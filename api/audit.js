'use strict';
// Revizijski dnevnik – samo osebje.  GET [?limit][?action][?user]
const { methods, query, ok } = require('../lib/http');
const db = require('../lib/db');
const { requireRole } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireRole(req, res, ['admin', 'tech']); if (!u) return;
    const qp = query(req);
    let where = '1=1', params = {};
    if (qp.action) { where += ' AND action=:a'; params.a = qp.action; }
    if (qp.user) { where += ' AND username=:un'; params.un = qp.user; }
    const limit = Math.min(1000, Math.max(1, +qp.limit || 200));
    const rows = await db.q(`SELECT * FROM audit WHERE ${where} ORDER BY ts DESC LIMIT ${limit}`, params);
    return ok(res, { audit: rows });
  },
});
