// Snemanje na strežnik: FFmpeg zapisuje 1-minutne MP4 segmente iz go2rtc (kamera ima samo eno povezavo)
// Načini: stalno, ob dogodku (s pred- in po-snemanjem), po urniku. Rok hrambe, kvote in zaščita pred polnim diskom.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { q, insert } from './db.js';
import { config } from './config.js';
import { restreamUrl } from './go2rtc.js';
import { poolFor, diskStats } from './storage.js';
import { scheduleActive, createEvent, onEvent, broadcast } from './events.js';

const procs = new Map(); // camId -> { proc, sig, startedAt, lastSegment, restarts }

function signature(cam, pool) {
  return [cam.rec_stream, pool?.id, cam.main_url, cam.sub_url, cam.source].join('|');
}

export function shouldRecord(cam, now = Date.now()) {
  if (!cam.enabled) return false;
  if (!['server', 'both'].includes(cam.rec_location)) return false;
  if (cam.rec_mode === 'schedule' && !scheduleActive(cam.rec_schedule, now)) return false;
  return true;
}

function start(cam) {
  const pool = poolFor(cam);
  if (!pool) { console.error(`[snemanje] kamera ${cam.id}: ni razpoložljivega diska`); return; }
  const dir = path.join(pool.path, `cam_${cam.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const src = restreamUrl(cam.id, cam.rec_stream === 'sub');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rtsp_transport', 'tcp', '-timeout', '10000000', '-use_wallclock_as_timestamps', '1',
    '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-ar', '16000',
    '-f', 'segment', '-segment_time', String(config.segmentSeconds), '-segment_atclocktime', '1',
    '-reset_timestamps', '1', '-strftime', '1', '-segment_format', 'mp4',
    '-segment_format_options', 'movflags=+faststart',
    '-segment_list', 'pipe:1', '-segment_list_type', 'csv', '-segment_list_flags', 'live',
    path.join(dir, '%s.mp4'),
  ];
  const proc = spawn(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const st = { proc, sig: signature(cam, pool), startedAt: Date.now(), lastSegment: Date.now(), pool, dir, err: '' };
  procs.set(cam.id, st);
  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line) onSegment(cam.id, st, line);
    }
  });
  proc.stderr.on('data', d => { st.err = (st.err + d.toString()).slice(-2000); });
  proc.on('exit', code => {
    if (procs.get(cam.id) === st) procs.delete(cam.id);
    if (code && !st.stopping) console.error(`[snemanje] kamera ${cam.id} se je ustavila (koda ${code}): ${st.err.trim().split('\n').pop() || ''}`);
  });
  console.log(`[snemanje] kamera ${cam.id} → ${dir}`);
}

function stop(camId) {
  const st = procs.get(camId);
  if (!st) return;
  st.stopping = true;
  procs.delete(camId);
  try { st.proc.kill('SIGINT'); } catch {}
  setTimeout(() => { try { st.proc.kill('SIGKILL'); } catch {} }, 5000);
}

function onSegment(camId, st, line) {
  // vrstica: "1729600000.mp4,0.000000,60.020000"
  const [file, s, e] = line.split(',');
  const startTs = Number(path.basename(file, '.mp4'));
  if (!startTs) return;
  const dur = Math.max(0, Number(e) - Number(s));
  const full = path.join(st.dir, path.basename(file));
  let size = 0;
  try { size = fs.statSync(full).size; } catch { return; }
  if (size < 1024) { try { fs.unlinkSync(full); } catch {} return; }
  const cam = q.get('SELECT rec_mode, pre_seconds, post_seconds FROM cameras WHERE id=?', camId);
  const endTs = startTs + dur;
  let keep = 1;
  if (cam?.rec_mode === 'events') {
    const hit = q.get(`SELECT 1 FROM events WHERE camera_id=? AND type NOT IN ('camera_online','camera_offline')
      AND ts - ? <= ? AND COALESCE(end_ts, ts) + ? >= ? LIMIT 1`, camId, cam.pre_seconds || 10, endTs, cam.post_seconds || 30, startTs);
    keep = hit ? 1 : 0;
  }
  const locked = q.get('SELECT 1 FROM bookmarks WHERE camera_id=? AND locked=1 AND start_ts<=? AND end_ts>=? LIMIT 1', camId, endTs, startTs) ? 1 : 0;
  insert('segments', { camera_id: camId, pool_id: st.pool.id, path: full, start_ts: startTs, end_ts: endTs, size, keep, locked });
  st.lastSegment = Date.now();
  broadcast('segment', { camera_id: camId, start_ts: startTs, end_ts: endTs });
}

// Ob dogodku označi segmente v oknu pred-/po-snemanja
onEvent(ev => {
  if (!ev.camera_id || ['camera_online', 'camera_offline'].includes(ev.type)) return;
  const cam = q.get('SELECT pre_seconds, post_seconds FROM cameras WHERE id=?', ev.camera_id);
  if (!cam) return;
  q.run('UPDATE segments SET keep=1 WHERE camera_id=? AND end_ts>=? AND start_ts<=?', ev.camera_id, ev.ts - (cam.pre_seconds || 10), (ev.end_ts || ev.ts) + (cam.post_seconds || 30));
});

export function lockRange(camId, from, to) {
  q.run('UPDATE segments SET locked=1, keep=1 WHERE camera_id=? AND end_ts>=? AND start_ts<=?', camId, from, to);
}

// Uskladi procese s konfiguracijo (kliče se periodično in ob spremembah)
export function reconcile() {
  const cams = q.all('SELECT * FROM cameras');
  const now = Date.now();
  for (const cam of cams) {
    const want = shouldRecord(cam, now);
    const st = procs.get(cam.id);
    if (!want) { if (st) stop(cam.id); continue; }
    const pool = poolFor(cam);
    if (st && st.sig !== signature(cam, pool)) { stop(cam.id); continue; }
    if (!st) {
      const last = restartAt.get(cam.id) || 0;
      if (now - last < 15000) continue;
      restartAt.set(cam.id, now);
      start(cam);
    } else if (now - st.lastSegment > (config.segmentSeconds * 3 + 30) * 1000) {
      console.warn(`[snemanje] kamera ${cam.id}: ni novih segmentov, ponovni zagon`);
      stop(cam.id);
    }
  }
  for (const id of procs.keys()) if (!cams.find(c => c.id === id)) stop(id);
}
const restartAt = new Map();

export function recorderStatus() {
  const out = {};
  for (const [id, st] of procs) out[id] = { recording: true, since: st.startedAt, last_segment: st.lastSegment, pool_id: st.pool?.id, error: st.err.trim().split('\n').pop() || null };
  return out;
}

function deleteSegments(rows) {
  if (!rows.length) return 0;
  for (const r of rows) { try { fs.unlinkSync(r.path); } catch {} }
  const ids = rows.map(r => r.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    q.run(`DELETE FROM segments WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
  }
  return rows.length;
}

