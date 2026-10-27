'use strict';
// Seje v bazi (preklicljive). V piškotku je surov žeton; v bazi le njegov sha256.
const crypto = require('./crypto');
const db = require('./db');
const { getCookies, setCookie, clearCookie, clientIp } = require('./http');

const COOKIE = 'vo_sess';
const TTL_DAYS = 14;

async function create(res, userId, req) {
  const raw = crypto.token(32);
  const id = crypto.sha256(raw);
  const expires = new Date(Date.now() + TTL_DAYS * 86400000);
  await db.run(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (:id, :uid, :exp, :ip, :ua)`,
    { id, uid: userId, exp: fmt(expires), ip: clientIp(req).slice(0, 64), ua: String(req.headers['user-agent'] || '').slice(0, 255) }
  );
  setCookie(res, COOKIE, raw, { maxAge: TTL_DAYS * 86400 });
  return raw;
}

async function current(req) {
  const raw = getCookies(req)[COOKIE];
  if (!raw) return null;
  const id = crypto.sha256(raw);
  const row = await db.one(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = :id AND s.expires_at > NOW() AND u.active = 1`,
    { id }
  );
  return row || null;
}

async function destroy(req, res) {
  const raw = getCookies(req)[COOKIE];
  if (raw) await db.run(`DELETE FROM sessions WHERE id = :id`, { id: crypto.sha256(raw) });
  clearCookie(res, COOKIE);
}

async function destroyAllForUser(userId) {
  await db.run(`DELETE FROM sessions WHERE user_id = :uid`, { uid: userId });
}

function fmt(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

module.exports = { create, current, destroy, destroyAllForUser, COOKIE, fmt };
