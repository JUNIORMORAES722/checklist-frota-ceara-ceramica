const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { carregarAmbiente, validarSegredo } = require('./lib/ambiente');
const { abrirBanco } = require('./lib/banco');
const { lerEntrada } = require('./lib/entrada');
const { pastaFotos, caminhoFotoSeguro, tipoPorExtensao } = require('./lib/fotos');
const repo = require('./lib/repositorio');

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

const ORIGENS_CORS = origensCors();

if (!fs.existsSync(SQLITE_PATH)) {
  console.error('Banco SQLite não encontrado. Execute npm run migrar ou npm run seed:demo.');
  process.exit(1);
}

const db = abrirBanco(SQLITE_PATH);
const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || ORIGENS_CORS.has(origin)) return callback(null, true);
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

function responderErro(res, erro) {
  const status = erro.status || 500;
  if (status === 500) console.error(erro);
  res.status(status).json({
    erro: status === 500 ? 'Não foi possível concluir a operação.' : erro.message
  });
}

async function realizarLogin(req, res, tipoPermitido) {
  const { usuario, senha } = req.body || {};
  const user = repo.buscarUsuario(db, usuario, tipoPermitido);
  if (!user) return res.status(401).json({ erro: 'Usuário ou senha incorretos' });
  const senhaValida = await bcrypt.compare(String(senha || ''), user.senha);
  if (!senhaValida) return res.status(401).json({ erro: 'Usuário ou senha incorretos' });
  const token = jwt.sign({ id: user.id, tipo: user.tipo, nome: user.nome }, SECRET, { expiresIn: '8h' });
  res.json({ token, id: user.id, nome: user.nome, usuario: user.usuario, tipo: user.tipo });
}

app.post('/motoristas/login', (req, res) => realizarLogin(req, res, 'motorista'));
app.post('/gestores/login', (req, res) => realizarLogin(req, res, 'gestor'));
app.post('/logout', (req, res) => {
  res.json({ sucesso: true, mensagem: 'Para logout, o frontend só precisa apagar o token salvo.' });
});

app.get('/eu', verificarToken, (req, res) => {
  res.json({ id: req.usuarioLogado.id, nome: req.usuarioLogado.nome, tipo: req.usuarioLogado.tipo });
});

app.get('/veiculos', verificarToken, (req, res) => {
  res.json(repo.listarVeiculos(db, req.usuarioLogado));
});

app.post('/veiculos', verificarToken, exigirGestor, (req, res) => {
  try {
    res.status(201).json(repo.criarVeiculo(db, req.body && req.body.placa, req.body && req.body.descricao));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.put('/veiculos/:id', verificarToken, exigirGestor, (req, res) => {
  try {
    res.json(repo.definirVeiculoAtivo(db, req.params.id, Boolean(req.body && req.body.ativo)));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get('/checklists', verificarToken, (req, res) => {
  if (req.usuarioLogado.tipo !== 'gestor' && req.usuarioLogado.tipo !== 'motorista') {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }
  res.json(repo.listarChecklists(db, req.usuarioLogado, req.query));
});

app.get('/checklists/:id/foto', verificarToken, (req, res) => {
  const encontrado = repo.obterChecklist(db, req.usuarioLogado, req.params.id);
  if (!encontrado || !encontrado.row.foto_arquivo) {
    return res.status(404).json({ erro: 'Fotografia não encontrada' });
  }
  const arquivo = caminhoFotoSeguro(FOTOS_PATH, encontrado.row.foto_arquivo);
  if (!arquivo) return res.status(404).json({ erro: 'Fotografia não encontrada' });
  const extensao = path.extname(arquivo).slice(1);
  res.setHeader('Content-Type', tipoPorExtensao(extensao));
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(arquivo).pipe(res);
});

app.get('/checklists/:id', verificarToken, (req, res) => {
  const encontrado = repo.obterChecklist(db, req.usuarioLogado, req.params.id);
  if (!encontrado) return res.status(404).json({ erro: 'Checklist não encontrado' });
  res.json(encontrado.checklist);
});

app.post('/checklists', verificarToken, async (req, res) => {
  try {
    const entrada = await lerEntrada(req);
    const campos = entrada.fields;
    const resultado = repo.criarChecklist(db, req.usuarioLogado, {
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
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.put('/checklists/:id/quilometragem', verificarToken, exigirGestor, (req, res) => {
  try {
    res.json(repo.corrigirQuilometragem(db, req.params.id, req.body && req.body.km, req.body && req.body.justificativa));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.put('/pendencias/:id', verificarToken, exigirGestor, (req, res) => {
  try {
    res.json(repo.atualizarPendencia(db, req.params.id, req.body || {}));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.delete('/checklists/:id', verificarToken, exigirGestor, (req, res) => {
  try {
    res.json(repo.excluirChecklist(db, req.params.id, FOTOS_PATH));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nServidor de Produção rodando na porta ${PORT}\n`);
});
