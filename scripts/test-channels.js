// Checks posting to Telegram channels against a fake Telegram server. Run: node scripts/test-channels.js
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sent = [];                                                    // every sendPhoto / sendMessage the server made
const tg = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks), m = req.url.replace(/^\/bot[^/]+\//, '');
    const out = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (m === 'sendPhoto' || m === 'sendMessage') {
      let f;
      if ((req.headers['content-type'] || '').startsWith('multipart')) {
        const txt = body.toString('utf8'), get = n => { const x = new RegExp(`name="${n}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(txt); return x ? x[1] : undefined; };
        f = { chat_id: get('chat_id'), caption: get('caption'), reply_markup: get('reply_markup') && JSON.parse(get('reply_markup')), uploaded: /name="photo"; filename=/.test(txt) };
      } else { const j = JSON.parse(body); f = { chat_id: j.chat_id, caption: j.caption || j.text, reply_markup: j.reply_markup }; }
      if (/bad/.test(f.chat_id)) return out({ ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat' });
      sent.push({ method: m, ...f }); return out({ ok: true, result: { message_id: sent.length } });
    }
    if (m === 'getUpdates') return setTimeout(() => out({ ok: true, result: [] }), 500);
    out({ ok: true, result: true });
  });
});
tg.listen(0, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-ch-')), PORT = 4300 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT, DATA_DIR: dir, TG_API: `http://localhost:${tg.address().port}`, BOT_TOKEN: '1:TEST', ADMIN_PASSWORD: 'pw-test-12345', WEBAPP_URL: 'https://shop.example', TG_POST_GAP_MS: '0', NODE_NO_WARNINGS: '1', BACKUP: '0' };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  let ck = '', n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok -', m); };
  const api = async (m, u, b, cookie = ck) => { const r = await fetch(`http://localhost:${PORT}${u}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'baleova', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => null), r }; };
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/healthz`); break; } catch { await sleep(200); } }
    ck = (await api('POST', '/api/admin/login', { username: 'owner', password: 'pw-test-12345' })).r.headers.get('set-cookie').split(';')[0];
    const cats = (await api('GET', '/api/admin/categories')).j;
    await api('PUT', '/api/admin/settings', { phone: '+251 911 000 000', whatsapp: '0911000000', telegram: '@baleova', address: 'Bale, Oromia' });

    // --- channel setup and validation ---
    let r = await api('POST', '/api/admin/channels', { name: 'x', chat: 'not a channel' }); ok(r.s === 400, 'invalid channel address refused');
    r = await api('POST', '/api/admin/channels', { name: 'All EN', chat: 'https://t.me/baleova_all', lang: 'en' }); ok(r.s === 201, 'channel added from a t.me link');
    r = await api('POST', '/api/admin/channels', { name: 'dup', chat: '@baleova_all' }); ok(r.s === 400, 'same channel cannot be added twice');
    r = await api('POST', '/api/admin/channels', { name: 'Women AM', chat: '@baleova_women', lang: 'am', audience: 'women' }); ok(r.s === 201, 'second channel with its own language and audience');
    r = await api('POST', '/api/admin/channels', { name: 'Men OM', chat: '-1001234567890', lang: 'om', audience: 'men' }); ok(r.s === 201, 'private channel by numeric id');
    r = await api('POST', '/api/admin/channels', { name: 'Bad', chat: '@baleova_bad', lang: 'en', active: 0 }); const badId = r.j.id; ok(r.s === 201, 'paused channel added');
    r = await api('POST', '/api/admin/channels', { name: 'Odd', chat: '@odd_chan', lang: 'fr' }); ok(r.s === 400, 'unknown language refused');
    await api('POST', '/api/admin/users', { username: 'sam', password: 'staff-pass-1', role: 'staff' });
    const staff = (await api('POST', '/api/admin/login', { username: 'sam', password: 'staff-pass-1' }, '')).r.headers.get('set-cookie').split(';')[0];
    r = await api('POST', '/api/admin/channels', { name: 'z', chat: '@zzzzzz' }, staff); ok(r.s === 403, 'staff cannot add channels');

    // --- automatic post of a new product ---
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await fetch(`http://localhost:${PORT}/api/admin/upload/products`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Requested-With': 'baleova', Cookie: ck }, body: png }).then(x => x.json());
    const base = { category_id: cats[0].id, images: [up.url], variants: [{ size: 'M', color: 'Black', stock: 7 }, { size: 'L', color: 'Black', stock: 0 }, { size: 'S', color: 'White', stock: 2 }] };
    r = await api('POST', '/api/admin/products', { ...base, code: 'CH-1', name: 'Women <Bale> Hoodie', name_am: 'የሴቶች ሁዲ', description: 'Warm & soft. '.repeat(60), price: 1500, sale_price: 1200, gender: 'women' });
    if (process.env.DBG) console.log(JSON.stringify(r.j.posted), r.s, JSON.stringify(r.j).slice(0,300));
    ok(r.s === 201 && r.j.posted.length === 2 && r.j.posted.every(x => x.ok), 'new product posted automatically to every matching active channel');
    const en = sent.find(s => s.chat_id === '@baleova_all'), am = sent.find(s => s.chat_id === '@baleova_women');
    ok(en && am && !sent.some(s => s.chat_id === '-1001234567890'), 'women product skipped the men-only channel');
    ok(en.method === 'sendPhoto' && en.uploaded, 'photo is uploaded from the server, not linked');
    ok(en.caption.includes('NEW ARRIVAL') || en.caption.includes('SPECIAL OFFER'), 'English header');
    ok(en.caption.includes('Women &lt;Bale&gt; Hoodie') && !en.caption.includes('<Bale>'), 'product name is HTML-escaped');
    ok(en.caption.includes('1,200 ETB') && en.caption.includes('<s>1,500 ETB</s>') && en.caption.includes('−20%'), 'sale price, old price and discount shown');
    ok(en.caption.includes('M · S') && en.caption.includes('Black · White') && !/L\b.*Black · White.*L/.test(en.caption), 'only sizes and colours that are in stock are listed');
    ok(!/\b7\b|\b2 left|in stock:|units|sold|★/i.test(en.caption.replace(/<[^>]+>/g, '')), 'no stock counts, sales or ratings in the post');
    ok(en.caption.length <= 1024 && am.caption.length <= 1024, 'caption stays under Telegram\'s 1,024-character limit with a very long description');
    ok(am.caption.includes('ልዩ ቅናሽ') && am.caption.includes('የሴቶች ሁዲ') && am.caption.includes('ለሴቶች'), 'Amharic channel gets Amharic labels and the Amharic product name');
    const urls = en.reply_markup.inline_keyboard.flat().map(b => b.url);
    ok(urls.some(u => u.startsWith('https://wa.me/251911000000?text=') && decodeURIComponent(u).includes('CH-1')), 'WhatsApp button has a ready order message with the code');
    ok(urls.includes('https://t.me/baleova') && urls.some(u => /^https:\/\/shop\.example\/#\/p\/\d+$/.test(u)), 'Telegram and open-in-store buttons present');
    ok(en.caption.includes('+251 911 000 000'), 'phone number shown in the post (Telegram does not allow call buttons)');

    // --- switches ---
    const before = sent.length;
    r = await api('POST', '/api/admin/products', { ...base, code: 'CH-2', name: 'Quiet item', price: 100, post_to_channels: false }); ok(r.s === 201 && r.j.posted.length === 0 && sent.length === before, 'unticking the box for a product posts nothing');
    await api('PUT', '/api/admin/settings', { tg_autopost: false });
    r = await api('POST', '/api/admin/products', { ...base, code: 'CH-3', name: 'Manual only', price: 100 }); ok(r.s === 201 && r.j.posted.length === 0 && sent.length === before, 'with automatic posting off, new products are not posted');
    const p3 = r.j.id;
    r = await api('POST', '/api/admin/products', { ...base, code: 'CH-4', name: 'Ticked anyway', price: 100, gender: 'men', post_to_channels: true }); ok(r.j.posted.some(x => x.channel === 'Men OM' && x.ok), 'ticking the box posts even when automatic posting is off');
    ok(sent.at(-1).caption.includes('አዲስ') === false && sent.at(-1).caption.includes('MEESHAA HARAA'), 'Afaan Oromoo channel gets Afaan Oromoo labels');

    // --- manual post / post again ---
    r = await api('POST', `/api/admin/products/${p3}/post`, { channel_ids: [] }); ok(r.s === 200 && r.j.posted.length === 0, 'post with no channel ticked does nothing');
    r = await api('POST', `/api/admin/products/${p3}/post`, {}); ok(r.j.posted.length === 3 && r.j.posted.every(x => x.ok) && /BACK IN STOCK/.test(sent.at(-3).caption + sent.at(-2).caption + sent.at(-1).caption), 'Post again sends to all active channels with the "back in stock" header');
    const list = (await api('GET', '/api/admin/products')).j; ok(list.find(p => p.id === p3).posted === 3 && list.find(p => p.code === 'CH-2').posted === 0, 'Products list shows how many channels each product was posted to');

    // --- problems are reported, product is still saved ---
    await api('PUT', `/api/admin/channels/${badId}`, { name: 'Bad', chat: '@baleova_bad', lang: 'en', active: 1 });
    r = await api('POST', '/api/admin/products', { ...base, code: 'CH-5', name: 'Fails somewhere', price: 100, post_to_channels: true });
    const f = r.j.posted.find(x => x.channel === 'Bad');
    ok(r.s === 201 && f && !f.ok && /administrator/i.test(f.error) && r.j.posted.some(x => x.ok), 'a channel that refuses the bot gives a plain-language error; the product and other channels are fine');
    r = await api('GET', '/api/admin/channels'); ok(/administrator/.test(r.j.channels.find(c => c.id === badId).last_error), 'last error is shown in the channel list');
    r = await api('POST', `/api/admin/channels/${badId}/test`); ok(r.j.ok === false && /administrator/.test(r.j.error), 'test post reports the problem');
    r = await api('POST', `/api/admin/channels/${(await api('GET', '/api/admin/channels')).j.channels[0].id}/test`); ok(r.j.ok === true && sent.at(-1).caption.includes('✅'), 'test post succeeds on a working channel');
    await api('DELETE', `/api/admin/channels/${badId}`);

    // --- out of stock / archived are not posted ---
    r = await api('POST', '/api/admin/products', { ...base, variants: [{ size: 'M', color: 'Red', stock: 0 }], code: 'CH-6', name: 'Sold out', price: 100, post_to_channels: true }); ok(r.s === 201 && r.j.posted[0].skipped && /out of stock/i.test(r.j.posted[0].error), 'out-of-stock products are not posted');

    // --- direct Mini App link ---
    await api('PUT', '/api/admin/settings', { bot_username: '@baleova_bot', tg_miniapp: 'store' });
    r = await api('POST', '/api/admin/products', { ...base, code: 'CH-7', name: 'App link', price: 100, post_to_channels: true });
    ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(b => new RegExp(`^https://t\\.me/baleova_bot/store\\?startapp=p_${r.j.id}$`).test(b.url)), 'open-in-store button opens the Mini App on that product');
    ok(!JSON.stringify((await api('GET', '/api/store', null, '')).j).includes('tg_autopost'), 'posting settings are not exposed on the public site');
    console.log(`\n${n} channel checks passed`);
  } catch (e) { console.error('\nFAILED:', e.message); process.exitCode = 1; }
  finally { srv.kill('SIGKILL'); tg.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0); }
});
