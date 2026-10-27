'use strict';
// Agent pošlje telemetrijo.  POST (Bearer)
// { version, results:[{device_id, up, latency_ms, cpu,mem,disk, extra, model,firmware,mac}], discovered:[...], capabilities:{device_id:[actions]} }
const { methods, readBody, ok, bad, clientIp } = require('../../lib/http');
const db = require('../../lib/db');
const agentauth = require('../../lib/agentauth');
const reconcile = require('../../lib/reconcile');

module.exports = methods({
  POST: async (req, res) => {
    const loc = await agentauth.location(req);
    if (!loc) return bad(res, 'Neveljaven žeton agenta', 401);
    const b = await readBody(req);
    await agentauth.touch(loc, { version: b.version, ip: clientIp(req) });

    const results = Array.isArray(b.results) ? b.results : [];
    const caps = b.capabilities || {};
    let processed = 0;

    for (const r of results) {
      const id = +r.device_id;
      if (!id) continue;
      const dev = await db.one(`SELECT id, status, settings FROM devices WHERE id=:id AND location_id=:l`, { id, l: loc.id });
      if (!dev) continue;
      const up = !!r.up;
      const status = up ? (r.warn ? 'warn' : 'online') : 'offline';

      // posodobi inventar (model/firmware/mac), če ga agent zazna
      const fields = [], params = { id, status, lat: num(r.latency_ms) };
      let setInv = '';
      if (r.model) { setInv += ', model=:model'; params.model = String(r.model).slice(0, 120); }
      if (r.firmware) { setInv += ', firmware=:fw'; params.fw = String(r.firmware).slice(0, 80); }
      if (r.mac) { setInv += ', mac=:mac'; params.mac = String(r.mac).slice(0, 32); }

      // zmožnosti (dejanja) shranimo v settings.actions
      if (caps[id]) {
        const s = parse(dev.settings) || {};
        s.actions = caps[id];
        setInv += ', settings=:settings'; params.settings = JSON.stringify(s);
      }

      await db.run(`UPDATE devices SET status=:status, last_seen=NOW(), last_latency_ms=:lat${setInv} WHERE id=:id`, params);
      await db.run(
        `INSERT INTO metrics (device_id, up, latency_ms, cpu, mem, disk, extra)
         VALUES (:id,:up,:lat,:cpu,:mem,:disk,:extra)`,
        { id, up: up ? 1 : 0, lat: num(r.latency_ms), cpu: num(r.cpu), mem: num(r.mem), disk: num(r.disk),
          extra: r.extra ? JSON.stringify(r.extra) : null });
      processed++;
    }

    // Zaznane (še nedodane) naprave shranimo v settings lokacije za predlog v vmesniku
    if (Array.isArray(b.discovered) && b.discovered.length) {
      await db.run(
        `INSERT INTO settings (k, v) VALUES (:k, :v) ON DUPLICATE KEY UPDATE v=VALUES(v)`,
        { k: `discovered:${loc.id}`, v: JSON.stringify({ ts: Date.now(), items: b.discovered.slice(0, 200) }) });
    }
    // Sprotno zaznavanje izpadov (brez odvisnosti od Vercel crona):
    // - incidenti naprav za to lokacijo takoj,
    // - pregled agentov po vseh lokacijah največ enkrat na ~55 s.
    try { await reconcile.reconcileLocation(loc.id); } catch (e) { console.error('[reconcile]', e.message); }
    try { await reconcile.sendPending(); } catch (e) {}
    reconcile.sweepIfDue().catch(() => {});

    return ok(res, { processed });
  },
});
function num(v) { return (v === null || v === undefined || isNaN(v)) ? null : Number(v); }
function parse(v) { if (v == null) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return null; } }
