// Pomnilniški bazeni (diski v strežniku) in statistika
import fs from 'node:fs';
import path from 'node:path';
import { q, insert } from './db.js';
import { config } from './config.js';

export function ensureDefaultPool() {
  fs.mkdirSync(config.recordingsRoot, { recursive: true });
  if (!q.get('SELECT id FROM storage_pools LIMIT 1')) {
    // vsak podimenik /recordings/xxx (npr. disk1, disk2) postane svoj bazen
    const subs = fs.readdirSync(config.recordingsRoot, { withFileTypes: true }).filter(d => d.isDirectory() && /^disk|^hdd|^raid|^pool/i.test(d.name));
    if (subs.length) subs.forEach((d, i) => insert('storage_pools', { name: `Disk ${i + 1} (${d.name})`, path: path.join(config.recordingsRoot, d.name) }));
    else insert('storage_pools', { name: 'Strežnik – glavni disk', path: config.recordingsRoot });
  }
}

export function diskStats(p) {
  try {
    const s = fs.statfsSync(p);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { total, free, used: total - free, free_percent: total ? (free / total) * 100 : 0 };
  } catch { return { total: 0, free: 0, used: 0, free_percent: 0, error: 'Pot ni dosegljiva' }; }
}

export function poolStats() {
  return q.all('SELECT * FROM storage_pools ORDER BY id').map(p => {
    const used = q.get('SELECT COALESCE(SUM(size),0) s, COUNT(*) n, MIN(start_ts) oldest FROM segments WHERE pool_id=?', p.id);
    return { ...p, disk: diskStats(p.path), vms_used: used.s, segments: used.n, oldest: used.oldest };
  });
}

// Kandidati za nove bazene: priklopljeni podimeniki v /recordings
export function availableMounts() {
  try {
    const used = new Set(q.all('SELECT path FROM storage_pools').map(r => r.path));
    return fs.readdirSync(config.recordingsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('cam_'))
      .map(d => path.join(config.recordingsRoot, d.name))
      .filter(p => !used.has(p))
      .map(p => ({ path: p, ...diskStats(p) }));
  } catch { return []; }
}

export function poolFor(cam) {
  if (cam.pool_id) {
    const p = q.get('SELECT * FROM storage_pools WHERE id=? AND enabled=1', cam.pool_id);
    if (p) return p;
  }
  // izberi bazen z največ prostora
  const pools = q.all('SELECT * FROM storage_pools WHERE enabled=1');
  if (!pools.length) return null;
  return pools.map(p => ({ p, f: diskStats(p.path).free })).sort((a, b) => b.f - a.f)[0].p;
}
