'use strict';
// Agent pridobi svoj seznam naprav in nastavitve nadzora.  GET (Bearer žeton lokacije)
const { methods, ok, bad, clientIp } = require('../../lib/http');
const db = require('../../lib/db');
const agentauth = require('../../lib/agentauth');

module.exports = methods({
  GET: async (req, res) => {
    const loc = await agentauth.location(req);
    if (!loc) return bad(res, 'Neveljaven žeton agenta', 401);
    await agentauth.touch(loc, { ip: clientIp(req) });

    const devices = await db.q(
      `SELECT id, name, kind, ip, mac, vendor, model, monitor FROM devices WHERE location_id=:l`, { l: loc.id });
    // Licenca lokacije (za funkcije, ki jih agent sme uporabljati)
    const lic = loc.license_id ? await db.one(`SELECT plan, claims, expires_at, revoked FROM licenses WHERE id=:id`, { id: loc.license_id }) : null;
    let features = [];
    if (lic && !lic.revoked && new Date(lic.expires_at) > new Date()) {
      try { features = (typeof lic.claims === 'string' ? JSON.parse(lic.claims) : lic.claims).features || []; } catch (e) {}
    }
    return ok(res, {
      location: { id: loc.id, name: loc.name },
      offlineAfter: +(process.env.OFFLINE_AFTER_SECONDS || 180),
      reportInterval: 45,
      features,
      devices: devices.map(d => ({ ...d, monitor: parse(d.monitor) })),
    });
  },
});
function parse(v) { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } }
