const crypto = require('crypto');
const { ITENS_CHECKLIST, COMBUSTIVEIS } = require('./itens');
const { salvarFoto, apagarFoto, nomeDeFoto, lerFotoDisco } = require('./fotos');

const COLUNAS_CHECKLIST = `
  c.id, c.data, c.hora, c.placa, c.veiculo_id, c.motorista, c.usuario_id,
  c.km, c.km_inconsistente, c.km_justificativa, c.combustivel, c.status,
  c.itens_nao_ok, c.obs, c.foto_arquivo, c.foto_original, c.criado_em,
  v.descricao
`;

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function novoId(prefixo) {
  return `${prefixo}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function interpretarKm(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor)) return valor;
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) return Number(valor.trim());
  return null;
}

function validarItensNovos(valor) {
  let lista = valor;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch { lista = []; }
  }
  if (!Array.isArray(lista)) throw new ErroHttp(400, 'Os itens da inspeção são inválidos.');
  const permitidos = new Set(ITENS_CHECKLIST);
  const marcados = new Set();
  for (const item of lista) {
    if (!permitidos.has(item)) throw new ErroHttp(400, 'Há um item de inspeção que não faz parte do checklist.');
    marcados.add(item);
  }
  return ITENS_CHECKLIST.filter((item) => marcados.has(item));
}

function lerItens(texto) {
  try {
    const lista = JSON.parse(texto || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function bytesDe(valor) {
  if (!valor) return null;
  if (Buffer.isBuffer(valor)) return valor;
  if (valor instanceof Uint8Array) return Buffer.from(valor);
  return null;
}

function mapearPendencia(row) {
  return {
    id: row.id,
    checklistId: row.checklist_id,
    item: row.item,
    situacao: row.situacao,
    responsavel: row.responsavel || '',
    abertoEm: row.aberto_em,
    observacaoResolucao: row.observacao_resolucao || '',
    concluidoEm: row.concluido_em || ''
  };
}

function mapearChecklist(row, pendencias) {
  const km = numero(row.km);
  return {
    id: row.id,
    data: row.data,
    hora: row.hora || '',
    placa: row.placa,
    veiculoId: row.veiculo_id,
    descricaoVeiculo: row.descricao || '',
    motorista: row.motorista,
    km,
    kmInconsistente: Number(row.km_inconsistente) === 1,
    kmJustificativa: row.km_justificativa || '',
    combustivel: row.combustivel || '',
    status: row.status,
    itensNaoOk: lerItens(row.itens_nao_ok),
    obs: row.obs || '',
    temFoto: Boolean(row.foto_arquivo),
    pendencias: pendencias || []
  };
}

function mapearVeiculo(row) {
  return {
    id: row.id,
    placa: row.placa,
    descricao: row.descricao,
    ativo: Number(row.ativo) ? 1 : 0
  };
}

async function pendenciasDe(db, checklistId) {
  const linhas = await db.all('SELECT * FROM pendencias WHERE checklist_id = ? ORDER BY id', [checklistId]);
  return linhas.map(mapearPendencia);
}

async function obterLinha(db, id) {
  return db.get(`
    SELECT ${COLUNAS_CHECKLIST}
    FROM checklists c
    LEFT JOIN veiculos v ON v.id = c.veiculo_id
    WHERE c.id = ?
  `, [id]);
}

function podeVer(usuario, row) {
  if (!row) return false;
  if (usuario.tipo === 'gestor') return true;
  if (usuario.tipo !== 'motorista') return false;
  if (row.usuario_id && row.usuario_id === usuario.id) return true;
  return String(row.motorista || '').trim().toLowerCase() === String(usuario.nome || '').trim().toLowerCase();
}

async function buscarUsuario(db, usuario, tipo) {
  return db.get('SELECT * FROM usuarios WHERE usuario = ? AND tipo = ?', [usuario, tipo]);
}

async function listarVeiculos(db, usuario) {
  if (usuario.tipo === 'gestor') {
    const linhas = await db.all('SELECT id, placa, descricao, ativo FROM veiculos ORDER BY placa');
    return linhas.map(mapearVeiculo);
  }
  const linhas = await db.all('SELECT id, placa, descricao, ativo FROM veiculos WHERE ativo = 1 ORDER BY placa');
  return linhas.map((veiculo) => ({ ...mapearVeiculo(veiculo), ativo: 1 }));
}

async function criarVeiculo(db, placaBruta, descricao) {
  const placa = String(placaBruta || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) {
    throw new ErroHttp(400, 'Informe uma placa válida, no padrão antigo ou Mercosul.');
  }
  const texto = String(descricao || '').trim();
  if (texto.length < 3) throw new ErroHttp(400, 'Informe uma identificação do veículo.');
  const existe = await db.get('SELECT id FROM veiculos WHERE placa = ?', [placa]);
  if (existe) throw new ErroHttp(409, 'Esta placa já está cadastrada.');
  const id = `vei_${placa}`;
  await db.run('INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, 1)', [id, placa, texto]);
  return mapearVeiculo(await db.get('SELECT id, placa, descricao, ativo FROM veiculos WHERE id = ?', [id]));
}

async function definirVeiculoAtivo(db, id, ativo) {
  const veiculo = await db.get('SELECT id FROM veiculos WHERE id = ?', [id]);
  if (!veiculo) throw new ErroHttp(404, 'Veículo não encontrado.');
  await db.run('UPDATE veiculos SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  return mapearVeiculo(await db.get('SELECT id, placa, descricao, ativo FROM veiculos WHERE id = ?', [id]));
}

function filtrosDe(usuario, query) {
  const dono = usuario.tipo === 'motorista' ? usuario : null;
  return {
    donoId: dono ? dono.id : null,
    donoNome: dono ? String(dono.nome || '').trim().toLowerCase() : null,
    placa: query.placa ? String(query.placa).trim().toLowerCase() : null,
    motorista: query.motorista ? String(query.motorista).trim().toLowerCase() : null,
    status: query.status ? String(query.status).trim().toUpperCase() : null,
    inicio: query.dataInicio || query.data || null,
    fim: query.dataFim || query.data || null
  };
}

function whereChecklist(filtros) {
  const clausulas = ['1 = 1'];
  const params = [];
  if (filtros.donoId) {
    clausulas.push('(c.usuario_id = ? OR (c.usuario_id IS NULL AND lower(c.motorista) = ?))');
    params.push(filtros.donoId, filtros.donoNome);
  }
  if (filtros.placa) {
    clausulas.push('lower(c.placa) LIKE ?');
    params.push(`%${filtros.placa.replace(/[%_]/g, '')}%`);
  }
  if (filtros.motorista) {
    clausulas.push('lower(c.motorista) LIKE ?');
    params.push(`%${filtros.motorista.replace(/[%_]/g, '')}%`);
  }
  if (filtros.status === 'OK' || filtros.status === 'PENDENTE') {
    clausulas.push('c.status = ?');
    params.push(filtros.status);
  }
  if (filtros.inicio) {
    clausulas.push('c.data >= ?');
    params.push(filtros.inicio);
  }
  if (filtros.fim) {
    clausulas.push('c.data <= ?');
    params.push(filtros.fim);
  }
  return { sql: clausulas.join(' AND '), params };
}

async function contar(db, sql, params) {
  const linha = await db.get(sql, params);
  return numero(linha && linha.n) || 0;
}

async function listarChecklists(db, usuario, consulta) {
  const query = consulta || {};
  const filtros = filtrosDe(usuario, query);
  const where = whereChecklist(filtros);
  const total = await contar(db, `SELECT COUNT(*) AS n FROM checklists c WHERE ${where.sql}`, where.params);
  const conformes = await contar(db, `SELECT COUNT(*) AS n FROM checklists c WHERE ${where.sql} AND c.status = 'OK'`, where.params);
  const pendencias = await contar(db, `SELECT COUNT(*) AS n FROM checklists c WHERE ${where.sql} AND c.status <> 'OK'`, where.params);
  const veiculosComPendencia = await contar(db, `
    SELECT COUNT(DISTINCT c.placa) AS n
    FROM checklists c
    JOIN pendencias p ON p.checklist_id = c.id AND p.situacao = 'aberta'
    WHERE ${where.sql}
  `, where.params);

  const limite = Math.min(Math.max(Number.parseInt(query.limite, 10) || 8, 1), 50);
  const pagina = Math.max(Number.parseInt(query.pagina, 10) || 1, 1);
  const offset = (pagina - 1) * limite;
  const linhas = await db.all(`
    SELECT ${COLUNAS_CHECKLIST}
    FROM checklists c
    LEFT JOIN veiculos v ON v.id = c.veiculo_id
    WHERE ${where.sql}
    ORDER BY c.data DESC, c.id DESC
    LIMIT ? OFFSET ?
  `, [...where.params, limite, offset]);
  const itens = [];
  for (const row of linhas) itens.push(mapearChecklist(row, await pendenciasDe(db, row.id)));

  return {
    itens,
    total,
    pagina,
    limite,
    indicadores: { total, conformes, pendencias, veiculosComPendencia }
  };
}

async function obterChecklist(db, usuario, id) {
  const row = await obterLinha(db, id);
  if (!row || !podeVer(usuario, row)) return null;
  return { row, checklist: mapearChecklist(row, await pendenciasDe(db, id)) };
}

async function criarChecklist(db, usuario, entrada, pastaFotos) {
  if (usuario.tipo !== 'motorista') throw new ErroHttp(403, 'Apenas motoristas podem criar checklists.');
  const veiculo = await db.get('SELECT * FROM veiculos WHERE id = ?', [entrada.veiculoId]);
  if (!veiculo || Number(veiculo.ativo) !== 1) throw new ErroHttp(400, 'Selecione um veículo ativo cadastrado.');
  const km = interpretarKm(entrada.km);
  if (km === null || km < 0) throw new ErroHttp(400, 'Informe uma quilometragem inteira igual ou maior que zero.');
  if (!COMBUSTIVEIS.includes(entrada.combustivel)) throw new ErroHttp(400, 'Selecione o nível de combustível.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.data || '')) throw new ErroHttp(400, 'Informe a data da inspeção.');
  if (!/^\d{2}:\d{2}$/.test(entrada.hora || '')) throw new ErroHttp(400, 'Informe a hora da inspeção.');
  const itens = validarItensNovos(entrada.itensNaoOk);
  const obs = typeof entrada.obs === 'string' ? entrada.obs.slice(0, 2000) : '';
  const itensJson = JSON.stringify(itens);
  const limiteRecente = new Date(Date.now() - 60 * 1000).toISOString();
  let fotoCriada = '';

  try {
    return await db.transaction(async (tx) => {
      if (tx.dialect === 'postgres') {
        await tx.run('LOCK TABLE checklists IN SHARE ROW EXCLUSIVE MODE');
      }
      const recente = await tx.get(`
        SELECT id FROM checklists
        WHERE usuario_id = ? AND veiculo_id = ? AND data = ? AND km = ? AND itens_nao_ok = ? AND criado_em >= ?
        ORDER BY criado_em DESC LIMIT 1
      `, [usuario.id, veiculo.id, entrada.data, km, itensJson, limiteRecente]);
      if (recente) {
        const completo = await obterLinha(tx, recente.id);
        return { checklist: mapearChecklist(completo, await pendenciasDe(tx, recente.id)), duplicado: true };
      }

      const ultimo = await tx.get(`
        SELECT MAX(km) AS km FROM checklists
        WHERE placa = ? AND km_inconsistente = 0 AND km IS NOT NULL
      `, [veiculo.placa]);
      if (ultimo && ultimo.km !== null && ultimo.km !== undefined && km < Number(ultimo.km)) {
        throw new ErroHttp(409, `A quilometragem é menor que o último registro confiável deste veículo (${Number(ultimo.km)} km).`);
      }

      const id = novoId('id');
      let fotoNome = null;
      let fotoBytes = null;
      if (entrada.fotoBuffer) {
        if (db.dialect === 'postgres') {
          fotoNome = nomeDeFoto(id, entrada.fotoBuffer);
          fotoBytes = entrada.fotoBuffer;
        } else {
          fotoCriada = salvarFoto(pastaFotos, id, entrada.fotoBuffer);
          fotoNome = fotoCriada;
        }
      }
      const agora = new Date().toISOString();
      const status = itens.length > 0 ? 'PENDENTE' : 'OK';
      if (db.dialect === 'postgres') {
        await tx.run(`
          INSERT INTO checklists (
            id, data, hora, placa, veiculo_id, motorista, usuario_id, km,
            km_inconsistente, combustivel, status, itens_nao_ok, obs,
            foto_arquivo, foto_conteudo, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id, entrada.data, entrada.hora, veiculo.placa, veiculo.id, usuario.nome, usuario.id,
          km, entrada.combustivel, status, itensJson, obs, fotoNome, fotoBytes, agora
        ]);
      } else {
        await tx.run(`
          INSERT INTO checklists (
            id, data, hora, placa, veiculo_id, motorista, usuario_id, km,
            km_inconsistente, combustivel, status, itens_nao_ok, obs,
            foto_arquivo, criado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        `, [
          id, entrada.data, entrada.hora, veiculo.placa, veiculo.id, usuario.nome, usuario.id,
          km, entrada.combustivel, status, itensJson, obs, fotoNome, agora
        ]);
      }
      for (let indice = 0; indice < itens.length; indice += 1) {
        await tx.run(`
          INSERT INTO pendencias (id, checklist_id, item, situacao, aberto_em)
          VALUES (?, ?, ?, 'aberta', ?)
        `, [`pen_${id}_${indice}`, id, itens[indice], entrada.data]);
      }
      const completo = await obterLinha(tx, id);
      return { checklist: mapearChecklist(completo, await pendenciasDe(tx, id)), duplicado: false };
    });
  } catch (erro) {
    if (fotoCriada) apagarFoto(pastaFotos, fotoCriada);
    throw erro;
  }
}

