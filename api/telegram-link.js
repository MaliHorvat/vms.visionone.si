'use strict';
// Povezava Telegram računa.  GET -> koda za /povezi · DELETE -> odklopi
const { methods, ok } = require('../lib/http');
const db = require('../lib/db');
const crypto = require('../lib/crypto');
const { requireAuth, audit } = require('../lib/auth');

module.exports = methods({
  GET: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    const code = crypto.token(5).replace(/[-_]/g, '').slice(0, 6).toUpperCase();
    await db.run(`UPDATE users SET telegram_link_code=:c WHERE id=:id`, { c: code, id: u.id });
    const bot = process.env.TELEGRAM_BOT_USERNAME || '';
    return ok(res, { code, botUsername: bot, instructions: `V Telegramu odprite bota in pošljite:  /povezi ${code}` });
  },
  DELETE: async (req, res) => {
    const u = await requireAuth(req, res); if (!u) return;
    await db.run(`UPDATE users SET telegram_chat_id=NULL, telegram_link_code=NULL WHERE id=:id`, { id: u.id });
    await audit(req, u, 'telegram_unlink', u.username);
    return ok(res, { ok: true });
  },
});
