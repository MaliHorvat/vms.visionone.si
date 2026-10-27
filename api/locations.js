'use strict';
// Lokacije + žeton agenta.
//   GET [?customer_id] · POST (nova, vrne žeton enkrat) · PUT ?id [&action=regen_token] · DELETE ?id
const { methods, readBody, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const crypto = require('../lib/crypto');
const { requireAuth, requireRole, isStaff, locationScope, locationFor, audit } = require('../lib/auth');

function newAgentToken(locId) {
  const raw = `vo_${locId}_${crypto.token(24)}`;
  return { raw, hash: crypto.sha256(raw), prefix: raw.slice(0, 11) };
}

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const scope = locationScope(u, 'l');
    const qp = query(req);
    let extra = '', params = { ...scope.params };
    if (qp.customer_id) { extra = ' AND l.customer_id = :cid'; params.cid = +qp.customer_id; }
    const rows = await db.q(
      `SELECT l.*, c.name AS customer_name,
          (SELECT COUNT(*) FROM devices d WHERE d.location_id=l.id) AS devices,
          (SELECT COUNT(*) FROM devices d WHERE d.location_id=l.id AND d.status='offline') AS devices_down,
          lic.plan AS license_plan, lic.expires_at AS license_expires, lic.revoked AS license_revoked
       FROM locations l
       JOIN customers c ON c.id=l.customer_id
       LEFT JOIN licenses lic ON lic.id = l.license_id
       WHERE ${scope.sql}${extra}
       ORDER BY c.name, l.name`, params);
    return ok(res, { locations: rows.map(cleanLoc) });
  },

  POST: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const b = await readBody(req);
    const customerId = +b.customer_id;
    const name = String(b.name || '').trim();
    if (!customerId || !name) return bad(res, 'Manjka stranka ali ime lokacije');
    const cust = await db.one(`SELECT id FROM customers WHERE id=:id`, { id: customerId });
    if (!cust) return bad(res, 'Stranka ne obstaja');

    const r = await db.run(`INSERT INTO locations (customer_id, name, address) VALUES (:c,:n,:a)`,
      { c: customerId, n: name, a: b.address || null });
    const tok = newAgentToken(r.insertId);
    await db.run(`UPDATE locations SET agent_token_hash=:h, agent_token_prefix=:p WHERE id=:id`,
      { h: tok.hash, p: tok.prefix, id: r.insertId });
    await audit(req, u, 'location_create', name);
    return ok(res, { id: r.insertId, agentToken: tok.raw, note: 'Žeton shranite – prikazan je samo enkrat.' });
  },

  PUT: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const id = +query(req).id;
    const loc = await locationFor(u, id);
    if (!loc) return bad(res, 'Lokacija ne obstaja ali nimate dostopa', 404);

    if (query(req).action === 'regen_token') {
      const tok = newAgentToken(id);
      await db.run(`UPDATE locations SET agent_token_hash=:h, agent_token_prefix=:p WHERE id=:id`,
        { h: tok.hash, p: tok.prefix, id });
      await audit(req, u, 'location_regen_token', id);
      return ok(res, { agentToken: tok.raw, note: 'Nov žeton. Star takoj preneha veljati.' });
    }

    const b = await readBody(req);
    await db.run(`UPDATE locations SET name=:n, address=:a WHERE id=:id`,
      { n: b.name || loc.name, a: b.address ?? loc.address, id });
    await audit(req, u, 'location_update', id);
    return ok(res, { ok: true });
  },

  DELETE: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const id = +query(req).id;
    if (!id) return bad(res, 'Manjka id');
    await db.run(`DELETE FROM locations WHERE id=:id`, { id });
    await audit(req, u, 'location_delete', id);
    return ok(res, { ok: true });
  },
});

function cleanLoc(l) {
  const { agent_token_hash, ...rest } = l;
  return rest;
}
