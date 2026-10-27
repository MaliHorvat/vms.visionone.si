'use strict';
const { methods, ok } = require('../../lib/http');
const session = require('../../lib/session');
const { publicUser } = require('../../lib/auth');
const db = require('../../lib/db');

module.exports = methods({
  GET: async (req, res) => {
    const u = await session.current(req);
    if (!u) return ok(res, { user: null });
    let customer = null;
    if (u.customer_id) customer = await db.one(`SELECT id, name FROM customers WHERE id=:id`, { id: u.customer_id });
    return ok(res, { user: publicUser(u), customer });
  },
});
