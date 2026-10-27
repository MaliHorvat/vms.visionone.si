'use strict';
// Agent sporoči izid ukaza.  POST (Bearer) { id, status:'done'|'error', result }
const { methods, readBody, ok, bad } = require('../../lib/http');
const db = require('../../lib/db');
const agentauth = require('../../lib/agentauth');

module.exports = methods({
  POST: async (req, res) => {
    const loc = await agentauth.location(req);
    if (!loc) return bad(res, 'Neveljaven žeton agenta', 401);
    const b = await readBody(req);
    const id = +b.id;
    const status = b.status === 'done' ? 'done' : 'error';
    const cmd = await db.one(`SELECT id FROM commands WHERE id=:id AND location_id=:l`, { id, l: loc.id });
    if (!cmd) return bad(res, 'Ukaz ne obstaja', 404);
    await db.run(`UPDATE commands SET status=:s, result=:r, done_at=NOW() WHERE id=:id`,
      { s: status, r: b.result ? JSON.stringify(b.result).slice(0, 4000) : null, id });
    return ok(res, { ok: true });
  },
});
