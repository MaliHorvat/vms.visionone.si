'use strict';
// Varovalni pregled (dnevni Vercel cron na Hobby; lahko ga pogosteje kliče zunanji
// razporejevalnik z Authorization: Bearer <CRON_SECRET>). Glavno zaznavanje izpadov
// se dogaja sproti ob agentovih poročilih (lib/reconcile).
const { methods, ok, bad } = require('../../lib/http');
const reconcile = require('../../lib/reconcile');

function cronAllowed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // interni Vercel cron
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

async function handle(req, res) {
  if (!cronAllowed(req)) return bad(res, 'Ni dovoljeno', 401);
  const r = await reconcile.sweepAgents();
  return ok(res, { ok: true, ...r });
}

module.exports = methods({ GET: handle, POST: handle });
