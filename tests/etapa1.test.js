const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { abrirBanco } = require('../lib/banco');

const RAIZ = path.join(__dirname, '..');
const SEGREDO = 'a'.repeat(40);
const SEGREDO_VAZADO = 'chave-secreta-frota-ceara';

function portaLivre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.listen(0, '127.0.0.1', () => {
      const porta = servidor.address().port;
      servidor.close((erro) => (erro ? reject(erro) : resolve(porta)));
    });
  });
}

function encerrar(child) {
  if (!child || child.pid == null || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    const timer = setTimeout(resolve, 4000);
    killer.on('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function executarAteSair(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: RAIZ,
      env: { ...process.env, CORS_ORIGENS: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let saida = '';
    child.stdout.on('data', (d) => { saida += d.toString(); });
    child.stderr.on('data', (d) => { saida += d.toString(); });
    const timer = setTimeout(() => {
      encerrar(child).then(() => resolve({ code: child.exitCode, saida, timeout: true }));
    }, 20000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, saida, timeout: false });
    });
  });
}

test('não inicia sem JWT_SECRET', async () => {
  const resultado = await executarAteSair({ JWT_SECRET: '   ' });
  assert.equal(resultado.timeout, false);
  assert.notEqual(resultado.code, 0);
  assert.match(resultado.saida, /JWT_SECRET ausente/);
});

test('não inicia com segredo vazado ou curto', async () => {
  const vazado = await executarAteSair({ JWT_SECRET: SEGREDO_VAZADO });
  assert.notEqual(vazado.code, 0);
  assert.equal(vazado.saida.includes(SEGREDO_VAZADO), false);
  const curto = await executarAteSair({ JWT_SECRET: 'curto-demais' });
  assert.notEqual(curto.code, 0);
  assert.match(curto.saida, /JWT_SECRET inseguro/);
});

test('npm start usa server.js e não publica o checklist sem login', { timeout: 60000 }, async () => {
  const porta = await portaLivre();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-start-'));
  const banco = path.join(pasta, 'vazio.sqlite');
  abrirBanco(banco).close();
  const child = spawn('npm', ['start'], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(porta), JWT_SECRET: SEGREDO, SQLITE_PATH: banco, FOTOS_PATH: path.join(pasta, 'fotos'), CORS_ORIGENS: '' },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let saida = '';
  child.stdout.on('data', (d) => { saida += d.toString(); });
  child.stderr.on('data', (d) => { saida += d.toString(); });
  try {
    let resposta;
    const inicio = Date.now();
    while (Date.now() - inicio < 20000) {
      try {
        resposta = await fetch(`http://127.0.0.1:${porta}/checklists`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.ok(resposta);
    assert.equal(resposta.status, 403);
    assert.equal(saida.includes(SEGREDO), false);
    const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
    assert.equal(pacote.scripts.start, 'node server.js');
    assert.equal(Object.hasOwn(pacote.dependencies, 'json-server'), false);
    const gerador = fs.readFileSync(path.join(RAIZ, 'gerarSenha.js'), 'utf8');
    assert.match(gerador, /process\.env\.SENHA/);
    assert.equal(/senha\s*=\s*['"][^'"]+['"]/.test(gerador), false);
    assert.equal(fs.readFileSync(path.join(RAIZ, 'public/js/app_gestor.js'), 'utf8').includes('innerHTML'), false);
  } finally {
    await encerrar(child);
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});
