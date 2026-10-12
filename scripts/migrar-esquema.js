const path = require('path');
const { carregarAmbiente } = require('../lib/ambiente');
const { validarUrlPostgres, criarPoolPostgres, adaptadorPostgres } = require('../lib/adaptador');
const { aplicarMigracoes } = require('../lib/migrar-esquema');

carregarAmbiente(path.join(__dirname, '..'));

async function main() {
  const validacao = validarUrlPostgres(process.env.DATABASE_URL);
  if (!validacao.ok) {
    console.error('Defina DATABASE_URL com uma URL PostgreSQL antes de migrar o esquema. O valor não é exibido.');
    process.exit(1);
  }
  const pool = criarPoolPostgres(process.env.DATABASE_URL.trim());
  const db = adaptadorPostgres(pool);
  try {
    const resultado = await aplicarMigracoes(db, path.join(__dirname, '..', 'migrations'));
    console.log(JSON.stringify({ ok: true, aplicadas: resultado.aplicadas, total: resultado.total }));
  } finally {
    await db.close();
  }
}

main().catch((erro) => {
  console.error('A migração do esquema foi interrompida.');
  process.exit(1);
});
