// Nadzor zdravja sistema (kamere, snemalniki, diski) in ONVIF dogodki kamer (gibanje, linija, sabotaža …)
import { q, update } from './db.js';
import { tcpCheck } from './discovery.js';
import { createEvent, broadcast, mqttCameraOnline } from './events.js';
import { recorderStatus } from './recorder.js';
import { adapterFor } from './nvr.js';
import { OnvifDevice, mapOnvifEvent } from './onvif.js';
import { poolStats } from './storage.js';

const fails = new Map();

function hostPort(url) {
  try { const u = new URL(url); return { host: u.hostname, port: Number(u.port) || 554 }; } catch { return null; }
}

async function setCamStatus(cam, online, detail = null) {
  const status = online ? 'online' : 'offline';
  const now = Math.floor(Date.now() / 1000);
  if (online) {
    fails.delete(cam.id);
    if (cam.status !== 'online') {
      update('cameras', cam.id, { status, last_seen: now, status_detail: null });
      if (cam.status === 'offline') createEvent({ type: 'camera_online', camera_id: cam.id, severity: 'info' });
      broadcast('camera_status', { id: cam.id, status });
      mqttCameraOnline(cam.id, true);
    } else update('cameras', cam.id, { last_seen: now });
  } else {
    const n = (fails.get(cam.id) || 0) + 1;
    fails.set(cam.id, n);
    if (n >= 2 && cam.status !== 'offline') {
      update('cameras', cam.id, { status, status_detail: detail });
      createEvent({ type: 'camera_offline', camera_id: cam.id, severity: 'warning', data: { detail } });
      broadcast('camera_status', { id: cam.id, status });
      mqttCameraOnline(cam.id, false);
    }
  }
}

const nvrChannelState = new Map(); // recorderId -> {channel: online}

async function checkRecorders() {
  for (const rec of q.all('SELECT * FROM recorders')) {
    const ok = await tcpCheck(rec.host, rec.http_port || 80, 2500) || await tcpCheck(rec.host, rec.rtsp_port || 554, 2500);
    const status = ok ? 'online' : 'offline';
    if (status !== rec.status) {
      update('recorders', rec.id, { status });
      if (rec.status === 'online' && !ok) createEvent({ type: 'recorder_offline', recorder_id: rec.id, severity: 'alarm', data: { name: rec.name } });
      broadcast('recorder_status', { id: rec.id, status });
    }
    if (ok) {
      update('recorders', rec.id, { last_seen: Math.floor(Date.now() / 1000) });
      if (['hikvision', 'dahua'].includes(rec.vendor)) try {
        const chans = await adapterFor(rec).channels(rec);
        const m = {};
        for (const c of chans) if (c.online != null) m[c.channel] = c.online;
        nvrChannelState.set(rec.id, m);
      } catch { nvrChannelState.delete(rec.id); }
    }
  }
}

let diskCheckAt = 0;
async function checkRecorderDisks() {
  if (Date.now() - diskCheckAt < 10 * 60000) return;
  diskCheckAt = Date.now();
  for (const rec of q.all("SELECT * FROM recorders WHERE status='online'")) {
    const a = adapterFor(rec);
    if (!a.disks) continue;
    try {
      const disks = await a.disks(rec);
      const prev = JSON.parse(rec.disks_json || '[]');
      update('recorders', rec.id, { disks_json: JSON.stringify(disks) });
      for (const d of disks) {
        const bad = d.status && !/^(ok|ok_|normal|idle|sleeping|running|online|success)/i.test(d.status);
        const was = prev.find(p => p.id === d.id);
        const wasBad = was?.status && !/^(ok|normal|idle|sleeping|running|online|success)/i.test(was.status);
        if (bad && !wasBad) createEvent({ type: 'disk', recorder_id: rec.id, severity: 'alarm', data: { recorder: rec.name, disk: d.name, status: d.status } });
      }
    } catch {}
  }
  // diski strežnika
  for (const p of poolStats()) {
    if (p.disk.total && p.disk.free_percent < 3) createEvent({ type: 'disk', severity: 'warning', data: { pool: p.name, free_percent: p.disk.free_percent.toFixed(1) } });
  }
}