// Čiščenje: način "ob dogodku", rok hrambe, kvote in minimalni prosti prostor
let lastDiskWarn = 0;
export function cleanup() {
  const now = Date.now() / 1000;
  let removed = 0;
  // 1) ob dogodku – segmenti brez dogodkov po izteku po-snemanja
  for (const cam of q.all("SELECT id, post_seconds FROM cameras WHERE rec_mode='events'")) {
    const cutoff = now - (cam.post_seconds || 30) - config.segmentSeconds - 120;
    removed += deleteSegments(q.all('SELECT id, path FROM segments WHERE camera_id=? AND keep=0 AND locked=0 AND end_ts<?', cam.id, cutoff));
  }
  // 2) rok hrambe
  for (const cam of q.all('SELECT id, retention_days FROM cameras')) {
    const cutoff = now - (cam.retention_days || 30) * 86400;
    removed += deleteSegments(q.all('SELECT id, path FROM segments WHERE camera_id=? AND locked=0 AND end_ts<? LIMIT 5000', cam.id, cutoff));
  }
  // segmenti izbrisanih kamer
  removed += deleteSegments(q.all('SELECT id, path FROM segments WHERE camera_id NOT IN (SELECT id FROM cameras) LIMIT 5000'));
  // 3) kvote in prosti prostor po bazenih – brišemo najstarejše
  for (const pool of q.all('SELECT * FROM storage_pools')) {
    for (let guard = 0; guard < 50; guard++) {
      const d = diskStats(pool.path);
      const used = q.get('SELECT COALESCE(SUM(size),0) s FROM segments WHERE pool_id=?', pool.id).s;
      const overQuota = pool.quota_gb > 0 && used > pool.quota_gb * 1e9;
      const lowFree = d.total > 0 && d.free_percent < (pool.min_free_percent ?? 5);
      if (!overQuota && !lowFree) break;
      const rows = q.all('SELECT id, path FROM segments WHERE pool_id=? AND locked=0 ORDER BY start_ts LIMIT 100', pool.id);
      if (!rows.length) {
        if (Date.now() - lastDiskWarn > 3600e3) { lastDiskWarn = Date.now(); createEvent({ type: 'disk', severity: 'alarm', data: { pool: pool.name, message: 'Disk je poln, vsi posnetki so zaklenjeni' } }); }
        break;
      }
      removed += deleteSegments(rows);
    }
  }
  if (removed) console.log(`[čiščenje] izbrisanih segmentov: ${removed}`);
  return removed;
}

// Uvoz segmentov, ki so na disku, a niso v bazi (npr. po obnovi baze)
export function reindex() {
  let added = 0;
  for (const pool of q.all('SELECT * FROM storage_pools')) {
    let dirs = [];
    try { dirs = fs.readdirSync(pool.path).filter(d => /^cam_\d+$/.test(d)); } catch { continue; }
    for (const d of dirs) {
      const camId = Number(d.slice(4));
      const known = new Set(q.all('SELECT path FROM segments WHERE camera_id=?', camId).map(r => r.path));
      const files = fs.readdirSync(path.join(pool.path, d)).filter(f => /^\d+\.mp4$/.test(f)).sort();
      for (let i = 0; i < files.length; i++) {
        const full = path.join(pool.path, d, files[i]);
        if (known.has(full)) continue;
        const startTs = Number(files[i].slice(0, -4));
        const next = files[i + 1] ? Number(files[i + 1].slice(0, -4)) : startTs + config.segmentSeconds;
        const size = fs.statSync(full).size;
        if (procs.get(camId) && i === files.length - 1) continue; // trenutno se zapisuje
        insert('segments', { camera_id: camId, pool_id: pool.id, path: full, start_ts: startTs, end_ts: Math.min(next, startTs + config.segmentSeconds * 1.5), size, keep: 1 });
        added++;
      }
    }
  }
  return added;
}

export function startRecorderLoop() {
  setTimeout(() => { try { reindex(); } catch (e) { console.error(e); } }, 3000);
  setInterval(reconcile, 10000).unref?.();
  setTimeout(reconcile, 4000);
  setInterval(() => { try { cleanup(); } catch (e) { console.error('[čiščenje]', e); } }, 5 * 60000);
}

export function stopAll() { for (const id of [...procs.keys()]) stop(id); }
