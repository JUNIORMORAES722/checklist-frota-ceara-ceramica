const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { ESQUEMA } = require('./esquema');

function abrirBanco(arquivo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(ESQUEMA);
  return db;
}

function verificarIntegridade(db) {
  const resultado = db.prepare('PRAGMA integrity_check').get();
  const valor = resultado.integrity_check || resultado['integrity_check'];
  if (valor !== 'ok') {
    throw new Error('A verificação de integridade do SQLite falhou.');
  }
  return valor;
}

module.exports = { abrirBanco, verificarIntegridade };
