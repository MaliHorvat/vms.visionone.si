'use strict';
// Upravljanje uporabnikov portala – samo skrbnik.
//   GET · POST (nov) · PUT ?id · DELETE ?id
const { methods, readBody, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const crypto = require('../lib/crypto');
const session = require('../lib/session');
const { requireRole, publicUser, audit } = require('../lib/auth');

const ROLES = ['admin', 'tech', 'customer'];

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const rows = await db.q(
      `SELECT u.id, u.username, u.email, u.role, u.customer_id, u.active, u.totp_enabled,
              u.telegram_chat_id, u.last_login, c.name AS customer_name
       FROM users u LEFT JOIN customers c ON c.id=u.customer_id ORDER BY u.role, u.username`);
    return ok(res, { users: rows.map(r => ({ ...r, telegram_linked: !!r.telegram_chat_id, telegram_chat_id: undefined })) });
  },

  POST: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    const role = ROLES.includes(b.role) ? b.role : 'tech';
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return bad(res, 'Neveljavno uporabniško ime (3–40 znakov: a–z, 0–9, . _ -)');
    if (password.length < 10) return bad(res, 'Geslo mora imeti vsaj 10 znakov');
    let customerId = null;
    if (role === 'customer') {
      customerId = +b.customer_id;
      if (!customerId || !(await db.one(`SELECT id FROM customers WHERE id=:id`, { id: customerId }))) return bad(res, 'Stranka za uporabnika ne obstaja');
    }
    const exists = await db.one(`SELECT id FROM users WHERE username=:u`, { u: username });
    if (exists) return bad(res, 'Uporabniško ime že obstaja');
    const r = await db.run(
      `INSERT INTO users (username, email, password_hash, role, customer_id, active)
       VALUES (:u,:e,:p,:r,:c,1)`,
      { u: username, e: b.email || null, p: crypto.hashPassword(password), r: role, c: customerId });
    await audit(req, u, 'user_create', `${username} (${role})`);
    return ok(res, { id: r.insertId });
  },

  PUT: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const id = +query(req).id; const b = await readBody(req);
    const target = await db.one(`SELECT * FROM users WHERE id=:id`, { id });
    if (!target) return bad(res, 'Uporabnik ne obstaja', 404);
    const role = ROLES.includes(b.role) ? b.role : target.role;
    const active = b.active === undefined ? target.active : (b.active ? 1 : 0);
    await db.run(`UPDATE users SET email=:e, role=:r, active=:a WHERE id=:id`,
      { e: b.email ?? target.email, r: role, a: active, id });
    if (b.password) {
      if (String(b.password).length < 10) return bad(res, 'Geslo mora imeti vsaj 10 znakov');
      await db.run(`UPDATE users SET password_hash=:p WHERE id=:id`, { p: crypto.hashPassword(b.password), id });
      await session.destroyAllForUser(id);
    }
    if (b.reset2fa) await db.run(`UPDATE users SET totp_enabled=0, totp_secret=NULL WHERE id=:id`, { id });
    await audit(req, u, 'user_update', target.username);
    return ok(res, { ok: true });
  },

  DELETE: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const id = +query(req).id;
    if (id === u.id) return bad(res, 'Ne morete izbrisati lastnega računa');
    const target = await db.one(`SELECT username FROM users WHERE id=:id`, { id });
    if (!target) return bad(res, 'Uporabnik ne obstaja', 404);
    await db.run(`DELETE FROM users WHERE id=:id`, { id });
    await audit(req, u, 'user_delete', target.username);
    return ok(res, { ok: true });
  },
});
