const crypto = require('crypto');
const { db, getSettings } = require('./db');
const { listProducts } = require('./services');
const { BOT, localizeSettings } = require('./i18n');

// Validate Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
function verifyInitData(initData, maxAgeSec = 86400) {
  const token = process.env.BOT_TOKEN;
  if (!token || !initData || typeof initData !== 'string' || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash'); if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > maxAgeSec) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

const api = (m, b) => fetch(`${(process.env.TG_API || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${process.env.BOT_TOKEN}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then(r => r.json()).catch(e => ({ ok: false, description: String(e) }));

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function availability(query, lang = 'en') {
  const B = BOT[lang];
  const q = String(query || '').trim();
  if (!q) return esc(B.stockHint);
  const found = listProducts({ q, limit: 5, lang });
  if (!found.length) return esc(B.none(q));
  return found.map(p => {
    const v = db.prepare('SELECT size, color, stock FROM variants WHERE product_id = ? AND stock > 0 ORDER BY id').all(p.id);
    const sizes = [...new Set(v.map(x => x.size))].join(', '), colors = [...new Set(v.map(x => x.color))].join(', ');
    const line = p.stock_status === 'out' ? B.out : `${B.inStock}${p.stock_status === 'low' ? ` (${B.low})` : ''} - ${B.sizes}: ${esc(sizes)}; ${B.colours}: ${esc(colors)}`;
    return `<b>${esc(p.name)}</b> (${esc(p.code)})\n${p.final_price} ETB - ${line}`;
  }).join('\n\n');
}

// Each chat remembers its language. Telegram's own language code picks the first guess (Amharic users get Amharic).
function chatLang(chatId, tgCode) {
  const row = db.prepare('SELECT lang FROM bot_users WHERE chat_id = ?').get(String(chatId));
  if (row) return row.lang;
  return /^am/i.test(tgCode || '') ? 'am' : /^om/i.test(tgCode || '') ? 'om' : 'en';
}
const setChatLang = (chatId, lang) => db.prepare('INSERT OR REPLACE INTO bot_users(chat_id, lang) VALUES(?,?)').run(String(chatId), lang);
const langKeyboard = { inline_keyboard: [[{ text: 'English', callback_data: 'lang:en' }, { text: 'Afaan Oromoo', callback_data: 'lang:om' }, { text: 'አማርኛ', callback_data: 'lang:am' }]] };

const webhookSecret = () => crypto.createHash('sha256').update('baleova-webhook:' + process.env.BOT_TOKEN).digest('hex').slice(0, 40);

async function handleUpdate(u, openBtn) {
  try {
    if (u.callback_query) {
      const cq = u.callback_query, m = /^lang:(en|om|am)$/.exec(cq.data || '');
      if (m && cq.message) { setChatLang(cq.message.chat.id, m[1]); api('answerCallbackQuery', { callback_query_id: cq.id }); api('sendMessage', { chat_id: cq.message.chat.id, text: BOT[m[1]].langSet, reply_markup: openBtn(m[1]) }); }
      return;
    }
    const m = u.message; if (!m || !m.text) return;
    const L = chatLang(m.chat.id, m.from && m.from.language_code), B = BOT[L], set = localizeSettings(getSettings(), L);
    const [cmd, ...rest] = m.text.trim().split(/\s+/); const c = cmd.split('@')[0].toLowerCase();
    let text, markup;
    if (c === '/start') { text = `<b>${esc(set.store_name)}</b>\n${esc(set.tagline)}\n\n${esc(B.welcome(set.store_name))}`; markup = openBtn(L); }
    else if (c === '/stock') text = availability(rest.join(' '), L);
    else if (c === '/language') { text = BOT.en.pickLang + '\n' + BOT.om.pickLang + '\n' + BOT.am.pickLang; markup = langKeyboard; }
    else if (c === '/contact') text = [`<b>${esc(set.store_name)}</b>`, set.phone && `${B.phone}: ${esc(set.phone)}`, set.whatsapp && `${B.wa}: +${esc(set.whatsapp)}`, set.address && `${B.loc}: ${esc(set.address)}`, set.hours && `${B.hours}: ${esc(set.hours)}`].filter(Boolean).join('\n');
    else text = esc(B.help);
    api('sendMessage', { chat_id: m.chat.id, text, parse_mode: 'HTML', reply_markup: markup });
  } catch (e) { console.error('bot error', e.message); }
}

let openBtnFn = null;
// Webhook mode (used when the site is on a public https address): Telegram calls us, so a sleeping free host wakes up for each message.
// Polling mode (local testing on http://localhost): we ask Telegram for messages.
const useWebhook = () => /^https:\/\//i.test(process.env.WEBAPP_URL || '') && process.env.TG_MODE !== 'polling';

function webhookHandler(req, res) {
  if (!process.env.BOT_TOKEN || req.get('x-telegram-bot-api-secret-token') !== webhookSecret()) return res.status(403).json({ ok: false });
  res.json({ ok: true });                       // answer fast; Telegram retries slow replies
  if (req.body && openBtnFn) handleUpdate(req.body, openBtnFn);
}

async function startBot() {
  if (!process.env.BOT_TOKEN || !process.env.WEBAPP_URL) return console.log('  Telegram bot: off (set BOT_TOKEN and WEBAPP_URL to enable)');
  const url = process.env.WEBAPP_URL.replace(/\/+$/, '');
  openBtnFn = L => ({ inline_keyboard: [[{ text: BOT[L].open, web_app: { url } }]] });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Store', web_app: { url } } });
  await api('setMyCommands', { commands: [{ command: 'start', description: 'Open the BALEOVA store' }, { command: 'stock', description: 'Check availability of a product' }, { command: 'contact', description: 'Phone, WhatsApp and location' }, { command: 'language', description: 'English / Afaan Oromoo / አማርኛ' }, { command: 'help', description: 'How ordering works' }] });
  if (useWebhook()) {
    const r = await api('setWebhook', { url: `${url}/api/tg/webhook`, secret_token: webhookSecret(), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
    return console.log(r.ok ? '  Telegram bot: running (webhook)' : `  Telegram bot: could not set webhook - ${r.description}`);
  }
  await api('deleteWebhook', {});
  console.log('  Telegram bot: running (polling)');
  let offset = 0;
  for (;;) {
    const r = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    if (!r.ok) { if (r.error_code === 409) console.log('  Telegram bot: another copy is already polling this token.'); await new Promise(x => setTimeout(x, 5000)); continue; }
    for (const u of (Array.isArray(r.result) ? r.result : [])) { offset = u.update_id + 1; await handleUpdate(u, openBtnFn); }
  }
}
module.exports = { verifyInitData, startBot, availability, webhookHandler, tgApi: api };
