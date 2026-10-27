'use strict';
// Licence: paketi + podpisani licenčni ključi (Ed25519). Agent preveri podpis z javnim ključem.
const crypto = require('crypto');

// Paketi po lokaciji (letni obračun). Omejitve in funkcije.
const PLANS = {
  basic: {
    name: 'Basic', maxDevices: 15, priceEUR: 120,
    features: ['nadzor', 'izpadi', 'telegram'],
  },
  pro: {
    name: 'Pro', maxDevices: 60, priceEUR: 360,
    features: ['nadzor', 'izpadi', 'telegram', 'snmp', 'kamere', 'daljinski_ukazi', 'grafi'],
  },
  enterprise: {
    name: 'Enterprise', maxDevices: 1000, priceEUR: 960,
    features: ['nadzor', 'izpadi', 'telegram', 'snmp', 'kamere', 'daljinski_ukazi', 'grafi', 'vec_lokacij', 'api'],
  },
};

const FEATURE_LABELS = {
  nadzor: 'Nadzor naprav', izpadi: 'Beleženje izpadov', telegram: 'Telegram obvestila',
  snmp: 'SNMP (switchi, UPS)', kamere: 'Kamere in snemalniki', daljinski_ukazi: 'Daljinski ukazi (domofon/rele)',
  grafi: 'Zgodovinski grafi', vec_lokacij: 'Več lokacij na stranko', api: 'Dostop do API',
};

function plan(id) { return PLANS[id] || null; }

// Objekt licence, ki ga podpišemo. Agent prejme JSON + podpis.
function buildClaims({ licenseId, customer, locationId, locationName, planId, issued, expires, maxDevices }) {
  const p = plan(planId);
  return {
    v: 1,
    id: licenseId,
    customer,
    loc: locationId,
    locName: locationName || '',
    plan: planId,
    features: p ? p.features : [],
    maxDevices: maxDevices || (p ? p.maxDevices : 0),
    issued,         // ISO datum
    expires,        // ISO datum
  };
}

// Kanonični JSON (urejeni ključi) za deterministični podpis.
function canonical(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (obj && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj);
}

function privateKeyFrom(b64) {
  const der = Buffer.from(b64, 'base64');
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}
function publicKeyFrom(b64) {
  const der = Buffer.from(b64, 'base64');
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function sign(claims, privB64) {
  const msg = Buffer.from(canonical(claims));
  const sig = crypto.sign(null, msg, privateKeyFrom(privB64));
  return sig.toString('base64');
}

function verify(claims, signatureB64, pubB64) {
  try {
    const msg = Buffer.from(canonical(claims));
    return crypto.verify(null, msg, publicKeyFrom(pubB64), Buffer.from(signatureB64, 'base64'));
  } catch (e) { return false; }
}

// Celoten licenčni dokument (za izvoz stranki): claims + podpis + javni ključ (za preverjanje).
function document(claims, privB64, pubB64) {
  return {
    license: claims,
    signature: sign(claims, privB64),
    publicKey: pubB64,
    note: 'VisionOne licenca. Podpisano z Ed25519. Ne spreminjaj vsebine – spremembe razveljavijo podpis.',
  };
}

function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

module.exports = {
  PLANS, FEATURE_LABELS, plan, buildClaims, canonical, sign, verify, document, generateKeypair,
};
