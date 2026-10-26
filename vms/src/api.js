// REST API za VisionOne Admin, VisionOne View, AI modul in VisionOne Field
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { Router, HttpError, readJson, sendJson, sendFile, httpRequest } from './http-util.js';
import { db, q, insert, update, pick, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import {
  ROLES, hashPassword, verifyPassword, sessionCookie, COOKIE, requireRole, allowedCameraIds, assertCamera, canSeeCamera,
  audit, base32Encode, verifyTotp, hashApiToken, checkBruteForce, failedLogin, clearAttempts,
  clientIp,
} from './auth.js';
import { OnvifDevice } from './onvif.js';
import { scanNetwork, localSubnets } from './discovery.js';
import { probeRecorder, adapterFor, playbackUrl, adapters } from './nvr.js';
import { syncAll, snapshot, tempStream, listStreams, streamName } from './go2rtc.js';
import { reconcile, recorderStatus, cleanup, reindex, lockRange } from './recorder.js';
import { poolStats, availableMounts, diskStats } from './storage.js';
import { createEvent, sseHandler, snapshotPath, setupMqtt, mqttStatus, EVENT_TYPES, LABELS } from './events.js';
import { processQueue, exportsDir } from './exporter.js';
import { ptzCommand } from './ptz.js';
import { onvifEventStatus } from './health.js';

export const api = new Router();
const admin = requireRole('admin');
const operator = requireRole('operator');
const viewer = requireRole('viewer');
const START = Date.now();
export const VERSION = '1.1.0';

const CAM_FIELDS = ['name', 'enabled', 'source', 'vendor', 'host', 'http_port', 'rtsp_port', 'username', 'password', 'onvif_port', 'main_url', 'sub_url', 'snapshot_url',
  'recorder_id', 'channel', 'group_id', 'model', 'serial', 'firmware', 'mac', 'resolution', 'codec', 'ptz', 'audio', 'two_way_audio', 'fisheye',
  'rec_location', 'rec_mode', 'rec_schedule', 'rec_stream', 'pre_seconds', 'post_seconds', 'retention_days', 'pool_id',
  'ai_enabled', 'ai_classes', 'ai_min_score', 'ai_fps', 'tamper_detect', 'zones_json', 'masks_json', 'onvif_events', 'plan_x', 'plan_y', 'plan_id', 'sort'];

function publicCamera(c, user) {
  const out = { ...c, has_password: !!c.password };
  delete out.password;
  if (user?.role !== 'admin') {
    for (const k of ['username', 'main_url', 'sub_url', 'snapshot_url', 'host', 'http_port', 'rtsp_port', 'onvif_port']) delete out[k];
  } else {
    out.main_url = maskUrl(c.main_url); out.sub_url = maskUrl(c.sub_url);
  }
  try { out.zones = JSON.parse(c.zones_json || '[]'); } catch { out.zones = []; }
  try { out.masks = JSON.parse(c.masks_json || '[]'); } catch { out.masks = []; }
  return out;
}
function maskUrl(u) {
  if (!u) return u;
  try { const x = new URL(u); if (x.password) x.password = '***'; return decodeURIComponent(x.toString()); } catch { return u; }
}
// Če uporabnik pošlje URL z "***", ohranimo staro geslo
function unmaskUrl(newUrl, oldUrl) {
  if (!newUrl || !newUrl.includes('***') || !oldUrl) return newUrl;
  try { const o = new URL(oldUrl); return newUrl.replace('***', encodeURIComponent(decodeURIComponent(o.password))); } catch { return newUrl; }
}
function withCreds(url, user, pass) {
  if (!url || !user) return url;
  try { const u = new URL(url); if (!u.username) { u.username = encodeURIComponent(user); u.password = encodeURIComponent(pass || ''); } return u.toString(); } catch { return url; }
}
const num = (v, d = null) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
const camOr404 = id => { const c = q.get('SELECT * FROM cameras WHERE id=?', id); if (!c) throw new HttpError(404, 'Kamera ne obstaja'); return c; };
const afterCameraChange = () => { syncAll().then(() => setTimeout(reconcile, 1500)); };

// ======================= AVTENTIKACIJA =======================
api.post('/api/auth/login', async (req, res) => {
  const b = await readJson(req);
  const key = `${clientIp(req)}|${b.username}`;
  checkBruteForce(key);
  const u = q.get('SELECT * FROM users WHERE username=? AND enabled=1', String(b.username || ''));
  if (!u || !verifyPassword(b.password, u.password_hash)) {
    failedLogin(key);
    audit({ user: { username: b.username }, headers: req.headers, socket: req.socket }, 'prijava_neuspesna');
    throw new HttpError(401, 'Napačno uporabniško ime ali geslo');
  }
  if (u.totp_enabled) {
    if (!b.totp) return sendJson(res, 200, { need_totp: true });
    if (!verifyTotp(u.totp_secret, b.totp)) { failedLogin(key); throw new HttpError(401, 'Napačna koda za dvofaktorsko prijavo'); }
  }
  clearAttempts(key);
  q.run('UPDATE users SET last_login=unixepoch() WHERE id=?', u.id);
  req.user = u;
  audit(req, 'prijava');
  res.setHeader('Set-Cookie', sessionCookie(u, req));
  sendJson(res, 200, { ok: true, user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role } });
});

api.post('/api/auth/logout', async (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  sendJson(res, 200, { ok: true });
});

api.get('/api/auth/me', viewer, async (req, res) => {
  const u = req.user.service ? req.user : q.get('SELECT id, username, full_name, email, role, totp_enabled, all_cameras FROM users WHERE id=?', req.user.id);
  sendJson(res, 200, { ...u, system_name: getSetting('system_name', 'VisionOne'), version: VERSION });
});

api.post('/api/auth/password', viewer, async (req, res) => {
  const b = await readJson(req);
  const u = q.get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!u || !verifyPassword(b.old_password, u.password_hash)) throw new HttpError(400, 'Trenutno geslo ni pravilno');
  if (String(b.new_password || '').length < 8) throw new HttpError(400, 'Novo geslo mora imeti vsaj 8 znakov');
  update('users', u.id, { password_hash: hashPassword(b.new_password) });
  audit(req, 'sprememba_gesla');
  sendJson(res, 200, { ok: true });
});

