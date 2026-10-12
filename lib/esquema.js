const ESQUEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('motorista', 'gestor'))
);

CREATE TABLE IF NOT EXISTS veiculos (
  id TEXT PRIMARY KEY,
  placa TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  hora TEXT,
  placa TEXT NOT NULL,
  veiculo_id TEXT,
  motorista TEXT NOT NULL,
  usuario_id TEXT,
  km INTEGER,
  km_inconsistente INTEGER NOT NULL DEFAULT 0 CHECK (km_inconsistente IN (0, 1)),
  km_justificativa TEXT,
  combustivel TEXT,
  status TEXT NOT NULL,
  itens_nao_ok TEXT NOT NULL,
  obs TEXT,
  foto_arquivo TEXT,
  foto_original TEXT,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (veiculo_id) REFERENCES veiculos(id)
);

CREATE TABLE IF NOT EXISTS pendencias (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL,
  item TEXT NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'concluida')),
  responsavel TEXT,
  aberto_em TEXT NOT NULL,
  observacao_resolucao TEXT,
  concluido_em TEXT,
  FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migracao_controle (
  origem TEXT PRIMARY KEY,
  executado_em TEXT NOT NULL,
  usuarios INTEGER NOT NULL,
  checklists INTEGER NOT NULL
);
`;

module.exports = { ESQUEMA };
