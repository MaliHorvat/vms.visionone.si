'use strict';
// Izpadi / dogodki.  GET [?location_id][?open=1][?limit]
const { methods, query, ok } = require('../lib/http');
const db = require('../lib/db');
const { requireAuth, isStaff, locationScope } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const qp = query(req);
    const scope = locationScope(u, 'l');
    let where = scope.sql, params = { ...scope.params };
    if (qp.location_id) { where += ' AND i.location_id=:lid'; params.lid = +qp.location_id; }
    if (qp.open) where += ' AND i.resolved_at IS NULL';
    const limit = Math.min(500, Math.max(1, +qp.limit || 100));
    const rows = await db.q(
      `SELECT i.*, l.name AS location_name, c.name AS customer_name, d.name AS device_name
       FROM incidents i
       JOIN locations l ON l.id=i.location_id
       JOIN customers c ON c.id=l.customer_id
       LEFT JOIN devices d ON d.id=i.device_id
       WHERE ${where}
       ORDER BY i.started_at DESC LIMIT ${limit}`, params);
    return ok(res, { incidents: rows });
  },
});
