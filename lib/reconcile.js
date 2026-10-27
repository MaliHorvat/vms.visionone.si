'use strict';
// Usklajevanje incidentov + obveščanje. Kliče se iz agentovega poročila (sprotno,
// brez odvisnosti od Vercel crona) in iz dnevnega crona kot varovalo.
const db = require('./db');
const notify = require('./notify');

// Odpri incident, če še ni odprtega za isto napravo/vrsto.
async function openIncident(locationId, deviceId, kind, severity, message) {
  const existing = await db.one(
    `SELECT id FROM incidents WHERE location_id=:l AND kind=:k AND resolved_at IS NULL
       AND ((device_id IS NULL AND :d IS NULL) OR device_id=:d) LIMIT 1`,
    { l: locationId, k: kind, d: deviceId });
  if (existing) return false;
  await db.run(`INSERT INTO incidents (location_id, device_id, kind, severity, message) VALUES (:l,:d,:k,:s,:m)`,
    { l: locationId, d: deviceId, k: kind, s: severity, m: message });
  return true;
}

async function resolveWithNotify(incidentId) {
  await db.run(`UPDATE incidents SET resolved_at=NOW() WHERE id=:id`, { id: incidentId });
  const full = await db.one(
    `SELECT i.*, l.name AS location_name, l.customer_id, c.name AS customer_name, d.name AS device_name
     FROM incidents i JOIN locations l ON l.id=i.location_id JOIN customers c ON c.id=l.customer_id
     LEFT JOIN devices d ON d.id=i.device_id WHERE i.id=:id`, { id: incidentId });
  if (full && full.notified) {
    const chats = await notify.recipients(full.customer_id);
    await notify.send(chats, notify.fmtResolved(full, minsSince(full.started_at)));
  }
}

// Za eno lokacijo: odpri/zapri incidente naprav glede na trenutno stanje.
async function reconcileLocation(locationId) {
  const offDevices = await db.q(
    `SELECT d.id FROM devices d JOIN locations l ON l.id=d.location_id
     WHERE d.location_id=:loc AND d.status='offline' AND l.status='online'
       AND d.id NOT IN (SELECT device_id FROM incidents WHERE device_id IS NOT NULL AND resolved_at IS NULL)`,
    { loc: locationId });
  for (const d of offDevices) await openIncident(locationId, d.id, 'device_offline', 'warn', 'Naprava ne odgovarja.');

  const onInc = await db.q(
    `SELECT i.id FROM incidents i JOIN devices d ON d.id=i.device_id
     WHERE i.location_id=:loc AND i.resolved_at IS NULL AND i.kind='device_offline' AND d.status='online'`,
    { loc: locationId });
  for (const i of onInc) await resolveWithNotify(i.id);
}

// Čez vse lokacije: zaznaj agente brez stika + njihovo vrnitev. Obvesti o novih.
async function sweepAgents() {
  const offlineAfter = +(process.env.OFFLINE_AFTER_SECONDS || 180);
  const stale = await db.q(
    `SELECT id FROM locations WHERE agent_token_hash IS NOT NULL AND status <> 'offline'
       AND agent_last_seen IS NOT NULL AND agent_last_seen < DATE_SUB(NOW(), INTERVAL ${offlineAfter} SECOND)`);
  for (const l of stale) {
    await db.run(`UPDATE locations SET status='offline' WHERE id=:id`, { id: l.id });
    await openIncident(l.id, null, 'agent_offline', 'crit', 'Agent se ne javlja.');
  }
  const back = await db.q(
    `SELECT i.id FROM incidents i JOIN locations l ON l.id=i.location_id
     WHERE i.kind='agent_offline' AND i.resolved_at IS NULL AND l.status='online'`);
  for (const i of back) await resolveWithNotify(i.id);

  await sendPending();
  return { stale: stale.length, back: back.length };
}

// Pošlji Telegram obvestila za nove (še neobveščene) odprte incidente.
async function sendPending() {
  const rows = await db.q(
    `SELECT i.*, l.name AS location_name, l.customer_id, c.name AS customer_name, d.name AS device_name
     FROM incidents i JOIN locations l ON l.id=i.location_id JOIN customers c ON c.id=l.customer_id
     LEFT JOIN devices d ON d.id=i.device_id
     WHERE i.resolved_at IS NULL AND i.notified=0 LIMIT 50`);
  for (const i of rows) {
    const chats = await notify.recipients(i.customer_id);
    await notify.send(chats, notify.fmtOpen(i));
    await db.run(`UPDATE incidents SET notified=1 WHERE id=:id`, { id: i.id });
  }
  return rows.length;
}

// Debounce prek settings: sweep največ enkrat na ~55 s (ob poročilih agentov).
async function sweepIfDue() {
  const row = await db.one(`SELECT v FROM settings WHERE k='last_sweep'`);
  const now = Date.now();
  if (row && now - (+row.v || 0) < 55000) return null;
  await db.run(`INSERT INTO settings (k, v) VALUES ('last_sweep', :v) ON DUPLICATE KEY UPDATE v=:v`, { v: String(now) });
  try { return await sweepAgents(); } catch (e) { console.error('[sweep]', e.message); return null; }
}

function minsSince(start) { try { return Math.max(1, Math.round((Date.now() - new Date(start).getTime()) / 60000)); } catch (e) { return null; } }

module.exports = { openIncident, reconcileLocation, sweepAgents, sweepIfDue, sendPending };
