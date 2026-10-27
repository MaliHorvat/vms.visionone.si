'use strict';
// Telegram bot: pošiljanje sporočil in gradnja odgovorov. Samo Node stdlib (https).
const https = require('https');

function api(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Promise.resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN ni nastavljen' });
  const data = Buffer.from(JSON.stringify(body));
  const opts = {
    method: 'POST', host: 'api.telegram.org', path: `/bot${token}/${method}`,
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    timeout: 10000,
  };
  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve({ ok: false, error: 'napačen odgovor' }); } });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'časovna omejitev' }); });
    req.end(data);
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]));

function sendMessage(chatId, text, extra = {}) {
  return api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

// Gumbi (inline keyboard)
const buttons = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const answerCallback = (id, text) => api('answerCallbackQuery', { callback_query_id: id, text: text || '' });

module.exports = { api, sendMessage, esc, buttons, answerCallback };
