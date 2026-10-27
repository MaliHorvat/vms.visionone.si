'use strict';
// Testni pripomočki: lažni req/res in lažna baza (monkeypatch lib/db).
const { EventEmitter } = require('events');

function fakeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method; req.url = url;
  req.headers = Object.assign({ host: 'vms.visionone.si' }, headers);
  req.socket = { remoteAddress: '203.0.113.5' };
  if (body !== undefined) req.body = body;
  return req;
}

function fakeRes() {
  const res = {};
  res.statusCode = 200; res.headersSent = false;
  res._headers = {}; res._chunks = [];
  res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res._headers[k.toLowerCase()];
  res.end = (d) => { res.headersSent = true; if (d) res._chunks.push(d); res._done = true; };
  Object.defineProperty(res, 'json', { get() { try { return JSON.parse(res._chunks.join('')); } catch (e) { return null; } } });
  return res;
}

// Zamenjaj metode lib/db z nadzorovanimi odgovori.
function mockDb(impl = {}) {
  const db = require('../lib/db');
  const noop = async () => null;
  db.one = impl.one || noop;
  db.q = impl.q || (async () => []);
  db.run = impl.run || (async () => ({ insertId: 1, affectedRows: 1 }));
  db.tx = impl.tx || (async (fn) => fn({}));
  db.getPool = impl.getPool || (() => ({ query: async () => [[]], execute: async () => [[]] }));
  return db;
}

async function call(handler, reqOpts) {
  const req = fakeReq(reqOpts); const res = fakeRes();
  await handler(req, res);
  return res;
}

module.exports = { fakeReq, fakeRes, mockDb, call };