api.post('/api/auth/totp/setup', viewer, async (req, res) => {
  const secret = base32Encode(crypto.randomBytes(20));
  update('users', req.user.id, { totp_secret: secret, totp_enabled: 0 });
  const label = encodeURIComponent(`VisionOne:${req.user.username}`);
  sendJson(res, 200, { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=VisionOne` });
});
api.post('/api/auth/totp/enable', viewer, async (req, res) => {
  const b = await readJson(req);
  const u = q.get('SELECT totp_secret FROM users WHERE id=?', req.user.id);
  if (!u?.totp_secret || !verifyTotp(u.totp_secret, b.code)) throw new HttpError(400, 'Koda ni pravilna');
  update('users', req.user.id, { totp_enabled: 1 });
  audit(req, '2fa_vklop');
  sendJson(res, 200, { ok: true });
});
api.post('/api/auth/totp/disable', viewer, async (req, res) => {
  update('users', req.user.id, { totp_enabled: 0, totp_secret: null });
  audit(req, '2fa_izklop');
  sendJson(res, 200, { ok: true });
});

// ======================= SISTEM =======================
api.get('/api/system/overview', operator, async (req, res) => {
  const cams = q.all('SELECT id, name, status, enabled, rec_location, rec_mode, ai_enabled, recorder_id FROM cameras');
  const recs = q.all('SELECT id, name, status, vendor, disks_json FROM recorders');
  let go2rtc = false;
  try { await listStreams(); go2rtc = true; } catch {}
  const since = Date.now() / 1000 - 86400;
  sendJson(res, 200, {
    version: VERSION, uptime: Math.floor((Date.now() - START) / 1000), system_name: getSetting('system_name', 'VisionOne'),
    host: { cpus: os.cpus().length, load: os.loadavg(), mem_total: os.totalmem(), mem_free: os.freemem(), platform: `${os.type()} ${os.release()}` },
    cameras: { total: cams.length, enabled: cams.filter(c => c.enabled).length, online: cams.filter(c => c.enabled && c.status === 'online').length, offline: cams.filter(c => c.enabled && c.status === 'offline').length, ai: cams.filter(c => c.ai_enabled).length },
    recorders: recs.map(r => ({ ...r, disks: JSON.parse(r.disks_json || '[]'), disks_json: undefined })),
    recording: recorderStatus(),
    pools: poolStats(),
    events_24h: q.all('SELECT type, COUNT(*) n FROM events WHERE ts>? GROUP BY type', since),
    unacked_alarms: q.get("SELECT COUNT(*) n FROM events WHERE acknowledged=0 AND severity IN ('alarm','warning')").n,
    services: { go2rtc, mqtt: mqttStatus(), ai: aiStatus() },
    offline_cameras: cams.filter(c => c.enabled && c.status === 'offline').map(c => ({ id: c.id, name: c.name })),
  });
});

// ======================= SKUPINE =======================
api.get('/api/groups', viewer, async (req, res) => sendJson(res, 200, q.all('SELECT * FROM camera_groups ORDER BY sort, name')));
api.post('/api/groups', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.name) throw new HttpError(400, 'Ime je obvezno');
  const id = insert('camera_groups', pick(b, ['name', 'sort']));
  audit(req, 'skupina_dodana', b.name);
  sendJson(res, 200, { id });
});
api.put('/api/groups/:id', admin, async (req, res) => { update('camera_groups', req.params.id, pick(await readJson(req), ['name', 'sort'])); sendJson(res, 200, { ok: true }); });
api.delete('/api/groups/:id', admin, async (req, res) => { q.run('DELETE FROM camera_groups WHERE id=?', req.params.id); sendJson(res, 200, { ok: true }); });

// ======================= KAMERE =======================
api.get('/api/cameras', viewer, async (req, res) => {
  const ids = allowedCameraIds(req.user);
  let rows = q.all('SELECT * FROM cameras ORDER BY sort, name');
  if (ids) rows = rows.filter(c => ids.includes(c.id));
  if (req.user.role !== 'admin') rows = rows.filter(c => c.enabled);
  const rec = recorderStatus();
  const ev = onvifEventStatus();
  sendJson(res, 200, rows.map(c => ({ ...publicCamera(c, req.user), recording: !!rec[c.id], recording_error: rec[c.id]?.error || null, onvif_events_error: ev[c.id]?.error || null })));
});

api.get('/api/cameras/:id', viewer, async (req, res) => {
  assertCamera(req.user, req.params.id);
  sendJson(res, 200, publicCamera(camOr404(req.params.id), req.user));
});

// Preizkus ONVIF naprave pred dodajanjem
api.post('/api/onvif/probe', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.host) throw new HttpError(400, 'Vnesite IP naslov');
  const dev = new OnvifDevice({ host: b.host, port: num(b.port, 80), username: b.username, password: b.password });
  try {
    await dev.connect();
    const info = await dev.deviceInfo();
    const mac = await dev.networkMac();
    const channels = await dev.channels();
    sendJson(res, 200, { info: { ...info, mac }, channels: channels.map(c => ({ ...c, main_url: dev.withCreds(c.main_url), sub_url: dev.withCreds(c.sub_url), main_url_display: c.main_url, sub_url_display: c.sub_url })), ptz: !!dev.xaddr.ptz, events: !!dev.xaddr.events });
  } catch (e) {
    throw new HttpError(400, e.auth ? 'ONVIF: napačno uporabniško ime ali geslo (preverite tudi, ali je ONVIF uporabnik ustvarjen na kameri)' : `ONVIF povezava ni uspela: ${e.message}`);
  }
});

// Preizkus RTSP povezave
api.post('/api/cameras/test-stream', admin, async (req, res) => {
  const b = await readJson(req);
  const url = withCreds(b.url, b.username, b.password);
  if (!url) throw new HttpError(400, 'Vnesite URL');
  const { spawn } = await import('node:child_process');
  const result = await new Promise(resolve => {
    const p = spawn('ffprobe', ['-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '6000000', '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', url]);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    const t = setTimeout(() => p.kill('SIGKILL'), 12000);
    p.on('exit', code => { clearTimeout(t); resolve({ code, out, err }); });
    p.on('error', e => resolve({ code: 1, err: e.message }));
  });
  if (result.code !== 0) throw new HttpError(400, `Tok ni dosegljiv: ${(result.err || 'časovna omejitev').trim().split('\n').pop()}`);
  const streams = JSON.parse(result.out || '{}').streams || [];
  sendJson(res, 200, { ok: true, streams });
});

api.post('/api/cameras', admin, async (req, res) => {
  const b = await readJson(req);
  const list = Array.isArray(b.cameras) ? b.cameras : [b];
  const ids = [];
  for (const c of list) {
    const data = pick(c, CAM_FIELDS);
    if (!data.name) data.name = c.source === 'demo' ? `Demo kamera ${q.get('SELECT COUNT(*)+1 n FROM cameras').n}` : 'Nova kamera';
    if (data.source !== 'demo') {
      data.main_url = withCreds(data.main_url, data.username, data.password);
      data.sub_url = withCreds(data.sub_url, data.username, data.password);
      if (!data.main_url) throw new HttpError(400, `Kamera "${data.name}": manjka RTSP naslov glavnega toka`);
    }
    if (data.zones_json && typeof data.zones_json !== 'string') data.zones_json = JSON.stringify(data.zones_json);
    ids.push(insert('cameras', data));
    audit(req, 'kamera_dodana', data.name);
  }
  afterCameraChange();
  sendJson(res, 200, { ids, id: ids[0] });
});

api.put('/api/cameras/:id', admin, async (req, res) => {
  const old = camOr404(req.params.id);
  const b = await readJson(req);
  const data = pick(b, CAM_FIELDS);
  if (b.zones) data.zones_json = JSON.stringify(b.zones);
  if (b.masks) data.masks_json = JSON.stringify(b.masks);
  if (data.password === '' || data.password === '***') delete data.password;
  if (data.main_url !== undefined) data.main_url = unmaskUrl(data.main_url, old.main_url);
  if (data.sub_url !== undefined) data.sub_url = unmaskUrl(data.sub_url, old.sub_url);
  if (data.rec_schedule && !/^[01]{168}$/.test(data.rec_schedule)) throw new HttpError(400, 'Neveljaven urnik');
  update('cameras', old.id, data);
  audit(req, 'kamera_spremenjena', old.name, Object.keys(data).filter(k => k !== 'password').join(','));
  afterCameraChange();
  sendJson(res, 200, { ok: true });
});

api.post('/api/cameras/bulk', admin, async (req, res) => {
  const b = await readJson(req);
  const data = pick(b.changes || {}, ['enabled', 'group_id', 'rec_location', 'rec_mode', 'rec_schedule', 'retention_days', 'pool_id', 'ai_enabled', 'ai_classes', 'tamper_detect', 'pre_seconds', 'post_seconds', 'rec_stream', 'onvif_events']);
  for (const id of b.ids || []) update('cameras', id, data);
  audit(req, 'kamere_mnozicno', (b.ids || []).join(','), Object.keys(data).join(','));
  afterCameraChange();
  sendJson(res, 200, { ok: true, count: (b.ids || []).length });
});

api.delete('/api/cameras/:id', admin, async (req, res) => {
  const cam = camOr404(req.params.id);
  const url = new URL(req.url, 'http://x');
  q.run('DELETE FROM cameras WHERE id=?', cam.id);
  q.run('DELETE FROM user_cameras WHERE camera_id=?', cam.id);
  if (url.searchParams.get('recordings') === '1') {
    for (const s of q.all('SELECT path FROM segments WHERE camera_id=?', cam.id)) try { fs.unlinkSync(s.path); } catch {}
    q.run('DELETE FROM segments WHERE camera_id=?', cam.id);
  }
  audit(req, 'kamera_izbrisana', cam.name);
  afterCameraChange();
  sendJson(res, 200, { ok: true });
});

api.get('/api/cameras/:id/snapshot', viewer, async (req, res) => {
  assertCamera(req.user, req.params.id);
  const url = new URL(req.url, 'http://x');
  try {
    const jpg = await snapshot(req.params.id, url.searchParams.get('hq') !== '1');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': jpg.length });
    res.end(jpg);
  } catch (e) { throw new HttpError(502, e.message); }
});

// Ponovno branje podatkov iz kamere (ONVIF)
api.post('/api/cameras/:id/refresh', admin, async (req, res) => {
  const cam = camOr404(req.params.id);
  if (!cam.host) throw new HttpError(400, 'Kamera nima IP naslova');
  const dev = new OnvifDevice({ host: cam.host, port: cam.onvif_port || cam.http_port || 80, username: cam.username, password: cam.password });
  await dev.connect();
  const info = await dev.deviceInfo();
  const ch = (await dev.channels())[Math.max(0, (cam.channel || 1) - 1)];
  update('cameras', cam.id, { model: info.model, firmware: info.firmware, serial: info.serial, resolution: ch?.resolution, codec: ch?.codec, ptz: ch?.ptz ? 1 : cam.ptz });
  sendJson(res, 200, { ok: true, info });
});

// PTZ
api.post('/api/cameras/:id/ptz', operator, async (req, res) => {
  assertCamera(req.user, req.params.id);
  const b = await readJson(req);
  try {
    const r = await ptzCommand(req.params.id, b);
    if (['goto', 'set_preset'].includes(b.action)) audit(req, `ptz_${b.action}`, req.params.id, String(b.preset || b.name || ''));
    sendJson(res, 200, r);
  } catch (e) { throw new HttpError(400, e.message); }
});

// ======================= SNEMALNIKI =======================
const REC_FIELDS = ['name', 'vendor', 'host', 'http_port', 'rtsp_port', 'username', 'password', 'https', 'model', 'serial', 'firmware', 'mac', 'channels', 'site_id', 'main_template', 'sub_template'];
function publicRecorder(r) {
  const out = { ...r, has_password: !!r.password, disks: JSON.parse(r.disks_json || '[]') };
  delete out.password; delete out.disks_json;
  out.camera_count = q.get('SELECT COUNT(*) n FROM cameras WHERE recorder_id=?', r.id).n;
  return out;
}
api.get('/api/recorders', admin, async (req, res) => sendJson(res, 200, q.all('SELECT * FROM recorders ORDER BY name').map(publicRecorder)));

api.post('/api/recorders/probe', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.host) throw new HttpError(400, 'Vnesite IP naslov snemalnika');
  const rec = { vendor: b.vendor || 'auto', host: b.host, http_port: num(b.http_port, 80), rtsp_port: num(b.rtsp_port, 554), username: b.username, password: b.password, https: b.https ? 1 : 0, channels: num(b.channels, 4), main_template: b.main_template, sub_template: b.sub_template };
  try {
    const r = await probeRecorder(rec);
    sendJson(res, 200, { ...r, channels: r.channels.map(c => ({ ...c, main_url_display: maskUrl(c.main_url) })) });
  } catch (e) { throw new HttpError(400, e.message); }
});

// Dodaj snemalnik in uvozi izbrane kanale kot kamere
api.post('/api/recorders', admin, async (req, res) => {
  const b = await readJson(req);
  const data = pick(b, REC_FIELDS);
  if (!data.host || !data.name) throw new HttpError(400, 'Ime in IP naslov sta obvezna');
  if (data.vendor === 'auto' || !data.vendor) {
    const p = await probeRecorder({ ...data, vendor: 'auto' }).catch(e => { throw new HttpError(400, e.message); });
    data.vendor = p.vendor;
  }
  data.status = 'online';
  const recId = insert('recorders', data);
  const rec = q.get('SELECT * FROM recorders WHERE id=?', recId);
  const imported = importChannels(rec, b.channels_selected || [], b);
  const ad = adapterFor(rec);
  if (ad.disks) ad.disks(rec).then(d => update('recorders', recId, { disks_json: JSON.stringify(d) })).catch(() => {});
  audit(req, 'snemalnik_dodan', data.name, `${imported} kamer`);
  afterCameraChange();
  sendJson(res, 200, { id: recId, imported });
});

function importChannels(rec, channels, opts = {}) {
  let n = 0;
  for (const ch of channels) {
    const exists = q.get('SELECT id FROM cameras WHERE recorder_id=? AND channel=?', rec.id, ch.channel);
    const data = {
      name: ch.name || `${rec.name} – K${ch.channel}`, source: 'recorder', vendor: rec.vendor, recorder_id: rec.id, channel: ch.channel,
      main_url: ch.main_url, sub_url: ch.sub_url || null, snapshot_url: ch.snapshot_url || null,
      resolution: ch.resolution || null, codec: ch.codec || null, ptz: ch.ptz ? 1 : 0, audio: ch.audio ? 1 : 0,
      host: ch.ip || null,
    };
    if (exists) { update('cameras', exists.id, { main_url: data.main_url, sub_url: data.sub_url, snapshot_url: data.snapshot_url }); continue; }
    insert('cameras', {
      ...data,
      rec_location: opts.rec_location || 'recorder', rec_mode: opts.rec_mode || 'continuous',
      retention_days: num(opts.retention_days, 30), group_id: opts.group_id || null, onvif_events: 0,
    });
    n++;
  }
  update('recorders', rec.id, { channels: Math.max(rec.channels || 0, ...channels.map(c => c.channel || 0)) });
  return n;
}

api.put('/api/recorders/:id', admin, async (req, res) => {
  const old = q.get('SELECT * FROM recorders WHERE id=?', req.params.id);
  if (!old) throw new HttpError(404, 'Snemalnik ne obstaja');
  const b = await readJson(req);
  const data = pick(b, REC_FIELDS);
  if (!data.password) delete data.password;
  update('recorders', old.id, data);
  // posodobi RTSP naslove kamer, če so se spremenili prijavni podatki ali naslov
  if (['host', 'rtsp_port', 'username', 'password', 'vendor'].some(k => data[k] !== undefined && data[k] !== old[k])) {
    const rec = q.get('SELECT * FROM recorders WHERE id=?', old.id);
    const a = adapterFor(rec);
    if (a.live) for (const c of q.all('SELECT id, channel FROM cameras WHERE recorder_id=?', rec.id)) {
      const main = a.live(rec, c.channel, 'main');
      if (main) update('cameras', c.id, { main_url: main, sub_url: a.live(rec, c.channel, 'sub') });
    }
  }
  audit(req, 'snemalnik_spremenjen', old.name);
  afterCameraChange();
  sendJson(res, 200, { ok: true });
});

// Ponovno branje kanalov – doda nove kamere, posodobi naslove
api.post('/api/recorders/:id/sync', admin, async (req, res) => {
  const rec = q.get('SELECT * FROM recorders WHERE id=?', req.params.id);
  if (!rec) throw new HttpError(404, 'Snemalnik ne obstaja');
  try {
    const p = await probeRecorder(rec);
    update('recorders', rec.id, { model: p.info.model, serial: p.info.serial, firmware: p.info.firmware, disks_json: JSON.stringify(p.disks), status: 'online' });
    const b = await readJson(req);
    const n = importChannels(rec, b.add_new === false ? p.channels.filter(c => q.get('SELECT 1 FROM cameras WHERE recorder_id=? AND channel=?', rec.id, c.channel)) : p.channels, b);
    afterCameraChange();
    sendJson(res, 200, { ok: true, added: n, channels: p.channels.length });
  } catch (e) { throw new HttpError(400, e.message); }
});

api.delete('/api/recorders/:id', admin, async (req, res) => {
  const rec = q.get('SELECT * FROM recorders WHERE id=?', req.params.id);
  if (!rec) throw new HttpError(404, 'Snemalnik ne obstaja');
  q.run('DELETE FROM cameras WHERE recorder_id=?', rec.id);
  q.run('DELETE FROM recorders WHERE id=?', rec.id);
  audit(req, 'snemalnik_izbrisan', rec.name);
  afterCameraChange();
  sendJson(res, 200, { ok: true });
});

// ======================= ODKRIVANJE =======================
api.get('/api/discovery/subnets', admin, async (req, res) => sendJson(res, 200, { local: localSubnets(), saved: getSetting('scan_ranges', []) }));
api.post('/api/discovery/scan', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.range) throw new HttpError(400, 'Vnesite IP območje, npr. 192.168.1.0/24');
  try {
    const results = await scanNetwork(b.range);
    const known = new Set([...q.all('SELECT host FROM cameras WHERE host IS NOT NULL').map(r => r.host), ...q.all('SELECT host FROM recorders').map(r => r.host)]);
    const saved = new Set(getSetting('scan_ranges', [])); saved.add(b.range); setSetting('scan_ranges', [...saved].slice(-5));
    audit(req, 'pregled_omrezja', b.range, `${results.length} naprav`);
    sendJson(res, 200, results.map(r => ({ ...r, added: known.has(r.ip) })));
  } catch (e) { throw new HttpError(400, e.message); }
});

// ======================= SHRAMBA =======================
api.get('/api/storage', admin, async (req, res) => {
  const perCam = q.all('SELECT camera_id, pool_id, COUNT(*) n, SUM(size) size, MIN(start_ts) oldest, MAX(end_ts) newest FROM segments GROUP BY camera_id, pool_id');
  sendJson(res, 200, { pools: poolStats(), mounts: availableMounts(), root: config.recordingsRoot, per_camera: perCam, recording: recorderStatus() });
});
api.post('/api/storage/pools', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.name || !b.path) throw new HttpError(400, 'Ime in pot sta obvezna');
  const p = path.resolve(b.path);
  if (!p.startsWith(path.resolve(config.recordingsRoot))) throw new HttpError(400, `Pot mora biti znotraj ${config.recordingsRoot} (diske priklopite v docker-compose.yml)`);
  fs.mkdirSync(p, { recursive: true });
  if (diskStats(p).error) throw new HttpError(400, 'Pot ni dosegljiva');
  const id = insert('storage_pools', { name: b.name, path: p, quota_gb: num(b.quota_gb, 0), min_free_percent: num(b.min_free_percent, 5) });
  audit(req, 'disk_dodan', b.name, p);
  sendJson(res, 200, { id });
});
api.put('/api/storage/pools/:id', admin, async (req, res) => {
  update('storage_pools', req.params.id, pick(await readJson(req), ['name', 'quota_gb', 'min_free_percent', 'enabled']));
  setTimeout(reconcile, 500);
  sendJson(res, 200, { ok: true });
});
api.delete('/api/storage/pools/:id', admin, async (req, res) => {
  if (q.get('SELECT COUNT(*) n FROM storage_pools').n <= 1) throw new HttpError(400, 'Vsaj en disk mora ostati');
  q.run('UPDATE cameras SET pool_id=NULL WHERE pool_id=?', req.params.id);
  q.run('DELETE FROM segments WHERE pool_id=?', req.params.id);
  q.run('DELETE FROM storage_pools WHERE id=?', req.params.id);
  setTimeout(reconcile, 500);
  sendJson(res, 200, { ok: true });
});
api.post('/api/storage/cleanup', admin, async (req, res) => sendJson(res, 200, { removed: cleanup() }));
api.post('/api/storage/reindex', admin, async (req, res) => sendJson(res, 200, { added: reindex() }));

// ======================= POSNETKI / PREDVAJANJE =======================
api.get('/api/recordings/timeline', viewer, async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const camId = Number(u.searchParams.get('camera'));
  assertCamera(req.user, camId);
  const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
  const cam = camOr404(camId);
  const server = q.all('SELECT id, start_ts, end_ts, keep, locked FROM segments WHERE camera_id=? AND end_ts>? AND start_ts<? ORDER BY start_ts', camId, from, to);
  const events = q.all('SELECT id, ts, end_ts, type, label, severity, zone FROM events WHERE camera_id=? AND ts>=? AND ts<=? ORDER BY ts', camId, from, to);
  let recorder = [];
  let recorder_error = null;
  if (cam.recorder_id && ['recorder', 'both'].includes(cam.rec_location)) {
    const rec = q.get('SELECT * FROM recorders WHERE id=?', cam.recorder_id);
    const a = rec && adapterFor(rec);
    if (a?.search) { try { recorder = await a.search(rec, cam.channel, from, to); } catch (e) { recorder_error = e.message; } }
    else if (rec) recorder_error = 'Snemalnik ne podpira iskanja – predvajanje je mogoče od izbranega časa naprej';
  }
  const bookmarks = q.all('SELECT * FROM bookmarks WHERE camera_id=? AND end_ts>? AND start_ts<?', camId, from, to);
  sendJson(res, 200, { server, recorder, recorder_error, events, bookmarks, rec_location: cam.rec_location, has_recorder: !!cam.recorder_id });
});

api.get('/api/recordings/segment/:id', viewer, async (req, res) => {
  const s = q.get('SELECT * FROM segments WHERE id=?', req.params.id);
  if (!s) throw new HttpError(404, 'Posnetek ne obstaja');
  assertCamera(req.user, s.camera_id);
  sendFile(req, res, s.path, { 'Cache-Control': 'private, max-age=3600' });
});

// Predvajanje s snemalnika – ustvari začasen tok v go2rtc
api.post('/api/recordings/playback', viewer, async (req, res) => {
  const b = await readJson(req);
  assertCamera(req.user, b.camera);
  const cam = camOr404(b.camera);
  const rec = cam.recorder_id && q.get('SELECT * FROM recorders WHERE id=?', cam.recorder_id);
  if (!rec) throw new HttpError(400, 'Kamera ni povezana s snemalnikom');
  const url = playbackUrl(rec, cam.channel, Number(b.ts), b.end ? Number(b.end) : null);
  if (!url) throw new HttpError(400, 'Predvajanje s tega snemalnika ni podprto – vklopite snemanje na strežnik');
  const name = await tempStream(url);
  audit(req, 'predvajanje_snemalnik', cam.name, new Date(b.ts * 1000).toISOString());
  sendJson(res, 200, { stream: name });
});

// Zaznamki in zaklepanje posnetkov
api.get('/api/bookmarks', viewer, async (req, res) => {
  const ids = allowedCameraIds(req.user);
  let rows = q.all('SELECT b.*, c.name camera_name FROM bookmarks b LEFT JOIN cameras c ON c.id=b.camera_id ORDER BY b.start_ts DESC LIMIT 500');
  if (ids) rows = rows.filter(r => ids.includes(r.camera_id));
  sendJson(res, 200, rows);
});
api.post('/api/bookmarks', operator, async (req, res) => {
  const b = await readJson(req);
  assertCamera(req.user, b.camera_id);
  const id = insert('bookmarks', { camera_id: b.camera_id, start_ts: b.start_ts, end_ts: b.end_ts, title: b.title || 'Zaznamek', locked: b.locked === false ? 0 : 1, created_by: req.user.username });
  if (b.locked !== false) lockRange(b.camera_id, b.start_ts, b.end_ts);
  audit(req, 'zaznamek', b.camera_id, b.title);
  sendJson(res, 200, { id });
});
api.delete('/api/bookmarks/:id', operator, async (req, res) => {
  const bm = q.get('SELECT * FROM bookmarks WHERE id=?', req.params.id);
  if (bm) {
    q.run('DELETE FROM bookmarks WHERE id=?', bm.id);
    q.run(`UPDATE segments SET locked=0 WHERE camera_id=? AND end_ts>=? AND start_ts<=? AND NOT EXISTS
      (SELECT 1 FROM bookmarks b WHERE b.camera_id=segments.camera_id AND b.locked=1 AND b.start_ts<=segments.end_ts AND b.end_ts>=segments.start_ts)`, bm.camera_id, bm.start_ts, bm.end_ts);
  }
  sendJson(res, 200, { ok: true });
});

// ======================= IZVOZ =======================
api.get('/api/exports', operator, async (req, res) => {
  const rows = q.all('SELECT e.*, c.name camera_name FROM exports e LEFT JOIN cameras c ON c.id=e.camera_id ORDER BY e.id DESC LIMIT 100');
  sendJson(res, 200, req.user.role === 'admin' ? rows : rows.filter(r => r.created_by === req.user.username));
});
api.post('/api/exports', operator, async (req, res) => {
  const b = await readJson(req);
  assertCamera(req.user, b.camera_id);
  const cam = camOr404(b.camera_id);
  const source = b.source || (q.get('SELECT 1 FROM segments WHERE camera_id=? AND end_ts>? AND start_ts<? LIMIT 1', cam.id, b.start_ts, b.end_ts) ? 'server' : 'recorder');
  const id = insert('exports', { camera_id: cam.id, start_ts: b.start_ts, end_ts: b.end_ts, source, watermark: b.watermark ? 1 : 0, created_by: req.user.username });
  audit(req, 'izvoz', cam.name, `${new Date(b.start_ts * 1000).toISOString()} – ${new Date(b.end_ts * 1000).toISOString()}`);
  processQueue();
  sendJson(res, 200, { id });
});
api.get('/api/exports/:id/download', operator, async (req, res) => {
  const e = q.get('SELECT * FROM exports WHERE id=?', req.params.id);
  if (!e || e.status !== 'done') throw new HttpError(404, 'Izvoz ni na voljo');
  if (req.user.role !== 'admin' && e.created_by !== req.user.username) throw new HttpError(403, 'Ni dostopa');
  const u = new URL(req.url, 'http://x');
  const f = path.join(exportsDir, e.file + (u.searchParams.get('sha') === '1' ? '.sha256' : ''));
  audit(req, 'izvoz_prenos', e.id);
  sendFile(req, res, f, { 'Content-Disposition': `attachment; filename="${path.basename(f)}"` });
});
api.delete('/api/exports/:id', operator, async (req, res) => {
  const e = q.get('SELECT * FROM exports WHERE id=?', req.params.id);
  if (e?.file) { fs.rmSync(path.join(exportsDir, e.file), { force: true }); fs.rmSync(path.join(exportsDir, e.file + '.sha256'), { force: true }); }
  q.run('DELETE FROM exports WHERE id=?', req.params.id);
  sendJson(res, 200, { ok: true });
});

// ======================= DOGODKI =======================
api.get('/api/stream', viewer, async (req, res) => sseHandler(req, res));

api.get('/api/events', viewer, async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = Object.fromEntries(u.searchParams);
  const where = [], args = [];
  const ids = allowedCameraIds(req.user);
  if (ids) { where.push(`(camera_id IN (${ids.map(() => '?').join(',') || 'NULL'}) )`); args.push(...ids); }
  if (p.camera) { const cs = p.camera.split(',').map(Number); where.push(`camera_id IN (${cs.map(() => '?').join(',')})`); args.push(...cs); }
  if (p.type) { const t = p.type.split(','); where.push(`type IN (${t.map(() => '?').join(',')})`); args.push(...t); }
  if (p.label) { const l = p.label.split(','); where.push(`label IN (${l.map(() => '?').join(',')})`); args.push(...l); }
  if (p.zone) { where.push('zone=?'); args.push(p.zone); }
  if (p.severity) { const s = p.severity.split(','); where.push(`severity IN (${s.map(() => '?').join(',')})`); args.push(...s); }
  if (p.from) { where.push('ts>=?'); args.push(Number(p.from)); }
  if (p.to) { where.push('ts<=?'); args.push(Number(p.to)); }
  if (p.ack === '0') where.push('acknowledged=0');
  if (p.ack === '1') where.push('acknowledged=1');
  if (p.snapshot === '1') where.push('snapshot IS NOT NULL');
  if (p.q) {
    // pametno iskanje v naravnem jeziku: "oseba", "avto", "pes", "sabotaža" …
    const words = p.q.toLowerCase().split(/\s+/);
    const labelMap = { oseb: 'person', človek: 'person', clovek: 'person', ljud: 'person', avt: 'car', vozil: 'car', tovornjak: 'truck', avtobus: 'bus', motor: 'motorcycle', kolo: 'bicycle', kolesar: 'bicycle', pes: 'dog', psa: 'dog', mačk: 'cat', mack: 'cat', ptic: 'bird' };
    const typeMap = { sabota: 'tamper', gibanj: 'motion', linij: 'line', prečk: 'line', preck: 'line', območ: 'zone', obmoc: 'zone', zadrž: 'loiter', zadrz: 'loiter', izpad: 'camera_offline', disk: 'disk' };
    const labels = new Set(), types = new Set();
    for (const w of words) {
      for (const [k, v] of Object.entries(labelMap)) if (w.startsWith(k)) labels.add(v);
      for (const [k, v] of Object.entries(typeMap)) if (w.startsWith(k)) types.add(v);
    }
    if (labels.size) { where.push(`label IN (${[...labels].map(() => '?').join(',')})`); args.push(...labels); }
    if (types.size) { where.push(`type IN (${[...types].map(() => '?').join(',')})`); args.push(...types); }
    // barva (AI modul jo zapiše v data_json)
    const colorWords = new Set();
    for (const w of words) if (/^(rdeč|rdec|moder|modr|bel|črn|crn|siv|zelen|rumen|oranž|oranz|vijol)/.test(w)) { colorWords.add(w); where.push('data_json LIKE ?'); args.push(`%${w.replace(/^crn/, 'črn').slice(0, 3)}%`); }
    // preostale besede: ime kamere ali območja/linije (npr. "dvorišče", "vhod")
    const STOP = /^(med|in|na|pri|ob|do|od|za|vceraj|včeraj|danes|teden|ta|ponoči|ponoci|noč|noc|zjutraj|popoldne|zvečer|zvecer|zadnj\w*|ur[aei]?|uro|dni|mesec\w*|\d+([:.]\d+)?)$/;
    const isKnown = w => Object.keys(labelMap).some(k => w.startsWith(k)) || Object.keys(typeMap).some(k => w.startsWith(k)) || colorWords.has(w);
    for (const w of words) {
      if (w.length < 3 || STOP.test(w) || isKnown(w)) continue;
      const camIds = q.all('SELECT id, name FROM cameras').filter(c => c.name.toLowerCase().includes(w)).map(c => c.id);
      where.push(`(zone LIKE ?${camIds.length ? ` OR camera_id IN (${camIds.map(() => '?').join(',')})` : ''})`);
      args.push(`%${w}%`, ...camIds);
    }
  }
  const limit = Math.min(Number(p.limit) || 100, 1000), offset = Number(p.offset) || 0;
  const sql = `SELECT e.*, c.name camera_name FROM events e LEFT JOIN cameras c ON c.id=e.camera_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ? OFFSET ?`;
  const rows = q.all(sql, ...args, limit, offset).map(r => ({ ...r, data: JSON.parse(r.data_json || '{}'), data_json: undefined }));
  const total = q.get(`SELECT COUNT(*) n FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...args).n;
  sendJson(res, 200, { items: rows, total, types: EVENT_TYPES, labels: LABELS });
});

api.get('/api/events/stats', viewer, async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const from = Number(u.searchParams.get('from')) || Date.now() / 1000 - 86400;
  const to = Number(u.searchParams.get('to')) || Date.now() / 1000;
  const bucket = Number(u.searchParams.get('bucket')) || 3600;
  const cam = u.searchParams.get('camera');
  const ids = allowedCameraIds(req.user);
  const args = [bucket, bucket, from, to];
  let extra = '';
  if (cam) { extra += ' AND camera_id=?'; args.push(Number(cam)); }
  if (ids) { extra += ` AND camera_id IN (${ids.map(() => '?').join(',') || 'NULL'})`; args.push(...ids); }
  const rows = q.all(`SELECT CAST(ts/? AS INTEGER)*? b, COALESCE(label, type) k, COUNT(*) n FROM events WHERE ts>=? AND ts<=? ${extra} GROUP BY b, k ORDER BY b`, ...args);
  // štetje prečkanj linij po smeri
  const lineArgs = [from, to]; let lineExtra = '';
  if (cam) { lineExtra = ' AND camera_id=?'; lineArgs.push(Number(cam)); }
  const lines = q.all(`SELECT zone, label, json_extract(data_json,'$.direction') dir, COUNT(*) n FROM events WHERE type='line' AND ts>=? AND ts<=? ${lineExtra} GROUP BY zone, label, dir`, ...lineArgs);
  sendJson(res, 200, { buckets: rows, lines, bucket, from, to });
});

