'use strict';
// Overjanje agenta prek žetona lokacije (Authorization: Bearer <token>).
const db = require('./db');
const crypto = require('./crypto');
const { clientIp } = require('./http');

async function location(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const hash = crypto.sha256(m[1].trim());
  const loc = await db.one(`SELECT * FROM locations WHERE agent_token_hash=:h`, { h: hash });
  return loc || null;
}

async function touch(loc, { version, ip } = {}) {
  await db.run(
    `UPDATE locations SET agent_last_seen=NOW(), status='online',
        agent_version=COALESCE(:v, agent_version), agent_ip=COALESCE(:ip, agent_ip)
     WHERE id=:id`,
    { v: version || null, ip: ip || null, id: loc.id });
}

module.exports = { location, touch };
