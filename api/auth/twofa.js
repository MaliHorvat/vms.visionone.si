'use strict';
// Dvofaktorska prijava (TOTP).
//   GET  /api/auth/twofa           -> ustvari (še neshranjen) secret + otpauth URL
//   POST /api/auth/twofa {secret, code}        -> vklopi (preveri kodo)
//   DELETE /api/auth/twofa {password}          -> izklopi
const { methods, readBody, ok, bad } = require('../../lib/http');
const db = require('../../lib/db');
const crypto = require('../../lib/crypto');
const totp = require('../../lib/totp');
const { requireAuth, audit } = require('../../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const secret = totp.generateSecret();
    return ok(res, { secret, otpauth: totp.otpauthURL(secret, u.username) });
  },
  POST: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const b = await readBody(req);
    const secret = String(b.secret || '');
    if (!secret) return bad(res, 'Manjka skrivnost');
    if (!totp.verify(secret, String(b.code || ''))) return bad(res, 'Napačna koda – poskusite znova');
    await db.run(`UPDATE users SET totp_secret=:s, totp_enabled=1 WHERE id=:id`, { s: secret, id: u.id });
    await audit(req, u, '2fa_enable', u.username);
    return ok(res, { enabled: true });
  },
  DELETE: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const b = await readBody(req);
    if (!crypto.verifyPassword(String(b.password || ''), u.password_hash)) return bad(res, 'Napačno geslo', 401);
    await db.run(`UPDATE users SET totp_secret=NULL, totp_enabled=0 WHERE id=:id`, { id: u.id });
    await audit(req, u, '2fa_disable', u.username);
    return ok(res, { enabled: false });
  },
});