api.post('/api/events', operator, async (req, res) => {
  const b = await readJson(req);
  if (b.camera_id) assertCamera(req.user, b.camera_id);
  const jpg = b.snapshot_b64 ? Buffer.from(b.snapshot_b64, 'base64') : null;
  const ev = createEvent({
    type: b.type || 'manual', camera_id: b.camera_id || null, label: b.label || null, score: num(b.score), zone: b.zone || null,
    severity: b.severity, ts: num(b.ts), end_ts: num(b.end_ts), data: { ...(b.data || {}), by: req.user.username },
  }, jpg);
  if (!req.user.service) audit(req, 'rocni_dogodek', b.camera_id, b.type);
  sendJson(res, 200, { id: ev.id });
});

api.get('/api/events/:id/snapshot', viewer, async (req, res) => {
  const e = q.get('SELECT camera_id, snapshot FROM events WHERE id=?', req.params.id);
  if (!e?.snapshot) throw new HttpError(404, 'Ni slike');
  if (e.camera_id) assertCamera(req.user, e.camera_id);
  sendFile(req, res, snapshotPath(e.snapshot), { 'Cache-Control': 'private, max-age=86400' });
});

api.post('/api/events/:id/ack', operator, async (req, res) => {
  const b = await readJson(req);
  q.run('UPDATE events SET acknowledged=1, ack_by=?, ack_at=unixepoch(), ack_comment=? WHERE id=?', req.user.username, b.comment || null, req.params.id);
  audit(req, 'potrditev_alarma', req.params.id, b.comment || '');
  sendJson(res, 200, { ok: true });
});
api.post('/api/events/ack-all', operator, async (req, res) => {
  const r = q.run('UPDATE events SET acknowledged=1, ack_by=?, ack_at=unixepoch() WHERE acknowledged=0', req.user.username);
  audit(req, 'potrditev_vseh_alarmov', '', String(r.changes));
  sendJson(res, 200, { ok: true, count: Number(r.changes) });
});