async function checkCameras() {
  const rec = recorderStatus();
  const cams = q.all('SELECT * FROM cameras WHERE enabled=1');
  await Promise.all(cams.map(async cam => {
    if (cam.source === 'demo') return setCamStatus(cam, true);
    if (rec[cam.id] && Date.now() - rec[cam.id].last_segment < 150000) return setCamStatus(cam, true);
    if (cam.recorder_id) {
      const r = q.get('SELECT status FROM recorders WHERE id=?', cam.recorder_id);
      if (r?.status === 'offline') return setCamStatus(cam, false, 'Snemalnik ni dosegljiv');
      const st = nvrChannelState.get(cam.recorder_id)?.[cam.channel];
      if (st === false) return setCamStatus(cam, false, 'Snemalnik poroča: kanal brez signala');
      if (st === true || r?.status === 'online') return setCamStatus(cam, true);
    }
    const hp = hostPort(cam.main_url) || (cam.host ? { host: cam.host, port: cam.rtsp_port || 554 } : null);
    if (!hp) return;
    const ok = await tcpCheck(hp.host, hp.port, 2500);
    return setCamStatus(cam, ok, ok ? null : `Ni odziva na ${hp.host}:${hp.port}`);
  }));
}

// ---------- ONVIF dogodki ----------
const subs = new Map(); // camId -> { stop, sig }
function onvifSig(c) { return [c.host, c.onvif_port, c.http_port, c.username, c.password, c.onvif_events, c.enabled].join('|'); }

function startOnvifEvents(cam) {
  const st = { stopped: false, sig: onvifSig(cam), lastMotion: 0, motionEventId: null, error: null };
  subs.set(cam.id, st);
  (async () => {
    let backoff = 5000;
    while (!st.stopped) {
      try {
        const dev = new OnvifDevice({ host: cam.host, port: cam.onvif_port || cam.http_port || 80, username: cam.username, password: cam.password });
        await dev.connect();
        await dev.createPullPoint();
        st.error = null; backoff = 5000;
        let renewAt = Date.now() + 240000;
        while (!st.stopped) {
          const msgs = await dev.pullMessages(10);
          for (const m of msgs) handleOnvif(cam, st, m);
          if (Date.now() > renewAt) { await dev.renewPullPoint().catch(() => {}); renewAt = Date.now() + 240000; }
        }
      } catch (e) {
        st.error = e.message;
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 300000);
      }
    }
  })();
}

function handleOnvif(cam, st, msg) {
  const ev = mapOnvifEvent(msg);
  if (!ev) return;
  const now = Date.now() / 1000;
  if (ev.type === 'motion') {
    if (ev.active) {
      if (now - st.lastMotion < 20 && st.motionEventId) return; // združi zaporedna gibanja
      st.lastMotion = now;
      const e = createEvent({ type: 'motion', camera_id: cam.id, data: { source: 'onvif', topic: msg.topic } });
      st.motionEventId = e.id;
    } else if (st.motionEventId) {
      q.run('UPDATE events SET end_ts=? WHERE id=?', now, st.motionEventId);
      st.motionEventId = null;
    }
    return;
  }
  if (!ev.active) return;
  const key = `${ev.type}:${ev.label || ''}`;
  st.last ||= {};
  if (now - (st.last[key] || 0) < 10) return;
  st.last[key] = now;
  createEvent({ type: ev.type, label: ev.label, camera_id: cam.id, data: { source: 'onvif', topic: msg.topic, items: msg.items } });
}

function syncOnvifSubs() {
  const cams = q.all("SELECT * FROM cameras WHERE enabled=1 AND onvif_events=1 AND host IS NOT NULL AND host<>'' AND source IN ('onvif','manual') AND recorder_id IS NULL");
  const want = new Set();
  for (const cam of cams) {
    want.add(cam.id);
    const s = subs.get(cam.id);
    if (s && s.sig === onvifSig(cam)) continue;
    if (s) s.stopped = true;
    startOnvifEvents(cam);
  }
  for (const [id, s] of subs) if (!want.has(id)) { s.stopped = true; subs.delete(id); }
}
export function onvifEventStatus() {
  const out = {};
  for (const [id, s] of subs) out[id] = { error: s.error };
  return out;
}

export function startHealthLoop() {
  const loop = async () => {
    try { await checkRecorders(); await checkCameras(); await checkRecorderDisks(); syncOnvifSubs(); }
    catch (e) { console.error('[zdravje]', e); }
  };
  setTimeout(loop, 5000);
  setInterval(loop, 30000);
}
