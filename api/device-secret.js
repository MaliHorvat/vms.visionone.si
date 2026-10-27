'use strict';
// Gesla naprav, shranjena v portalu (šifrirano, AES-256-GCM). Samo osebje.
//   GET ?device_id (metapodatki, brez gesla) · POST (shrani) · DELETE ?id
// Opomba: priporočeno je gesla hraniti LOKALNO v agentu. To je neobvezna centralna shramba.
const { methods, readBody, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const crypto = require('../lib/crypto');
const { requireRole, deviceFor, audit } = require('../lib/auth');

function key() {
  const k = process.env.DEVICE_SECRET_KEY;
  if (!k) throw new Error('DEVICE_SECRET_KEY ni nastavljen – centralna shramba gesel ni na voljo.');
  return k;
}

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const d = await deviceFor(u, +query(req).device_id);
    if (!d) return bad(res, 'Naprava ne obstaja ali nimate dostopa', 404);
    const rows = await db.q(`SELECT id, label, username, created_at FROM device_secrets WHERE device_id=:id`, { id: d.id });
    return ok(res, { secrets: rows });
  },
  POST: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const b = await readBody(req);
    const d = await deviceFor(u, +b.device_id);
    if (!d) return bad(res, 'Naprava ne obstaja ali nimate dostopa', 404);
    if (!b.secret) return bad(res, 'Manjka geslo');
    const enc = crypto.encryptSecret(String(b.secret), key());
    await db.run(`INSERT INTO device_secrets (device_id, label, username, secret_enc) VALUES (:d,:l,:u,:s)`,
      { d: d.id, l: (b.label || 'privzeto').slice(0, 80), u: (b.username || '').slice(0, 120), s: enc });
    await audit(req, u, 'device_secret_set', d.id);
    return ok(res, { ok: true });
  },
  DELETE: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const id = +query(req).id;
    const row = await db.one(`SELECT ds.*, d.location_id FROM device_secrets ds JOIN devices d ON d.id=ds.device_id WHERE ds.id=:id`, { id });
    if (!row) return bad(res, 'Ne obstaja', 404);
    if (!(await deviceFor(u, row.device_id))) return bad(res, 'Nimate dostopa', 403);
    await db.run(`DELETE FROM device_secrets WHERE id=:id`, { id });
    await audit(req, u, 'device_secret_delete', id);
    return ok(res, { ok: true });
  },
});