// ======================= PRAVILA =======================
api.get('/api/rules', admin, async (req, res) => sendJson(res, 200, q.all('SELECT * FROM rules ORDER BY name').map(r => ({ ...r, trigger: JSON.parse(r.trigger_json), actions: JSON.parse(r.actions_json) }))));
api.post('/api/rules', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.name) throw new HttpError(400, 'Ime pravila je obvezno');
  const id = insert('rules', { name: b.name, enabled: b.enabled ?? 1, trigger_json: JSON.stringify(b.trigger || {}), actions_json: JSON.stringify(b.actions || []), cooldown_seconds: num(b.cooldown_seconds, 30) });
  audit(req, 'pravilo_dodano', b.name);
  sendJson(res, 200, { id });
});
api.put('/api/rules/:id', admin, async (req, res) => {
  const b = await readJson(req);
  const data = pick(b, ['name', 'enabled', 'cooldown_seconds']);
  if (b.trigger) data.trigger_json = JSON.stringify(b.trigger);
  if (b.actions) data.actions_json = JSON.stringify(b.actions);
  update('rules', req.params.id, data);
  sendJson(res, 200, { ok: true });
});
api.delete('/api/rules/:id', admin, async (req, res) => { q.run('DELETE FROM rules WHERE id=?', req.params.id); sendJson(res, 200, { ok: true }); });

