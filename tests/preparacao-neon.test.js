const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const bcrypt = require('bcrypt');
const { DatabaseSync } = require('node:sqlite');
const { abrirBanco, modoBanco } = require('../lib/banco');
const { validarSqlSeguro, aplicarMigracoes } = require('../lib/migrar-esquema');
const { migrarCopiaSqlite, caminhoOperacional } = require('../lib/migrar-neon');
const { adaptadorConsulta, converterInterrogacoes, redigirTexto, validarUrlPostgres } = require('../lib/adaptador');
const repo = require('../lib/repositorio');

const RAIZ = path.join(__dirname, '..');
const SEGREDO = 'c'.repeat(40);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

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

async function apagarPasta(pasta) {
  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    try {
      fs.rmSync(pasta, { recursive: true, force: true });
      return;
    } catch (erro) {
      if (tentativa === 19) throw erro;
      await new Promise((resolver) => setTimeout(resolver, 300));
    }
  }
}

function executar(args, env, tempo) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: RAIZ,
      env: { ...process.env, DATABASE_URL: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let saida = '';
    child.stdout.on('data', (d) => { saida += d.toString(); });
    child.stderr.on('data', (d) => { saida += d.toString(); });
    const timer = setTimeout(() => {
      encerrar(child).then(() => resolve({ code: child.exitCode, saida, timeout: true }));
    }, tempo || 15000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, saida, timeout: false });
    });
  });
}

function adaptadorPglite(pg) {
  return adaptadorConsulta({
    dialect: 'postgres',
    async consultar(sql, params = []) {
      const resultado = await pg.query(converterInterrogacoes(sql), params);
      return resultado.rows || [];
    },
    async executar(sql) {
      await pg.exec(sql);
    },
    async transacionar(fn, adaptador) {
      await pg.exec('BEGIN');
      try {
        const resultado = await fn(adaptador);
        await pg.exec('COMMIT');
        return resultado;
      } catch (erro) {
        try { await pg.exec('ROLLBACK'); } catch { /* a transação já foi encerrada */ }
        throw erro;
      }
    },
    fechar: () => pg.close()
  });
}

async function postgresTemporario() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-pg-'));
  const diretorio = path.join(pasta, 'pg');
  const pg = new PGlite(diretorio);
  const db = adaptadorPglite(pg);
  await aplicarMigracoes(db, path.join(RAIZ, 'migrations'));
  return {
    pasta,
    diretorio,
    db,
    async fechar() {
      await db.close();
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  };
}

function gravarCopia(pasta, extras) {
  const banco = path.join(pasta, 'copia.sqlite');
  const bruto = abrirBanco(banco);
  bruto.close();
  const db = new DatabaseSync(banco);
  db.exec('BEGIN');
  db.prepare('INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)').run('u1', 'Motorista Ficticio', 'motorista.ficticio', extras.hash, 'motorista');
  db.prepare('INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)').run('g1', 'Gestor Ficticio', 'gestor.ficticio', extras.hash, 'gestor');
  db.prepare('INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, 1)').run('vei_ABC1D23', 'ABC1D23', 'Veículo fictício');
  db.prepare(`
    INSERT INTO checklists (
      id, data, hora, placa, veiculo_id, motorista, usuario_id, km, km_inconsistente,
      combustivel, status, itens_nao_ok, obs, foto_arquivo, criado_em
    ) VALUES ('c1', '2026-04-01', '08:00', 'ABC1D23', 'vei_ABC1D23', 'Motorista Ficticio', 'u1', 1000, 0, '1/2', 'OK', '[]', '', NULL, '2026-04-01T08:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO checklists (
      id, data, hora, placa, veiculo_id, motorista, usuario_id, km, km_inconsistente,
      combustivel, status, itens_nao_ok, obs, foto_arquivo, criado_em
    ) VALUES ('c2', '2026-04-02', '09:00', 'ABC1D23', 'vei_ABC1D23', 'Pessoa Sem Cadastro', NULL, 1100, 0, 'cheio', 'PENDENTE', '["Freios"]', '', 'antiga.jpg', '2026-04-02T09:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO pendencias (id, checklist_id, item, situacao, aberto_em)
    VALUES ('p1', 'c2', 'Freios', 'aberta', '2026-04-02')
  `).run();
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  return banco;
}

function gravarOrfao(pasta) {
  const banco = path.join(pasta, 'orfao.sqlite');
  abrirBanco(banco).close();
  const db = new DatabaseSync(banco);
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)').run('u1', 'Motorista Ficticio', 'motorista.ficticio', 'hash', 'motorista');
    db.prepare(`
      INSERT INTO checklists (
        id, data, placa, motorista, usuario_id, veiculo_id, km, km_inconsistente, status, itens_nao_ok, criado_em
      ) VALUES ('c1', '2026-04-01', 'ABC1D23', 'Motorista Ficticio', 'u1', 'vei_ausente', 10, 0, 'OK', '[]', '2026-04-01T08:00:00.000Z')
    `).run();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  return banco;
}

