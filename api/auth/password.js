'use strict';
// POST /api/auth/password { current, next }  – sprememba lastnega gesla.
const { methods, readBody, ok, bad } = require('../../lib/http');
const db = require('../../lib/db');
const crypto = require('../../lib/crypto');
const session = require('../../lib/session');
const { requireAuth, audit } = require('../../lib/auth');

module.exports = methods({
  POST: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const b = await readBody(req);
    if (!crypto.verifyPassword(String(b.current || ''), u.password_hash)) return bad(res, 'Trenutno geslo ni pravilno', 401);
    const next = String(b.next || '');
    if (next.length < 10) return bad(res, 'Novo geslo mora imeti vsaj 10 znakov');
    await db.run(`UPDATE users SET password_hash=:p WHERE id=:id`, { p: crypto.hashPassword(next), id: u.id });
    await session.destroyAllForUser(u.id);
    await session.create(res, u.id, req);
    await audit(req, u, 'password_change', u.username);
    return ok(res, { ok: true });
  },
});
