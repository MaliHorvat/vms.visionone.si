'use strict';
// Zgodovinski podatki za napravo.  GET ?device_id&hours=24
const { methods, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const { requireAuth, deviceFor } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const qp = query(req);
    const d = await deviceFor(u, +qp.device_id);
    if (!d) return bad(res, 'Naprava ne obstaja ali nimate dostopa', 404);
    const hours = Math.min(720, Math.max(1, +qp.hours || 24));
    const rows = await db.q(
      `SELECT ts, up, latency_ms, cpu, mem, disk FROM metrics
       WHERE device_id=:id AND ts >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)
       ORDER BY ts ASC LIMIT 5000`, { id: d.id });
    // razpoložljivost v obdobju
    const upCount = rows.filter(r => r.up).length;
    const availability = rows.length ? (upCount / rows.length) * 100 : null;
    return ok(res, { metrics: rows, availability });
  },
});
