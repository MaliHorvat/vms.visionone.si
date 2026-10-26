// Dogodki: shranjevanje, pravila (avtomatizacije), obveščanje v živo (SSE), MQTT/Home Assistant, webhook, ntfy push
import fs from 'node:fs';
import path from 'node:path';
import { q, insert, getSetting } from './db.js';
import { config } from './config.js';
import { MqttClient } from './mqtt.js';
import { httpRequest } from './http-util.js';

export const EVENT_TYPES = {
  motion: 'Gibanje', object: 'Zaznan objekt', zone: 'Vstop v območje', line: 'Prečkanje linije', loiter: 'Zadrževanje',
  tamper: 'Sabotaža kamere', camera_offline: 'Kamera brez povezave', camera_online: 'Kamera spet povezana',
  recorder_offline: 'Snemalnik brez povezave', disk: 'Opozorilo diska', system: 'Sistem', manual: 'Ročni alarm', input: 'Alarmni vhod',
};
export const LABELS = { person: 'Oseba', car: 'Avto', truck: 'Tovornjak', bus: 'Avtobus', motorcycle: 'Motor', bicycle: 'Kolo', dog: 'Pes', cat: 'Mačka', bird: 'Ptica' };

const snapshotsDir = path.join(config.dataDir, 'snapshots');
fs.mkdirSync(snapshotsDir, { recursive: true });
export const snapshotPath = name => path.join(snapshotsDir, path.basename(name));

// ---------- SSE (dogodki v živo za View/Admin) ----------
const clients = new Set();
export function sseHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const c = { res, user: req.user };
  clients.add(c);
  const ka = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ka); clients.delete(c); });
}
export function broadcast(type, data, filterCam = null) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (filterCam != null && c.user && c.user.role !== 'admin' && !c.user.all_cameras) {
      const ok = q.get('SELECT 1 FROM user_cameras WHERE user_id=? AND camera_id=?', c.user.id, filterCam);
      if (!ok) continue;
    }
    c.res.write(msg);
  }
}

// ---------- MQTT / Home Assistant ----------
let mqtt = null;
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export function mqttStatus() { return mqtt ? { connected: mqtt.connected, error: mqtt.lastError } : { connected: false, error: null }; }

export function setupMqtt() {
  if (mqtt) { mqtt.end(); mqtt = null; }
  const s = getSetting('mqtt', {});
  if (!s.enabled || !s.host) return;
  const base = s.topic || 'visionone';
  mqtt = new MqttClient({ host: s.host, port: s.port, username: s.username, password: s.password, tls: s.tls, will: { topic: `${base}/status`, payload: 'offline' } });
  mqtt.onConnect = () => {
    mqtt.publish(`${base}/status`, 'online', { retain: true });
    if (s.ha_discovery !== false) publishDiscovery(base);
  };
  mqtt.connect();
}

function publishDiscovery(base) {
  const device = { identifiers: ['visionone_vms'], name: 'VisionOne VMS', manufacturer: 'VisionOne', model: 'VMS' };
  for (const cam of q.all('SELECT id, name FROM cameras WHERE enabled=1')) {
    const id = `visionone_cam${cam.id}`;
    const sensors = [
      ['motion', 'Gibanje', 'motion'], ['person', 'Oseba', 'occupancy'], ['vehicle', 'Vozilo', 'occupancy'],
      ['online', 'Povezava', 'connectivity'], ['tamper', 'Sabotaža', 'tamper'],
    ];
    for (const [key, label, cls] of sensors) {
      mqtt.publish(`homeassistant/binary_sensor/${id}_${key}/config`, {
        name: `${cam.name} ${label}`, unique_id: `${id}_${key}`, device_class: cls,
        state_topic: `${base}/camera/${cam.id}/${key}`, payload_on: 'ON', payload_off: 'OFF',
        availability_topic: `${base}/status`, device,
      }, { retain: true });
    }
    mqtt.publish(`homeassistant/sensor/${id}_last_event/config`, {
      name: `${cam.name} zadnji dogodek`, unique_id: `${id}_last_event`, state_topic: `${base}/camera/${cam.id}/event`,
      value_template: '{{ value_json.type_label }}', json_attributes_topic: `${base}/camera/${cam.id}/event`, availability_topic: `${base}/status`, device,
    }, { retain: true });
  }
}

