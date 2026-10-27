'use strict';
// Telegram webhook: povezava računa, poizvedbe in daljinski ukazi.
// Nastavi webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://vms.visionone.si/api/telegram&secret_token=<WEBHOOK_SECRET>
const { methods, readBody, ok } = require('../lib/http');
const db = require('../lib/db');
const tg = require('../lib/telegram');

const isStaff = (u) => u.role === 'admin' || u.role === 'tech';

module.exports = methods({
  POST: async (req, res) => {
    // Zaščita: Telegram pošlje naš skrivni žeton v glavi.
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return ok(res, { ok: true });

    const upd = await readBody(req);
    try {
      if (upd.callback_query) await onCallback(upd.callback_query);
      else if (upd.message && upd.message.text) await onMessage(upd.message);
    } catch (e) { console.error('[telegram]', e.message); }
    return ok(res, { ok: true }); // vedno 200, da Telegram ne ponavlja
  },
});

async function userByChat(chatId) {
  return db.one(`SELECT * FROM users WHERE telegram_chat_id=:c AND active=1`, { c: String(chatId) });
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);

  if (cmd === '/start') {
    return tg.sendMessage(chatId, 'Pozdravljeni v <b>VisionOne</b>.\nRačun povežete z ukazom:\n<code>/povezi KODA</code>\n(kodo dobite v portalu → Moj račun → Telegram).');
  }
  if (cmd === '/povezi') {
    const code = (args[0] || '').toUpperCase();
    if (!code) return tg.sendMessage(chatId, 'Uporaba: <code>/povezi KODA</code>');
    const u = await db.one(`SELECT * FROM users WHERE telegram_link_code=:c`, { c: code });
    if (!u) return tg.sendMessage(chatId, '❌ Napačna ali potekla koda. Ustvarite novo v portalu.');
    await db.run(`UPDATE users SET telegram_chat_id=:chat, telegram_link_code=NULL WHERE id=:id`, { chat: String(chatId), id: u.id });
    return tg.sendMessage(chatId, `✅ Povezano z računom <b>${tg.esc(u.username)}</b>.\nUkazi: /status /lokacije /izpadi /odpri`);
  }

  const u = await userByChat(chatId);
  if (!u) return tg.sendMessage(chatId, 'Račun ni povezan. Pošljite <code>/povezi KODA</code> (kodo dobite v portalu).');

  if (cmd === '/status') return sendStatus(chatId, u);
  if (cmd === '/lokacije') return sendLocations(chatId, u);
  if (cmd === '/izpadi') return sendIncidents(chatId, u);
  if (cmd === '/odpri') return sendDoorButtons(chatId, u);
  return tg.sendMessage(chatId, 'Ukazi: /status /lokacije /izpadi /odpri');
}

function scopeSQL(u, alias = 'l') {
  return isStaff(u) ? { sql: '1=1', p: {} } : { sql: `${alias}.customer_id=:cid`, p: { cid: u.customer_id } };
}

async function sendStatus(chatId, u) {
  const s = scopeSQL(u);
  const loc = await db.one(`SELECT COUNT(*) t, SUM(status='online') o, SUM(status='offline') f FROM locations l WHERE ${s.sql}`, s.p);
  const dev = await db.one(`SELECT COUNT(*) t, SUM(d.status='offline') f FROM devices d JOIN locations l ON l.id=d.location_id WHERE ${s.sql}`, s.p);
  const inc = await db.one(`SELECT COUNT(*) n FROM incidents i JOIN locations l ON l.id=i.location_id WHERE i.resolved_at IS NULL AND ${s.sql}`, s.p);
  await tg.sendMessage(chatId,
    `📊 <b>Stanje</b>\nLokacije: ${loc.o || 0}/${loc.t || 0} online\nNaprave: ${(dev.t || 0) - (dev.f || 0)}/${dev.t || 0} online${dev.f ? ` (${dev.f} v izpadu)` : ''}\nOdprti izpadi: ${inc.n || 0}`);
}

