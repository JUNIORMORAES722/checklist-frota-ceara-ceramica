const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { carregarAmbiente, validarSegredo } = require('./lib/ambiente');
const { abrirBanco, modoBanco } = require('./lib/banco');
const { lerEntrada } = require('./lib/entrada');
const { pastaFotos, tipoPorExtensao } = require('./lib/fotos');
const repo = require('./lib/repositorio');
const {
  adaptadorSqlite,
  adaptadorPostgres,
  criarPoolPostgres,
  validarUrlPostgres,
  sanitizarErro,
  redigirTexto
} = require('./lib/adaptador');

const RAIZ = __dirname;
carregarAmbiente(RAIZ);

const erroSegredo = validarSegredo(process.env.JWT_SECRET);
if (erroSegredo) {
  console.error(erroSegredo);
  process.exit(1);
}

const SECRET = process.env.JWT_SECRET.trim();
const PORT = process.env.PORT || 3001;
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(RAIZ, 'data', 'frota.sqlite');
const FOTOS_PATH = process.env.FOTOS_PATH || pastaFotos(path.join(RAIZ, 'data', 'fotos'));

function abrirConexao() {
  const modo = modoBanco();
  if (process.env.VERCEL && modo !== 'postgres') {
    console.error('DATABASE_URL ausente na Vercel. O SQLite local não é o banco de produção.');
    process.exit(1);
  }
  if (modo === 'postgres') {
    const validacao = validarUrlPostgres(process.env.DATABASE_URL);
    if (!validacao.ok) {
      console.error('DATABASE_URL precisa ser uma URL PostgreSQL. O valor não é exibido.');
      process.exit(1);
    }
    if (process.env.VERCEL && !validacao.pooled) {
      console.error('Na Vercel, use a connection string pooled do Neon. O valor não é exibido.');
    }
    return adaptadorPostgres(criarPoolPostgres(process.env.DATABASE_URL.trim()));
  }
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error('Banco SQLite não encontrado. Execute npm run migrar ou npm run seed:demo.');
    process.exit(1);
  }
  return adaptadorSqlite(abrirBanco(SQLITE_PATH));
}

function origensCors() {
  const porta = String(PORT);
  const lista = new Set([
    `http://localhost:${porta}`,
    `http://127.0.0.1:${porta}`,
    `http://[::1]:${porta}`
  ]);
  for (const origem of String(process.env.CORS_ORIGENS || '').split(',')) {
    const texto = origem.trim();
    if (texto) lista.add(texto);
  }
  return lista;
}

function responderErro(res, erro) {
  const seguro = sanitizarErro(erro);
  const status = seguro.status || 500;
  if (status >= 500) console.error(redigirTexto(erro && (erro.stack || erro.message)));
  res.status(status).json({
    erro: status >= 500 ? 'Não foi possível concluir a operação.' : seguro.message
  });
}