async function corrigirQuilometragem(db, id, kmValor, justificativa) {
  const km = interpretarKm(kmValor);
  if (km === null || km < 0) throw new ErroHttp(400, 'Informe uma quilometragem inteira igual ou maior que zero.');
  const texto = String(justificativa || '').trim();
  if (texto.length < 10) throw new ErroHttp(400, 'Descreva a justificativa da correção com pelo menos 10 caracteres.');
  const row = await obterLinha(db, id);
  if (!row) throw new ErroHttp(404, 'Checklist não encontrado.');
  await db.run('UPDATE checklists SET km = ?, km_inconsistente = 0, km_justificativa = ? WHERE id = ?', [km, texto, id]);
  return mapearChecklist(await obterLinha(db, id), await pendenciasDe(db, id));
}

async function atualizarPendencia(db, id, entrada) {
  const row = await db.get('SELECT * FROM pendencias WHERE id = ?', [id]);
  if (!row) throw new ErroHttp(404, 'Pendência não encontrada.');
  const situacao = entrada.situacao === 'concluida' ? 'concluida' : 'aberta';
  const responsavel = String(entrada.responsavel || '').trim().slice(0, 120);
  const observacao = String(entrada.observacaoResolucao || '').trim().slice(0, 2000);
  const concluido = situacao === 'concluida' ? (row.concluido_em || new Date().toISOString().slice(0, 10)) : null;
  await db.run(`
    UPDATE pendencias
    SET situacao = ?, responsavel = ?, observacao_resolucao = ?, concluido_em = ?
    WHERE id = ?
  `, [situacao, responsavel, observacao, concluido, id]);
  return mapearPendencia(await db.get('SELECT * FROM pendencias WHERE id = ?', [id]));
}

