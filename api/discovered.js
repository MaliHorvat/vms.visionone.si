'use strict';
// Naprave, ki jih je agent zaznal v omrežju (predlog za dodajanje).  GET ?location_id
const { methods, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const { requireRole, locationFor } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const locId = +query(req).location_id;
    const loc = await locationFor(u, locId);
    if (!loc) return bad(res, 'Lokacija ne obstaja ali nimate dostopa', 404);
    const row = await db.one(`SELECT v FROM settings WHERE k=:k`, { k: `discovered:${locId}` });
    let data = { items: [], ts: null };
    if (row) { try { data = JSON.parse(row.v); } catch (e) {} }
    // odstrani že dodane (po IP)
    const have = new Set((await db.q(`SELECT ip FROM devices WHERE location_id=:l AND ip IS NOT NULL`, { l: locId })).map(r => r.ip));
    data.items = (data.items || []).filter(it => !have.has(it.ip));
    return ok(res, data);
  },
});