async function sendLocations(chatId, u) {
  const s = scopeSQL(u);
  const rows = await db.q(`SELECT l.name, l.status, c.name cust FROM locations l JOIN customers c ON c.id=l.customer_id WHERE ${s.sql} ORDER BY c.name, l.name LIMIT 40`, s.p);
  if (!rows.length) return tg.sendMessage(chatId, 'Ni lokacij.');
  const line = (r) => `${r.status === 'online' ? '🟢' : r.status === 'offline' ? '🔴' : '⚪'} ${tg.esc(r.cust)} – ${tg.esc(r.name)}`;
  await tg.sendMessage(chatId, '<b>Lokacije</b>\n' + rows.map(line).join('\n'));
}

async function sendIncidents(chatId, u) {
  const s = scopeSQL(u);
  const rows = await db.q(
    `SELECT i.*, l.name loc, c.name cust, d.name dev FROM incidents i
     JOIN locations l ON l.id=i.location_id JOIN customers c ON c.id=l.customer_id
     LEFT JOIN devices d ON d.id=i.device_id
     WHERE i.resolved_at IS NULL AND ${s.sql} ORDER BY i.started_at DESC LIMIT 20`, s.p);
  if (!rows.length) return tg.sendMessage(chatId, '✅ Ni odprtih izpadov.');
  const line = (i) => `🔴 ${tg.esc(i.cust)}/${tg.esc(i.loc)} – ${i.dev ? tg.esc(i.dev) : 'agent'}`;
  await tg.sendMessage(chatId, '<b>Odprti izpadi</b>\n' + rows.map(line).join('\n'));
}

async function sendDoorButtons(chatId, u) {
  const s = scopeSQL(u);
  const rows = await db.q(
    `SELECT d.id, d.name, d.kind, d.settings, l.name loc FROM devices d JOIN locations l ON l.id=d.location_id
     WHERE ${s.sql} AND (d.kind='domofon' OR JSON_EXTRACT(d.settings,'$.actions') IS NOT NULL) ORDER BY l.name, d.name LIMIT 20`, s.p);
  if (!rows.length) return tg.sendMessage(chatId, 'Ni naprav z daljinskimi dejanji (domofon/rele).');
  const kb = rows.map(r => [{ text: `🔓 ${r.loc} – ${r.name}`, callback_data: `door:${r.id}` }]);
  await tg.sendMessage(chatId, 'Izberite napravo za <b>odpiranje</b>:', tg.buttons(kb));
}

async function onCallback(cb) {
  const chatId = cb.message.chat.id;
  const u = await userByChat(chatId);
  if (!u) return tg.answerCallback(cb.id, 'Račun ni povezan.');
  const [kind, idStr] = String(cb.data || '').split(':');
  if (kind !== 'door') return tg.answerCallback(cb.id, '');
  const deviceId = +idStr;
  const dev = await db.one(
    `SELECT d.*, l.customer_id FROM devices d JOIN locations l ON l.id=d.location_id WHERE d.id=:id`, { id: deviceId });
  if (!dev) return tg.answerCallback(cb.id, 'Naprava ne obstaja.');
  if (!isStaff(u) && Number(dev.customer_id) !== Number(u.customer_id)) return tg.answerCallback(cb.id, 'Nimate dostopa.');

  await db.run(
    `INSERT INTO commands (location_id, device_id, action, params, created_by) VALUES (:l,:d,'open_door',NULL,:by)`,
    { l: dev.location_id, d: deviceId, by: `tg:${u.username}` });
  await db.run(
    `INSERT INTO audit (user_id, username, role, ip, action, target, detail)
     VALUES (:uid,:un,:role,'telegram','command_queue',:t,:det)`,
    { uid: u.id, un: u.username, role: u.role, t: `${dev.location_id}/open_door`, det: JSON.stringify({ device: deviceId, via: 'telegram' }) });
  await tg.answerCallback(cb.id, 'Ukaz poslan ✅');
  await tg.sendMessage(chatId, `🔓 Ukaz za <b>${tg.esc(dev.name)}</b> poslan agentu.`);
}