const offTimers = new Map();
function mqttState(camId, key, ttl = 30) {
  if (!mqtt) return;
  const base = getSetting('mqtt', {}).topic || 'visionone';
  mqtt.publish(`${base}/camera/${camId}/${key}`, 'ON', { retain: true });
  const k = `${camId}:${key}`;
  clearTimeout(offTimers.get(k));
  offTimers.set(k, setTimeout(() => mqtt?.publish(`${base}/camera/${camId}/${key}`, 'OFF', { retain: true }), ttl * 1000));
}
export function mqttCameraOnline(camId, online) {
  if (!mqtt) return;
  const base = getSetting('mqtt', {}).topic || 'visionone';
  mqtt.publish(`${base}/camera/${camId}/online`, online ? 'ON' : 'OFF', { retain: true });
}
export function mqttPublishEvent(ev) {
  if (!mqtt) return;
  const base = getSetting('mqtt', {}).topic || 'visionone';
  const payload = { ...ev, type_label: EVENT_TYPES[ev.type] || ev.type, label_sl: LABELS[ev.label] || ev.label };
  delete payload.data_json;
  mqtt.publish(`${base}/events`, payload);
  if (ev.camera_id) {
    mqtt.publish(`${base}/camera/${ev.camera_id}/event`, payload, { retain: true });
    if (ev.type === 'motion') mqttState(ev.camera_id, 'motion');
    if (ev.type === 'tamper') mqttState(ev.camera_id, 'tamper', 60);
    if (ev.label === 'person') mqttState(ev.camera_id, 'person');
    if (['car', 'truck', 'bus', 'motorcycle'].includes(ev.label)) mqttState(ev.camera_id, 'vehicle');
  }
}

// ---------- Pravila ----------
function scheduleActive(sched, ts = Date.now()) {
  if (!sched || sched.length !== 168) return true;
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7; // pon = 0
  return sched[day * 24 + d.getHours()] === '1';
}
export { scheduleActive };

function ruleMatches(rule, ev) {
  let t;
  try { t = JSON.parse(rule.trigger_json); } catch { return false; }
  if (t.types?.length && !t.types.includes(ev.type)) return false;
  if (t.cameras?.length && !t.cameras.map(Number).includes(Number(ev.camera_id))) return false;
  if (t.labels?.length && !t.labels.includes(ev.label)) return false;
  if (t.zones?.length && !t.zones.includes(ev.zone)) return false;
  if (t.min_score && (ev.score ?? 1) < t.min_score) return false;
  if (!scheduleActive(t.schedule, ev.ts * 1000)) return false;
  return true;
}

const cooldowns = new Map();
let hooks = { lockRange: null, ptzPreset: null };
export function setEventHooks(h) { hooks = { ...hooks, ...h }; }

async function runActions(rule, ev, actions) {
  for (const a of actions) {
    try {
      if (a.type === 'webhook' && a.url) {
        const body = JSON.stringify({ rule: rule.name, event: ev });
        await httpRequest(a.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 5000 });
      } else if (a.type === 'ntfy' && a.topic) {
        const server = (a.server || 'https://ntfy.sh').replace(/\/$/, '');
        const cam = ev.camera_id ? q.get('SELECT name FROM cameras WHERE id=?', ev.camera_id) : null;
        const title = `${EVENT_TYPES[ev.type] || ev.type}${ev.label ? ': ' + (LABELS[ev.label] || ev.label) : ''}`;
        const msg = `${cam?.name || 'Sistem'} – ${new Date(ev.ts * 1000).toLocaleString('sl-SI', { timeZone: config.tz })}`;
        // ntfy sprejme parametre v URL (podpira šumnike), priponka je telo zahteve
        const params = new URLSearchParams({ title, message: msg, priority: ev.severity === 'alarm' ? 'high' : 'default', tags: 'rotating_light' });
        let body = Buffer.from(msg);
        if (ev.snapshot && a.attach !== false) {
          try { body = fs.readFileSync(snapshotPath(ev.snapshot)); params.set('filename', 'dogodek.jpg'); } catch {}
        }
        const headers = { 'Content-Length': body.length };
        if (a.token) headers.Authorization = `Bearer ${a.token}`;
        await httpRequest(`${server}/${encodeURIComponent(a.topic)}?${params}`, { method: 'PUT', body, headers, timeout: 8000 });
      } else if (a.type === 'mqtt' && mqtt) {
        mqtt.publish(a.topic || `${getSetting('mqtt', {}).topic || 'visionone'}/rules/${slug(rule.name)}`, { rule: rule.name, event: ev });
      } else if (a.type === 'lock' && hooks.lockRange && ev.camera_id) {
        hooks.lockRange(ev.camera_id, ev.ts - (a.before || 30), ev.ts + (a.after || 60));
      } else if (a.type === 'ptz_preset' && hooks.ptzPreset) {
        await hooks.ptzPreset(a.camera_id || ev.camera_id, a.preset);
      }
    } catch (e) { console.error(`[pravilo ${rule.name}] dejanje ${a.type} ni uspelo:`, e.message); }
  }
}

