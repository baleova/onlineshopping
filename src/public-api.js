const { Router, raw } = require('./mini');
const { db, getSettings } = require('./db');
const S = require('./services');
const { bad, str, reqStr, int, normPhone, limiter, saveImage, wrap, HttpError } = require('./util');
const { verifyInitData } = require('./telegram');
const { pickLang, catName, localizeSettings } = require('./i18n');

const r = new Router();

r.get('/store', wrap((req, res) => {
  const lang = pickLang(req.query.lang);
  const s = getSettings(); delete s.low_stock_threshold; delete s.tg_autopost; delete s.tg_miniapp;
  const cats = db.prepare(`SELECT c.slug, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'active') AS count,
      (SELECT url FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.category_id = c.id AND p.status = 'active' ORDER BY p.id DESC, i.sort, i.id LIMIT 1) AS cover
    FROM categories c ORDER BY c.sort`).all().map(c => ({ ...c, name: catName(c.slug, c.name, lang) }));
  const banners = db.prepare('SELECT id,title,subtitle,title_om,title_am,subtitle_om,subtitle_am,image,link,placement FROM banners WHERE active = 1 ORDER BY sort, id').all()
    .map(b => ({ id: b.id, image: b.image, link: b.link, placement: b.placement, title: (lang !== 'en' && b[`title_${lang}`]) || b.title, subtitle: (lang !== 'en' && b[`subtitle_${lang}`]) || b.subtitle }));
  const aud = (where) => ({ count: db.prepare(`SELECT COUNT(*) n FROM products WHERE status='active' AND ${where}`).get().n,
    cover: (db.prepare(`SELECT url FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.status='active' AND ${where} ORDER BY p.id DESC, i.sort, i.id LIMIT 1`).get() || {}).url || null });
  const audiences = [['men', "gender IN ('men','unisex')"], ['women', "gender IN ('women','unisex')"], ['brand-new', "cond='new'"], ['bonda', "cond='bonda'"]]
    .map(([slug, w]) => ({ slug, ...aud(w) }));
  res.json({ settings: localizeSettings(s, lang), categories: cats, audiences, banners, telegram_enabled: !!process.env.BOT_TOKEN });
}));

r.get('/products', wrap((req, res) => res.json(S.listProducts(req.query))));

r.get('/products/:id', wrap((req, res) => {
  const lang = pickLang(req.query.lang), p = S.getProduct(+req.params.id, { lang });
  if (!p) throw new HttpError(404, 'Product not found');
  p.reviews = db.prepare(`SELECT id, name, rating, comment, verified, admin_reply, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 50`).all(p.id)
    .map(rv => ({ ...rv, verified: !!rv.verified, photos: db.prepare('SELECT url FROM review_photos WHERE review_id = ?').all(rv.id).map(x => x.url) }));
  p.related = S.relatedProducts(p.id, 4, lang);
  res.json(p);
}));

// Batch lookup for "recently viewed"
r.get('/products-by-ids', wrap((req, res) => res.json(S.listProducts({ ids: req.query.ids }))));

// Customers upload review photos first, then attach the URLs when submitting the review.
r.post('/review-photo', limiter('rphoto', 12, 3600e3), raw({ limit: 4 * 1048576 }), wrap((req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('No image received');
  res.json({ url: saveImage(req.body, 'reviews') });
}));

r.post('/products/:id/reviews', limiter('review', 6, 3600e3), wrap((req, res) => {
  const p = S.getProduct(+req.params.id);
  if (!p) throw new HttpError(404, 'Product not found');
  const b = req.body || {};
  const name = reqStr(b.name, 'Name', 60), rating = int(b.rating, 'Rating', { min: 1, max: 5 });
  const comment = str(b.comment, 1000);
  const phone = normPhone(b.phone);
  const tgUser = verifyInitData(b.initData);
  const photos = (Array.isArray(b.photos) ? b.photos : []).filter(u => /^\/uploads\/reviews\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(u)).slice(0, 3);
  const verified = S.isVerifiedBuyer(p.id, phone) ? 1 : 0;
  const id = db.prepare('INSERT INTO reviews(product_id,name,rating,comment,phone_norm,tg_user_id,verified) VALUES(?,?,?,?,?,?,?)')
    .run(p.id, name, rating, comment, phone, tgUser ? String(tgUser.id) : '', verified).lastInsertRowid;
  for (const u of photos) db.prepare('INSERT INTO review_photos(review_id,url) VALUES(?,?)').run(id, u);
  res.status(201).json({ ok: true, message: 'Thank you! Your review will appear after it is checked.' });
}));

r.get('/shein', wrap((req, res) => {
  const lang = pickLang(req.query.lang);
  res.json({
    notice: localizeSettings(getSettings(), lang).shein_notice,
    items: db.prepare('SELECT id, code, title, title_om, title_am, link, est_price, sizes, colors, note, image FROM shein_items WHERE active = 1 ORDER BY id DESC').all()
      .map(({ title_om, title_am, ...i }) => ({ ...i, title: (lang === 'om' && title_om) || (lang === 'am' && title_am) || i.title })),
  });
}));

r.post('/tg/auth', limiter('tgauth', 30, 600e3), wrap((req, res) => {
  const u = verifyInitData(req.body && req.body.initData);
  res.json(u ? { ok: true, first_name: u.first_name || '' } : { ok: false });
}));

module.exports = r;
