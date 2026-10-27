#!/usr/bin/env node
'use strict';
// Generira skrivnosti za .env: SESSION_SECRET, licenčni par Ed25519, DEVICE_SECRET_KEY, SETUP_TOKEN, webhook secret.
const crypto = require('crypto');
const license = require('../lib/license');

const kp = license.generateKeypair();
console.log('# --- Prilepi v Vercel okoljske spremenljivke (ali .env) ---');
console.log('SESSION_SECRET=' + crypto.randomBytes(32).toString('base64url'));
console.log('SETUP_TOKEN=' + crypto.randomBytes(18).toString('base64url'));
console.log('TELEGRAM_WEBHOOK_SECRET=' + crypto.randomBytes(18).toString('base64url'));
console.log('DEVICE_SECRET_KEY=' + crypto.randomBytes(32).toString('base64'));
console.log('LICENSE_PRIVATE_KEY=' + kp.privateKey);
console.log('LICENSE_PUBLIC_KEY=' + kp.publicKey);
console.log('');
console.log('# Javni ključ shrani tudi v agent/pubkey.txt (za preverjanje licenc v agentu):');
console.log(kp.publicKey);