// ---------- Ustvarjanje dogodka ----------
let onNewEvent = [];
export function onEvent(fn) { onNewEvent.push(fn); }

export function createEvent(ev, snapshotJpeg = null) {
  ev.ts = ev.ts || Date.now() / 1000;
  ev.severity = ev.severity || (['tamper', 'camera_offline', 'recorder_offline', 'disk', 'manual', 'input'].includes(ev.type) ? 'warning' : 'info');
  const data = ev.data || {};
  // pravila lahko spremenijo resnost in prikažejo pojavno okno
  const matched = [];
  for (const rule of q.all('SELECT * FROM rules WHERE enabled=1')) {
    if (!ruleMatches(rule, ev)) continue;
    const key = `${rule.id}:${ev.camera_id}`;
    if (Date.now() - (cooldowns.get(key) || 0) < (rule.cooldown_seconds || 0) * 1000) continue;
    cooldowns.set(key, Date.now());
    let actions = [];
    try { actions = JSON.parse(rule.actions_json); } catch {}
    for (const a of actions) {
      if (a.type === 'severity') ev.severity = a.value;
      if (a.type === 'popup') data.popup = true;
      if (a.type === 'sound') data.sound = true;
    }
    data.rules = [...(data.rules || []), rule.name];
    matched.push({ rule, actions });
    q.run('UPDATE rules SET last_fired=unixepoch() WHERE id=?', rule.id);
  }
  if (snapshotJpeg) {
    const name = `ev_${Math.floor(ev.ts * 1000)}_${ev.camera_id || 0}.jpg`;
    fs.writeFileSync(snapshotPath(name), snapshotJpeg);
    ev.snapshot = name;
  }
  const row = {
    ts: ev.ts, end_ts: ev.end_ts ?? null, camera_id: ev.camera_id ?? null, recorder_id: ev.recorder_id ?? null,
    type: ev.type, label: ev.label ?? null, score: ev.score ?? null, zone: ev.zone ?? null,
    severity: ev.severity, data_json: JSON.stringify(data), snapshot: ev.snapshot ?? null,
  };
  const id = insert('events', row);
  const full = { id, ...row, data };
  for (const fn of onNewEvent) { try { fn(full); } catch (e) { console.error(e); } }
  broadcast('event', full, full.camera_id);
  mqttPublishEvent(full);
  for (const m of matched) runActions(m.rule, full, m.actions);
  return full;
}

// Čiščenje starih dogodkov in sličic
export function cleanupEvents() {
  const days = getSetting('event_retention_days', 90);
  const cutoff = Date.now() / 1000 - days * 86400;
  for (const r of q.all('SELECT snapshot FROM events WHERE ts<? AND snapshot IS NOT NULL', cutoff)) {
    try { fs.unlinkSync(snapshotPath(r.snapshot)); } catch {}
  }
  q.run('DELETE FROM events WHERE ts<?', cutoff);
  q.run('DELETE FROM audit WHERE ts<?', Math.floor(Date.now() / 1000) - Math.max(days, 365) * 86400);
}
