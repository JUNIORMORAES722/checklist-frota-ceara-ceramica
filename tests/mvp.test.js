const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const bcrypt = require('bcrypt');
const { DatabaseSync } = require('node:sqlite');
const { migrar } = require('../lib/migrar');
const { fazerBackup, restaurar } = require('../lib/backup');
const { caminhoFotoSeguro } = require('../lib/fotos');
const { montarHtmlImpressao, ITENS_IMPRESSAO, campoCsv } = require('../public/js/impressao');

const RAIZ = path.join(__dirname, '..');
const SEGREDO = 'b'.repeat(48);
const SENHA_M = 'senha-motorista-teste';
const SENHA_G = 'senha-gestor-teste';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function hashArquivo(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

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

async function esperar(url) {
  const inicio = Date.now();
  while (Date.now() - inicio < 20000) {
    try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error('servidor não respondeu');
}

function subir(porta, banco, fotos) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(porta), JWT_SECRET: SEGREDO, SQLITE_PATH: banco, FOTOS_PATH: fotos, CORS_ORIGENS: '', DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let saida = '';
  child.stdout.on('data', (d) => { saida += d.toString(); });
  child.stderr.on('data', (d) => { saida += d.toString(); });
  child.saida = () => saida;
  return child;
}

async function login(porta, rota, usuario, senha) {
  const resposta = await fetch(`http://127.0.0.1:${porta}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, senha })
  });
  return { status: resposta.status, dados: await resposta.json() };
}

function multipart(campos, arquivo) {
  const boundary = 'FrotaBoundary';
  const chunks = [];
  for (const [nome, valor] of Object.entries(campos)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${nome}"\r\n\r\n${valor}\r\n`));
  }
  if (arquivo) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="foto"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    chunks.push(arquivo);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

