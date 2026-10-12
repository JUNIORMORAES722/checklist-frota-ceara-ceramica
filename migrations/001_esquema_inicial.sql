-- Esquema PostgreSQL da frota.
-- Identificadores continuam TEXT, como no SQLite, para preservar os registros.
-- Datas ficam em TEXT no formato já gravado. Não há conversão para timestamp.
-- ativo e km_inconsistente continuam inteiros 0 ou 1, como a aplicação já interpreta.
-- usuario_id não tem chave estrangeira: há inspeções históricas sem usuário correspondente.
-- foto_conteudo guarda a imagem no banco. A Vercel não oferece disco persistente.
-- Esta migração só cria estruturas ausentes. Não apaga tabela nem registro.

CREATE TABLE IF NOT EXISTS schema_migracoes (
  versao TEXT PRIMARY KEY,
  descricao TEXT NOT NULL,
  aplicada_em TEXT NOT NULL
);

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
  foto_conteudo BYTEA,
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

CREATE INDEX IF NOT EXISTS idx_checklists_placa ON checklists (placa);
CREATE INDEX IF NOT EXISTS idx_checklists_usuario ON checklists (usuario_id);
CREATE INDEX IF NOT EXISTS idx_checklists_data ON checklists (data);
CREATE INDEX IF NOT EXISTS idx_checklists_veiculo ON checklists (veiculo_id);
CREATE INDEX IF NOT EXISTS idx_pendencias_checklist ON pendencias (checklist_id);
