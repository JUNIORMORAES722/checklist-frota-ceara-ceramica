const path = require('path');
const { restaurar } = require('../lib/backup');
const { pastaFotos } = require('../lib/fotos');

function argumento(nome) {
  const indice = process.argv.indexOf(nome);
  return indice >= 0 ? process.argv[indice + 1] : '';
}

const raiz = path.join(__dirname, '..');
const origem = argumento('--origem');
if (!origem) {
  console.error('Informe --origem com a pasta da cópia.');
  process.exit(1);
}

try {
  const resultado = restaurar({
    origem,
    banco: argumento('--banco') || process.env.SQLITE_PATH || path.join(raiz, 'data', 'frota.sqlite'),
    fotos: argumento('--fotos') || process.env.FOTOS_PATH || pastaFotos(path.join(raiz, 'data', 'fotos'))
  });
  console.log(JSON.stringify({ ok: true, ...resultado }));
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}
