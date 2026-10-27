'use strict';
// Kriptografski pripomočki (samo Node stdlib): gesla (scrypt), žetoni, HMAC podpisi, AES šifriranje.
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const dk = crypto.scryptSync(String(password), salt, expected.length, { N: +N, r: +r, p: +p });
    return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
  } catch (e) { return false; }
}

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}
function hmacVerify(data, sig, secret) {
  const a = Buffer.from(hmac(data, secret));
  const b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Podpisan "paket" podatkov v piškotku: base64url(json).sig
function sealJSON(obj, secret) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${payload}.${hmac(payload, secret)}`;
}
function openJSON(str, secret) {
  if (!str || typeof str !== 'string' || !str.includes('.')) return null;
  const i = str.lastIndexOf('.');
  const payload = str.slice(0, i), sig = str.slice(i + 1);
  if (!hmacVerify(payload, sig, secret)) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
}

// AES-256-GCM za gesla naprav, shranjena v portalu (ključ iz DEVICE_SECRET_KEY, base64 32B).
function encryptSecret(plain, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('DEVICE_SECRET_KEY mora biti 32 bajtov (base64)');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}
function decryptSecret(blob, keyB64) {
  const key = Buffer.from(keyB64, 'base64');
  const [ivB, tagB, encB] = String(blob).split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  d.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
}

module.exports = {
  hashPassword, verifyPassword, token, sha256, hmac, hmacVerify,
  sealJSON, openJSON, encryptSecret, decryptSecret,
};
