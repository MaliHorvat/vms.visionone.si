'use strict';
// Agent prevzame čakajoče ukaze.  GET (Bearer) -> jih označi kot 'sent'.
const { methods, ok, bad, clientIp } = require('../../lib/http');
const db = require('../../lib/db');
const agentauth = require('../../lib/agentauth');

module.exports = methods({
  GET: async (req, res) => {
    const loc = await agentauth.location(req);
    if (!loc) return bad(res, 'Neveljaven žeton agenta', 401);
    await agentauth.touch(loc, { ip: clientIp(req) });

    const rows = await db.q(
      `SELECT c.id, c.action, c.device_id, c.params, d.ip AS device_ip, d.kind AS device_kind
       FROM commands c LEFT JOIN devices d ON d.id=c.device_id
       WHERE c.location_id=:l AND c.status='pending' ORDER BY c.created_at ASC LIMIT 20`, { l: loc.id });
    for (const r of rows) await db.run(`UPDATE commands SET status='sent', picked_at=NOW() WHERE id=:id`, { id: r.id });
    return ok(res, { commands: rows.map(r => ({ id: r.id, action: r.action, device_id: r.device_id, device_ip: r.device_ip, device_kind: r.device_kind, params: parse(r.params) })) });
  },
});
function parse(v) { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } }
