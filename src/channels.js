// Posts products to the shop's Telegram channels / groups (one bot, any number of channels, each with its own language).
// Never posts stock counts, ratings or sales figures - only what the shop typed in plus which sizes/colours are available.
const fs = require('fs'), path = require('path');
const { db, getSettings, DATA_DIR } = require('./db');
const S = require('./services');
const { POST, pickLang } = require('./i18n');
const { bad } = require('./util');

const API = () => (process.env.TG_API || 'https://api.telegram.org').replace(/\/+$/, '');
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const etb = n => `${Number(n || 0).toLocaleString('en-US')} ETB`;
const botOn = () => !!process.env.BOT_TOKEN;
const CAPTION_MAX = 1024;

// ---- channel address: "@name", "t.me/name" or a numeric id such as -1001234567890 ----
function normChat(v) {
  let s = String(v ?? '').trim().replace(/^(https?:\/\/)?(t|telegram)\.me\//i, '');
  if (/^-?\d{5,20}$/.test(s)) return s;
  s = s.replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s)) throw bad('Channel must be @username (public channel) or a number like -1001234567890 (private channel or group)');
  return '@' + s;
}

// ---- turn Telegram's error text into something a shop owner can act on ----
function friendly(desc) {
  const d = String(desc || '');
  if (/chat not found/i.test(d)) return 'Channel not found. Check the @name or number, and make sure the bot was added to it.';
  if (/not enough rights|need administrator|CHAT_ADMIN_REQUIRED|have no rights|not a member|was kicked|bot is not a member|forbidden/i.test(d)) return 'The bot is not allowed to post there. Add it to the channel as an administrator with permission to post messages.';
  if (/unauthorized|401/i.test(d)) return 'The bot token was refused by Telegram. Check BOT_TOKEN.';
  if (/wrong file|failed to get http url content|image_process_failed|wrong type of the web page content/i.test(d)) return 'Telegram could not read the product photo.';
  if (/BUTTON_URL_INVALID/i.test(d)) return 'Telegram refused a button link. Check the WhatsApp number and Telegram username in Settings.';
  return d || 'Telegram did not accept the post.';
}

// One call to Telegram. Retries once when Telegram says "slow down".
async function tg(method, body, { form = false, tries = 2 } = {}) {
  for (let i = 0; i < tries; i++) {
    let r;
    try {
      r = await fetch(`${API()}/bot${process.env.BOT_TOKEN}/${method}`, {
        method: 'POST', headers: form ? undefined : { 'Content-Type': 'application/json' }, body: form ? body : JSON.stringify(body), signal: AbortSignal.timeout(25000),
      }).then(x => x.json());
    } catch (e) { return { ok: false, description: 'Could not reach Telegram (' + (e.name === 'TimeoutError' ? 'timed out' : e.message) + ')' }; }
    if (r.ok || r.error_code !== 429 || i === tries - 1) return r;
    await wait(Math.min(((r.parameters && r.parameters.retry_after) || 3) + 0.5, 30) * 1000);
  }
}

// Posts go out one at a time with a gap, so many channels or many products never trip Telegram's limits (about 20 messages a minute per channel).
let chain = Promise.resolve(), lastSend = 0;
const GAP = () => (process.env.TG_POST_GAP_MS != null ? +process.env.TG_POST_GAP_MS : 1200);
function queued(fn) {
  const run = async () => { const d = lastSend + GAP() - Date.now(); if (d > 0) await wait(d); try { return await fn(); } finally { lastSend = Date.now(); } };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}

// ---- link that opens the product ----
function storeLink(id, set) {
  const bot = String(set.bot_username || '').trim(), app = String(set.tg_miniapp || '').trim();
  if (bot && app) return `https://t.me/${bot}/${app}?startapp=p_${id}`;               // opens inside Telegram as a Mini App
  const web = String(process.env.WEBAPP_URL || '').replace(/\/+$/, '');
  return /^https:\/\//i.test(web) ? `${web}/#/p/${id}` : '';                          // plain website link (Telegram buttons need https)
}

// ---- the post ----
function buildCaption(p, lang, set, kind) {
  const T = POST[lang], dot = ' · ';
  const head = kind === 'again' ? `🔁 <b>${esc(T.again)}</b>` : (p.sale_price != null || p.is_offer) ? `🔥 <b>${esc(T.offer)}</b>` : `🆕 <b>${esc(T.fresh)}</b>`;
  const price = p.sale_price != null
    ? `💰 <b>${esc(etb(p.final_price))}</b>  <s>${esc(etb(p.price))}</s>  (−${p.discount_percent}%)`
    : `💰 <b>${esc(etb(p.final_price))}</b>`;
  const who = p.gender === 'men' ? T.men : p.gender === 'women' ? T.women : T.unisex;
  const lines = [head, '', `<b>${esc(p.name)}</b>`, `${esc(T.code)}: <code>${esc(p.code)}</code>${p.category_name ? dot + esc(p.category_name) : ''}`, '', price, ''];
  const list = a => a.slice(0, 14).join(dot) + (a.length > 14 ? ' …' : '');
  if (p.sizes.length) lines.push(`📏 ${esc(T.sizes)}: ${esc(list(p.sizes))}`);
  if (p.colors.length) lines.push(`🎨 ${esc(T.colours)}: ${esc(list(p.colors))}`);
  lines.push(`🏷 ${esc(p.condition === 'bonda' ? T.bonda : T.brandNew)}${dot}${esc(who)}`);
  const foot = ['', `🚚 ${esc(T.delivery)}`];
  if (set.phone) foot.push(`📞 ${esc(set.phone)}`);
  if (set.address) foot.push(`📍 ${esc(set.address)}`);
  foot.push('', `<i>${esc(T.contactHint)}</i>`);
  // The description gets whatever room is left under Telegram's 1,024-character caption limit.
  const fixed = [...lines, ...foot].join('\n').length + 4;
  let desc = String(p.description || '').replace(/\s+/g, ' ').trim();
  const room = Math.min(260, CAPTION_MAX - fixed - 40);
  if (desc && room > 40) { if (desc.length > room) desc = desc.slice(0, room - 1).replace(/\s+\S*$/, '') + '…'; lines.push('', esc(desc)); }
  let out = [...lines, ...foot].join('\n');
  // Last resort (e.g. dozens of sizes): keep only the essentials, cut on whole lines so no formatting tag is ever split.
  if (out.length > CAPTION_MAX) out = [head, '', `<b>${esc(p.name)}</b>`, `${esc(T.code)}: <code>${esc(p.code)}</code>`, '', price].join('\n');
  return out;
}

function buildButtons(p, lang, set) {
  const T = POST[lang], rows = [];
  const msg = `${T.waHello(set.store_name)}\n${p.name} (${p.code})\n${T.waPrice}: ${etb(p.final_price)}\n${T.waAvail}`;
  if (set.whatsapp) rows.push([{ text: '🛒 ' + T.order, url: `https://wa.me/${set.whatsapp}?text=${encodeURIComponent(msg)}` }]);
  const second = [];
  if (set.telegram) second.push({ text: '✈️ ' + T.telegram, url: `https://t.me/${set.telegram}` });
  const link = storeLink(p.id, set);
  if (link) second.push({ text: '🛍 ' + T.store, url: link });
  if (second.length) rows.push(second);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

// Photo: files we stored are uploaded directly (works even if the site is not public yet); outside links are passed by address.
function photoPart(url) {
  if (/^https:\/\//i.test(url)) return { remote: url };
  const root = path.resolve(DATA_DIR, 'uploads'), file = path.resolve(DATA_DIR, '.' + url);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return null;
  return { file, name: path.basename(file) };
}

async function sendOne(chat, p, lang, set, kind) {
  const caption = buildCaption(p, lang, set, kind), markup = buildButtons(p, lang, set);
  const first = p.images[0] && photoPart(p.images[0].url);
  if (first && first.file) {
    const fd = new FormData();
    fd.append('chat_id', chat); fd.append('caption', caption); fd.append('parse_mode', 'HTML');
    if (markup) fd.append('reply_markup', JSON.stringify(markup));
    fd.append('photo', new Blob([fs.readFileSync(first.file)]), first.name);
    return tg('sendPhoto', fd, { form: true });
  }
  if (first && first.remote) return tg('sendPhoto', { chat_id: chat, photo: first.remote, caption, parse_mode: 'HTML', reply_markup: markup });
  return tg('sendMessage', { chat_id: chat, text: caption, parse_mode: 'HTML', reply_markup: markup, link_preview_options: { is_disabled: true } });
}

const inAudience = (ch, gender) => ch.audience === 'all' || gender === 'unisex' || gender === ch.audience;

// Post one product to every active channel (or just the chosen ones). Returns one result per channel; never throws.
async function postProduct(productId, { channelIds, kind = 'new', explicit = false } = {}) {
  if (!db.prepare('SELECT 1 FROM channels WHERE active = 1').get())
    return explicit ? [{ ok: false, skipped: true, channel: '', error: 'No Telegram channel is set up. Add one in Settings > Telegram channels.' }] : [];
  if (!botOn()) return [{ ok: false, skipped: true, channel: '', error: 'The Telegram bot is not set up on this server (BOT_TOKEN is empty).' }];
  const p = S.getProduct(productId, { admin: true });
  if (!p) return [{ ok: false, channel: '', error: 'Product not found.' }];
  if (p.status !== 'active') return [{ ok: false, skipped: true, channel: '', error: 'Archived products are not posted.' }];
  if (p.stock_status === 'out') return [{ ok: false, skipped: true, channel: '', error: 'This product is out of stock, so it was not posted.' }];
  let chans = db.prepare('SELECT * FROM channels WHERE active = 1 ORDER BY id').all();
  if (Array.isArray(channelIds)) chans = chans.filter(c => channelIds.map(Number).includes(c.id));
  const set = getSettings(), out = [];
  for (const ch of chans) {
    if (!inAudience(ch, p.gender)) continue;   // e.g. a women's item and a men-only channel: expected, not a problem worth reporting
    const lang = pickLang(ch.lang), loc = S.getProduct(productId, { lang });
    const r = await queued(() => sendOne(ch.chat, loc, lang, set, kind));
    const ok = !!r.ok, error = ok ? '' : friendly(r.description);
    db.prepare('INSERT INTO channel_posts(channel_id,product_id,message_id,ok,error) VALUES(?,?,?,?,?)').run(ch.id, productId, ok ? r.result.message_id : null, ok ? 1 : 0, error);
    out.push({ ok, channel: ch.name, error });
  }
  return out;
}

// Short message to prove the bot can post in a channel.
async function sendTest(channelId) {
  if (!botOn()) return { ok: false, error: 'The Telegram bot is not set up on this server (BOT_TOKEN is empty).' };
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!ch) return { ok: false, error: 'Channel not found.' };
  const lang = pickLang(ch.lang), set = getSettings();
  const r = await queued(() => tg('sendMessage', { chat_id: ch.chat, text: `✅ ${esc(POST[lang].testOk(set.store_name))}`, parse_mode: 'HTML' }));
  return r.ok ? { ok: true } : { ok: false, error: friendly(r.description) };
}

// How many channels each product has been posted to (for the Products list).
const postedCounts = () => Object.fromEntries(db.prepare('SELECT product_id, COUNT(*) n FROM channel_posts WHERE ok = 1 GROUP BY product_id').all().map(r => [r.product_id, r.n]));

module.exports = { normChat, postProduct, sendTest, postedCounts, buildCaption, buildButtons, botOn };
