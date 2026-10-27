'use strict';
// Povzetek za nadzorno ploščo (ločeno po pravicah).
const { methods, ok } = require('../lib/http');
const db = require('../lib/db');
const { requireAuth, isStaff } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const staff = isStaff(u);
    const cond = staff ? '1=1' : 'l.customer_id = :cid';
    const p = staff ? {} : { cid: u.customer_id };

    const loc = await db.one(
      `SELECT COUNT(*) AS total,
         SUM(status='online') AS online, SUM(status='offline') AS offline
       FROM locations l WHERE ${cond}`, p);
    const dev = await db.one(
      `SELECT COUNT(*) AS total,
         SUM(d.status='online') AS online, SUM(d.status='offline') AS offline, SUM(d.status='warn') AS warn
       FROM devices d JOIN locations l ON l.id=d.location_id WHERE ${cond}`, p);
    const inc = await db.one(
      `SELECT COUNT(*) AS open FROM incidents i JOIN locations l ON l.id=i.location_id
       WHERE i.resolved_at IS NULL AND ${cond}`, p);

    const out = {
      locations: num(loc), devices: num(dev), openIncidents: Number(inc.open || 0),
    };
    if (staff) {
      const cust = await db.one(`SELECT COUNT(*) AS n FROM customers`);
      const lic = await db.one(
        `SELECT SUM(revoked=0 AND expires_at>NOW()) AS active,
            SUM(revoked=0 AND expires_at<=NOW()) AS expired,
            SUM(revoked=0 AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)) AS soon
         FROM licenses`);
      out.customers = Number(cust.n || 0);
      out.licenses = { active: Number(lic.active || 0), expired: Number(lic.expired || 0), soon: Number(lic.soon || 0) };
    }
    return ok(res, out);
  },
});
function num(r) { return { total: Number(r.total || 0), online: Number(r.online || 0), offline: Number(r.offline || 0), warn: Number(r.warn || 0) }; }