test('a migração preserva um JSON fictício em uma cópia SQLite', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-mig-'));
  const origemJson = path.join(pasta, 'origem.json');
  const destino = path.join(pasta, 'copia.sqlite');
  const hashMotorista = await bcrypt.hash('senha-motorista-teste', 4);
  const hashGestor = await bcrypt.hash('senha-gestor-teste', 4);
  const origem = {
    usuarios: [
      { id: 'm1', nome: 'Motorista Teste', usuario: 'motorista.teste', senha: hashMotorista, tipo: 'motorista' },
      { id: 'g1', nome: 'Gestor Teste', usuario: 'gestor.teste', senha: hashGestor, tipo: 'gestor' }
    ],
    checklists: [
      { id: 'id_1', data: '2026-01-01', placa: 'ABC1D23', motorista: 'Motorista Teste', km: 10000, combustivel: '1/2', status: 'OK', itensNaoOk: [], obs: 'primeiro', foto: '' },
      { id: 'id_2', data: '2026-01-02', placa: 'ABC1D23', motorista: 'Motorista Teste', km: 8000, combustivel: '1/2', status: 'OK', itensNaoOk: [], obs: 'queda de km', foto: '' },
      { id: 'id_3', data: '2026-01-03', placa: 'DEF2E34', motorista: 'Motorista Arquivado', km: 5000, combustivel: 'cheio', status: 'PENDENTE', itensNaoOk: ['Freios'], obs: 'sem usuario', foto: 'nome-antigo.jpg' }
    ]
  };
  fs.writeFileSync(origemJson, JSON.stringify(origem));
  const hashAntes = hashArquivo(origemJson);
  try {
    const relatorio = migrar({ origem: origemJson, destino });
    assert.equal(relatorio.usuarios, 2);
    assert.equal(relatorio.checklists, 3);
    assert.equal(relatorio.veiculos, 2);
    assert.equal(relatorio.kmInconsistentes, 1);
    assert.equal(relatorio.integridade, 'ok');
    const repetida = migrar({ origem: origemJson, destino });
    assert.equal(repetida.jaMigrado, true);
    assert.equal(repetida.checklists, 3);
    const db = new DatabaseSync(destino);
    for (const usuario of origem.usuarios) {
      const copiado = db.prepare('SELECT senha, nome FROM usuarios WHERE usuario = ?').get(usuario.usuario);
      assert.equal(copiado.senha, usuario.senha);
      assert.equal(copiado.nome, usuario.nome);
    }
    const queda = db.prepare('SELECT km, km_inconsistente FROM checklists WHERE id = ?').get('id_2');
    assert.equal(queda.km, 8000);
    assert.equal(queda.km_inconsistente, 1);
    const arquivado = db.prepare('SELECT motorista, usuario_id, foto_arquivo, foto_original FROM checklists WHERE id = ?').get('id_3');
    assert.equal(arquivado.motorista, 'Motorista Arquivado');
    assert.equal(arquivado.usuario_id, null);
    assert.equal(arquivado.foto_arquivo, null);
    assert.equal(arquivado.foto_original, 'nome-antigo.jpg');
    db.close();
    assert.equal(hashArquivo(origemJson), hashAntes);
    assert.equal(caminhoFotoSeguro(pasta, '../db.json'), '');
    assert.equal(caminhoFotoSeguro(pasta, '..\\segredo.env'), '');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('checklist, fotos, quilometragem, permissões, backup e impressão', { timeout: 60000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-mvp-'));
  const json = path.join(pasta, 'origem.json');
  const banco = path.join(pasta, 'app.sqlite');
  const fotos = path.join(pasta, 'fotos');
  const hashM = await bcrypt.hash(SENHA_M, 4);
  const hashG = await bcrypt.hash(SENHA_G, 4);
  fs.writeFileSync(json, JSON.stringify({
    usuarios: [
      { id: 'm1', nome: 'Motorista Teste', usuario: 'motorista.teste', senha: hashM, tipo: 'motorista' },
      { id: 'g1', nome: 'Gestor Teste', usuario: 'gestor.teste', senha: hashG, tipo: 'gestor' }
    ],
    checklists: [
      { id: 'id_a', data: '2026-07-01', placa: 'ABC1D23', motorista: 'Motorista Teste', km: 1000, combustivel: '1/2', status: 'OK', itensNaoOk: [], obs: 'ok', foto: '' },
      { id: 'id_b', data: '2026-07-02', placa: 'XYZ9A87', motorista: 'Outra Pessoa', km: 2000, combustivel: 'cheio', status: 'PENDENTE', itensNaoOk: ['Freios', '<script>alert(1)</script>'], obs: '<script>alert(1)</script>', foto: '' }
    ]
  }));
  const relatorio = migrar({ origem: json, destino: banco });
  assert.equal(relatorio.checklists, 2);
  const porta = await portaLivre();
  let child = subir(porta, banco, fotos);
  try {
    await esperar(`http://127.0.0.1:${porta}/`);
    assert.equal((await fetch(`http://127.0.0.1:${porta}/db.json`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${porta}/data/app.sqlite`)).status, 404);
    const origemHostil = await fetch(`http://127.0.0.1:${porta}/checklists`, { headers: { Origin: 'https://origem-hostil.example' } });
    assert.equal(origemHostil.headers.get('access-control-allow-origin'), null);
    const origemLocal = await fetch(`http://127.0.0.1:${porta}/`, { headers: { Origin: `http://127.0.0.1:${porta}` } });
    assert.equal(origemLocal.headers.get('access-control-allow-origin'), `http://127.0.0.1:${porta}`);
    const ruim = await login(porta, '/motoristas/login', 'motorista.teste', 'errada');
    assert.equal(ruim.status, 401);
    const motorista = await login(porta, '/motoristas/login', 'motorista.teste', SENHA_M);
    const gestor = await login(porta, '/gestores/login', 'gestor.teste', SENHA_G);
    assert.equal(motorista.status, 200);
    assert.equal(Object.hasOwn(motorista.dados, 'senha'), false);
    const listaMotorista = await fetch(`http://127.0.0.1:${porta}/checklists`, { headers: { Authorization: 'Bearer ' + motorista.dados.token } });
    const dadosMotorista = await listaMotorista.json();
    assert.equal(dadosMotorista.itens.length, 1);
    assert.equal(dadosMotorista.itens[0].id, 'id_a');
    assert.equal((await fetch(`http://127.0.0.1:${porta}/checklists/id_b`, { headers: { Authorization: 'Bearer ' + motorista.dados.token } })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${porta}/checklists/id_b`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + motorista.dados.token } })).status, 403);

    const veiculos = await (await fetch(`http://127.0.0.1:${porta}/veiculos`, { headers: { Authorization: 'Bearer ' + motorista.dados.token } })).json();
    const veiculo = veiculos.find(v => v.placa === 'ABC1D23');
    const campos = {
      veiculoId: veiculo.id,
      data: '2026-08-01',
      hora: '09:30',
      km: '1500',
      combustivel: '3/4',
      itensNaoOk: JSON.stringify(['Freios']),
      obs: '<script>alert(1)</script>'
    };
    const envio = multipart(campos, JPEG);
    const criado = await fetch(`http://127.0.0.1:${porta}/checklists`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + motorista.dados.token, 'Content-Type': 'multipart/form-data; boundary=' + envio.boundary },
      body: envio.body
    });
    const criadoJson = await criado.json();
    assert.equal(criado.status, 201);
    assert.equal(criadoJson.motorista, 'Motorista Teste');
    assert.equal(criadoJson.status, 'PENDENTE');
    assert.equal(criadoJson.temFoto, true);
    assert.equal(criadoJson.obs, '<script>alert(1)</script>');

    const repetido = await fetch(`http://127.0.0.1:${porta}/checklists`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + motorista.dados.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(campos)
    });
    assert.equal(repetido.status, 200);
    assert.equal((await repetido.json()).id, criadoJson.id);

    const baixo = await fetch(`http://127.0.0.1:${porta}/checklists`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + motorista.dados.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...campos, km: '10', hora: '10:00', itensNaoOk: [] })
    });
    assert.equal(baixo.status, 409);

    const paralelo = await Promise.allSettled([1800, 1700].map((km) => fetch(`http://127.0.0.1:${porta}/checklists`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + motorista.dados.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...campos, km: String(km), hora: '11:' + String(km).slice(-2), itensNaoOk: [], obs: 'concorrente ' + km })
    })));
    assert.equal(paralelo.length, 2);
    const db = new DatabaseSync(banco);
    const sequencia = db.prepare("SELECT km FROM checklists WHERE placa = 'ABC1D23' AND km_inconsistente = 0 ORDER BY criado_em, id").all().map(r => r.km);
    for (let i = 1; i < sequencia.length; i += 1) assert.ok(sequencia[i] >= sequencia[i - 1]);
    db.close();

    assert.equal((await fetch(`http://127.0.0.1:${porta}/checklists`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + gestor.dados.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(campos)
    })).status, 403);

    const foto = await fetch(`http://127.0.0.1:${porta}/checklists/${criadoJson.id}/foto`, { headers: { Authorization: 'Bearer ' + gestor.dados.token } });
    assert.equal(foto.status, 200);
    assert.equal(Buffer.compare(Buffer.from(await foto.arrayBuffer()), JPEG), 0);
    assert.equal((await fetch(`http://127.0.0.1:${porta}/checklists/${criadoJson.id}/foto`, { headers: { Authorization: 'Bearer ' + motorista.dados.token } })).status, 200);
    const outroToken = gestor.dados.token;
    assert.equal((await fetch(`http://127.0.0.1:${porta}/checklists/id_b/foto`, { headers: { Authorization: 'Bearer ' + motorista.dados.token } })).status, 404);

    const listaGestor = await (await fetch(`http://127.0.0.1:${porta}/checklists?dataInicio=2026-07-01&dataFim=2026-07-02&status=PENDENTE`, { headers: { Authorization: 'Bearer ' + outroToken } })).json();
    assert.equal(listaGestor.itens.some(item => item.id === 'id_b'), true);
    assert.equal(listaGestor.indicadores.pendencias >= 1, true);

    const html = montarHtmlImpressao(criadoJson);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
    for (const item of ITENS_IMPRESSAO) assert.equal(html.includes(item), true);
    assert.equal(html.includes('>NÃO OK<') || html.includes('NÃO OK'), true);
    assert.equal(html.includes('Farol Alto'), false);
    assert.equal(campoCsv('=1+1'), `"'=1+1"`);
    assert.equal(campoCsv('Paulo'), '"Paulo"');

    const pendencia = criadoJson.pendencias[0];
    const atualizada = await fetch(`http://127.0.0.1:${porta}/pendencias/${pendencia.id}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + gestor.dados.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ situacao: 'concluida', responsavel: 'Oficina', observacaoResolucao: 'Freio ajustado' })
    });
    assert.equal(atualizada.status, 200);
    assert.equal((await atualizada.json()).situacao, 'concluida');
    const aindaPendente = await (await fetch(`http://127.0.0.1:${porta}/checklists/${criadoJson.id}`, { headers: { Authorization: 'Bearer ' + gestor.dados.token } })).json();
    assert.equal(aindaPendente.status, 'PENDENTE');

    await encerrar(child);
    child = subir(porta, banco, fotos);
    await esperar(`http://127.0.0.1:${porta}/`);
    const gestor2 = await login(porta, '/gestores/login', 'gestor.teste', SENHA_G);
    const fotoDepois = await fetch(`http://127.0.0.1:${porta}/checklists/${criadoJson.id}/foto`, { headers: { Authorization: 'Bearer ' + gestor2.dados.token } });
    assert.equal(fotoDepois.status, 200);

    const copia = path.join(pasta, 'backup');
    fazerBackup({ banco, fotos, destino: copia, retencaoDias: 14 });
    const restaurado = path.join(pasta, 'restaurado.sqlite');
    const fotosRestauradas = path.join(pasta, 'fotos-restauradas');
    const pastas = fs.readdirSync(copia).filter(nome => fs.statSync(path.join(copia, nome)).isDirectory());
    const resultado = restaurar({ origem: path.join(copia, pastas[0]), banco: restaurado, fotos: fotosRestauradas });
    assert.equal(resultado.integridade, 'ok');
    assert.ok(resultado.checklists >= 3);
    assert.equal(child.saida().includes(SEGREDO), false);
  } finally {
    await encerrar(child);
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('o seed recusa o nome do banco operacional', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-seed-'));
  const destino = path.join(pasta, 'frota.sqlite');
  const child = spawn(process.execPath, ['scripts/seed-demo.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      SQLITE_PATH: destino,
      DATABASE_URL: '',
      SENHA_GESTOR: 'senha-gestor-teste',
      SENHA_MOTORISTA: 'senha-motorista-teste'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let saida = '';
  child.stderr.on('data', (d) => { saida += d.toString(); });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(saida, /frota\.sqlite/);
  assert.equal(fs.existsSync(destino), false);
  fs.rmSync(pasta, { recursive: true, force: true });
});
