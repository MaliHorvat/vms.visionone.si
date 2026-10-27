'use strict';
// Dnevni cron: opomniki o poteku licenc (30, 14, 7, 1 dan prej) prek Telegrama osebju in stranki.
const { methods, ok, bad } = require('../../lib/http');
const db = require('../../lib/db');
const notify = require('../../lib/notify');
const tg = require('../../lib/telegram');

function cronAllowed(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers['authorization'] || '') === `Bearer ${secret}`;
}

async function handle(req, res) {
  if (!cronAllowed(req)) return bad(res, 'Ni dovoljeno', 401);
  const windows = [30, 14, 7, 1];
  let sent = 0;
  const rows = await db.q(
    `SELECT l.*, c.name AS customer_name,
        DATEDIFF(l.expires_at, NOW()) AS days
     FROM licenses l JOIN customers c ON c.id=l.customer_id
     WHERE l.revoked=0 AND l.expires_at > NOW()
       AND DATEDIFF(l.expires_at, NOW()) IN (${windows.join(',')})`);
  for (const r of rows) {
    const key = `lic_reminder:${r.id}:${r.days}`;
    const already = await db.one(`SELECT k FROM settings WHERE k=:k`, { k: key });
    if (already) continue;
    const chats = await notify.recipients(r.customer_id);
    const msg = `⏳ <b>Licenca poteče čez ${r.days} dni</b>\n${tg.esc(r.customer_name)}\nPaket: ${tg.esc(r.plan)} · ID: ${tg.esc(r.id)}\nDatum poteka: ${new Date(r.expires_at).toLocaleDateString('sl-SI')}`;
    await notify.send(chats, msg);
    await db.run(`INSERT INTO settings (k, v) VALUES (:k,'1') ON DUPLICATE KEY UPDATE v='1'`, { k: key });
    sent++;
  }
  return ok(res, { candidates: rows.length, reminded: sent });
}

module.exports = methods({ GET: handle, POST: handle });
