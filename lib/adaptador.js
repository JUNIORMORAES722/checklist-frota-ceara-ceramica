function converterInterrogacoes(sql) {
  let indice = 0;
  return String(sql).replace(/\?/g, () => {
    indice += 1;
    return `$${indice}`;
  });
}

function redigirTexto(texto) {
  return String(texto || '').replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[oculto]');
}

function sanitizarErro(erro) {
  if (!erro || typeof erro !== 'object') return erro;
  if (erro.status && erro.status < 500) return erro;
  const mensagem = String(erro.message || '');
  if (redigirTexto(mensagem) !== mensagem) {
    const limpo = new Error('Não foi possível conectar ao banco.');
    limpo.status = erro.status || 503;
    return limpo;
  }
  return erro;
}

function validarUrlPostgres(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return { ok: false, motivo: 'ausente' };
  let protocolo = '';
  let host = '';
  try {
    const url = new URL(texto);
    protocolo = url.protocol;
    host = url.hostname;
  } catch {
    return { ok: false, motivo: 'invalida' };
  }
  if (protocolo !== 'postgres:' && protocolo !== 'postgresql:') return { ok: false, motivo: 'protocolo' };
  return { ok: true, pooled: host.includes('-pooler') };
}

function adaptadorSqlite(db) {
  const adaptador = {
    dialect: 'sqlite',
    async get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = await fn(adaptador);
        db.exec('COMMIT');
        return resultado;
      } catch (erro) {
        try { db.exec('ROLLBACK'); } catch { /* a transação já foi encerrada */ }
        throw erro;
      }
    },
    async close() {
      db.close();
    }
  };
  return adaptador;
}

function adaptadorClientePostgres(client) {
  const adaptador = {
    dialect: 'postgres',
    async get(sql, params = []) {
      const resultado = await client.query(converterInterrogacoes(sql), params);
      return resultado.rows[0];
    },
    async all(sql, params = []) {
      const resultado = await client.query(converterInterrogacoes(sql), params);
      return resultado.rows;
    },
    async run(sql, params = []) {
      await client.query(converterInterrogacoes(sql), params);
    },
    async exec(sql) {
      await client.query(sql);
    },
    async transaction(fn) {
      return fn(adaptador);
    },
    async close() {}
  };
  return adaptador;
}

function adaptadorPostgres(pool) {
  pool.on('error', () => {
    console.error('Falha na conexão PostgreSQL ociosa.');
  });
  return {
    dialect: 'postgres',
    async get(sql, params = []) {
      try {
        const resultado = await pool.query(converterInterrogacoes(sql), params);
        return resultado.rows[0];
      } catch (erro) {
        throw sanitizarErro(erro);
      }
    },
    async all(sql, params = []) {
      try {
        const resultado = await pool.query(converterInterrogacoes(sql), params);
        return resultado.rows;
      } catch (erro) {
        throw sanitizarErro(erro);
      }
    },
    async run(sql, params = []) {
      try {
        await pool.query(converterInterrogacoes(sql), params);
      } catch (erro) {
        throw sanitizarErro(erro);
      }
    },
    async exec(sql) {
      try {
        await pool.query(sql);
      } catch (erro) {
        throw sanitizarErro(erro);
      }
    },
    async transaction(fn) {
      const client = await pool.connect();
      const tx = adaptadorClientePostgres(client);
      try {
        await client.query('BEGIN');
        const resultado = await fn(tx);
        await client.query('COMMIT');
        return resultado;
      } catch (erro) {
        try { await client.query('ROLLBACK'); } catch { /* a transação já foi encerrada */ }
        throw sanitizarErro(erro);
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}

function criarPoolPostgres(connectionString) {
  const { Pool } = require('@neondatabase/serverless');
  return new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000
  });
}

function adaptadorConsulta({ dialect, consultar, executar, transacionar, fechar }) {
  const adaptador = {
    dialect,
    async get(sql, params = []) {
      const linhas = await consultar(sql, params);
      return linhas[0];
    },
    async all(sql, params = []) {
      return consultar(sql, params);
    },
    async run(sql, params = []) {
      await consultar(sql, params);
    },
    async exec(sql) {
      await executar(sql);
    },
    transaction(fn) {
      return transacionar(fn, adaptador);
    },
    async close() {
      if (fechar) await fechar();
    }
  };
  return adaptador;
}

module.exports = {
  converterInterrogacoes,
  redigirTexto,
  sanitizarErro,
  validarUrlPostgres,
  adaptadorSqlite,
  adaptadorPostgres,
  adaptadorConsulta,
  criarPoolPostgres
};
