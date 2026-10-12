const Busboy = require('busboy');
const { LIMITE_BYTES } = require('./fotos');

function lerMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: LIMITE_BYTES, fields: 20, fieldSize: 1024 * 1024 }
    });
    const fields = {};
    const arquivos = [];
    let excedeu = false;

    busboy.on('field', (nome, valor) => {
      fields[nome] = valor;
    });
    busboy.on('file', (nome, arquivo) => {
      const pedacos = [];
      arquivo.on('data', (pedaco) => pedacos.push(pedaco));
      arquivo.on('limit', () => { excedeu = true; });
      arquivo.on('end', () => {
        if (nome === 'foto') arquivos.push(Buffer.concat(pedacos));
      });
    });
    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (excedeu) {
        const erro = new Error('A fotografia passa de 5 MB.');
        erro.status = 413;
        reject(erro);
        return;
      }
      resolve({ fields, fotoBuffer: arquivos[0] && arquivos[0].length ? arquivos[0] : null });
    });
    req.pipe(busboy);
  });
}

async function lerEntrada(req) {
  const tipo = String(req.headers['content-type'] || '');
  if (tipo.includes('multipart/form-data')) return lerMultipart(req);
  const corpo = req.body && typeof req.body === 'object' ? req.body : {};
  return { fields: corpo, fotoBuffer: null };
}

module.exports = { lerEntrada };
