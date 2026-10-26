// VisionOne VMS – glavni strežnik
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { config } from './config.js';
import { q, insert, getSetting, setSetting } from './db.js';
import { identify, hashPassword } from './auth.js';
import { HttpError, sendJson, serveStatic } from './http-util.js';
import { api, checkGo2rtcAccess, VERSION } from './api.js';
import { syncAll } from './go2rtc.js';
import { startRecorderLoop, stopAll, lockRange } from './recorder.js';
import { startHealthLoop } from './health.js';
import { setupMqtt, cleanupEvents, setEventHooks } from './events.js';
import { ensureDefaultPool } from './storage.js';
import { processQueue, cleanupExports } from './exporter.js';
import { ptzCommand } from './ptz.js';

// ---------- začetna nastavitev ----------
if (!q.get('SELECT id FROM users LIMIT 1')) {
  insert('users', { username: config.adminUser, full_name: 'Skrbnik', role: 'admin', password_hash: hashPassword(config.adminPassword) });
  console.log(`[VisionOne] ustvarjen skrbnik "${config.adminUser}" (geslo iz ADMIN_PASSWORD). Po prvi prijavi ga spremenite!`);
}
ensureDefaultPool();
if (getSetting('system_name') == null) setSetting('system_name', process.env.SYSTEM_NAME || 'VisionOne');
const demoCount = Number(process.env.DEMO_CAMERAS || 0);
if (demoCount > 0 && !q.get('SELECT id FROM cameras LIMIT 1')) {
  const gid = insert('camera_groups', { name: 'Demo' });
  for (let i = 1; i <= demoCount; i++) {
    insert('cameras', { name: `Demo kamera ${i}`, source: 'demo', group_id: gid, rec_location: 'server', rec_mode: i % 2 ? 'continuous' : 'events', retention_days: 3, resolution: '1280x720', codec: 'H264', ptz: i === 1 ? 1 : 0 });
  }
  console.log(`[VisionOne] dodanih ${demoCount} demo kamer`);
}
setEventHooks({ lockRange, ptzPreset: (camId, preset) => ptzCommand(camId, { action: 'goto', preset }) });

// ---------- go2rtc posrednik (HTTP + WebSocket) ----------
const g2 = new URL(config.go2rtcApi);
function proxyHttp(req, res, pathname, search) {
  const p = http.request({ host: g2.hostname, port: g2.port || 80, method: req.method, path: pathname + search, headers: { ...req.headers, host: g2.host, cookie: '' } }, pr => {
    res.writeHead(pr.statusCode, pr.headers);
    pr.pipe(res);
  });
  p.on('error', () => { if (!res.headersSent) sendJson(res, 502, { error: 'Pretočni strežnik (go2rtc) ni dosegljiv' }); });
  req.pipe(p);
}

// ---------- HTTP strežnik ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    req.user = identify(req);
    if (pathname.startsWith('/api/')) {
      const m = api.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'Ni najdeno');
      req.params = m.params;
      for (const h of m.handlers) {
        await h(req, res);
        if (res.writableEnded || res.headersSent) break;
      }
      return;
    }
    if (pathname.startsWith('/go2rtc/')) {
      if (!req.user) throw new HttpError(401, 'Prijava je potrebna');
      const sub = pathname.slice('/go2rtc'.length);
      if (!checkGo2rtcAccess(req, sub, url.search)) throw new HttpError(403, 'Ni dostopa');
      return proxyHttp(req, res, sub, url.search);
    }
    if (pathname === '/') { res.writeHead(302, { Location: '/view/' }); return res.end(); }
    if (pathname === '/health') return sendJson(res, 200, { ok: true, version: VERSION });
    if (serveStatic(req, res, config.webDir, pathname)) return;
    if (pathname.startsWith('/admin')) { if (serveStatic(req, res, config.webDir, '/admin/index.html')) return; }
    if (pathname.startsWith('/view')) { if (serveStatic(req, res, config.webDir, '/view/index.html')) return; }
    throw new HttpError(404, 'Ni najdeno');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[napaka] ${req.method} ${pathname}:`, e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || 'Napaka strežnika' });
    else res.end();
  }
});

// WebSocket nadgradnja za živo sliko (go2rtc MSE / WebRTC signalizacija)
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  req.user = identify(req);
  const sub = url.pathname.replace(/^\/go2rtc/, '');
  if (!url.pathname.startsWith('/go2rtc/') || !req.user || !checkGo2rtcAccess(req, sub, url.search)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const up = net.connect(Number(g2.port) || 80, g2.hostname, () => {
    const headers = Object.entries(req.headers).filter(([k]) => !['host', 'cookie', 'origin'].includes(k)).map(([k, v]) => `${k}: ${v}`);
    up.write(`GET ${sub}${url.search} HTTP/1.1\r\nHost: ${g2.host}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(config.port, () => {
  console.log(`[VisionOne] VMS ${VERSION} posluša na :${config.port}  (Admin: /admin/  View: /view/)`);
});

// ---------- ozadna opravila ----------
const syncLoop = async () => { await syncAll(); };
setTimeout(syncLoop, 1500);
setInterval(syncLoop, 60000);
startRecorderLoop();
startHealthLoop();
setupMqtt();
processQueue();
setInterval(() => { cleanupEvents(); cleanupExports(); }, 6 * 3600e3);
setTimeout(() => { cleanupEvents(); cleanupExports(); }, 60000);

const shutdown = () => { console.log('[VisionOne] zaustavljanje …'); stopAll(); setTimeout(() => process.exit(0), 1500); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => console.error('[napaka]', e));
