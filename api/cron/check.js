'use strict';
// Vercel cron (vsako minuto): zazna izpade, uskladi incidente, pošlje Telegram obvestila.
const { methods, ok, bad } = require('../../lib/http');
const db = require('../../lib/db');
const notify = require('../../lib/notify');

function cronAllowed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // če ni nastavljen, dovoli (Vercel interni klic)
  const h = req.headers['authorization'] || '';
  return h === `Bearer ${secret}`;
}

async function handle(req, res) {
  if (!cronAllowed(req)) return bad(res, 'Ni dovoljeno', 401);
  const offlineAfter = +(process.env.OFFLINE_AFTER_SECONDS || 180);

  // 1) Lokacije brez poročila -> offline + incident agent_offline
  const staleLocs = await db.q(
    `SELECT l.*, c.name AS customer_name FROM locations l JOIN customers c ON c.id=l.customer_id
     WHERE l.agent_token_hash IS NOT NULL AND l.status <> 'offline'
       AND l.agent_last_seen IS NOT NULL
       AND l.agent_last_seen < DATE_SUB(NOW(), INTERVAL ${offlineAfter} SECOND)`);
  for (const l of staleLocs) {
    await db.run(`UPDATE locations SET status='offline' WHERE id=:id`, { id: l.id });
    await openIncident(l.id, null, 'agent_offline', 'crit', 'Agent se ne javlja.');
  }

  // 2) Lokacije spet online -> zapri agent_offline incidente
  const backLocs = await db.q(
    `SELECT id FROM locations WHERE status='online' AND id IN
       (SELECT location_id FROM incidents WHERE kind='agent_offline' AND resolved_at IS NULL)`);
  for (const l of backLocs) await resolveIncidents(l.id, null, 'agent_offline');

  // 3) Naprave offline (lokacija online) -> incident; spet online -> zapri
  const offDevices = await db.q(
    `SELECT d.id, d.location_id FROM devices d JOIN locations l ON l.id=d.location_id
     WHERE d.status='offline' AND l.status='online'
       AND d.id NOT IN (SELECT device_id FROM incidents WHERE device_id IS NOT NULL AND resolved_at IS NULL)`);
  for (const d of offDevices) await openIncident(d.location_id, d.id, 'device_offline', 'warn', 'Naprava ne odgovarja.');

  const onDevices = await db.q(
    `SELECT i.id AS incident_id, i.device_id, i.location_id, i.started_at FROM incidents i
     JOIN devices d ON d.id=i.device_id
     WHERE i.resolved_at IS NULL AND i.kind='device_offline' AND d.status='online'`);
  for (const i of onDevices) await resolveOne(i);

  // 4) Pošlji obvestila za nove (še neobveščene) odprte incidente
  const toNotify = await db.q(
    `SELECT i.*, l.name AS location_name, l.customer_id, c.name AS customer_name, d.name AS device_name
     FROM incidents i JOIN locations l ON l.id=i.location_id JOIN customers c ON c.id=l.customer_id
     LEFT JOIN devices d ON d.id=i.device_id
     WHERE i.resolved_at IS NULL AND i.notified=0 LIMIT 50`);
  for (const i of toNotify) {
    const chats = await notify.recipients(i.customer_id);
    await notify.send(chats, notify.fmtOpen(i));
    await db.run(`UPDATE incidents SET notified=1 WHERE id=:id`, { id: i.id });
  }

  return ok(res, { staleLocations: staleLocs.length, backLocations: backLocs.length, newDeviceDown: offDevices.length, notified: toNotify.length });
}

async function openIncident(locationId, deviceId, kind, severity, message) {
  const existing = await db.one(
    `SELECT id FROM incidents WHERE location_id=:l AND kind=:k AND resolved_at IS NULL
       AND ((device_id IS NULL AND :d IS NULL) OR device_id=:d) LIMIT 1`,
    { l: locationId, k: kind, d: deviceId });
  if (existing) return;
  await db.run(`INSERT INTO incidents (location_id, device_id, kind, severity, message) VALUES (:l,:d,:k,:s,:m)`,
    { l: locationId, d: deviceId, k: kind, s: severity, m: message });
}

async function resolveIncidents(locationId, deviceId, kind) {
  const rows = await db.q(
    `SELECT i.*, l.name AS location_name, l.customer_id, c.name AS customer_name
     FROM incidents i JOIN locations l ON l.id=i.location_id JOIN customers c ON c.id=l.customer_id
     WHERE i.location_id=:l AND i.kind=:k AND i.resolved_at IS NULL
       AND ((device_id IS NULL AND :d IS NULL) OR device_id=:d)`,
    { l: locationId, k: kind, d: deviceId });
  for (const i of rows) {
    await db.run(`UPDATE incidents SET resolved_at=NOW() WHERE id=:id`, { id: i.id });
    if (i.notified) { const chats = await notify.recipients(i.customer_id); await notify.send(chats, notify.fmtResolved(i, minsSince(i.started_at))); }
  }
}

async function resolveOne(i) {
  await db.run(`UPDATE incidents SET resolved_at=NOW() WHERE id=:id`, { id: i.incident_id });
  const full = await db.one(
    `SELECT i.*, l.name AS location_name, l.customer_id, c.name AS customer_name, d.name AS device_name
     FROM incidents i JOIN locations l ON l.id=i.location_id JOIN customers c ON c.id=l.customer_id
     LEFT JOIN devices d ON d.id=i.device_id WHERE i.id=:id`, { id: i.incident_id });
  if (full && full.notified) { const chats = await notify.recipients(full.customer_id); await notify.send(chats, notify.fmtResolved(full, minsSince(full.started_at))); }
}

function minsSince(start) { try { return Math.max(1, Math.round((Date.now() - new Date(start).getTime()) / 60000)); } catch (e) { return null; } }

module.exports = methods({ GET: handle, POST: handle });
