'use strict';
// POST /api/auth/login { username, password, totp? }
const { methods, readBody, ok, bad } = require('../../lib/http');
const db = require('../../lib/db');
const crypto = require('../../lib/crypto');
const totp = require('../../lib/totp');
const session = require('../../lib/session');
const { audit, publicUser } = require('../../lib/auth');

const MAX_FAILS = 6;
const LOCK_MIN = 15;

module.exports = methods({
  POST: async (req, res) => {
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!username || !password) return bad(res, 'Vnesite uporabniško ime in geslo');

    const u = await db.one(`SELECT * FROM users WHERE username = :u`, { u: username });
    // Enoten odgovor in enak čas ne glede na obstoj uporabnika (proti ugibanju).
    const okPass = u ? crypto.verifyPassword(password, u.password_hash) : crypto.verifyPassword(password, crypto.hashPassword('x'));

    if (!u || !u.active || !okPass) {
      if (u) {
        const fails = (u.failed_logins || 0) + 1;
        const lock = fails >= MAX_FAILS ? session.fmt(new Date(Date.now() + LOCK_MIN * 60000)) : null;
        await db.run(`UPDATE users SET failed_logins=:f, locked_until=:l WHERE id=:id`, { f: fails, l: lock, id: u.id });
      }
      await audit(req, u || null, 'login_fail', username);
      return bad(res, 'Napačno uporabniško ime ali geslo', 401);
    }

    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      return bad(res, 'Račun je začasno zaklenjen zaradi preveč poskusov. Poskusite kasneje.', 423);
    }

    if (u.totp_enabled) {
      const t = String(b.totp || '').replace(/\D/g, '');
      if (!t) return ok(res, { need2fa: true });
      if (!totp.verify(u.totp_secret, t)) {
        await audit(req, u, 'login_2fa_fail', username);
        return bad(res, 'Napačna koda za dvofaktorsko prijavo', 401);
      }
    }

    await db.run(`UPDATE users SET failed_logins=0, locked_until=NULL, last_login=NOW() WHERE id=:id`, { id: u.id });
    await session.create(res, u.id, req);
    await audit(req, u, 'login_ok', username);
    return ok(res, { user: publicUser(u) });
  },
});
