const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIMITE_BYTES = 5 * 1024 * 1024;

function pastaFotos(raiz) {
  return path.resolve(raiz || path.join(__dirname, '..', 'data', 'fotos'));
}

function extensaoPorAssinatura(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

function tipoPorExtensao(extensao) {
  if (extensao === 'png') return 'image/png';
  if (extensao === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function rejeitarFoto(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  throw erro;
}

function validarFoto(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) rejeitarFoto(400, 'A fotografia enviada está vazia.');
  if (buffer.length > LIMITE_BYTES) rejeitarFoto(413, 'A fotografia passa de 5 MB.');
  const extensao = extensaoPorAssinatura(buffer);
  if (!extensao) rejeitarFoto(400, 'Envie uma imagem JPEG, PNG ou WebP.');
  return extensao;
}

function nomeDeFoto(checklistId, buffer) {
  const extensao = validarFoto(buffer);
  return `foto_${String(checklistId).replace(/[^a-zA-Z0-9_-]/g, '')}_${crypto.randomBytes(4).toString('hex')}.${extensao}`;
}

function salvarFoto(pasta, checklistId, buffer) {
  const nome = nomeDeFoto(checklistId, buffer);
  const diretorio = pastaFotos(pasta);
  fs.mkdirSync(diretorio, { recursive: true });
  const destino = path.resolve(diretorio, nome);
  if (!destino.startsWith(diretorio + path.sep)) {
    const erro = new Error('Nome de fotografia recusado.');
    erro.status = 400;
    throw erro;
  }
  fs.writeFileSync(destino, buffer);
  return nome;
}

function caminhoFotoSeguro(pasta, nomeArquivo) {
  const base = pastaFotos(pasta);
  const nome = path.basename(String(nomeArquivo || ''));
  if (!/^foto_[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(nome)) return '';
  const absoluto = path.resolve(base, nome);
  if (!absoluto.startsWith(base + path.sep)) return '';
  if (!fs.existsSync(absoluto)) return '';
  return absoluto;
}

function apagarFoto(pasta, nomeArquivo) {
  const absoluto = caminhoFotoSeguro(pasta, nomeArquivo);
  if (absoluto) fs.rmSync(absoluto, { force: true });
}

function lerFotoDisco(pasta, nomeArquivo) {
  const absoluto = caminhoFotoSeguro(pasta, nomeArquivo);
  if (!absoluto) return null;
  return fs.readFileSync(absoluto);
}

module.exports = {
  LIMITE_BYTES,
  pastaFotos,
  extensaoPorAssinatura,
  tipoPorExtensao,
  validarFoto,
  nomeDeFoto,
  salvarFoto,
  caminhoFotoSeguro,
  apagarFoto,
  lerFotoDisco
};