// ======================= POGLEDI (LAYOUTS) =======================
api.get('/api/layouts', viewer, async (req, res) => sendJson(res, 200, q.all('SELECT * FROM layouts WHERE user_id IS NULL OR user_id=? ORDER BY name', req.user.id).map(l => ({ ...l, cells: JSON.parse(l.cells_json || '[]') }))));
api.post('/api/layouts', viewer, async (req, res) => {
  const b = await readJson(req);
  const shared = b.shared && ROLES[req.user.role] >= ROLES.operator;
  const id = insert('layouts', { name: b.name || 'Pogled', user_id: shared ? null : req.user.id, grid: num(b.grid, 4), cells_json: JSON.stringify(b.cells || []), tour_seconds: num(b.tour_seconds, 0) });
  sendJson(res, 200, { id });
});
api.put('/api/layouts/:id', viewer, async (req, res) => {
  const l = q.get('SELECT * FROM layouts WHERE id=?', req.params.id);
  if (!l || (l.user_id && l.user_id !== req.user.id) || (!l.user_id && ROLES[req.user.role] < ROLES.operator)) throw new HttpError(403, 'Pogleda ne morete urejati');
  const b = await readJson(req);
  const data = pick(b, ['name', 'grid', 'tour_seconds']);
  if (b.cells) data.cells_json = JSON.stringify(b.cells);
  update('layouts', l.id, data);
  sendJson(res, 200, { ok: true });
});
api.delete('/api/layouts/:id', viewer, async (req, res) => {
  const l = q.get('SELECT * FROM layouts WHERE id=?', req.params.id);
  if (l && (l.user_id === req.user.id || ROLES[req.user.role] >= ROLES.operator)) q.run('DELETE FROM layouts WHERE id=?', l.id);
  sendJson(res, 200, { ok: true });
});

