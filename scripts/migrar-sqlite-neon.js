const fs = require('fs');
const path = require('path');
const { carregarAmbiente } = require('../lib/ambiente');
const { validarUrlPostgres, criarPoolPostgres, adaptadorPostgres, redigirTexto } = require('../lib/adaptador');
const { aplicarMigracoes } = require('../lib/migrar-esquema');
const { migrarCopiaSqlite, caminhoOperacional, mesmoArquivo } = require('../lib/migrar-neon');

carregarAmbiente(path.join(__dirname, '..'));

function argumento(nome) {
  const indice = process.argv.indexOf(nome);
  if (indice < 0 || !process.argv[indice + 1]) return '';
  return process.argv[indice + 1];
}

async function main() {
  const origem = argumento('--origem');
  if (!origem) {
    console.error('Informe --origem com o caminho de uma cópia do SQLite.');
    process.exit(1);
  }
  const resolvida = path.resolve(origem);
  if (mesmoArquivo(resolvida, caminhoOperacional(path.join(__dirname, '..')))) {
    console.error('O script não abre o banco operacional. Use uma cópia do SQLite.');
    process.exit(1);
  }
  if (!fs.existsSync(resolvida)) {
    console.error('A cópia SQLite não foi encontrada.');
    process.exit(1);
  }
  const validacao = validarUrlPostgres(process.env.DATABASE_URL);
  if (!validacao.ok) {
    console.error('Defina DATABASE_URL com uma URL PostgreSQL. O valor não é exibido.');
    process.exit(1);
  }
  const pool = criarPoolPostgres(process.env.DATABASE_URL.trim());
  const db = adaptadorPostgres(pool);
  try {
    await aplicarMigracoes(db, path.join(__dirname, '..', 'migrations'));
    const relatorio = await migrarCopiaSqlite({
      origem: resolvida,
      fotos: argumento('--fotos'),
      retomar: process.argv.includes('--retomar'),
      db,
      raiz: path.join(__dirname, '..')
    });
    console.log(JSON.stringify({ ok: true, ...relatorio }));
  } finally {
    await db.close();
  }
}

main().catch((erro) => {
  console.error(redigirTexto(erro && erro.message ? erro.message : 'A migração dos dados foi interrompida.'));
  process.exit(1);
});
