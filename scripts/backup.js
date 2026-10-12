const path = require('path');
const { carregarAmbiente } = require('../lib/ambiente');
const { fazerBackup } = require('../lib/backup');
const { pastaFotos } = require('../lib/fotos');

carregarAmbiente(path.join(__dirname, '..'));

const raiz = path.join(__dirname, '..');
try {
  const resultado = fazerBackup({
    banco: process.env.SQLITE_PATH || path.join(raiz, 'data', 'frota.sqlite'),
    fotos: process.env.FOTOS_PATH || pastaFotos(path.join(raiz, 'data', 'fotos')),
    destino: process.env.BACKUP_DIR || path.join(raiz, 'backups'),
    retencaoDias: process.env.BACKUP_RETENCAO_DIAS || '14'
  });
  console.log(JSON.stringify({ ok: true, diretorio: resultado.diretorio, removidos: resultado.removidos }));
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}
