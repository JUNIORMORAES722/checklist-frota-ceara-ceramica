const fs = require('fs');
const path = require('path');

const SEGREDO_VAZADO = 'chave-secreta-frota-ceara';
const SEGREDOS_BLOQUEADOS = new Set([
  SEGREDO_VAZADO,
  'secret',
  'changeme',
  'change-me',
  'senha',
  'password',
  'jwt_secret',
  'frota',
  'frota-ceara'
]);

function carregarAmbiente(diretorio) {
  const envPath = path.join(diretorio || path.join(__dirname, '..'), '.env');
  if (!fs.existsSync(envPath)) return;

  const texto = fs.readFileSync(envPath, 'utf8');
  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const separador = linha.indexOf('=');
    if (separador <= 0) continue;
    const chave = linha.slice(0, separador).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(chave)) continue;
    let valor = linha.slice(separador + 1).trim();
    const aspasDuplas = valor.startsWith('"') && valor.endsWith('"');
    const aspasSimples = valor.startsWith("'") && valor.endsWith("'");
    if (aspasDuplas || aspasSimples) valor = valor.slice(1, -1);
    if (process.env[chave] === undefined) process.env[chave] = valor;
  }
}

function validarSegredo(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    return 'JWT_SECRET ausente. Defina a variável de ambiente ou o arquivo .env antes de iniciar. Consulte .env.example.';
  }
  const segredo = valor.trim();
  const normalizado = segredo.toLowerCase();
  const inseguro = segredo.length < 32
    || SEGREDOS_BLOQUEADOS.has(normalizado)
    || normalizado.includes(SEGREDO_VAZADO);
  if (inseguro) {
    return 'JWT_SECRET inseguro. Use um valor exclusivo com pelo menos 32 caracteres, diferente de exemplos e padrões conhecidos.';
  }
  return '';
}

module.exports = { carregarAmbiente, validarSegredo, SEGREDO_VAZADO };
