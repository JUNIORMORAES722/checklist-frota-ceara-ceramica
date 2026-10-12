const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function copiarPasta(origem, destino) {
  fs.rmSync(destino, { recursive: true, force: true });
  if (!fs.existsSync(origem)) {
    fs.mkdirSync(destino, { recursive: true });
    return;
  }
  fs.cpSync(origem, destino, { recursive: true });
}

function fazerBackup(opcoes) {
  const banco = path.resolve(opcoes.banco);
  const fotos = path.resolve(opcoes.fotos);
  const pasta = path.resolve(opcoes.destino);
  const retencao = Number.parseInt(opcoes.retencaoDias, 10) || 14;
  if (!fs.existsSync(banco)) throw new Error('Banco SQLite não encontrado para backup.');
  fs.mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const diretorio = path.join(pasta, carimbo);
  fs.mkdirSync(diretorio, { recursive: true });
  const arquivoSql = path.join(diretorio, 'frota.sqlite').replace(/\\/g, '/');
  const db = new DatabaseSync(banco);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`VACUUM INTO '${arquivoSql.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  copiarPasta(fotos, path.join(diretorio, 'fotos'));
  const removidos = aplicarRetencao(pasta, retencao);
  const registro = `${new Date().toISOString()} backup ok ${carimbo} retencao=${retencao} removidos=${removidos}\n`;
  fs.appendFileSync(path.join(pasta, 'backup.log'), registro);
  return { diretorio, removidos, retencao };
}

function aplicarRetencao(pasta, dias) {
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  let removidos = 0;
  for (const nome of fs.readdirSync(pasta)) {
    const completo = path.join(pasta, nome);
    if (!fs.statSync(completo).isDirectory()) continue;
    const momento = fs.statSync(completo).mtimeMs;
    if (momento < limite) {
      fs.rmSync(completo, { recursive: true, force: true });
      removidos += 1;
    }
  }
  return removidos;
}

function restaurar(opcoes) {
  const origem = path.resolve(opcoes.origem);
  const bancoDestino = path.resolve(opcoes.banco);
  const fotosDestino = path.resolve(opcoes.fotos);
  const arquivo = path.join(origem, 'frota.sqlite');
  if (!fs.existsSync(arquivo)) throw new Error('A cópia não contém frota.sqlite.');
  fs.mkdirSync(path.dirname(bancoDestino), { recursive: true });
  fs.copyFileSync(arquivo, bancoDestino);
  copiarPasta(path.join(origem, 'fotos'), fotosDestino);
  const db = new DatabaseSync(bancoDestino);
  try {
    const integridade = db.prepare('PRAGMA integrity_check').get();
    const valor = integridade.integrity_check;
    if (valor !== 'ok') throw new Error('A cópia restaurada não passou na verificação de integridade.');
    const checklists = db.prepare('SELECT COUNT(*) AS n FROM checklists').get().n;
    const usuarios = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    return { usuarios, checklists, integridade: valor };
  } finally {
    db.close();
  }
}

module.exports = { fazerBackup, restaurar };
