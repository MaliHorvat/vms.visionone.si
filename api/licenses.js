'use strict';
// Licence.  GET [?customer_id | ?id | ?id&download=1] · POST (izdaj) · PUT ?id&action=revoke
const { methods, readBody, query, json, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const crypto = require('../lib/crypto');
const license = require('../lib/license');
const { requireAuth, requireRole, isStaff, audit } = require('../lib/auth');

function keys() {
  const priv = process.env.LICENSE_PRIVATE_KEY, pub = process.env.LICENSE_PUBLIC_KEY;
  if (!priv || !pub) throw new Error('Licenčni ključi niso nastavljeni (LICENSE_PRIVATE_KEY / LICENSE_PUBLIC_KEY)');
  return { priv, pub };
}
function docOf(row) {
  const claims = typeof row.claims === 'string' ? JSON.parse(row.claims) : row.claims;
  return { license: claims, signature: row.signature, publicKey: process.env.LICENSE_PUBLIC_KEY || '', revoked: !!row.revoked };
}

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const qp = query(req);
    if (qp.id) {
      const row = await db.one(`SELECT * FROM licenses WHERE id=:id`, { id: qp.id });
      if (!row) return bad(res, 'Licenca ne obstaja', 404);
      if (!isStaff(u) && Number(row.customer_id) !== Number(u.customer_id)) return bad(res, 'Nimate dostopa', 403);
      if (qp.download) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="visionone-licenca-${row.id}.json"`);
        return res.end(JSON.stringify(docOf(row), null, 2));
      }
      return ok(res, { license: row, document: docOf(row) });
    }
    let where = '1=1', params = {};
    if (!isStaff(u)) { where = 'l.customer_id=:cid'; params.cid = u.customer_id; }
    else if (qp.customer_id) { where = 'l.customer_id=:cid'; params.cid = +qp.customer_id; }
    const rows = await db.q(
      `SELECT l.*, c.name AS customer_name,
          (SELECT name FROM locations loc WHERE loc.id=l.location_id) AS location_name
       FROM licenses l JOIN customers c ON c.id=l.customer_id
       WHERE ${where} ORDER BY l.created_at DESC`, params);
    return ok(res, { licenses: rows.map(r => ({ ...r, claims: undefined })) });
  },

  POST: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const b = await readBody(req);
    const { priv, pub } = keys();
    const cust = await db.one(`SELECT * FROM customers WHERE id=:id`, { id: +b.customer_id });
    if (!cust) return bad(res, 'Stranka ne obstaja');
    const plan = license.plan(b.plan);
    if (!plan) return bad(res, 'Neznan paket');
    let locName = '';
    if (b.location_id) {
      const loc = await db.one(`SELECT * FROM locations WHERE id=:id AND customer_id=:c`, { id: +b.location_id, c: cust.id });
      if (!loc) return bad(res, 'Lokacija ne pripada stranki');
      locName = loc.name;
    }
    const years = Math.max(1, Math.min(10, +b.years || 1));
    const issued = new Date();
    const expires = new Date(issued.getTime()); expires.setFullYear(expires.getFullYear() + years);
    const licenseId = 'LIC-' + crypto.token(6).toUpperCase().replace(/[-_]/g, '').slice(0, 10);
    const maxDevices = +b.maxDevices || plan.maxDevices;

    const claims = license.buildClaims({
      licenseId, customer: cust.name, locationId: b.location_id ? +b.location_id : null,
      locationName: locName, planId: b.plan, issued: issued.toISOString(), expires: expires.toISOString(), maxDevices,
    });
    const signature = license.sign(claims, priv);

    await db.run(
      `INSERT INTO licenses (id, customer_id, location_id, plan, max_devices, issued_at, expires_at, claims, signature)
       VALUES (:id,:c,:loc,:p,:md,:iss,:exp,:cl,:sig)`,
      { id: licenseId, c: cust.id, loc: b.location_id ? +b.location_id : null, p: b.plan, md: maxDevices,
        iss: issued.toISOString().slice(0, 19).replace('T', ' '), exp: expires.toISOString().slice(0, 19).replace('T', ' '),
        cl: JSON.stringify(claims), sig: signature });
    if (b.location_id) await db.run(`UPDATE locations SET license_id=:lic WHERE id=:id`, { lic: licenseId, id: +b.location_id });
    await audit(req, u, 'license_issue', `${licenseId} ${cust.name} ${b.plan}`);
    return ok(res, { id: licenseId, document: { license: claims, signature, publicKey: pub } });
  },

  PUT: async (req, res) => {
    const u = await requireRole(req, res, ['admin']); if (!u) return;
    const id = query(req).id;
    if (query(req).action !== 'revoke') return bad(res, 'Neznano dejanje');
    const row = await db.one(`SELECT * FROM licenses WHERE id=:id`, { id });
    if (!row) return bad(res, 'Licenca ne obstaja', 404);
    await db.run(`UPDATE licenses SET revoked=1 WHERE id=:id`, { id });
    await audit(req, u, 'license_revoke', id);
    return ok(res, { ok: true });
  },
});
