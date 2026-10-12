const path = require('path');
const { carregarAmbiente } = require('../lib/ambiente');
const { migrar } = require('../lib/migrar');

carregarAmbiente(path.join(__dirname, '..'));

const origem = process.env.JSON_PATH || path.join(__dirname, '..', 'db.json');
const destino = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'frota.sqlite');

try {
  const relatorio = migrar({ origem, destino });
  console.log(JSON.stringify(relatorio, null, 2));
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}
