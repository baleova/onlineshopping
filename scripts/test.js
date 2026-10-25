// End-to-end checks against a throwaway database. Run: npm test
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baleova-'));
const PORT = 3900 + Math.floor(Math.random() * 90), base = `http://localhost:${PORT}`;
// Telegram Mini App signature check (offline)
{
  process.env.DATA_DIR = dir; process.env.BOT_TOKEN = '123456:TEST-TOKEN';
  const crypto = require('crypto'), { verifyInitData } = require('../src/telegram');
  const sign = (fields) => { const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n'); const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest(); return new URLSearchParams({ ...fields, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString(); };
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42, first_name: 'Abdi' }) };
  assert.strictEqual(verifyInitData(sign(fields)).first_name, 'Abdi'); console.log('  ok - valid Telegram initData accepted');
  assert.strictEqual(verifyInitData(sign(fields).replace('Abdi', 'Evil')), null); console.log('  ok - tampered Telegram initData rejected');
  assert.strictEqual(verifyInitData(sign({ ...fields, auth_date: '1000' })), null); console.log('  ok - expired Telegram initData rejected');
  delete process.env.BOT_TOKEN;
}
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir, ADMIN_PASSWORD: 'test-pass-123', BOT_TOKEN: '', NODE_NO_WARNINGS: '1' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';
async function call(method, url, body, { raw, ck = cookie } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(raw ? { 'Content-Type': raw } : body ? { 'Content-Type': 'application/json' } : {}), 'X-Requested-With': 'baleova', Cookie: ck }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc && ck === cookie && url.includes('login')) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
let passed = 0; const ok = (c, m) => { assert(c, m); passed++; console.log('  ok -', m); };
(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/store'); break; } catch { await sleep(150); } }
  let r = await call('POST', '/api/admin/login', { username: 'owner', password: 'wrong' }); ok(r.status === 401, 'wrong password rejected');
  r = await call('GET', '/api/admin/dashboard'); ok(r.status === 401, 'admin API needs login');
  r = await call('POST', '/api/admin/login', { username: 'owner', password: 'test-pass-123' }); ok(r.status === 200 && r.data.user.role === 'owner', 'owner can sign in');
  r = await fetch(base + '/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' }); ok(r.status === 403, 'POST without CSRF header refused');

  const cats = (await call('GET', '/api/admin/categories')).data;
  ok(cats.some(c => c.slug === 'electronics') && cats.some(c => c.slug === 'other'), 'Electronics and Other categories exist');
  const am = (await call('GET', '/api/store?lang=am', null, { ck: '' })).data; ok(am.categories.find(c => c.slug === 'electronics').name === 'ኤሌክትሮኒክስ', 'category names come back in Amharic');
  ok(am.settings.delivery_info.includes('ኢትዮጵያ') && !('delivery_info_am' in am.settings), 'shop texts are localised for Amharic');
  r = await call('POST', '/api/admin/products', { code: 'T-1', name: 'Test Tee', name_om: 'Tishartii Qorannoo', name_am: 'የሙከራ ቲሸርት', description: 'English text', description_am: 'አማርኛ መግለጫ', category_id: cats[0].id, price: 1000, sale_price: 800, is_new: 1, variants: [{ size: 'M', color: 'Black', stock: 5 }, { size: 'L', color: 'Black', stock: 1 }] });
  ok(r.status === 201 && r.data.variants.length === 2, 'create product with variants');
  const P = r.data, vM = P.variants.find(v => v.size === 'M'), vL = P.variants.find(v => v.size === 'L');
  r = await call('GET', `/api/products/${P.id}?lang=om`, null, { ck: '' }); ok(r.data.name === 'Tishartii Qorannoo' && r.data.description === 'English text', 'Afaan Oromoo name shown, English description used as fallback');
  r = await call('GET', `/api/products/${P.id}?lang=am`, null, { ck: '' }); ok(r.data.name === 'የሙከራ ቲሸርት' && r.data.description === 'አማርኛ መግለጫ', 'Amharic name and description shown');
  r = await call('GET', `/api/products?q=${encodeURIComponent('የሙከራ')}`, null, { ck: '' }); ok(r.data.length === 1, 'search finds products by translated name');
  r = await call('POST', '/api/admin/products', { code: 't-1', name: 'Dup', category_id: cats[0].id, price: 5 }); ok(r.status === 400, 'duplicate product code refused');
  r = await call('POST', '/api/admin/products', { code: 'T-W1', name: 'Women Bonda Top', category_id: cats[0].id, price: 400, gender: 'women', condition: 'bonda', variants: [{ size: 'M', color: 'Red', stock: 1 }] });
  ok(r.status === 201 && r.data.gender === 'women' && r.data.condition === 'bonda', 'create a women / bonda product');
  r = await call('POST', '/api/admin/products', { code: 'T-W2', name: 'Bad gender', category_id: cats[0].id, price: 400, gender: 'robots' }); ok(r.status === 400, 'invalid gender refused');
  r = await call('GET', '/api/products?category=bonda', null, { ck: '' }); ok(r.data.length >= 1 && r.data.every(x => x.condition === 'bonda'), 'bonda category lists only bonda items');
  r = await call('GET', '/api/products?category=women', null, { ck: '' }); ok(r.data.some(x => x.code === 'T-W1') && r.data.every(x => x.gender !== 'men'), 'women category excludes men-only items');
  r = await call('GET', '/api/products?category=men', null, { ck: '' }); ok(!r.data.some(x => x.code === 'T-W1'), 'men category excludes women-only items');
  r = await call('GET', '/api/products?category=brand-new', null, { ck: '' }); ok(!r.data.some(x => x.code === 'T-W1'), 'brand-new category excludes bonda items');
  r = await call('GET', '/api/store', null, { ck: '' }); ok(r.data.audiences.length === 4 && r.data.audiences.find(x => x.slug === 'bonda').count >= 1, 'store lists men / women / new / bonda groups with counts');
  r = await call('POST', '/api/admin/products', { code: 'T-2', name: 'Bad discount', category_id: cats[0].id, price: 500, sale_price: 600 }); ok(r.status === 400, 'discount above price refused');

  r = await call('POST', '/api/admin/sales', { channel: 'whatsapp', customer_name: 'Abdi', customer_phone: '0911 22 33 44', items: [{ variant_id: vM.id, qty: 2 }] });
  ok(r.status === 201 && r.data.total === 1600, 'sale uses discounted price (2 x 800)');
  const saleId = r.data.id;
  let pub = (await call('GET', `/api/products/${P.id}`)).data;
  ok(pub.variants.find(v => v.id === vM.id).stock === 3, 'stock reduced to 3 after sale');
  ok(pub.units_sold === 2, 'units sold is computed from real sales');
  r = await call('POST', '/api/admin/sales', { channel: 'phone', items: [{ variant_id: vL.id, qty: 2 }, { variant_id: vM.id, qty: 1 }] });
  ok(r.status === 400, 'overselling is refused');
  pub = (await call('GET', `/api/products/${P.id}`)).data;
  ok(pub.variants.find(v => v.id === vM.id).stock === 3 && pub.units_sold === 2, 'failed sale rolled back completely (no partial stock change)');

  r = await call('POST', `/api/admin/sales/${saleId}/reverse`, { reason: 'customer cancelled' }); ok(r.status === 200 && r.data.status === 'reversed', 'sale reversed');
  pub = (await call('GET', `/api/products/${P.id}`)).data;
  ok(pub.variants.find(v => v.id === vM.id).stock === 5 && pub.units_sold === 0, 'reversal restores stock and units sold');
  r = await call('POST', `/api/admin/sales/${saleId}/reverse`, {}); ok(r.status === 400, 'cannot reverse twice');
  r = await call('DELETE', `/api/admin/products/${P.id}`); ok(r.status === 400, 'product with sales cannot be deleted');

  r = await call('POST', '/api/admin/inventory/change', { variant_id: vL.id, type: 'adjustment', qty: -5, note: 'x' }); ok(r.status === 400, 'stock cannot go below zero');
  r = await call('POST', '/api/admin/inventory/change', { variant_id: vL.id, type: 'adjustment', qty: -1 }); ok(r.status === 400, 'adjustment needs a reason');
  r = await call('POST', '/api/admin/inventory/change', { variant_id: vL.id, type: 'restock', qty: 10, note: 'new batch' }); ok(r.status === 200 && r.data.stock === 11, 'restock adds stock');
  r = await call('GET', `/api/admin/inventory/movements?product_id=${P.id}`); ok(r.data.length >= 5 && r.data.some(m => m.type === 'sale_reversal'), 'movement history recorded');

  // Reviews: pending until approved; verified only when phone matches a real sale
  await call('POST', '/api/admin/sales', { channel: 'phone', customer_phone: '+251911223344', items: [{ variant_id: vM.id, qty: 1 }] });
  r = await call('POST', `/api/products/${P.id}/reviews`, { name: 'Abdi', rating: 5, comment: 'Great', phone: '0911223344' }, { ck: '' }); ok(r.status === 201, 'customer can submit review');
  await call('POST', `/api/products/${P.id}/reviews`, { name: 'Stranger', rating: 4, comment: 'Nice', phone: '0900000000' }, { ck: '' });
  pub = (await call('GET', `/api/products/${P.id}`, null, { ck: '' })).data; ok(pub.reviews.length === 0 && pub.rating_avg === null, 'unapproved reviews are hidden, no invented rating');
  const rv = (await call('GET', '/api/admin/reviews?status=pending')).data; ok(rv.length === 2, 'reviews appear in moderation queue');
  for (const x of rv) await call('PATCH', `/api/admin/reviews/${x.id}`, { status: 'approved', admin_reply: x.name === 'Abdi' ? 'Thanks!' : '' });
  pub = (await call('GET', `/api/products/${P.id}`, null, { ck: '' })).data;
  ok(pub.reviews.length === 2 && pub.rating_avg === 4.5, 'approved reviews counted');
  ok(pub.reviews.find(x => x.name === 'Abdi').verified === true && pub.reviews.find(x => x.name === 'Stranger').verified === false, 'verified label only for real buyers');
  ok(!JSON.stringify(pub).includes('911223344'), 'reviewer phone is never exposed');

  // Roles
  r = await call('POST', '/api/admin/users', { username: 'sam', password: 'staff-pass-1', role: 'staff' }); ok(r.status === 201, 'owner creates staff user');
  const owner = cookie; cookie = '';
  r = await call('POST', '/api/admin/login', { username: 'sam', password: 'staff-pass-1' }); ok(r.status === 200, 'staff signs in');
  r = await call('POST', '/api/admin/products', { code: 'X', name: 'X', category_id: 1, price: 1 }); ok(r.status === 403, 'staff cannot create products');
  r = await call('PUT', '/api/admin/settings', { phone: '1' }); ok(r.status === 403, 'staff cannot change settings');
  r = await call('POST', `/api/admin/sales/${saleId}/reverse`, {}); ok(r.status === 403, 'staff cannot reverse sales');
  r = await call('POST', '/api/admin/sales', { channel: 'in_person', items: [{ variant_id: vM.id, qty: 1 }] }); ok(r.status === 201, 'staff can record a sale');
  cookie = owner;

  r = await call('PUT', '/api/admin/settings', { phone: '+251 911 000 000', whatsapp: '0911000000', telegram: '@baleova' });
  ok(r.data.whatsapp === '251911000000' && r.data.telegram === 'baleova', 'settings normalise WhatsApp and Telegram');
  const st = (await call('GET', '/api/store', null, { ck: '' })).data.settings; ok(st.whatsapp === '251911000000', 'public site reads configured contact');
  r = await call('GET', '/api/admin/dashboard'); ok(r.data.all.units >= 2 && r.data.daily.length >= 1, 'dashboard reports include sales');

  r = await call('POST', '/api/admin/shein/requests', { customer_name: 'Hana', item_ref: 'SHN-1', size: 'M', status: 'Price Quoted', quoted_price: 3000 }); ok(r.status === 201, 'SHEIN request created');
  r = await call('PUT', `/api/admin/shein/requests/${r.data.id}`, { status: 'Ordered' }); ok(r.status === 200, 'SHEIN status updated');
  const sr = (await call('GET', '/api/admin/shein/requests')).data.requests[0]; ok(sr.log.length === 2, 'SHEIN status history kept');
  r = await call('POST', '/api/admin/upload/products', Buffer.from('not an image at all, just text!!'), { raw: 'image/png' }); ok(r.status === 400, 'fake image upload refused');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  r = await call('POST', '/api/admin/upload/products', png, { raw: 'image/png' }); ok(r.status === 200 && /^\/uploads\/products\/[a-f0-9]{24}\.png$/.test(r.data.url), 'real image upload accepted');
  console.log(`\n${passed} checks passed`);
})().catch(e => { console.error('\nFAILED:', e.message); process.exitCode = 1; }).finally(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
