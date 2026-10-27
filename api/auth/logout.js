'use strict';
const { methods, ok } = require('../../lib/http');
const session = require('../../lib/session');

module.exports = methods({
  POST: async (req, res) => { await session.destroy(req, res); return ok(res, { ok: true }); },
});
