'use strict';
// Naprave.  GET ?location_id | ?id · POST · PUT ?id · DELETE ?id
const { methods, readBody, query, ok, bad } = require('../lib/http');
const db = require('../lib/db');
const { requireAuth, requireRole, locationFor, deviceFor, audit } = require('../lib/auth');

const KINDS = ['camera', 'nvr', 'switch', 'router', 'ap', 'ups', 'server', 'domofon', 'nas', 'printer', 'other'];
const j = (v) => (v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v)));
function parse(v) { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } }
function clean(d) { return { ...d, monitor: parse(d.monitor), settings: parse(d.settings) }; }

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const qp = query(req);
    if (qp.id) {
      const d = await deviceFor(u, +qp.id);
      if (!d) return bad(res, 'Naprava ne obstaja ali nimate dostopa', 404);
      return ok(res, { device: clean(d) });
    }
    const locId = +qp.location_id;
    if (!locId) return bad(res, 'Manjka location_id');
    const loc = await locationFor(u, locId);
    if (!loc) return bad(res, 'Lokacija ne obstaja ali nimate dostopa', 404);
    const rows = await db.q(`SELECT * FROM devices WHERE location_id=:l ORDER BY kind, name`, { l: locId });
    return ok(res, { devices: rows.map(clean) });
  },

  POST: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const b = await readBody(req);
    const loc = await locationFor(u, +b.location_id);
    if (!loc) return bad(res, 'Lokacija ne obstaja ali nimate dostopa', 404);
    const name = String(b.name || '').trim();
    if (!name) return bad(res, 'Ime naprave je obvezno');
    const kind = KINDS.includes(b.kind) ? b.kind : 'other';
    const r = await db.run(
      `INSERT INTO devices (location_id, name, kind, ip, mac, vendor, model, firmware, monitor, settings)
       VALUES (:l,:n,:k,:ip,:mac,:ven,:mod,:fw,:mon,:set)`,
      { l: loc.id, n: name, k: kind, ip: b.ip || null, mac: b.mac || null, ven: b.vendor || null,
        mod: b.model || null, fw: b.firmware || null, mon: j(b.monitor), set: j(b.settings) });
    await audit(req, u, 'device_create', `${loc.id}/${name}`);
    return ok(res, { id: r.insertId });
  },

  PUT: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const id = +query(req).id;
    const d = await deviceFor(u, id);
    if (!d) return bad(res, 'Naprava ne obstaja ali nimate dostopa', 404);
    const b = await readBody(req);
    const kind = KINDS.includes(b.kind) ? b.kind : d.kind;
    await db.run(
      `UPDATE devices SET name=:n, kind=:k, ip=:ip, mac=:mac, vendor=:ven, model=:mod, firmware=:fw,
          monitor=:mon, settings=:set WHERE id=:id`,
      { n: b.name ?? d.name, k: kind, ip: b.ip ?? d.ip, mac: b.mac ?? d.mac, ven: b.vendor ?? d.vendor,
        mod: b.model ?? d.model, fw: b.firmware ?? d.firmware,
        mon: b.monitor !== undefined ? j(b.monitor) : d.monitor,
        set: b.settings !== undefined ? j(b.settings) : d.settings, id });
    await audit(req, u, 'device_update', id);
    return ok(res, { ok: true });
  },

  DELETE: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const id = +query(req).id;
    const d = await deviceFor(u, id);
    if (!d) return bad(res, 'Naprava ne obstaja ali nimate dostopa', 404);
    await db.run(`DELETE FROM devices WHERE id=:id`, { id });
    await audit(req, u, 'device_delete', id);
    return ok(res, { ok: true });
  },
});

module.exports.KINDS = KINDS;