// ======================= TLORISI =======================
const mapsDir = path.join(config.dataDir, 'maps');
fs.mkdirSync(mapsDir, { recursive: true });
api.get('/api/maps', viewer, async (req, res) => sendJson(res, 200, q.all('SELECT * FROM maps ORDER BY name')));
api.post('/api/maps', admin, async (req, res) => {
  const b = await readJson(req);
  const m = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,(.+)$/.exec(b.image || '');
  if (!b.name || !m) throw new HttpError(400, 'Ime in slika tlorisa sta obvezna');
  const ext = m[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  const file = `map_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(mapsDir, file), Buffer.from(m[2], 'base64'));
  const id = insert('maps', { name: b.name, image: file });
  sendJson(res, 200, { id });
});
api.put('/api/maps/:id', admin, async (req, res) => { update('maps', req.params.id, pick(await readJson(req), ['name'])); sendJson(res, 200, { ok: true }); });
api.delete('/api/maps/:id', admin, async (req, res) => {
  const m = q.get('SELECT * FROM maps WHERE id=?', req.params.id);
  if (m?.image) fs.rmSync(path.join(mapsDir, m.image), { force: true });
  q.run('UPDATE cameras SET plan_id=NULL WHERE plan_id=?', req.params.id);
  q.run('DELETE FROM maps WHERE id=?', req.params.id);
  sendJson(res, 200, { ok: true });
});
api.get('/api/maps/:id/image', viewer, async (req, res) => {
  const m = q.get('SELECT * FROM maps WHERE id=?', req.params.id);
  if (!m?.image) throw new HttpError(404, 'Ni slike');
  sendFile(req, res, path.join(mapsDir, m.image));
});

// ======================= UPORABNIKI =======================
api.get('/api/users', admin, async (req, res) => {
  const rows = q.all('SELECT id, username, full_name, email, role, totp_enabled, all_cameras, enabled, last_login, created_at FROM users ORDER BY username');
  for (const r of rows) r.cameras = q.all('SELECT camera_id FROM user_cameras WHERE user_id=?', r.id).map(x => x.camera_id);
  sendJson(res, 200, rows);
});
function saveUserCameras(id, cams) {
  if (!Array.isArray(cams)) return;
  q.run('DELETE FROM user_cameras WHERE user_id=?', id);
  for (const c of cams) q.run('INSERT OR IGNORE INTO user_cameras(user_id, camera_id) VALUES(?,?)', id, c);
}
api.post('/api/users', admin, async (req, res) => {
  const b = await readJson(req);
  if (!b.username || String(b.password || '').length < 8) throw new HttpError(400, 'Uporabniško ime in geslo (vsaj 8 znakov) sta obvezna');
  if (!ROLES[b.role]) throw new HttpError(400, 'Neveljavna vloga');
  if (q.get('SELECT 1 FROM users WHERE username=?', b.username)) throw new HttpError(400, 'Uporabnik že obstaja');
  const id = insert('users', { username: b.username, full_name: b.full_name, email: b.email, role: b.role, password_hash: hashPassword(b.password), all_cameras: b.all_cameras ?? 1 });
  saveUserCameras(id, b.cameras);
  audit(req, 'uporabnik_dodan', b.username, b.role);
  sendJson(res, 200, { id });
});
api.put('/api/users/:id', admin, async (req, res) => {
  const b = await readJson(req);
  const data = pick(b, ['full_name', 'email', 'role', 'all_cameras', 'enabled']);
  if (data.role && !ROLES[data.role]) throw new HttpError(400, 'Neveljavna vloga');
  if (b.password) { if (String(b.password).length < 8) throw new HttpError(400, 'Geslo mora imeti vsaj 8 znakov'); data.password_hash = hashPassword(b.password); }
  if (b.reset_totp) { data.totp_enabled = 0; data.totp_secret = null; }
  if (Number(req.params.id) === req.user.id && (data.role && data.role !== 'admin' || data.enabled === 0 || data.enabled === false)) throw new HttpError(400, 'Sebi ne morete odvzeti skrbniških pravic');
  update('users', req.params.id, data);
  saveUserCameras(req.params.id, b.cameras);
  audit(req, 'uporabnik_spremenjen', req.params.id);
  sendJson(res, 200, { ok: true });
});
api.delete('/api/users/:id', admin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'Sebe ne morete izbrisati');
  q.run('DELETE FROM users WHERE id=?', req.params.id);
  audit(req, 'uporabnik_izbrisan', req.params.id);
  sendJson(res, 200, { ok: true });
});

// ======================= API ŽETONI =======================
api.get('/api/tokens', admin, async (req, res) => sendJson(res, 200, q.all('SELECT id, name, role, created_at, last_used FROM api_tokens ORDER BY id DESC')));
api.post('/api/tokens', admin, async (req, res) => {
  const b = await readJson(req);
  const token = 'v1_' + crypto.randomBytes(24).toString('base64url');
  insert('api_tokens', { name: b.name || 'Žeton', token_hash: hashApiToken(token), role: ROLES[b.role] ? b.role : 'viewer' });
  audit(req, 'api_zeton_ustvarjen', b.name);
  sendJson(res, 200, { token });
});
api.delete('/api/tokens/:id', admin, async (req, res) => { q.run('DELETE FROM api_tokens WHERE id=?', req.params.id); sendJson(res, 200, { ok: true }); });

// ======================= NASTAVITVE =======================
const SETTING_KEYS = ['system_name', 'mqtt', 'event_retention_days', 'ntfy', 'snapshot_on_event', 'site_address', 'privacy_notice'];
api.get('/api/settings', admin, async (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k, null);
  if (out.mqtt?.password) out.mqtt = { ...out.mqtt, password: '***' };
  sendJson(res, 200, { ...out, mqtt_status: mqttStatus(), recordings_root: config.recordingsRoot, segment_seconds: config.segmentSeconds });
});
api.put('/api/settings', admin, async (req, res) => {
  const b = await readJson(req);
  for (const k of SETTING_KEYS) if (b[k] !== undefined) {
    if (k === 'mqtt' && b.mqtt?.password === '***') b.mqtt.password = getSetting('mqtt', {}).password;
    setSetting(k, b[k]);
  }
  if (b.mqtt !== undefined) setupMqtt();
  audit(req, 'nastavitve', '', Object.keys(b).join(','));
  sendJson(res, 200, { ok: true });
});

// ======================= REVIZIJSKA SLED =======================
api.get('/api/audit', admin, async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const s = u.searchParams.get('q');
  const rows = s
    ? q.all('SELECT * FROM audit WHERE username LIKE ? OR action LIKE ? OR target LIKE ? ORDER BY id DESC LIMIT 500', `%${s}%`, `%${s}%`, `%${s}%`)
    : q.all('SELECT * FROM audit ORDER BY id DESC LIMIT 500');
  sendJson(res, 200, rows);
});

// ======================= VARNOSTNA KOPIJA =======================
const BACKUP_TABLES = ['settings', 'users', 'user_cameras', 'api_tokens', 'camera_groups', 'recorders', 'storage_pools', 'cameras', 'rules', 'layouts', 'maps', 'bookmarks'];
api.get('/api/system/backup', admin, async (req, res) => {
  const data = { app: 'VisionOne', version: VERSION, created: new Date().toISOString(), tables: {} };
  for (const t of BACKUP_TABLES) data.tables[t] = q.all(`SELECT * FROM ${t}`);
  audit(req, 'varnostna_kopija');
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="visionone-nastavitve-${new Date().toISOString().slice(0, 10)}.json"` });
  res.end(JSON.stringify(data, null, 1));
});
api.post('/api/system/restore', admin, async (req, res) => {
  const b = await readJson(req);
  if (b.app !== 'VisionOne' || !b.tables) throw new HttpError(400, 'Datoteka ni VisionOne varnostna kopija');
  db.exec('BEGIN');
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    for (const t of [...BACKUP_TABLES].reverse()) if (b.tables[t]) q.run(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES) for (const row of b.tables[t] || []) insert(t, row);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw new HttpError(400, `Obnova ni uspela: ${e.message}`); }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
  audit(req, 'obnova_nastavitev');
  setupMqtt(); afterCameraChange();
  sendJson(res, 200, { ok: true });
});

