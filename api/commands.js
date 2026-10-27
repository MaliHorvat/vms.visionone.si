'use strict';
// Daljinski ukazi (domofon/rele).  GET ?location_id · POST · PUT ?id&action=cancel
// Portal samo doda ukaz v vrsto. Agent izvede le vnaprej določena dejanja (po imenu), definirana lokalno.
const { methods, readBody, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const { requireAuth, locationFor, deviceFor, audit } = require('../lib/auth');

const ACTIONS = ['run_action', 'open_door', 'relay_on', 'relay_off', 'relay_pulse'];

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const locId = +query(req).location_id;
    const loc = await locationFor(u, locId);
    if (!loc) return bad(res, 'Lokacija ne obstaja ali nimate dostopa', 404);
    const rows = await db.q(
      `SELECT c.*, d.name AS device_name FROM commands c LEFT JOIN devices d ON d.id=c.device_id
       WHERE c.location_id=:l ORDER BY c.created_at DESC LIMIT 50`, { l: locId });
    return ok(res, { commands: rows.map(r => ({ ...r, params: parse(r.params), result: parse(r.result) })) });
  },

  POST: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const b = await readBody(req);
    const loc = await locationFor(u, +b.location_id);
    if (!loc) return bad(res, 'Lokacija ne obstaja ali nimate dostopa', 404);
    if (!ACTIONS.includes(b.action)) return bad(res, 'Nedovoljeno dejanje');
    let deviceId = null;
    if (b.device_id) {
      const d = await deviceFor(u, +b.device_id);
      if (!d || d.location_id !== loc.id) return bad(res, 'Naprava ne pripada lokaciji', 400);
      deviceId = d.id;
    }
    const r = await db.run(
      `INSERT INTO commands (location_id, device_id, action, params, created_by)
       VALUES (:l,:d,:a,:p,:by)`,
      { l: loc.id, d: deviceId, a: b.action, p: b.params ? JSON.stringify(b.params) : null, by: u.username });
    await audit(req, u, 'command_queue', `${loc.id}/${b.action}`, { device: deviceId, params: b.params || null });
    return ok(res, { id: r.insertId, status: 'pending' });
  },

  PUT: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    if (query(req).action !== 'cancel') return bad(res, 'Neznano dejanje');
    const id = +query(req).id;
    const row = await db.one(`SELECT * FROM commands WHERE id=:id`, { id });
    if (!row) return bad(res, 'Ukaz ne obstaja', 404);
    if (!(await locationFor(u, row.location_id))) return bad(res, 'Nimate dostopa', 403);
    if (row.status !== 'pending') return bad(res, 'Ukaza ni mogoče preklicati (ni več v čakanju)');
    await db.run(`UPDATE commands SET status='canceled', done_at=NOW() WHERE id=:id`, { id });
    await audit(req, u, 'command_cancel', id);
    return ok(res, { ok: true });
  },
});
function parse(v) { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } }
module.exports.ACTIONS = ACTIONS;
