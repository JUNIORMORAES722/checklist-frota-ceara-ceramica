const fs = require('fs');
const path = require('path');

const DESCRICOES = {
  '001_esquema_inicial': 'Tabelas, chaves, índices e versão do esquema PostgreSQL.'
};

function validarSqlSeguro(sql) {
  const semComentarios = String(sql).replace(/--[^\n]*/g, '').replace(/\bON\s+DELETE\s+CASCADE\b/gi, '');
  if (/\b(DROP|TRUNCATE|DELETE|GRANT|REVOKE|COPY)\b/i.test(semComentarios)) {
    throw new Error('A migração contém um comando destrutivo e foi recusada.');
  }
}

function separarComandos(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((parte) => parte.trim())
    .filter(Boolean);
}

async function tabelaDeVersao(db) {
  const linha = await db.get(
    "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migracoes'"
  );
  return Boolean(linha);
}

async function aplicarMigracoes(db, diretorio) {
  const pasta = diretorio || path.join(__dirname, '..', 'migrations');
  const arquivos = fs.readdirSync(pasta).filter((nome) => nome.endsWith('.sql')).sort();
  const aplicadas = new Set();
  if (await tabelaDeVersao(db)) {
    const linhas = await db.all('SELECT versao FROM schema_migracoes');
    for (const linha of linhas) aplicadas.add(linha.versao);
  }
  const novas = [];
  for (const arquivo of arquivos) {
    const versao = arquivo.replace(/\.sql$/, '');
    if (aplicadas.has(versao)) continue;
    const sql = fs.readFileSync(path.join(pasta, arquivo), 'utf8');
    validarSqlSeguro(sql);
    const comandos = separarComandos(sql);
    await db.transaction(async (tx) => {
      for (const comando of comandos) await tx.run(comando);
      await tx.run(
        'INSERT INTO schema_migracoes (versao, descricao, aplicada_em) VALUES (?, ?, ?)',
        [versao, DESCRICOES[versao] || versao, new Date().toISOString()]
      );
    });
    novas.push(versao);
  }
  return { aplicadas: novas, total: aplicadas.size + novas.length };
}

module.exports = { validarSqlSeguro, separarComandos, aplicarMigracoes };
