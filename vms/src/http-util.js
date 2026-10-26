// Pomožne funkcije za HTTP: usmerjevalnik, odgovori, statične datoteke, HTTP odjemalec z Digest avtentikacijo
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------- Usmerjevalnik ----------
export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  put(p, ...h) { this.add('PUT', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  delete(p, ...h) { this.add('DELETE', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.re);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handlers: r.handlers, params };
      }
    }
    return null;
  }
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

export async function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Zahteva je prevelika')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'Neveljaven JSON'); }
}

export function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
export const mimeOf = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

// Pošlji datoteko s podporo za Range (za predvajanje videa)
export function sendFile(req, res, file, extraHeaders = {}) {
  let st;
  try { st = fs.statSync(file); } catch { res.writeHead(404); res.end('Ni najdeno'); return; }
  if (!st.isFile()) { res.writeHead(404); res.end('Ni najdeno'); return; }
  const type = mimeOf(file);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1]) : 0;
    let end = m && m[2] ? parseInt(m[2]) : st.size - 1;
    if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2]); end = st.size - 1; }
    if (start >= st.size || end >= st.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return;
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', ...extraHeaders });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', ...extraHeaders });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
}

export function serveStatic(req, res, root, pathname) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(root, safe);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return true; }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  } catch { return false; }
  if (!fs.existsSync(file)) return false;
  sendFile(req, res, file, { 'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300' });
  return true;
}

// ---------- HTTP odjemalec (za kamere in snemalnike) ----------
export function httpRequest(url, { method = 'GET', headers = {}, body = null, timeout = 8000, insecure = true } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, headers: { ...headers }, rejectUnauthorized: !insecure, timeout,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('Časovna omejitev zahteve')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

// HTTP zahteva z Basic ali Digest avtentikacijo (Hikvision, Dahua, Uniview …)
export async function authRequest(url, { username, password, ...opts } = {}) {
  let r = await httpRequest(url, opts);
  if (r.status !== 401 || !username) return r;
  const wa = [].concat(r.headers['www-authenticate'] || []).join(', ');
  const u = new URL(url);
  if (/digest/i.test(wa)) {
    const p = {};
    wa.replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, v1, v2) => { p[k.toLowerCase()] = v1 ?? v2; });
    const uri = u.pathname + u.search;
    const method = opts.method || 'GET';
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${username}:${p.realm}:${password}`);
    const ha2 = md5(`${method}:${uri}`);
    const qop = p.qop ? p.qop.split(',').map(s => s.trim()).includes('auth') ? 'auth' : p.qop.split(',')[0].trim() : null;
    const response = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
    let h = `Digest username="${username}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"`;
    if (p.opaque) h += `, opaque="${p.opaque}"`;
    if (p.algorithm) h += `, algorithm=${p.algorithm}`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    r = await httpRequest(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: h } });
  } else {
    const h = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    r = await httpRequest(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: h } });
  }
  return r;
}

// Zelo preprost XML pomočnik – vrne besedilo vseh elementov z danim imenom (ne glede na imenski prostor)
export function xmlAll(xml, tag) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
export const xmlFirst = (xml, tag) => xmlAll(xml, tag)[0];
export const xmlText = (xml, tag) => { const v = xmlFirst(xml, tag); return v == null ? null : v.replace(/<[^>]+>/g, '').trim(); };
export function xmlAttr(xml, tag, attr) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\s[^>]*?${attr}="([^"]*)"`);
  const m = re.exec(xml);
  return m ? m[1] : null;
}
export const xmlEscape = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