test('o modo local permanece SQLite e a URL de produção não é ecoada', () => {
  assert.equal(modoBanco({}), 'sqlite');
  assert.equal(modoBanco({ DATABASE_URL: '   ' }), 'sqlite');
  assert.equal(modoBanco({ DATABASE_URL: 'postgresql://usuario:segredo@localhost/frota' }), 'postgres');
  const invalida = validarUrlPostgres('http://segredo-nao-imprimir.example/db');
  assert.equal(invalida.ok, false);
  assert.equal(JSON.stringify(invalida).includes('segredo-nao-imprimir'), false);
  const texto = redigirTexto('falha em postgresql://usuario:segredo-nao-imprimir@127.0.0.1:1/frota');
  assert.equal(texto.includes('segredo-nao-imprimir'), false);
  const sql = fs.readFileSync(path.join(RAIZ, 'migrations', '001_esquema_inicial.sql'), 'utf8');
  assert.doesNotThrow(() => validarSqlSeguro(sql));
  assert.throws(() => validarSqlSeguro('DROP TABLE usuarios'), /destrutivo/);
});

test('a Vercel não cria SQLite e o entrypoint não fica escutando porta', { timeout: 30000 }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-vercel-'));
  const ausente = path.join(pasta, 'nao-criar.sqlite');
  try {
    const semBanco = await executar(['server.js'], {
      VERCEL: '1',
      JWT_SECRET: SEGREDO,
      SQLITE_PATH: ausente,
      DATABASE_URL: ''
    });
    assert.equal(semBanco.timeout, false);
    assert.notEqual(semBanco.code, 0);
    assert.match(semBanco.saida, /DATABASE_URL ausente na Vercel/);
    assert.equal(fs.existsSync(ausente), false);

    const urlRuim = await executar(['server.js'], {
      JWT_SECRET: SEGREDO,
      SQLITE_PATH: ausente,
      DATABASE_URL: 'http://segredo-nao-imprimir.example/db'
    });
    assert.notEqual(urlRuim.code, 0);
    assert.equal(urlRuim.saida.includes('segredo-nao-imprimir'), false);
    assert.equal(fs.existsSync(ausente), false);

    const banco = path.join(pasta, 'vazio.sqlite');
    abrirBanco(banco).close();
    const exportado = await executar(['-e', "const app = require('./server.js'); if (typeof app !== 'function') process.exit(2); process.exit(0);"], {
      JWT_SECRET: SEGREDO,
      SQLITE_PATH: banco,
      DATABASE_URL: '',
      VERCEL: ''
    }, 8000);
    assert.equal(exportado.timeout, false);
    assert.equal(exportado.code, 0);

    const porta = await portaLivre();
    const servindo = spawn(process.execPath, ['server.js'], {
      cwd: RAIZ,
      env: { ...process.env, PORT: String(porta), JWT_SECRET: SEGREDO, SQLITE_PATH: banco, DATABASE_URL: '', VERCEL: '', CORS_ORIGENS: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      let estilo;
      const inicio = Date.now();
      while (Date.now() - inicio < 15000) {
        try {
          estilo = await fetch(`http://127.0.0.1:${porta}/css/style.css`);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      assert.equal(estilo.status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${porta}/tela2.html`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${porta}/tela3.html`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${porta}/.env`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${porta}/db.json`)).status, 404);
    } finally {
      await encerrar(servindo);
    }
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test('o esquema e a cópia fictícia funcionam no PostgreSQL local', { timeout: 60000 }, async () => {
  const ambiente = await postgresTemporario();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-copia-'));
  try {
    const repetido = await aplicarMigracoes(ambiente.db, path.join(RAIZ, 'migrations'));
    assert.deepEqual(repetido.aplicadas, []);
    const versoes = await ambiente.db.get('SELECT COUNT(*) AS n FROM schema_migracoes');
    assert.equal(Number(versoes.n), 1);

    const hash = await bcrypt.hash('senha-ficticia', 4);
    const banco = gravarCopia(pasta, { hash });
    fs.writeFileSync(path.join(pasta, 'foto.jpg'), JPEG);
    const bruto = new DatabaseSync(banco);
    bruto.prepare("UPDATE checklists SET foto_arquivo = 'foto.jpg' WHERE id = 'c1'").run();
    bruto.close();

    const relatorio = await migrarCopiaSqlite({
      origem: banco,
      fotos: pasta,
      db: ambiente.db,
      raiz: RAIZ
    });
    assert.equal(relatorio.conferem, true);
    assert.equal(relatorio.origem.usuarios, 2);
    assert.equal(relatorio.origem.checklists, 2);
    assert.equal(relatorio.origem.pendencias, 1);
    assert.equal(relatorio.vinculosUsuarioAusentes, 1);
    assert.equal(relatorio.fotosAusentes, 1);
    assert.equal(relatorio.confereComReferencia, false);
    const foto = await ambiente.db.get('SELECT foto_arquivo FROM checklists WHERE id = ?', ['c1']);
    assert.equal(foto.foto_arquivo, 'foto.jpg');
    const conteudo = await ambiente.db.get('SELECT foto_conteudo FROM checklists WHERE id = ?', ['c1']);
    const bytes = Buffer.isBuffer(conteudo.foto_conteudo) ? conteudo.foto_conteudo : Buffer.from(conteudo.foto_conteudo);
    assert.equal(Buffer.compare(bytes, JPEG), 0);
    const semVinculo = await ambiente.db.get('SELECT motorista, usuario_id FROM checklists WHERE id = ?', ['c2']);
    assert.equal(semVinculo.motorista, 'Pessoa Sem Cadastro');
    assert.equal(semVinculo.usuario_id, null);

    await assert.rejects(
      () => migrarCopiaSqlite({ origem: banco, fotos: pasta, db: ambiente.db, raiz: RAIZ }),
      /já contém dados/
    );
    const retomado = await migrarCopiaSqlite({
      origem: banco,
      fotos: pasta,
      retomar: true,
      db: ambiente.db,
      raiz: RAIZ
    });
    assert.equal(retomado.conferem, true);
    assert.equal(retomado.destino.usuarios, 2);
    assert.equal(retomado.retomado, true);

    const usuario = await repo.buscarUsuario(ambiente.db, 'motorista.ficticio', 'motorista');
    assert.equal(await bcrypt.compare('senha-ficticia', usuario.senha), true);
    assert.equal(await bcrypt.compare('senha-errada', usuario.senha), false);
    assert.equal(await repo.buscarUsuario(ambiente.db, 'nao-existe', 'motorista'), undefined);
    const lista = await repo.listarChecklists(ambiente.db, { id: 'u1', tipo: 'motorista', nome: 'Motorista Ficticio' }, {});
    assert.equal(lista.itens.length, 1);
    assert.equal(lista.itens[0].id, 'c1');
    const gestor = await repo.listarChecklists(ambiente.db, { id: 'g1', tipo: 'gestor', nome: 'Gestor Ficticio' }, { status: 'PENDENTE' });
    assert.equal(gestor.indicadores.pendencias, 1);
    await assert.rejects(
      () => repo.criarChecklist(ambiente.db, { id: 'g1', tipo: 'gestor', nome: 'Gestor Ficticio' }, {}, pasta),
      (erro) => erro.status === 403
    );

    const criado = await repo.criarChecklist(ambiente.db, {
      id: 'u1', tipo: 'motorista', nome: 'Motorista Ficticio'
    }, {
      veiculoId: 'vei_ABC1D23',
      data: '2026-05-01',
      hora: '10:00',
      km: '1200',
      combustivel: '1/2',
      itensNaoOk: [],
      obs: 'persistencia',
      fotoBuffer: JPEG
    }, pasta);
    assert.equal(criado.checklist.temFoto, true);
    const lida = await repo.lerFoto(ambiente.db, { id: 'g1', tipo: 'gestor', nome: 'Gestor Ficticio' }, criado.checklist.id, pasta);
    assert.equal(Buffer.compare(lida.buffer, JPEG), 0);

    await ambiente.db.close();
    const { PGlite } = await import('@electric-sql/pglite');
    const reaberto = new PGlite(ambiente.diretorio);
    const outro = adaptadorPglite(reaberto);
    const persistido = await outro.get('SELECT COUNT(*) AS n FROM checklists');
    assert.ok(Number(persistido.n) >= 3);
    await outro.close();
  } finally {
    await apagarPasta(pasta);
    await ambiente.fechar().catch(() => {});
  }
});

test('a migração fictícia recusa veículo órfão, dado estranho e o banco operacional', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'frota-recusa-'));
  const ambiente = await postgresTemporario();
  try {
    const banco = gravarOrfao(pasta);
    await assert.rejects(
      () => migrarCopiaSqlite({ origem: banco, db: ambiente.db, raiz: RAIZ }),
      /Nada foi gravado/
    );
    const intacto = await ambiente.db.get('SELECT COUNT(*) AS n FROM checklists');
    assert.equal(Number(intacto.n), 0);

    await ambiente.db.run(
      'INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)',
      ['estranho', 'Fora da Copia', 'fora', 'hash', 'gestor']
    );
    const copia = gravarCopia(pasta, { hash: 'hash' });
    await assert.rejects(
      () => migrarCopiaSqlite({ origem: copia, retomar: true, db: ambiente.db, raiz: RAIZ }),
      /não estão na cópia/
    );

    const operacional = caminhoOperacional(RAIZ);
    const resultado = await executar(
      ['scripts/migrar-sqlite-neon.js', '--origem', operacional],
      { DATABASE_URL: 'postgresql://usuario:segredo-nao-imprimir@127.0.0.1:1/frota' }
    );
    assert.equal(resultado.timeout, false);
    assert.notEqual(resultado.code, 0);
    assert.match(resultado.saida, /não abre o banco operacional/);
    assert.equal(resultado.saida.includes('segredo-nao-imprimir'), false);
  } finally {
    await ambiente.fechar();
    await apagarPasta(pasta);
  }
});
