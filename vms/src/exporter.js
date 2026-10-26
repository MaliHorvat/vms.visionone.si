// Izvoz posnetkov (MP4) s strežnika ali snemalnika, z neobveznim vodnim žigom in SHA-256 kontrolno vsoto
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q, update } from './db.js';
import { config } from './config.js';
import { playbackUrl } from './nvr.js';
import { broadcast } from './events.js';

export const exportsDir = path.join(config.dataDir, 'exports');
fs.mkdirSync(exportsDir, { recursive: true });

const FONT_CANDIDATES = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'];
const font = () => FONT_CANDIDATES.find(f => fs.existsSync(f));

function run(args, timeoutMs = 30 * 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err = (err + d).slice(-3000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('exit', code => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg koda ${code}`)); });
  });
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%');

async function doExport(job) {
  const cam = q.get('SELECT * FROM cameras WHERE id=?', job.camera_id);
  if (!cam) throw new Error('Kamera ne obstaja');
  const out = path.join(exportsDir, `izvoz_${job.id}_cam${cam.id}_${Math.floor(job.start_ts)}.mp4`);
  const duration = job.end_ts - job.start_ts;
  if (duration <= 0 || duration > 24 * 3600) throw new Error('Neveljavno časovno obdobje (največ 24 ur)');
  const wm = job.watermark && font()
    ? ['-vf', `drawtext=fontfile=${font()}:text='${esc(cam.name)}  %{pts\\:localtime\\:${Math.floor(job.start_ts)}\\:%d.%m.%Y %H\\\\\\:%M\\\\\\:%S}':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=6`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
    : ['-c:v', 'copy'];
  if (job.source === 'recorder') {
    const rec = q.get('SELECT * FROM recorders WHERE id=?', cam.recorder_id);
    const url = rec && playbackUrl(rec, cam.channel, job.start_ts, job.end_ts);
    if (!url) throw new Error('Ta snemalnik ne podpira izvoza prek RTSP');
    await run(['-hide_banner', '-y', '-rtsp_transport', 'tcp', '-i', url, '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?', ...wm, '-c:a', 'aac', '-movflags', '+faststart', out]);
  } else {
    const segs = q.all('SELECT * FROM segments WHERE camera_id=? AND end_ts>? AND start_ts<? ORDER BY start_ts', cam.id, job.start_ts, job.end_ts);
    if (!segs.length) throw new Error('V izbranem obdobju na strežniku ni posnetkov');
    const lines = ['ffconcat version 1.0'];
    segs.forEach((s, i) => {
      lines.push(`file '${s.path.replace(/'/g, "'\\''")}'`);
      if (i === 0 && job.start_ts > s.start_ts) lines.push(`inpoint ${(job.start_ts - s.start_ts).toFixed(2)}`);
      if (i === segs.length - 1 && job.end_ts < s.end_ts) lines.push(`outpoint ${(job.end_ts - s.start_ts).toFixed(2)}`);
    });
    const list = out + '.txt';
    fs.writeFileSync(list, lines.join('\n'));
    try {
      await run(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-map', '0:a:0?', ...wm, '-c:a', 'copy', '-movflags', '+faststart', out]);
    } finally { fs.rmSync(list, { force: true }); }
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
  const size = fs.statSync(out).size;
  fs.writeFileSync(out + '.sha256', `${hash}  ${path.basename(out)}\nKamera: ${cam.name}\nOd: ${new Date(job.start_ts * 1000).toISOString()}\nDo: ${new Date(job.end_ts * 1000).toISOString()}\nIzvozil: ${job.created_by}\nUstvarjeno: ${new Date().toISOString()}\n`);
  return { file: path.basename(out), sha256: hash, size };
}

let busy = false;
export async function processQueue() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const job = q.get("SELECT * FROM exports WHERE status='queued' ORDER BY id LIMIT 1");
      if (!job) break;
      update('exports', job.id, { status: 'running' });
      broadcast('export', { id: job.id, status: 'running' });
      try {
        const r = await doExport(job);
        update('exports', job.id, { status: 'done', ...r });
        broadcast('export', { id: job.id, status: 'done', ...r });
      } catch (e) {
        update('exports', job.id, { status: 'error', error: e.message });
        broadcast('export', { id: job.id, status: 'error', error: e.message });
      }
    }
  } finally { busy = false; }
}

export function cleanupExports(days = 14) {
  const cutoff = Date.now() - days * 86400e3;
  for (const f of fs.readdirSync(exportsDir)) {
    const p = path.join(exportsDir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
}
