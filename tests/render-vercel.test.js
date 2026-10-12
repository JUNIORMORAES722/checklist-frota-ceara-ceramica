const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { abrirBanco } = require('../lib/banco');

const RAIZ = path.join(__dirname, '..');
const SEGREDO = 'd'.repeat(40);

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

test('render.yaml e vercel.json estão presentes e válidos', () => {
  assert.equal(fs.existsSync(path.join(RAIZ, 'render.yaml')), true);
  assert.equal(fs.existsSync(path.join(RAIZ, 'vercel.json')), true);

  const vercel = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));
  assert.equal(vercel.outputDirectory, 'public');
  assert.equal(vercel.cleanUrls, true);

  const render = fs.readFileSync(path.join(RAIZ, 'render.yaml'), 'utf8');
  assert.match(render, /healthCheckPath:\s*\/health/);
  assert.match(render, /JWT_SECRET/);
});

test('endpoint /health e suporte a CORS para Vercel no Render', { timeout: 30000 }, async () => {
  const porta = await portaLivre();
  const bancoTmp = path.join(RAIZ, 'tests', 'temp_render.sqlite');
  abrirBanco(bancoTmp).close();

  const origensTeste = 'https://frota-ceara.vercel.app,*.vercel.app';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(porta),
      JWT_SECRET: SEGREDO,
      SQLITE_PATH: bancoTmp,
      CORS_ORIGENS: origensTeste,
      DATABASE_URL: '',
      VERCEL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    let healthRes;
    const inicio = Date.now();
    while (Date.now() - inicio < 15000) {
      try {
        healthRes = await fetch(`http://127.0.0.1:${porta}/health`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    assert.ok(healthRes);
    assert.equal(healthRes.status, 200);
    const corpoHealth = await healthRes.json();
    assert.equal(corpoHealth.status, 'ok');
    assert.equal(corpoHealth.banco, 'sqlite');

    // Teste CORS: Origem permitida exata
    const resCorsExato = await fetch(`http://127.0.0.1:${porta}/health`, {
      headers: { Origin: 'https://frota-ceara.vercel.app' }
    });
    assert.equal(resCorsExato.headers.get('access-control-allow-origin'), 'https://frota-ceara.vercel.app');

    // Teste CORS: Subdomínio wildcard *.vercel.app
    const resCorsWildcard = await fetch(`http://127.0.0.1:${porta}/health`, {
      headers: { Origin: 'https://frota-preview-abc123.vercel.app' }
    });
    assert.equal(resCorsWildcard.headers.get('access-control-allow-origin'), 'https://frota-preview-abc123.vercel.app');

    // Teste CORS: Origem não autorizada
    const resCorsBloqueado = await fetch(`http://127.0.0.1:${porta}/health`, {
      headers: { Origin: 'https://site-malicioso.com' }
    });
    assert.equal(resCorsBloqueado.headers.get('access-control-allow-origin'), null);

    // Teste CORS: Preflight OPTIONS
    const resOptions = await fetch(`http://127.0.0.1:${porta}/checklists`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://frota-ceara.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });
    assert.equal(resOptions.status, 204);
    assert.equal(resOptions.headers.get('access-control-allow-origin'), 'https://frota-ceara.vercel.app');
  } finally {
    await encerrar(child);
    try { fs.rmSync(bancoTmp, { force: true }); } catch {}
  }
});