// ======================= AI MODUL =======================
const aiState = { last: 0, info: null };
function aiStatus() { return { connected: Date.now() - aiState.last < 60000, last: aiState.last ? Math.floor(aiState.last / 1000) : null, info: aiState.info }; }
api.get('/api/ai/config', admin, async (req, res) => {
  const cams = q.all('SELECT * FROM cameras WHERE enabled=1 AND (ai_enabled=1 OR tamper_detect=1)');
  sendJson(res, 200, {
    go2rtc: config.go2rtcApi,
    cameras: cams.map(c => ({
      id: c.id, name: c.name, stream: streamName(c.id, true), ai: !!c.ai_enabled, tamper: !!c.tamper_detect,
      classes: String(c.ai_classes || '').split(',').map(s => s.trim()).filter(Boolean), min_score: c.ai_min_score || 0.5, fps: c.ai_fps || 2,
      zones: JSON.parse(c.zones_json || '[]'),
    })),
  });
});
api.post('/api/ai/heartbeat', admin, async (req, res) => {
  aiState.last = Date.now(); aiState.info = await readJson(req);
  sendJson(res, 200, { ok: true });
});
api.get('/api/ai/status', admin, async (req, res) => sendJson(res, 200, aiStatus()));

// ======================= INTEGRACIJA (VisionOne Field, Home Assistant …) =======================
api.get('/api/integration/status', viewer, async (req, res) => {
  const cams = q.all('SELECT id, name, status, enabled, rec_location, last_seen FROM cameras WHERE enabled=1');
  const recs = q.all('SELECT id, name, status, vendor, model, disks_json FROM recorders');
  sendJson(res, 200, {
    system_name: getSetting('system_name', 'VisionOne'), version: VERSION, time: Math.floor(Date.now() / 1000),
    cameras: cams, recorders: recs.map(r => ({ ...r, disks: JSON.parse(r.disks_json || '[]'), disks_json: undefined })),
    pools: poolStats().map(p => ({ name: p.name, total: p.disk.total, free: p.disk.free, oldest: p.oldest })),
    recording: Object.keys(recorderStatus()).length,
    alarms_24h: q.get("SELECT COUNT(*) n FROM events WHERE ts>? AND severity IN ('alarm','warning')", Date.now() / 1000 - 86400).n,
  });
});

// Filter za go2rtc posredovanje: samo dovoljeni tokovi
export function checkGo2rtcAccess(req, pathname, search) {
  const allowedStatic = ['/video-rtc.js', '/video-stream.js'];
  if (allowedStatic.includes(pathname)) return true;
  if (!['/api/ws', '/api/frame.jpeg', '/api/webrtc', '/api/stream.mp4', '/api/stream.m3u8', '/api/hls/playlist.m3u8', '/api/hls/segment.m4s', '/api/hls/init.mp4', '/api/hls/segment.ts'].includes(pathname)) return false;
  const src = new URLSearchParams(search).get('src');
  if (!src) return pathname.startsWith('/api/hls/'); // HLS segmenti uporabljajo id
  const m = /^cam_(\d+)(_sub)?$/.exec(src);
  if (m) return canSeeCamera(req.user, Number(m[1]));
  return /^pb_[a-z0-9]+$/.test(src);
}
