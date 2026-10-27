'use strict';
// Pomočniki za Vercel Node funkcije: branje telesa, JSON odgovori, piškotki, IP, usmerjanje.

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
    return req.body;
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
const ok = (res, obj = {}) => json(res, 200, obj);
const bad = (res, msg, code = 400) => json(res, code, { error: msg });

function getCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 14, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Secure');
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}
function clearCookie(res, name) {
  appendHeader(res, 'Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}
function appendHeader(res, name, value) {
  const prev = res.getHeader(name);
  if (!prev) res.setHeader(name, value);
  else res.setHeader(name, Array.isArray(prev) ? prev.concat(value) : [prev, value]);
}

function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const i = (req.url || '').indexOf('?');
  const out = {};
  if (i >= 0) for (const [k, v] of new URLSearchParams(req.url.slice(i + 1))) out[k] = v;
  return out;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}

// Obravnavaj metode: methods({GET: fn, POST: fn})
function methods(map) {
  return async (req, res) => {
    const fn = map[req.method];
    if (!fn) { res.setHeader('Allow', Object.keys(map).join(', ')); return bad(res, 'Metoda ni dovoljena', 405); }
    try { return await fn(req, res); }
    catch (e) {
      console.error('[api]', e && e.stack || e);
      if (!res.headersSent) return bad(res, process.env.NODE_ENV === 'development' ? String(e && e.message || e) : 'Napaka strežnika', 500);
    }
  };
}

module.exports = { readBody, json, ok, bad, getCookies, setCookie, clearCookie, appendHeader, clientIp, query, methods };
