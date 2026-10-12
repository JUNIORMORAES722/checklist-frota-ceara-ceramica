const fs = require('fs');
const path = require('path');
const { abrirBanco, verificarIntegridade } = require('./banco');

function normalizarPlaca(valor) {
  return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function lerJson(arquivo) {
  const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!Array.isArray(dados.usuarios) || !Array.isArray(dados.checklists)) {
    throw new Error('O JSON de origem não tem usuarios e checklists.');
  }
  return dados;
}

function sinalizarQuilometragem(checklists) {
  const grupos = new Map();
  for (const checklist of checklists) {
    const placa = normalizarPlaca(checklist.placa);
    if (!grupos.has(placa)) grupos.set(placa, []);
    grupos.get(placa).push(checklist);
  }
  const flags = new Map();
  for (const lista of grupos.values()) {
    lista.sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.id).localeCompare(String(b.id)));
    let ultimoConfiavel = null;
    for (const checklist of lista) {
      const km = Number(checklist.km);
      const numeroValido = Number.isInteger(km) && km >= 0;
      const confiavel = numeroValido && (ultimoConfiavel === null || km >= ultimoConfiavel);
      flags.set(checklist.id, confiavel ? 0 : 1);
      if (confiavel) ultimoConfiavel = km;
    }
  }
  return flags;
}

function migrar(opcoes) {
  const origem = path.resolve(opcoes.origem);
  const destino = path.resolve(opcoes.destino);
  const dados = lerJson(origem);
  const flags = sinalizarQuilometragem(dados.checklists);
  const db = abrirBanco(destino);

  db.exec('BEGIN IMMEDIATE');
  try {
    const ids = dados.checklists.map(c => String(c.id));
    const jaExistem = ids.filter(id => db.prepare('SELECT 1 AS ok FROM checklists WHERE id = ?').get(id));
    if (jaExistem.length === ids.length && ids.length > 0) {
      db.exec('ROLLBACK');
      const integridade = verificarIntegridade(db);
      return {
        jaMigrado: true,
        usuarios: db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n,
        checklists: db.prepare('SELECT COUNT(*) AS n FROM checklists').get().n,
        veiculos: db.prepare('SELECT COUNT(*) AS n FROM veiculos').get().n,
        joaoDaSilva: db.prepare("SELECT COUNT(*) AS n FROM checklists WHERE motorista = 'João da Silva'").get().n,
        kmInconsistentes: db.prepare('SELECT COUNT(*) AS n FROM checklists WHERE km_inconsistente = 1').get().n,
        integridade
      };
    }
    if (jaExistem.length > 0) {
      throw new Error('O banco já contém parte destes checklists. A importação foi interrompida para não duplicar registros.');
    }

    const inserirUsuario = db.prepare(`
      INSERT INTO usuarios (id, nome, usuario, senha, tipo)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const usuario of dados.usuarios) {
      inserirUsuario.run(String(usuario.id), usuario.nome, usuario.usuario, usuario.senha, usuario.tipo);
    }

    const placas = new Map();
    for (const checklist of dados.checklists) {
      const placa = normalizarPlaca(checklist.placa);
      if (placa && !placas.has(placa)) placas.set(placa, `Veículo ${placa}`);
    }
    const inserirVeiculo = db.prepare(`
      INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, 1)
    `);
    for (const [placa, descricao] of placas) {
      inserirVeiculo.run(`vei_${placa}`, placa, descricao);
    }

    const usuariosPorNome = new Map();
    for (const usuario of dados.usuarios) {
      usuariosPorNome.set(String(usuario.nome || '').trim().toLowerCase(), String(usuario.id));
    }

    const inserirChecklist = db.prepare(`
      INSERT INTO checklists (
        id, data, hora, placa, veiculo_id, motorista, usuario_id, km,
        km_inconsistente, combustivel, status, itens_nao_ok, obs,
        foto_arquivo, foto_original, criado_em
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);
    const inserirPendencia = db.prepare(`
      INSERT INTO pendencias (id, checklist_id, item, situacao, responsavel, aberto_em)
      VALUES (?, ?, ?, 'aberta', NULL, ?)
    `);

    dados.checklists.forEach((checklist, indice) => {
      const placa = normalizarPlaca(checklist.placa);
      const itens = Array.isArray(checklist.itensNaoOk) ? checklist.itensNaoOk.map(item => String(item)) : [];
      const nome = String(checklist.motorista || '');
      inserirChecklist.run(
        String(checklist.id),
        checklist.data || '',
        placa,
        placas.has(placa) ? `vei_${placa}` : null,
        nome,
        usuariosPorNome.get(nome.trim().toLowerCase()) || null,
        Number.isInteger(Number(checklist.km)) ? Number(checklist.km) : null,
        flags.get(checklist.id) || 0,
        checklist.combustivel || '',
        checklist.status || (itens.length ? 'PENDENTE' : 'OK'),
        JSON.stringify(itens),
        checklist.obs || '',
        checklist.foto ? String(checklist.foto) : null,
        `${checklist.data || '1970-01-01'}T00:00:00.000Z`
      );
      itens.forEach((item, itemIndice) => {
        inserirPendencia.run(`pen_${checklist.id}_${itemIndice}`, String(checklist.id), item, checklist.data || '');
      });
    });

    db.prepare(`
      INSERT INTO migracao_controle (origem, executado_em, usuarios, checklists)
      VALUES (?, ?, ?, ?)
    `).run(origem, new Date().toISOString(), dados.usuarios.length, dados.checklists.length);

    const usuarios = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    const checklists = db.prepare('SELECT COUNT(*) AS n FROM checklists').get().n;
    const veiculos = db.prepare('SELECT COUNT(*) AS n FROM veiculos').get().n;
    const joaoDaSilva = db.prepare("SELECT COUNT(*) AS n FROM checklists WHERE motorista = 'João da Silva'").get().n;
    const kmInconsistentes = db.prepare('SELECT COUNT(*) AS n FROM checklists WHERE km_inconsistente = 1').get().n;
    if (usuarios !== dados.usuarios.length || checklists !== dados.checklists.length) {
      throw new Error('A contagem depois da migração não confere com o JSON.');
    }

    db.exec('COMMIT');
    const integridade = verificarIntegridade(db);
    return { jaMigrado: false, usuarios, checklists, veiculos, joaoDaSilva, kmInconsistentes, integridade };
  } catch (erro) {
    try { db.exec('ROLLBACK'); } catch { /* transação já encerrada */ }
    throw erro;
  } finally {
    db.close();
  }
}

module.exports = { migrar, normalizarPlaca, sinalizarQuilometragem };