function criarAplicacao(db) {
  const app = express();
  const origens = origensCors();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use((req, res, next) => {
    let caminho = '';
    try { caminho = decodeURIComponent(req.path || '').toLowerCase(); } catch { return res.status(404).json({ erro: 'Não encontrado.' }); }
    if (caminho.includes('..') || caminho.endsWith('.env') || caminho.includes('/.env') || caminho.endsWith('.sqlite') || caminho.endsWith('.sqlite-wal') || caminho === '/db.json' || caminho.endsWith('/db.json')) {
      return res.status(404).json({ erro: 'Não encontrado.' });
    }
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origens.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(RAIZ, 'public')));

  function verificarToken(req, res, next) {
    const tokenHeader = req.headers.authorization;
    if (!tokenHeader) return res.status(403).json({ erro: 'Acesso negado. Faça login primeiro.' });
    const token = tokenHeader.split(' ')[1] || tokenHeader;
    jwt.verify(token, SECRET, (err, decoded) => {
      if (err) return res.status(401).json({ erro: 'Sessão expirada ou inválida. Faça login novamente.' });
      req.usuarioLogado = decoded;
      next();
    });
  }

  function exigirGestor(req, res, next) {
    if (!req.usuarioLogado || req.usuarioLogado.tipo !== 'gestor') {
      return res.status(403).json({ erro: 'Apenas gestores podem executar esta operação.' });
    }
    next();
  }

  async function realizarLogin(req, res, tipoPermitido) {
    const { usuario, senha } = req.body || {};
    const user = await repo.buscarUsuario(db, usuario, tipoPermitido);
    if (!user) return res.status(401).json({ erro: 'Usuário ou senha incorretos' });
    const senhaValida = await bcrypt.compare(String(senha || ''), user.senha);
    if (!senhaValida) return res.status(401).json({ erro: 'Usuário ou senha incorretos' });
    const token = jwt.sign({ id: user.id, tipo: user.tipo, nome: user.nome }, SECRET, { expiresIn: '8h' });
    res.json({ token, id: user.id, nome: user.nome, usuario: user.usuario, tipo: user.tipo });
  }

  app.post('/motoristas/login', (req, res, next) => {
    realizarLogin(req, res, 'motorista').catch(next);
  });
  app.post('/gestores/login', (req, res, next) => {
    realizarLogin(req, res, 'gestor').catch(next);
  });
  app.post('/logout', (req, res) => {
    res.json({ sucesso: true, mensagem: 'Para logout, o frontend só precisa apagar o token salvo.' });
  });
  app.get('/eu', verificarToken, (req, res) => {
    res.json({ id: req.usuarioLogado.id, nome: req.usuarioLogado.nome, tipo: req.usuarioLogado.tipo });
  });
  app.get('/veiculos', verificarToken, async (req, res, next) => {
    try { res.json(await repo.listarVeiculos(db, req.usuarioLogado)); } catch (erro) { next(erro); }
  });
  app.post('/veiculos', verificarToken, exigirGestor, async (req, res, next) => {
    try {
      res.status(201).json(await repo.criarVeiculo(db, req.body && req.body.placa, req.body && req.body.descricao));
    } catch (erro) { next(erro); }
  });
  app.put('/veiculos/:id', verificarToken, exigirGestor, async (req, res, next) => {
    try {
      res.json(await repo.definirVeiculoAtivo(db, req.params.id, Boolean(req.body && req.body.ativo)));
    } catch (erro) { next(erro); }
  });
  app.get('/checklists', verificarToken, async (req, res, next) => {
    try {
      if (req.usuarioLogado.tipo !== 'gestor' && req.usuarioLogado.tipo !== 'motorista') {
        return res.status(403).json({ erro: 'Acesso negado.' });
      }
      res.json(await repo.listarChecklists(db, req.usuarioLogado, req.query));
    } catch (erro) { next(erro); }
  });
  app.get('/checklists/:id/foto', verificarToken, async (req, res, next) => {
    try {
      const foto = await repo.lerFoto(db, req.usuarioLogado, req.params.id, FOTOS_PATH);
      if (!foto) return res.status(404).json({ erro: 'Fotografia não encontrada' });
      const extensao = path.extname(foto.nome).slice(1);
      res.setHeader('Content-Type', tipoPorExtensao(extensao));
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, no-store');
      res.end(foto.buffer);
    } catch (erro) { next(erro); }
  });
  app.get('/checklists/:id', verificarToken, async (req, res, next) => {
    try {
      const encontrado = await repo.obterChecklist(db, req.usuarioLogado, req.params.id);
      if (!encontrado) return res.status(404).json({ erro: 'Checklist não encontrado' });
      res.json(encontrado.checklist);
    } catch (erro) { next(erro); }
  });
  app.post('/checklists', verificarToken, async (req, res, next) => {
    try {
      const entrada = await lerEntrada(req);
      const campos = entrada.fields;
      const resultado = await repo.criarChecklist(db, req.usuarioLogado, {
        veiculoId: campos.veiculoId,
        data: campos.data,
        hora: campos.hora,
        km: campos.km,
        combustivel: campos.combustivel,
        itensNaoOk: campos.itensNaoOk,
        obs: campos.obs,
        fotoBuffer: entrada.fotoBuffer
      }, FOTOS_PATH);
      res.status(resultado.duplicado ? 200 : 201).json(resultado.checklist);
    } catch (erro) { next(erro); }
  });
  app.put('/checklists/:id/quilometragem', verificarToken, exigirGestor, async (req, res, next) => {
    try {
      res.json(await repo.corrigirQuilometragem(db, req.params.id, req.body && req.body.km, req.body && req.body.justificativa));
    } catch (erro) { next(erro); }
  });
  app.put('/pendencias/:id', verificarToken, exigirGestor, async (req, res, next) => {
    try {
      res.json(await repo.atualizarPendencia(db, req.params.id, req.body || {}));
    } catch (erro) { next(erro); }
  });
  app.delete('/checklists/:id', verificarToken, exigirGestor, async (req, res, next) => {
    try {
      res.json(await repo.excluirChecklist(db, req.params.id, FOTOS_PATH));
    } catch (erro) { next(erro); }
  });
  app.use((erro, req, res, next) => {
    if (res.headersSent) return next(erro);
    responderErro(res, erro);
  });
  return app;
}

const db = abrirConexao();
const app = criarAplicacao(db);
module.exports = app;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const banco = modoBanco() === 'postgres' ? 'PostgreSQL' : 'SQLite local';
    console.log(`\nServidor de Produção rodando na porta ${PORT} (${banco})\n`);
  });
}
