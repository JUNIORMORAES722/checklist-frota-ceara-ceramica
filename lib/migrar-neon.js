const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const REFERENCIA = { usuarios: 3, veiculos: 6, checklists: 10, pendencias: 8 };
const TABELAS = ['usuarios', 'veiculos', 'checklists', 'pendencias'];

function caminhoOperacional(raiz) {
  return path.resolve(raiz || path.join(__dirname, '..'), 'data', 'frota.sqlite');
}

function mesmoArquivo(origem, destino) {
  const normal = (valor) => path.resolve(valor).replace(/\\/g, '/').toLowerCase();
  return normal(origem) === normal(destino);
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function lerBytesFoto(pasta, nome) {
  if (!nome) return { buffer: null, ausente: false };
  if (!pasta) return { buffer: null, ausente: true };
  const base = path.resolve(pasta);
  const nomeSeguro = path.basename(String(nome));
  if (!nomeSeguro || nomeSeguro === '.' || nomeSeguro === '..') return { buffer: null, ausente: true };
  const arquivo = path.resolve(base, nomeSeguro);
  if (!arquivo.startsWith(base + path.sep) || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    return { buffer: null, ausente: true };
  }
  return { buffer: fs.readFileSync(arquivo), ausente: false };
}

function lerCopia(origem) {
  const db = new DatabaseSync(path.resolve(origem), { readOnly: true });
  try {
    return {
      usuarios: db.prepare('SELECT id, nome, usuario, senha, tipo FROM usuarios ORDER BY id').all(),
      veiculos: db.prepare('SELECT id, placa, descricao, ativo FROM veiculos ORDER BY id').all(),
      checklists: db.prepare(`
        SELECT id, data, hora, placa, veiculo_id, motorista, usuario_id, km, km_inconsistente,
               km_justificativa, combustivel, status, itens_nao_ok, obs, foto_arquivo, foto_original, criado_em
        FROM checklists ORDER BY id
      `).all(),
      pendencias: db.prepare(`
        SELECT id, checklist_id, item, situacao, responsavel, aberto_em, observacao_resolucao, concluido_em
        FROM pendencias ORDER BY id
      `).all()
    };
  } finally {
    db.close();
  }
}

function conferirCopia(dados) {
  const ids = (linhas) => {
    const vistos = new Set();
    for (const linha of linhas) {
      const id = String(linha.id);
      if (vistos.has(id)) return null;
      vistos.add(id);
    }
    return vistos;
  };
  const mapas = {
    usuarios: ids(dados.usuarios),
    veiculos: ids(dados.veiculos),
    checklists: ids(dados.checklists),
    pendencias: ids(dados.pendencias)
  };
  if (Object.values(mapas).some((mapa) => !mapa)) {
    throw new Error('A cópia tem identificadores repetidos. Nada foi gravado.');
  }
  const tiposInvalidos = dados.usuarios.filter((usuario) => usuario.tipo !== 'motorista' && usuario.tipo !== 'gestor').length;
  const ativosInvalidos = dados.veiculos.filter((veiculo) => numero(veiculo.ativo) !== 0 && numero(veiculo.ativo) !== 1).length;
  const situacoesInvalidas = dados.pendencias.filter((pendencia) => pendencia.situacao !== 'aberta' && pendencia.situacao !== 'concluida').length;
  const veiculosOrfaos = dados.checklists.filter((checklist) => checklist.veiculo_id && !mapas.veiculos.has(String(checklist.veiculo_id))).length;
  const pendenciasOrfas = dados.pendencias.filter((pendencia) => !mapas.checklists.has(String(pendencia.checklist_id))).length;
  if (tiposInvalidos || ativosInvalidos || situacoesInvalidas || veiculosOrfaos || pendenciasOrfas) {
    throw new Error(`A cópia tem inconsistências (tipos=${tiposInvalidos}, ativos=${ativosInvalidos}, situacoes=${situacoesInvalidas}, veiculos=${veiculosOrfaos}, pendencias=${pendenciasOrfas}). Nada foi gravado.`);
  }
  return {
    mapas,
    vinculosUsuarioAusentes: dados.checklists.filter((checklist) => !checklist.usuario_id || !mapas.usuarios.has(String(checklist.usuario_id))).length,
    kmInconsistentes: dados.checklists.filter((checklist) => numero(checklist.km_inconsistente) === 1).length
  };
}

async function contarDestino(db) {
  const totais = {};
  for (const tabela of TABELAS) {
    const linha = await db.get(`SELECT COUNT(*) AS n FROM ${tabela}`);
    totais[tabela] = numero(linha && linha.n);
  }
  return totais;
}

async function idsEstranhos(db, tabela, idsOrigem) {
  const linhas = await db.all(`SELECT id FROM ${tabela}`);
  return linhas.filter((linha) => !idsOrigem.has(String(linha.id))).length;
}

async function migrarCopiaSqlite(opcoes) {
  const origem = path.resolve(opcoes.origem);
  const operacional = caminhoOperacional(opcoes.raiz);
  if (mesmoArquivo(origem, operacional)) {
    throw new Error('O script não abre o banco operacional. Use uma cópia do SQLite.');
  }
  if (!fs.existsSync(origem)) throw new Error('A cópia SQLite não foi encontrada. Nada foi gravado.');
  const dados = lerCopia(origem);
  const conferencia = conferirCopia(dados);
  let fotosAusentes = 0;
  const fotos = dados.checklists.map((checklist) => {
    const lida = lerBytesFoto(opcoes.fotos, checklist.foto_arquivo);
    if (lida.ausente) fotosAusentes += 1;
    return lida.buffer;
  });

  const relatorio = await opcoes.db.transaction(async (tx) => {
    const antes = await contarDestino(tx);
    const ocupado = TABELAS.reduce((soma, tabela) => soma + antes[tabela], 0);
    if (ocupado > 0 && !opcoes.retomar) {
      throw new Error('O destino já contém dados. Nada foi gravado.');
    }
    if (opcoes.retomar) {
      const pares = [
        ['usuarios', conferencia.mapas.usuarios],
        ['veiculos', conferencia.mapas.veiculos],
        ['checklists', conferencia.mapas.checklists],
        ['pendencias', conferencia.mapas.pendencias]
      ];
      for (const [tabela, ids] of pares) {
        if (await idsEstranhos(tx, tabela, ids)) {
          throw new Error('O destino contém registros que não estão na cópia. Nada foi gravado.');
        }
      }
    }

    for (const usuario of dados.usuarios) {
      const existe = await tx.get('SELECT id FROM usuarios WHERE id = ?', [String(usuario.id)]);
      if (existe) continue;
      await tx.run(
        'INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)',
        [String(usuario.id), usuario.nome, usuario.usuario, usuario.senha, usuario.tipo]
      );
    }
    for (const veiculo of dados.veiculos) {
      const existe = await tx.get('SELECT id FROM veiculos WHERE id = ?', [String(veiculo.id)]);
      if (existe) continue;
      await tx.run(
        'INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, ?)',
        [String(veiculo.id), veiculo.placa, veiculo.descricao, numero(veiculo.ativo)]
      );
    }
    for (let indice = 0; indice < dados.checklists.length; indice += 1) {
      const checklist = dados.checklists[indice];
      const existe = await tx.get('SELECT id FROM checklists WHERE id = ?', [String(checklist.id)]);
      if (existe) continue;
      await tx.run(`
        INSERT INTO checklists (
          id, data, hora, placa, veiculo_id, motorista, usuario_id, km, km_inconsistente,
          km_justificativa, combustivel, status, itens_nao_ok, obs, foto_arquivo, foto_original,
          foto_conteudo, criado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        String(checklist.id), checklist.data, checklist.hora, checklist.placa, checklist.veiculo_id,
        checklist.motorista, checklist.usuario_id, checklist.km, numero(checklist.km_inconsistente),
        checklist.km_justificativa, checklist.combustivel, checklist.status, checklist.itens_nao_ok,
        checklist.obs, checklist.foto_arquivo, checklist.foto_original, fotos[indice], checklist.criado_em
      ]);
    }
    for (const pendencia of dados.pendencias) {
      const existe = await tx.get('SELECT id FROM pendencias WHERE id = ?', [String(pendencia.id)]);
      if (existe) continue;
      await tx.run(`
        INSERT INTO pendencias (
          id, checklist_id, item, situacao, responsavel, aberto_em, observacao_resolucao, concluido_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        String(pendencia.id), String(pendencia.checklist_id), pendencia.item, pendencia.situacao,
        pendencia.responsavel, pendencia.aberto_em, pendencia.observacao_resolucao, pendencia.concluido_em
      ]);
    }

    const destino = await contarDestino(tx);
    const origemTotais = {
      usuarios: dados.usuarios.length,
      veiculos: dados.veiculos.length,
      checklists: dados.checklists.length,
      pendencias: dados.pendencias.length
    };
    const conferem = TABELAS.every((tabela) => destino[tabela] === origemTotais[tabela]);
    if (!conferem) throw new Error('A contagem do destino não confere com a cópia. A gravação foi desfeita.');
    return {
      retomado: Boolean(opcoes.retomar && ocupado > 0),
      origem: origemTotais,
      destino,
      conferem,
      vinculosUsuarioAusentes: conferencia.vinculosUsuarioAusentes,
      kmInconsistentes: conferencia.kmInconsistentes,
      fotosAusentes,
      referenciaConhecida: REFERENCIA,
      confereComReferencia: TABELAS.every((tabela) => origemTotais[tabela] === REFERENCIA[tabela])
    };
  });
  return relatorio;
}

module.exports = {
  REFERENCIA,
  caminhoOperacional,
  mesmoArquivo,
  migrarCopiaSqlite
};
