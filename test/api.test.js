'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { mockDb, call } = require('./harness');
const cryptoLib = require('../lib/crypto');

process.env.SESSION_SECRET = 'test-secret-session';
process.env.SETUP_TOKEN = 'setup-xyz';
process.env.OFFLINE_AFTER_SECONDS = '180';

test('login: manjkajoči podatki -> 400', async () => {
  mockDb();
  const h = require('../api/auth/login');
  const res = await call(h, { method: 'POST', body: {} });
  assert.strictEqual(res.statusCode, 400);
});

test('login: napačno geslo -> 401 in enak odgovor', async () => {
  mockDb({ one: async () => ({ id: 1, username: 'admin', active: 1, password_hash: cryptoLib.hashPassword('pravo-geslo'), role: 'admin' }) });
  const h = require('../api/auth/login');
  const res = await call(h, { method: 'POST', body: { username: 'admin', password: 'napacno' } });
  assert.strictEqual(res.statusCode, 401);
});

test('login: pravilno geslo z 2FA -> need2fa', async () => {
  mockDb({ one: async () => ({ id: 1, username: 'admin', active: 1, password_hash: cryptoLib.hashPassword('geslo12345'), role: 'admin', totp_enabled: 1, totp_secret: 'JBSWY3DPEHPK3PXP' }) });
  const h = require('../api/auth/login');
  const res = await call(h, { method: 'POST', body: { username: 'admin', password: 'geslo12345' } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.need2fa, true);
});

test('login: GET ni dovoljen -> 405', async () => {
  mockDb();
  const res = await call(require('../api/auth/login'), { method: 'GET' });
  assert.strictEqual(res.statusCode, 405);
});

test('setup: napačen token -> 403', async () => {
  mockDb();
  const res = await call(require('../api/setup'), { method: 'POST', body: { token: 'ni-pravi' } });
  assert.strictEqual(res.statusCode, 403);
});

test('agent/report brez žetona -> 401', async () => {
  mockDb({ one: async () => null });
  const res = await call(require('../api/agent/report'), { method: 'POST', body: {} });
  assert.strictEqual(res.statusCode, 401);
});

test('agent/report z veljavnim žetonom -> obdela rezultate', async () => {
  const token = 'vo_1_abc'; const hash = cryptoLib.sha256(token);
  let metricInserted = false, statusUpdated = false;
  mockDb({
    one: async (sql, p) => {
      if (/FROM locations WHERE agent_token_hash/.test(sql)) return { id: 1, name: 'Test', license_id: null };
      if (/FROM devices WHERE id/.test(sql)) return { id: 5, status: 'online', settings: null };
      return null;
    },
    run: async (sql) => { if (/INSERT INTO metrics/.test(sql)) metricInserted = true; if (/UPDATE devices SET status/.test(sql)) statusUpdated = true; return { affectedRows: 1 }; },
  });
  const res = await call(require('../api/agent/report'), {
    method: 'POST', headers: { authorization: 'Bearer ' + token },
    body: { version: '1.0.0', results: [{ device_id: 5, up: true, latency_ms: 12 }] },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.processed, 1);
  assert.ok(metricInserted && statusUpdated);
});

test('customers: brez prijave -> 401', async () => {
  mockDb({ one: async () => null }); // session.current vrne null
  const res = await call(require('../api/customers'), { method: 'GET' });
  assert.strictEqual(res.statusCode, 401);
});

test('customers: stranka (customer) ne more ustvariti -> 403', async () => {
  mockDb({ one: async (sql) => /FROM sessions s JOIN users/.test(sql) ? { id: 9, username: 'stranka', role: 'customer', customer_id: 3, active: 1 } : null });
  const res = await call(require('../api/customers'), { method: 'POST', headers: { cookie: 'vo_sess=x' }, body: { name: 'X' } });
  assert.strictEqual(res.statusCode, 403);
});

test('licenses: izdaja zahteva admina -> 403 za tehnika', async () => {
  mockDb({ one: async (sql) => /FROM sessions s JOIN users/.test(sql) ? { id: 2, username: 'teh', role: 'tech', customer_id: null, active: 1 } : null });
  const res = await call(require('../api/licenses'), { method: 'POST', headers: { cookie: 'vo_sess=x' }, body: {} });
  assert.strictEqual(res.statusCode, 403);
});

test('commands: nedovoljeno dejanje -> 400', async () => {
  mockDb({ one: async (sql) => {
    if (/FROM sessions s JOIN users/.test(sql)) return { id: 1, role: 'admin', customer_id: null, active: 1, username: 'a' };
    if (/FROM locations WHERE id/.test(sql)) return { id: 1, customer_id: 1 };
    return null;
  } });
  const res = await call(require('../api/commands'), { method: 'POST', headers: { cookie: 'vo_sess=x' }, body: { location_id: 1, action: 'rm -rf' } });
  assert.strictEqual(res.statusCode, 400);
});
