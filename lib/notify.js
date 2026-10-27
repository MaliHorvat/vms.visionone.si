'use strict';
// Obveščanje o incidentih prek Telegrama (osebje + stranka lokacije).
const db = require('./db');
const tg = require('./telegram');

// Prejemniki: vse osebje z vezanim Telegramom + stranke te stranke z vezanim Telegramom.
async function recipients(customerId) {
  const rows = await db.q(
    `SELECT telegram_chat_id FROM users
     WHERE telegram_chat_id IS NOT NULL AND active=1
       AND (role IN ('admin','tech') OR (role='customer' AND customer_id=:cid))`,
    { cid: customerId });
  return rows.map(r => r.telegram_chat_id).filter(Boolean);
}

function fmtOpen(i) {
  const icon = i.severity === 'crit' ? '🔴' : i.severity === 'warn' ? '🟠' : '🔵';
  const what = i.device_name ? `naprava <b>${tg.esc(i.device_name)}</b>` : `agent lokacije`;
  return `${icon} <b>IZPAD</b>\n${tg.esc(i.customer_name)} · ${tg.esc(i.location_name)}\n${what} ne odgovarja.\n<i>${tg.esc(i.message || '')}</i>`;
}
function fmtResolved(i, mins) {
  const what = i.device_name ? `Naprava <b>${tg.esc(i.device_name)}</b>` : `Agent lokacije`;
  return `🟢 <b>POVRNJENO</b>\n${tg.esc(i.customer_name)} · ${tg.esc(i.location_name)}\n${what} spet deluje.${mins != null ? `\nTrajanje izpada: ${mins} min.` : ''}`;
}

async function send(chatIds, text) {
  for (const id of chatIds) { try { await tg.sendMessage(id, text); } catch (e) {} }
}

module.exports = { recipients, fmtOpen, fmtResolved, send };
