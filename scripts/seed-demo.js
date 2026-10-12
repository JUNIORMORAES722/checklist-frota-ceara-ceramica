const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { abrirBanco } = require('../lib/banco');

async function seed() {
  const senhaGestor = process.env.SENHA_GESTOR;
  const senhaMotorista = process.env.SENHA_MOTORISTA;
  if (!senhaGestor || !senhaMotorista) {
    console.error('Defina SENHA_GESTOR e SENHA_MOTORISTA no ambiente. Elas não ficam no repositório.');
    process.exit(1);
  }
  const destino = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'demo.sqlite'));
  if (path.basename(destino) === 'frota.sqlite') {
    console.error('O seed de demonstração não grava no banco operacional frota.sqlite.');
    process.exit(1);
  }
  fs.rmSync(destino, { force: true });
  fs.rmSync(`${destino}-wal`, { force: true });
  fs.rmSync(`${destino}-shm`, { force: true });
  const db = abrirBanco(destino);
  const hashGestor = await bcrypt.hash(senhaGestor, 10);
  const hashMotorista = await bcrypt.hash(senhaMotorista, 10);
  db.exec('BEGIN');
  db.prepare('INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)').run('demo-gestor', 'Helena Costa', 'helena', hashGestor, 'gestor');
  db.prepare('INSERT INTO usuarios (id, nome, usuario, senha, tipo) VALUES (?, ?, ?, ?, ?)').run('demo-motorista', 'Paulo Andrade', 'paulo', hashMotorista, 'motorista');
  db.prepare('INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, 1)').run('vei_ABC1D23', 'ABC1D23', 'Caminhão de demonstração');
  db.prepare('INSERT INTO veiculos (id, placa, descricao, ativo) VALUES (?, ?, ?, 1)').run('vei_DEF2E34', 'DEF2E34', 'Utilitário de demonstração');
  db.prepare(`
    INSERT INTO checklists (
      id, data, hora, placa, veiculo_id, motorista, usuario_id, km, km_inconsistente,
      combustivel, status, itens_nao_ok, obs, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run('demo-ok', '2026-03-02', '08:10', 'ABC1D23', 'vei_ABC1D23', 'Paulo Andrade', 'demo-motorista', 12000, '1/2', 'OK', '[]', 'Inspeção de demonstração sem pendência.', '2026-03-02T08:10:00.000Z');
  db.prepare(`
    INSERT INTO checklists (
      id, data, hora, placa, veiculo_id, motorista, usuario_id, km, km_inconsistente,
      combustivel, status, itens_nao_ok, obs, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run('demo-pendente', '2026-03-03', '14:40', 'DEF2E34', 'vei_DEF2E34', 'Paulo Andrade', 'demo-motorista', 12150, '1/4', 'PENDENTE', JSON.stringify(['Freios']), 'Freio com folga na demonstração.', '2026-03-03T14:40:00.000Z');
  db.prepare(`
    INSERT INTO pendencias (id, checklist_id, item, situacao, aberto_em)
    VALUES ('pen-demo', 'demo-pendente', 'Freios', 'aberta', '2026-03-03')
  `).run();
  db.exec('COMMIT');
  db.close();
  console.log(JSON.stringify({ ok: true, banco: destino, gestor: 'helena', motorista: 'paulo' }));
}

seed().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
