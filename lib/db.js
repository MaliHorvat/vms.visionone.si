'use strict';
// MySQL/MariaDB povezava (Neoserv). Pool se ustvari ob prvi uporabi. mysql2 namesti Vercel ob gradnji.
let pool = null;

function config() {
  const ssl = process.env.DB_SSL === '1'
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === '1' }
    : undefined;
  return {
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 30000,
    enableKeepAlive: true,
    namedPlaceholders: true,
    charset: 'utf8mb4_general_ci',
    timezone: 'Z',
  };
}

function getPool() {
  if (!pool) {
    if (!process.env.DB_HOST) throw new Error('Baza ni nastavljena (DB_HOST). Preveri okoljske spremenljivke.');
    const mysql = require('mysql2/promise');
    pool = mysql.createPool(config());
  }
  return pool;
}

// q('SELECT ... WHERE id=:id', {id}) -> vrstice
async function q(sql, params = {}) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}
async function one(sql, params = {}) {
  const rows = await q(sql, params);
  return rows[0] || null;
}
// Za INSERT/UPDATE/DELETE – vrne result (affectedRows, insertId)
async function run(sql, params = {}) {
  const [res] = await getPool().execute(sql, params);
  return res;
}
async function tx(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally { conn.release(); }
}

module.exports = { getPool, q, one, run, tx, config };
