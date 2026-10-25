const { Router, raw } = require('./mini');
const { db, tx, getSettings, SETTING_DEFAULTS } = require('./db');
const S = require('./services');
const A = require('./auth');
const C = require('./channels');
const { bad, HttpError, str, reqStr, int, flag, oneOf, normPhone, wrap, saveImage, limiter } = require('./util');

const r = new Router();

// ---- auth (public part of the admin API) ----
r.post('/login', limiter('login-ip', 30, 15 * 60e3), wrap((req, res) => {
  const { token, user } = A.login(str(req.body?.username, 60), String(req.body?.password ?? '').slice(0, 200), req.ip);
  res.set('Set-Cookie', A.cookieHeader(token, A.SESSION_HOURS * 3600));
  res.json({ user });
}));
r.post('/logout', (req, res) => { A.logout(req); res.set('Set-Cookie', A.cookieHeader('', 0)); res.json({ ok: true }); });

r.use((req, res, next) => { req.user = A.currentUser(req); next(); });
r.use(A.csrfGuard);
r.get('/me', (req, res) => req.user ? res.json({ user: req.user }) : res.status(401).json({ error: 'Please sign in' }));

const staff = A.requireRole('staff'), manager = A.requireRole('manager'), owner = A.requireRole('owner');
const id = req => { const n = Number(req.params.id); if (!Number.isInteger(n)) throw bad('Invalid id'); return n; };

// ---- dashboard ----
r.get('/dashboard', staff, wrap((req, res) => res.json(S.reports())));

// ---- uploads (images only; sniffed by content) ----
r.post('/upload/:folder', manager, raw({ limit: 6 * 1048576 }), wrap((req, res) => {
  const folder = oneOf(req.params.folder, ['products', 'shein', 'banners'], 'Folder');
  res.json({ url: saveImage(req.body, folder) });
}));

// ---- categories ----
r.get('/categories', staff, wrap((req, res) => res.json(db.prepare('SELECT id, slug, name FROM categories ORDER BY sort').all())));

// ---- products ----
r.get('/products', staff, wrap((req, res) => {
  const where = [], args = [];
  if (req.query.status) { where.push('p.status = ?'); args.push(req.query.status); }
  if (req.query.q) { where.push("(p.name LIKE ? OR p.code LIKE ?)"); const l = `%${String(req.query.q).slice(0, 60)}%`; args.push(l, l); }
  const rows = db.prepare(`${S.PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 500`).all(...args);
  const posted = C.postedCounts();
  res.json(rows.map(p => ({ ...S.decorate(p, true), posted: posted[p.id] || 0 })));
}));
r.get('/products/:id', staff, wrap((req, res) => {
  const p = S.getProduct(id(req), { admin: true });
  if (!p) throw new HttpError(404, 'Not found');
  res.json(p);
}));

