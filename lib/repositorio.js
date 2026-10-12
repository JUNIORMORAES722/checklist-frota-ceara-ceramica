const crypto = require('crypto');
const { ITENS_CHECKLIST, COMBUSTIVEIS } = require('./itens');
const { salvarFoto, apagarFoto } = require('./fotos');

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function novoId(prefixo) {
  return `${prefixo}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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
  return ITENS_CHECKLIST.filter(item => marcados.has(item));
}

function lerItens(texto) {
  try {
    const lista = JSON.parse(texto || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
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
  return {
    id: row.id,
    data: row.data,
    hora: row.hora || '',
    placa: row.placa,
    veiculoId: row.veiculo_id,
    descricaoVeiculo: row.descricao || '',
    motorista: row.motorista,
    km: row.km,
    kmInconsistente: row.km_inconsistente === 1,
    kmJustificativa: row.km_justificativa || '',
    combustivel: row.combustivel || '',
    status: row.status,
    itensNaoOk: lerItens(row.itens_nao_ok),
    obs: row.obs || '',
    temFoto: Boolean(row.foto_arquivo),
    pendencias: pendencias || []
  };
}

function pendenciasDe(db, checklistId) {
  return db.prepare(`
    SELECT * FROM pendencias WHERE checklist_id = ? ORDER BY id
  `).all(checklistId).map(mapearPendencia);
}

function obterLinha(db, id) {
  return db.prepare(`
    SELECT c.*, v.descricao
    FROM checklists c
    LEFT JOIN veiculos v ON v.id = c.veiculo_id
    WHERE c.id = ?
  `).get(id);
}

function podeVer(usuario, row) {
  if (!row) return false;
  if (usuario.tipo === 'gestor') return true;
  if (usuario.tipo !== 'motorista') return false;
  if (row.usuario_id && row.usuario_id === usuario.id) return true;
  return String(row.motorista || '').trim().toLowerCase() === String(usuario.nome || '').trim().toLowerCase();
}

function buscarUsuario(db, usuario, tipo) {
  return db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND tipo = ?').get(usuario, tipo);
}

function listarVeiculos(db, usuario) {
  if (usuario.tipo === 'gestor') {
    return db.prepare('SELECT id, placa, descricao, ativo FROM veiculos ORDER BY placa').all();
  }
  return db.prepare('SELECT id, placa, descricao, ativo FROM veiculos WHERE ativo = 1 ORDER BY placa').all()
    .map(v => ({ ...v, ativo: 1 }));
}

function criarVeiculo(db, placaBruta, descricao) {
  const placa = String(placaBruta || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) {
    throw new ErroHttp(400, 'Informe uma placa válida, no padrão antigo ou Mercosul.');
  }
  const texto = String(descricao || '').trim();
  if (texto.length < 3) throw new ErroHttp(400, 'Informe uma identificação do veículo.');
  const existe = db.prepare('SELECT id FROM veiculos WHERE placa = ?').get(placa);
  if (existe) throw new ErroHttp(409, 'Esta placa já está cadastrada.');
  const id = `vei_${placa}`;
  db.prepare('INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, 1)').run(id, placa, texto);
  return db.prepare('SELECT id, placa, descricao, ativo FROM veiculos WHERE id = ?').get(id);
}

function definirVeiculoAtivo(db, id, ativo) {
  const veiculo = db.prepare('SELECT id FROM veiculos WHERE id = ?').get(id);
  if (!veiculo) throw new ErroHttp(404, 'Veículo não encontrado.');
  db.prepare('UPDATE veiculos SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
  return db.prepare('SELECT id, placa, descricao, ativo FROM veiculos WHERE id = ?').get(id);
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

function listarChecklists(db, usuario, query) {
  const filtros = filtrosDe(usuario, query);
  const where = whereChecklist(filtros);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM checklists c WHERE ${where.sql}`).get(...where.params).n;
  const conformes = db.prepare(`SELECT COUNT(*) AS n FROM checklists c WHERE ${where.sql} AND c.status = 'OK'`).get(...where.params).n;
  const pendencias = db.prepare(`SELECT COUNT(*) AS n FROM checklists c WHERE ${where.sql} AND c.status <> 'OK'`).get(...where.params).n;
  const veiculosComPendencia = db.prepare(`
    SELECT COUNT(DISTINCT c.placa) AS n
    FROM checklists c
    JOIN pendencias p ON p.checklist_id = c.id AND p.situacao = 'aberta'
    WHERE ${where.sql}
  `).get(...where.params).n;

  const limite = Math.min(Math.max(Number.parseInt(query.limite, 10) || 8, 1), 50);
  const pagina = Math.max(Number.parseInt(query.pagina, 10) || 1, 1);
  const offset = (pagina - 1) * limite;
  const linhas = db.prepare(`
    SELECT c.*, v.descricao
    FROM checklists c
    LEFT JOIN veiculos v ON v.id = c.veiculo_id
    WHERE ${where.sql}
    ORDER BY c.data DESC, c.id DESC
    LIMIT ? OFFSET ?
  `).all(...where.params, limite, offset);

  return {
    itens: linhas.map(row => mapearChecklist(row, pendenciasDe(db, row.id))),
    total,
    pagina,
    limite,
    indicadores: { total, conformes, pendencias, veiculosComPendencia }
  };
}

