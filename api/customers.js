'use strict';
// Stranke.  GET (seznam) · POST (nova) · PUT ?id · DELETE ?id   — samo osebje (admin/tech).
const { methods, readBody, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const { requireAuth, requireRole, isStaff, audit } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    if (isStaff(u)) {
      const rows = await db.q(
        `SELECT c.*,
            (SELECT COUNT(*) FROM locations l WHERE l.customer_id=c.id) AS locations,
            (SELECT COUNT(*) FROM devices d JOIN locations l ON l.id=d.location_id WHERE l.customer_id=c.id) AS devices
         FROM customers c ORDER BY c.name`);
      return ok(res, { customers: rows });
    }
    const row = await db.one(`SELECT * FROM customers WHERE id=:id`, { id: u.customer_id });
    return ok(res, { customers: row ? [row] : [] });
  },
  POST: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (!name) return bad(res, 'Ime stranke je obvezno');
    const r = await db.run(
      `INSERT INTO customers (name, contact_email, contact_phone, notes) VALUES (:n,:e,:p,:no)`,
      { n: name, e: b.contact_email || null, p: b.contact_phone || null, no: b.notes || null });
    await audit(req, u, 'customer_create', name);
    return ok(res, { id: r.insertId });
  },
  PUT: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const id = +query(req).id; const b = await readBody(req);
    if (!id) return bad(res, 'Manjka id');
    await db.run(
      `UPDATE customers SET name=:n, contact_email=:e, contact_phone=:p, notes=:no, active=:a WHERE id=:id`,
      { n: b.name, e: b.contact_email || null, p: b.contact_phone || null, no: b.notes || null, a: b.active ? 1 : 0, id });
    await audit(req, u, 'customer_update', id);
    return ok(res, { ok: true });
  },
  DELETE: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const id = +query(req).id;
    if (!id) return bad(res, 'Manjka id');
    await db.run(`DELETE FROM customers WHERE id=:id`, { id });
    await audit(req, u, 'customer_delete', id);
    return ok(res, { ok: true });
  },
});