function saveProduct(pid, b, userId) {
  const f = {
    code: reqStr(b.code, 'Product code', 40).toUpperCase(), name: reqStr(b.name, 'Name', 120),
    category_id: int(b.category_id, 'Category', { min: 1 }), price: int(b.price, 'Price', { min: 0, max: 10000000 }),
    sale_price: int(b.sale_price, 'Discount price', { min: 0, max: 10000000, required: false }),
    description: str(b.description, 3000), name_om: str(b.name_om, 120), name_am: str(b.name_am, 120), description_om: str(b.description_om, 3000), description_am: str(b.description_am, 3000), gender: oneOf(b.gender || 'unisex', ['men','women','unisex'], 'Gender'), cond: oneOf(b.condition || b.cond || 'new', ['new','bonda'], 'Condition'), material: str(b.material, 300), fit: str(b.fit, 200), specs: str(b.specs, 1500),
  };
  if (f.sale_price != null && f.sale_price >= f.price) throw bad('Discount price must be lower than the normal price');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(f.category_id)) throw bad('Category is invalid');
  const flags = [flag(b.is_featured), flag(b.is_new), flag(b.is_best), flag(b.is_offer), flag(b.out_of_stock)];
  const images = (Array.isArray(b.images) ? b.images : []).map(u => str(u, 300)).filter(u => /^(\/uploads\/products\/[a-f0-9]{24}\.(jpg|png|webp)|https:\/\/[^\s"'<>]+)$/.test(u)).slice(0, 10);
  const variants = Array.isArray(b.variants) ? b.variants : [];
  if (variants.length > 120) throw bad('Too many size/colour combinations');
  return tx(() => {
    try {
      if (pid) db.prepare(`UPDATE products SET code=?,name=?,category_id=?,price=?,sale_price=?,description=?,material=?,fit=?,specs=?,
        is_featured=?,is_new=?,is_best=?,is_offer=?,out_of_stock=?,name_om=?,name_am=?,description_om=?,description_am=?,gender=?,cond=?,updated_at=datetime('now') WHERE id=?`)
        .run(f.code, f.name, f.category_id, f.price, f.sale_price, f.description, f.material, f.fit, f.specs, ...flags, f.name_om, f.name_am, f.description_om, f.description_am, f.gender, f.cond, pid);
      else pid = db.prepare(`INSERT INTO products(code,name,category_id,price,sale_price,description,material,fit,specs,is_featured,is_new,is_best,is_offer,out_of_stock,name_om,name_am,description_om,description_am,gender,cond) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(f.code, f.name, f.category_id, f.price, f.sale_price, f.description, f.material, f.fit, f.specs, ...flags, f.name_om, f.name_am, f.description_om, f.description_am, f.gender, f.cond).lastInsertRowid;
    } catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That product code is already used'); throw e; }
    db.prepare('DELETE FROM product_images WHERE product_id = ?').run(pid);
    images.forEach((u, i) => db.prepare('INSERT INTO product_images(product_id,url,sort) VALUES(?,?,?)').run(pid, u, i));
    const keep = [];
    for (const v of variants) {
      const size = reqStr(v.size, 'Size', 20), color = reqStr(v.color, 'Colour', 30);
      if (v.id) {
        const cur = db.prepare('SELECT * FROM variants WHERE id = ? AND product_id = ?').get(+v.id, pid);
        if (!cur) throw bad('Unknown size/colour row');
        try { db.prepare('UPDATE variants SET size=?, color=? WHERE id=?').run(size, color, cur.id); }
        catch (e) { if (/UNIQUE/.test(e.message)) throw bad(`${size} / ${color} appears twice`); throw e; }   // stock is NOT editable here
        keep.push(cur.id);
      } else {
        const qty = int(v.stock ?? 0, 'Opening stock', { min: 0, max: 100000 });
        let vid;
        try { vid = db.prepare('INSERT INTO variants(product_id,size,color,stock) VALUES(?,?,?,?)').run(pid, size, color, qty).lastInsertRowid; }
        catch (e) { if (/UNIQUE/.test(e.message)) throw bad(`${size} / ${color} appears twice`); throw e; }
        if (qty) S.logMove(vid, pid, 'initial', qty, qty, 'Opening stock', null, userId);
        keep.push(vid);
      }
    }
    for (const old of db.prepare('SELECT * FROM variants WHERE product_id = ?').all(pid)) {
      if (keep.includes(old.id)) continue;
      if (db.prepare('SELECT 1 FROM sale_items WHERE variant_id = ?').get(old.id)) throw bad(`${old.size}/${old.color} has recorded sales and cannot be removed. Set its stock to 0 instead.`);
      db.prepare('DELETE FROM variants WHERE id = ?').run(old.id);
    }
    return pid;
  });
}
// A new product is posted to the Telegram channels automatically (Settings > Telegram channels), unless the box is unticked for it.
r.post('/products', manager, wrap(async (req, res) => {
  const b = req.body || {}, pid = saveProduct(null, b, req.user.id);
  const want = b.post_to_channels === undefined ? getSettings().tg_autopost === '1' : !!flag(b.post_to_channels);
  let posted = [];
  if (want) { try { posted = await C.postProduct(pid); } catch (e) { posted = [{ ok: false, channel: '', error: e.message }]; } }   // posting must never lose a saved product
  res.status(201).json({ ...S.getProduct(pid, { admin: true }), posted });
}));
// "Post" / "Post again" from the Products list: all active channels, or only the ticked ones.
r.post('/products/:id/post', manager, wrap(async (req, res) => {
  const b = req.body || {};
  res.json({ posted: await C.postProduct(id(req), { channelIds: Array.isArray(b.channel_ids) ? b.channel_ids : undefined, kind: b.kind === 'new' ? 'new' : 'again', explicit: true }) });
}));
r.put('/products/:id', manager, wrap((req, res) => res.json(S.getProduct(saveProduct(id(req), req.body || {}, req.user.id), { admin: true }))));
r.patch('/products/:id/status', manager, wrap((req, res) => {
  const st = oneOf(req.body?.status, ['active', 'archived'], 'Status');
  db.prepare("UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?").run(st, id(req));
  res.json({ ok: true });
}));
r.delete('/products/:id', manager, wrap((req, res) => {
  if (db.prepare('SELECT 1 FROM sale_items WHERE product_id = ?').get(id(req))) throw bad('This product has recorded sales, so it cannot be deleted. Archive it instead.');
  db.prepare('DELETE FROM products WHERE id = ?').run(id(req));
  res.json({ ok: true });
}));

// ---- sellable variants (for the Record Sale screen) ----
r.get('/variants', staff, wrap((req, res) => {
  const l = `%${String(req.query.q || '').slice(0, 60)}%`;
  res.json(db.prepare(`SELECT v.id, v.size, v.color, v.stock, p.id AS product_id, p.name, p.code,
      CASE WHEN p.sale_price IS NOT NULL AND p.sale_price < p.price THEN p.sale_price ELSE p.price END AS price
    FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' AND (p.name LIKE ? OR p.code LIKE ?) ORDER BY p.name, v.size, v.color LIMIT 60`).all(l, l));
}));

// ---- inventory ----
r.get('/inventory/movements', staff, wrap((req, res) => {
  const where = [], args = [];
  if (req.query.product_id) { where.push('m.product_id = ?'); args.push(+req.query.product_id); }
  if (req.query.type) { where.push('m.type = ?'); args.push(String(req.query.type)); }
  const limit = Math.min(+req.query.limit || 100, 500);
  res.json(db.prepare(`SELECT m.*, p.name AS product_name, p.code, v.size, v.color, u.display_name AS user_name
    FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN variants v ON v.id = m.variant_id LEFT JOIN users u ON u.id = m.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.id DESC LIMIT ?`).all(...args, limit));
}));
r.post('/inventory/change', manager, wrap((req, res) => {
  const b = req.body || {};
  res.json(S.changeStock({ variant_id: int(b.variant_id, 'Item', { min: 1 }), type: b.type, qty: Number(b.qty), note: str(b.note, 300) }, req.user.id));
}));

// ---- sales ----
r.get('/sales', staff, wrap((req, res) => {
  const where = [], args = [];
  if (req.query.status) { where.push('s.status = ?'); args.push(String(req.query.status)); }
  if (req.query.from) { where.push("date(s.created_at) >= date(?)"); args.push(String(req.query.from)); }
  if (req.query.to) { where.push("date(s.created_at) <= date(?)"); args.push(String(req.query.to)); }
  const rows = db.prepare(`SELECT s.*, u.display_name AS recorded_by FROM sales s LEFT JOIN users u ON u.id = s.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id DESC LIMIT 200`).all(...args);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?');
  res.json(rows.map(s => ({ ...s, items: items.all(s.id) })));
}));
r.post('/sales', staff, wrap((req, res) => {
  const b = req.body || {};
  const sale = S.recordSale({
    channel: oneOf(b.channel, ['phone', 'whatsapp', 'telegram', 'in_person', 'other'], 'Channel'),
    customer_name: str(b.customer_name, 80), customer_phone: str(b.customer_phone, 30), note: str(b.note, 300),
    items: (Array.isArray(b.items) ? b.items : []).map(i => ({ variant_id: Number(i.variant_id), qty: Number(i.qty), unit_price: i.unit_price === '' || i.unit_price == null ? undefined : Number(i.unit_price) })),
  }, req.user.id);
  res.status(201).json(sale);
}));
r.post('/sales/:id/reverse', manager, wrap((req, res) => res.json(S.reverseSale(id(req), str(req.body?.reason, 200), req.user.id))));

// ---- reviews ----
r.get('/reviews', manager, wrap((req, res) => {
  const st = req.query.status ? String(req.query.status) : null;
  const rows = db.prepare(`SELECT r.*, p.name AS product_name, p.code FROM reviews r JOIN products p ON p.id = r.product_id
    ${st ? 'WHERE r.status = ?' : ''} ORDER BY r.id DESC LIMIT 200`).all(...(st ? [st] : []));
  res.json(rows.map(x => ({ ...x, phone_norm: x.phone_norm ? '+' + x.phone_norm : '', photos: db.prepare('SELECT url FROM review_photos WHERE review_id = ?').all(x.id).map(p => p.url) })));
}));
r.patch('/reviews/:id', manager, wrap((req, res) => {
  const b = req.body || {}, rid = id(req);
  const rv = db.prepare('SELECT * FROM reviews WHERE id = ?').get(rid);
  if (!rv) throw new HttpError(404, 'Not found');
  const status = b.status ? oneOf(b.status, ['pending', 'approved', 'rejected'], 'Status') : rv.status;
  const reply = b.admin_reply != null ? str(b.admin_reply, 600) : rv.admin_reply;
  // Verified label is always derived from recorded sales, never typed in by hand.
  const verified = S.isVerifiedBuyer(rv.product_id, rv.phone_norm) ? 1 : 0;
  db.prepare('UPDATE reviews SET status=?, admin_reply=?, verified=? WHERE id=?').run(status, reply, verified, rid);
  res.json({ ok: true, verified: !!verified });
}));
r.delete('/reviews/:id', manager, wrap((req, res) => { db.prepare('DELETE FROM reviews WHERE id = ?').run(id(req)); res.json({ ok: true }); }));

// ---- SHEIN ----
r.get('/shein/items', staff, wrap((req, res) => res.json(db.prepare('SELECT * FROM shein_items ORDER BY id DESC').all())));
function sheinItem(b) {
  const link = str(b.link, 500);
  if (link && !/^https?:\/\//i.test(link)) throw bad('Link must start with http:// or https://');
  const image = str(b.image, 300);
  if (image && !/^(\/uploads\/shein\/[a-f0-9]{24}\.(jpg|png|webp)|https:\/\/[^\s"'<>]+)$/.test(image)) throw bad('Image is invalid');
  return [reqStr(b.code, 'Code', 40).toUpperCase(), reqStr(b.title, 'Title', 150), link, int(b.est_price, 'Estimated price', { min: 0, max: 1e8, required: false }),
    str(b.sizes, 100), str(b.colors, 100), str(b.note, 400), image, flag(b.active ?? 1), str(b.title_om, 150), str(b.title_am, 150)];
}
r.post('/shein/items', manager, wrap((req, res) => {
  try { const x = db.prepare('INSERT INTO shein_items(code,title,link,est_price,sizes,colors,note,image,active,title_om,title_am) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...sheinItem(req.body || {})); res.status(201).json({ id: x.lastInsertRowid }); }
  catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That code is already used'); throw e; }
}));
r.put('/shein/items/:id', manager, wrap((req, res) => {
  try { db.prepare('UPDATE shein_items SET code=?,title=?,link=?,est_price=?,sizes=?,colors=?,note=?,image=?,active=?,title_om=?,title_am=? WHERE id=?').run(...sheinItem(req.body || {}), id(req)); res.json({ ok: true }); }
  catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That code is already used'); throw e; }
}));
r.delete('/shein/items/:id', manager, wrap((req, res) => { db.prepare('DELETE FROM shein_items WHERE id = ?').run(id(req)); res.json({ ok: true }); }));

const STATUSES = ['Requested', 'Price Quoted', 'Confirmed', 'Ordered', 'In Transit', 'Arrived', 'Delivered', 'Cancelled'];
r.get('/shein/requests', staff, wrap((req, res) => {
  const st = req.query.status ? String(req.query.status) : null;
  const rows = db.prepare(`SELECT q.*, i.title AS item_title, i.code AS item_code FROM shein_requests q LEFT JOIN shein_items i ON i.id = q.item_id
    ${st ? 'WHERE q.status = ?' : ''} ORDER BY q.id DESC LIMIT 300`).all(...(st ? [st] : []));
  res.json({ statuses: STATUSES, requests: rows.map(q => ({ ...q, log: db.prepare('SELECT l.status, l.created_at, u.display_name AS user_name FROM shein_request_log l LEFT JOIN users u ON u.id = l.user_id WHERE request_id = ? ORDER BY l.id').all(q.id) })) });
}));
function sheinReq(b, cur) {
  const item_id = b.item_id ? int(b.item_id, 'Item', { min: 1 }) : null;
  return [item_id, str(b.item_ref, 300), reqStr(b.customer_name, 'Customer name', 80), str(b.customer_phone, 30),
    oneOf(b.channel || 'whatsapp', ['phone', 'whatsapp', 'telegram', 'in_person', 'other'], 'Channel'), str(b.size, 30), str(b.color, 30),
    int(b.qty ?? 1, 'Quantity', { min: 1, max: 100 }), int(b.quoted_price, 'Quoted price', { min: 0, max: 1e8, required: false }), str(b.note, 400),
    oneOf(b.status || (cur ? cur.status : 'Requested'), STATUSES, 'Status')];
}
r.post('/shein/requests', staff, wrap((req, res) => {
  const v = sheinReq(req.body || {});
  tx(() => {
    const rid = db.prepare('INSERT INTO shein_requests(item_id,item_ref,customer_name,customer_phone,channel,size,color,qty,quoted_price,note,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...v).lastInsertRowid;
    db.prepare('INSERT INTO shein_request_log(request_id,status,user_id) VALUES(?,?,?)').run(rid, v[10], req.user.id);
    res.status(201).json({ id: rid });
  });
}));
r.put('/shein/requests/:id', staff, wrap((req, res) => {
  const cur = db.prepare('SELECT * FROM shein_requests WHERE id = ?').get(id(req));
  if (!cur) throw new HttpError(404, 'Not found');
  const v = sheinReq({ ...cur, ...(req.body || {}) }, cur);
  tx(() => {
    db.prepare("UPDATE shein_requests SET item_id=?,item_ref=?,customer_name=?,customer_phone=?,channel=?,size=?,color=?,qty=?,quoted_price=?,note=?,status=?,updated_at=datetime('now') WHERE id=?").run(...v, cur.id);
    if (v[10] !== cur.status) db.prepare('INSERT INTO shein_request_log(request_id,status,user_id) VALUES(?,?,?)').run(cur.id, v[10], req.user.id);
  });
  res.json({ ok: true });
}));
r.delete('/shein/requests/:id', manager, wrap((req, res) => { db.prepare('DELETE FROM shein_requests WHERE id = ?').run(id(req)); res.json({ ok: true }); }));

// ---- banners ----
r.get('/banners', manager, wrap((req, res) => res.json(db.prepare('SELECT * FROM banners ORDER BY placement, sort, id').all())));
function bannerVals(b) {
  const image = str(b.image, 300);
  if (image && !/^(\/uploads\/banners\/[a-f0-9]{24}\.(jpg|png|webp)|https:\/\/[^\s"'<>]+)$/.test(image)) throw bad('Image is invalid');
  const link = str(b.link, 300);
  if (link && !/^(#\/[\w\-/?=&%.]*|https?:\/\/[^\s"'<>]+)$/.test(link)) throw bad('Link must be a page like #/shop or a full http(s) address');
  return [reqStr(b.title, 'Title', 100), str(b.subtitle, 200), image, link, oneOf(b.placement || 'hero', ['hero', 'promo'], 'Placement'), int(b.sort ?? 0, 'Order', { min: 0, max: 999 }), flag(b.active ?? 1), str(b.title_om, 100), str(b.title_am, 100), str(b.subtitle_om, 200), str(b.subtitle_am, 200)];
}
r.post('/banners', manager, wrap((req, res) => res.status(201).json({ id: db.prepare('INSERT INTO banners(title,subtitle,image,link,placement,sort,active,title_om,title_am,subtitle_om,subtitle_am) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...bannerVals(req.body || {})).lastInsertRowid })));
r.put('/banners/:id', manager, wrap((req, res) => { db.prepare('UPDATE banners SET title=?,subtitle=?,image=?,link=?,placement=?,sort=?,active=?,title_om=?,title_am=?,subtitle_om=?,subtitle_am=? WHERE id=?').run(...bannerVals(req.body || {}), id(req)); res.json({ ok: true }); }));
r.delete('/banners/:id', manager, wrap((req, res) => { db.prepare('DELETE FROM banners WHERE id = ?').run(id(req)); res.json({ ok: true }); }));

// ---- settings ----
r.get('/settings', manager, wrap((req, res) => res.json(getSettings())));
r.put('/settings', owner, wrap((req, res) => {
  const b = req.body || {};
  const clean = {
    whatsapp: v => normPhone(v), telegram: v => str(v, 80).replace(/^(https?:\/\/)?t\.me\//i, '').replace(/^@/, ''),
    bot_username: v => str(v, 80).replace(/^(https?:\/\/)?t\.me\//i, '').replace(/^@/, ''),
    low_stock_threshold: v => String(int(v, 'Low-stock level', { min: 0, max: 1000 })),
    tg_autopost: v => flag(v) ? '1' : '0', tg_miniapp: v => str(v, 64).replace(/[^\w]/g, ''),
  };
  const url = k => v => { const s = str(v, 300); if (s && !/^https?:\/\//i.test(s)) throw bad(`${k} must start with http:// or https://`); return s; };
  clean.map_url = url('Map link'); clean.instagram = url('Instagram'); clean.facebook = url('Facebook'); clean.tiktok = url('TikTok');
  tx(() => {
    for (const k of Object.keys(SETTING_DEFAULTS)) if (k in b) db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, (clean[k] || (v => str(v, 2000)))(b[k]));
  });
  res.json(getSettings());
}));

// ---- Telegram channels (where new products are posted) ----
r.get('/channels', manager, wrap((req, res) => res.json({
  bot_on: C.botOn(),
  channels: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM channel_posts x WHERE x.channel_id = c.id AND x.ok = 1) AS posts,
    (SELECT error FROM channel_posts x WHERE x.channel_id = c.id ORDER BY x.id DESC LIMIT 1) AS last_error FROM channels c ORDER BY c.id`).all(),
})));
function channelVals(b) {
  return [reqStr(b.name, 'Name', 60), C.normChat(b.chat), oneOf(b.lang || 'en', ['en', 'om', 'am'], 'Language'), oneOf(b.audience || 'all', ['all', 'men', 'women'], 'Audience'), flag(b.active ?? 1)];
}
const dupChannel = e => { if (/UNIQUE/.test(e.message)) throw bad('That channel is already in the list'); throw e; };
r.post('/channels', owner, wrap((req, res) => {
  try { res.status(201).json({ id: db.prepare('INSERT INTO channels(name,chat,lang,audience,active) VALUES(?,?,?,?,?)').run(...channelVals(req.body || {})).lastInsertRowid }); } catch (e) { dupChannel(e); }
}));
r.put('/channels/:id', owner, wrap((req, res) => {
  try { db.prepare('UPDATE channels SET name=?,chat=?,lang=?,audience=?,active=? WHERE id=?').run(...channelVals(req.body || {}), id(req)); res.json({ ok: true }); } catch (e) { dupChannel(e); }
}));
r.delete('/channels/:id', owner, wrap((req, res) => { db.prepare('DELETE FROM channels WHERE id = ?').run(id(req)); res.json({ ok: true }); }));
r.post('/channels/:id/test', owner, wrap(async (req, res) => res.json(await C.sendTest(id(req)))));

// ---- team ----
r.get('/users', owner, wrap((req, res) => res.json(db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id').all())));
r.post('/users', owner, wrap((req, res) => {
  const b = req.body || {}, pw = String(b.password || '');
  if (pw.length < 8) throw bad('Password must be at least 8 characters');
  const username = reqStr(b.username, 'Username', 40);
  if (!/^[\w.-]+$/.test(username)) throw bad('Username can use letters, numbers, dot, dash and underscore only');
  try { res.status(201).json({ id: db.prepare('INSERT INTO users(username,display_name,password_hash,role) VALUES(?,?,?,?)').run(username, str(b.display_name, 60) || username, A.hashPassword(pw), oneOf(b.role, ['owner', 'manager', 'staff'], 'Role')).lastInsertRowid }); }
  catch (e) { if (/UNIQUE/.test(e.message)) throw bad('That username is taken'); throw e; }
}));
r.put('/users/:id', owner, wrap((req, res) => {
  const b = req.body || {}, uid = id(req);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) throw new HttpError(404, 'Not found');
  const role = b.role ? oneOf(b.role, ['owner', 'manager', 'staff'], 'Role') : u.role, active = b.active == null ? u.active : flag(b.active);
  if (uid === req.user.id && (role !== 'owner' || !active)) throw bad('You cannot remove your own owner access');
  tx(() => {
    db.prepare('UPDATE users SET display_name=?, role=?, active=? WHERE id=?').run(str(b.display_name, 60) || u.display_name, role, active, uid);
    if (b.password) { if (String(b.password).length < 8) throw bad('Password must be at least 8 characters'); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(String(b.password)), uid); }
    if (!active || b.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  });
  res.json({ ok: true });
}));
r.post('/me/password', staff, wrap((req, res) => {
  const b = req.body || {}, u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!A.verifyPassword(String(b.current || ''), u.password_hash)) throw bad('Current password is wrong');
  if (String(b.next || '').length < 8) throw bad('New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(A.hashPassword(String(b.next)), u.id);
  res.json({ ok: true });
}));

// Any unknown admin route
r.use((req, res) => res.status(404).json({ error: 'Not found' }));
module.exports = r;