function obterChecklist(db, usuario, id) {
  const row = obterLinha(db, id);
  if (!row || !podeVer(usuario, row)) return null;
  return { row, checklist: mapearChecklist(row, pendenciasDe(db, row.id)) };
}

function criarChecklist(db, usuario, entrada, pastaFotos) {
  if (usuario.tipo !== 'motorista') throw new ErroHttp(403, 'Apenas motoristas podem criar checklists.');
  const veiculo = db.prepare('SELECT * FROM veiculos WHERE id = ?').get(entrada.veiculoId);
  if (!veiculo || veiculo.ativo !== 1) throw new ErroHttp(400, 'Selecione um veículo ativo cadastrado.');
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

  db.exec('BEGIN IMMEDIATE');
  try {
    const recente = db.prepare(`
      SELECT * FROM checklists
      WHERE usuario_id = ? AND veiculo_id = ? AND data = ? AND km = ? AND itens_nao_ok = ? AND criado_em >= ?
      ORDER BY criado_em DESC LIMIT 1
    `).get(usuario.id, veiculo.id, entrada.data, km, itensJson, limiteRecente);
    if (recente) {
      db.exec('COMMIT');
      const completo = obterLinha(db, recente.id);
      return { checklist: mapearChecklist(completo, pendenciasDe(db, recente.id)), duplicado: true };
    }

    const ultimo = db.prepare(`
      SELECT MAX(km) AS km FROM checklists
      WHERE placa = ? AND km_inconsistente = 0 AND km IS NOT NULL
    `).get(veiculo.placa);
    if (ultimo && ultimo.km !== null && km < ultimo.km) {
      throw new ErroHttp(409, `A quilometragem é menor que o último registro confiável deste veículo (${ultimo.km} km).`);
    }

    const id = novoId('id');
    if (entrada.fotoBuffer) fotoCriada = salvarFoto(pastaFotos, id, entrada.fotoBuffer);
    const agora = new Date().toISOString();
    const status = itens.length > 0 ? 'PENDENTE' : 'OK';
    db.prepare(`
      INSERT INTO checklists (
        id, data, hora, placa, veiculo_id, motorista, usuario_id, km,
        km_inconsistente, combustivel, status, itens_nao_ok, obs,
        foto_arquivo, criado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      id, entrada.data, entrada.hora, veiculo.placa, veiculo.id, usuario.nome, usuario.id,
      km, entrada.combustivel, status, itensJson, obs, fotoCriada || null, agora
    );
    itens.forEach((item, indice) => {
      db.prepare(`
        INSERT INTO pendencias (id, checklist_id, item, situacao, aberto_em)
        VALUES (?, ?, ?, 'aberta', ?)
      `).run(`pen_${id}_${indice}`, id, item, entrada.data);
    });
    db.exec('COMMIT');
    const completo = obterLinha(db, id);
    return { checklist: mapearChecklist(completo, pendenciasDe(db, id)), duplicado: false };
  } catch (erro) {
    try { db.exec('ROLLBACK'); } catch { /* já encerrada */ }
    if (fotoCriada) apagarFoto(pastaFotos, fotoCriada);
    throw erro;
  }
}

function corrigirQuilometragem(db, id, kmValor, justificativa) {
  const km = interpretarKm(kmValor);
  if (km === null || km < 0) throw new ErroHttp(400, 'Informe uma quilometragem inteira igual ou maior que zero.');
  const texto = String(justificativa || '').trim();
  if (texto.length < 10) throw new ErroHttp(400, 'Descreva a justificativa da correção com pelo menos 10 caracteres.');
  const row = obterLinha(db, id);
  if (!row) throw new ErroHttp(404, 'Checklist não encontrado.');
  db.prepare(`
    UPDATE checklists SET km = ?, km_inconsistente = 0, km_justificativa = ? WHERE id = ?
  `).run(km, texto, id);
  return mapearChecklist(obterLinha(db, id), pendenciasDe(db, id));
}

function atualizarPendencia(db, id, entrada) {
  const row = db.prepare('SELECT * FROM pendencias WHERE id = ?').get(id);
  if (!row) throw new ErroHttp(404, 'Pendência não encontrada.');
  const situacao = entrada.situacao === 'concluida' ? 'concluida' : 'aberta';
  const responsavel = String(entrada.responsavel || '').trim().slice(0, 120);
  const observacao = String(entrada.observacaoResolucao || '').trim().slice(0, 2000);
  const concluido = situacao === 'concluida' ? (row.concluido_em || new Date().toISOString().slice(0, 10)) : null;
  db.prepare(`
    UPDATE pendencias
    SET situacao = ?, responsavel = ?, observacao_resolucao = ?, concluido_em = ?
    WHERE id = ?
  `).run(situacao, responsavel, observacao, concluido, id);
  return mapearPendencia(db.prepare('SELECT * FROM pendencias WHERE id = ?').get(id));
}

function excluirChecklist(db, id, pastaFotos) {
  const row = obterLinha(db, id);
  if (!row) throw new ErroHttp(404, 'Checklist não encontrado.');
  db.prepare('DELETE FROM checklists WHERE id = ?').run(id);
  if (row.foto_arquivo) apagarFoto(pastaFotos, row.foto_arquivo);
  return { sucesso: true };
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
  excluirChecklist
};
