'use strict';
// Enkratni zagon: ustvari tabele in prvega skrbnika. Zaščiteno s SETUP_TOKEN.
// POST /api/setup { token, username, password, email }
const { methods, readBody, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const { migrate } = require('../lib/schema');
const crypto = require('../lib/crypto');

module.exports = methods({
  POST: async (req, res) => {
    const b = await readBody(req);
    const setupToken = process.env.SETUP_TOKEN;
    if (!setupToken) return bad(res, 'SETUP_TOKEN ni nastavljen na strežniku', 500);
    if (!b.token || b.token !== setupToken) return bad(res, 'Napačen SETUP_TOKEN', 403);

    await migrate();

    const existing = await db.one(`SELECT COUNT(*) AS n FROM users`);
    if (existing && Number(existing.n) > 0) {
      return ok(res, { migrated: true, adminCreated: false, note: 'Uporabniki že obstajajo – migracije osvežene.' });
    }

    const username = String(b.username || 'admin').trim().toLowerCase();
    const password = String(b.password || '');
    if (password.length < 10) return bad(res, 'Geslo skrbnika mora imeti vsaj 10 znakov');

    await db.run(
      `INSERT INTO users (username, email, password_hash, role, active)
       VALUES (:u, :e, :p, 'admin', 1)`,
      { u: username, e: b.email || null, p: crypto.hashPassword(password) }
    );
    return ok(res, { migrated: true, adminCreated: true, username });
  },
});