async function excluirChecklist(db, id, pastaFotos) {
  const row = await obterLinha(db, id);
  if (!row) throw new ErroHttp(404, 'Checklist não encontrado.');
  await db.run('DELETE FROM checklists WHERE id = ?', [id]);
  if (db.dialect !== 'postgres' && row.foto_arquivo) apagarFoto(pastaFotos, row.foto_arquivo);
  return { sucesso: true };
}

async function lerFoto(db, usuario, id, pastaFotos) {
  const encontrado = await obterChecklist(db, usuario, id);
  if (!encontrado || !encontrado.row.foto_arquivo) return null;
  if (db.dialect === 'postgres') {
    const row = await db.get('SELECT foto_arquivo, foto_conteudo FROM checklists WHERE id = ?', [id]);
    const buffer = bytesDe(row && row.foto_conteudo);
    if (!row || !buffer) return null;
    return { nome: row.foto_arquivo, buffer };
  }
  const buffer = lerFotoDisco(pastaFotos, encontrado.row.foto_arquivo);
  if (!buffer) return null;
  return { nome: encontrado.row.foto_arquivo, buffer };
}

module.exports = {
  ErroHttp,
  buscarUsuario,
  listarVeiculos,
  criarVeiculo,
  definirVeiculoAtivo,
  listarChecklists,
  obterChecklist,
  criarChecklist,
  corrigirQuilometragem,
  atualizarPendencia,
  excluirChecklist,
  lerFoto
};
