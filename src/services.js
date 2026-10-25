const { db, tx, getSettings } = require('./db');
const { bad, HttpError, normPhone } = require('./util');
const { pickLang, catName } = require('./i18n');

const TZ = Number.isFinite(+process.env.TZ_OFFSET_HOURS) ? +process.env.TZ_OFFSET_HOURS : 3;
const tzMod = `${TZ >= 0 ? '+' : ''}${TZ} hours`;

// ---------- Products (read side) ----------
const PRODUCT_SELECT = `
SELECT p.*, c.slug AS category_slug, c.name AS category_name,
  CASE WHEN p.sale_price IS NOT NULL AND p.sale_price < p.price THEN p.sale_price ELSE p.price END AS final_price,
  COALESCE((SELECT SUM(v.stock) FROM variants v WHERE v.product_id = p.id), 0) AS total_stock,
  COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'completed'), 0) AS units_sold,
  (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS review_count,
  (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_avg,
  (SELECT group_concat(DISTINCT v.size) FROM variants v WHERE v.product_id = p.id AND v.stock > 0) AS sizes_avail,
  (SELECT group_concat(DISTINCT v.color) FROM variants v WHERE v.product_id = p.id AND v.stock > 0) AS colors_avail,
  (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS cover,
  (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1 OFFSET 1) AS cover2
FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

function decorate(p, forAdmin = false, lang = 'en') {
  const threshold = parseInt(getSettings().low_stock_threshold, 10) || 3;
  const out = !!p.out_of_stock || p.total_stock <= 0;
  const o = {
    id: p.id, code: p.code, name: (lang !== 'en' && p[`name_${lang}`]) || p.name, category: p.category_slug, category_name: catName(p.category_slug, p.category_name, lang),
    price: p.price, sale_price: p.final_price < p.price ? p.final_price : null, final_price: p.final_price,
    discount_percent: p.final_price < p.price ? Math.round((1 - p.final_price / p.price) * 100) : 0,
    cover: p.cover, cover2: p.cover2, gender: p.gender, condition: p.cond, is_featured: !!p.is_featured, is_new: !!p.is_new, is_best: !!p.is_best, is_offer: !!p.is_offer,
    stock_status: out ? 'out' : (p.total_stock <= threshold ? 'low' : 'in'),
    sizes: out ? [] : String(p.sizes_avail || '').split(',').filter(Boolean), colors: out ? [] : String(p.colors_avail || '').split(',').filter(Boolean),
    units_sold: p.units_sold, review_count: p.review_count, rating_avg: p.review_count ? p.rating_avg : null,
  };
  if (forAdmin) Object.assign(o, { name_en: p.name, name_om: p.name_om, name_am: p.name_am, status: p.status, total_stock: p.total_stock, out_of_stock: !!p.out_of_stock, category_id: p.category_id });
  return o;
}

const SORTS = {
  newest: 'p.id DESC', price_asc: 'final_price ASC', price_desc: 'final_price DESC',
  popular: 'units_sold DESC, p.id DESC', name: 'p.name COLLATE NOCASE ASC',
};
function listProducts(q = {}) {
  const where = ["p.status = 'active'"], args = [];
  const cat = q.category;
  if (cat === 'new-arrivals') where.push('p.is_new = 1');
  else if (cat === 'best-sellers') where.push('p.is_best = 1');
  else if (cat === 'special-offers') where.push('(p.is_offer = 1 OR (p.sale_price IS NOT NULL AND p.sale_price < p.price))');
  else if (cat === 'featured') where.push('p.is_featured = 1');
  else if (cat === 'men') where.push("p.gender IN ('men','unisex')");
  else if (cat === 'women') where.push("p.gender IN ('women','unisex')");
  else if (cat === 'brand-new') where.push("p.cond = 'new'");
  else if (cat === 'bonda') where.push("p.cond = 'bonda'");
  else if (cat) { where.push('p.category_slug = ?'); args.push(String(cat)); }
  if (q.gender && ['men', 'women', 'unisex'].includes(q.gender)) { where.push(q.gender === 'unisex' ? "p.gender = 'unisex'" : "p.gender IN (?,'unisex')"); if (q.gender !== 'unisex') args.push(q.gender); }
  if (q.cond && ['new', 'bonda'].includes(q.cond)) { where.push('p.cond = ?'); args.push(q.cond); }
  if (q.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.name_om LIKE ? ESCAPE '\\' OR p.name_am LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')"); const l = '%' + String(q.q).replace(/[\\%_]/g, m => '\\' + m).slice(0, 60) + '%'; args.push(l, l, l, l, l); }
  if (q.min) { where.push('final_price >= ?'); args.push(+q.min || 0); }
  if (q.max) { where.push('final_price <= ?'); args.push(+q.max || 1e9); }
  if (q.size) { where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.size = ? AND v.stock > 0)'); args.push(String(q.size)); }
  if (q.color) { where.push('EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.color = ? AND v.stock > 0)'); args.push(String(q.color)); }
  if (q.instock === '1') where.push('p.out_of_stock = 0 AND total_stock > 0');
  if (q.ids) { const ids = String(q.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 12); where.push(`p.id IN (${ids.join(',') || 0})`); }
  const order = SORTS[q.sort] || SORTS.newest;
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 60, 1), 100);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const rows = db.prepare(`SELECT * FROM (${PRODUCT_SELECT}) p WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const lang = pickLang(q.lang);
  return rows.map(r => decorate(r, false, lang));
}

function getProduct(id, { admin = false, lang = 'en' } = {}) {
  const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  if (!p || (!admin && p.status !== 'active')) return null;
  lang = pickLang(lang);
  const out = decorate(p, admin, lang);
  out.description = (lang !== 'en' && p[`description_${lang}`]) || p.description;
  if (admin) Object.assign(out, { description_en: p.description, description_om: p.description_om, description_am: p.description_am }); out.material = p.material; out.fit = p.fit;
  out.specs = String(p.specs || '').split('\n').map(s => s.trim()).filter(Boolean);
  out.images = db.prepare('SELECT id, url FROM product_images WHERE product_id = ? ORDER BY sort, id').all(id);
  const vs = db.prepare('SELECT id, size, color, stock FROM variants WHERE product_id = ? ORDER BY id').all(id);
  out.variants = admin ? vs : vs.map(v => ({ id: v.id, size: v.size, color: v.color, stock: p.out_of_stock ? 0 : v.stock }));
  return out;
}

function relatedProducts(id, limit = 4, lang = 'en') {
  const p = db.prepare('SELECT category_id FROM products WHERE id = ?').get(id);
  if (!p) return [];
  const rows = db.prepare(`SELECT * FROM (${PRODUCT_SELECT}) p WHERE p.status = 'active' AND p.category_id = ? AND p.id != ? ORDER BY p.id DESC LIMIT ?`).all(p.category_id, id, limit);
  return rows.map(r => decorate(r, false, pickLang(lang)));
}

// ---------- Inventory ----------
function logMove(variantId, productId, type, change, after, note, saleId, userId) {
  db.prepare('INSERT INTO inventory_movements(variant_id,product_id,type,qty_change,stock_after,note,sale_id,user_id) VALUES(?,?,?,?,?,?,?,?)')
    .run(variantId, productId, type, change, after, note || '', saleId || null, userId || null);
}

function changeStock({ variant_id, type, qty, note }, userId) {
  if (!['restock', 'adjustment'].includes(type)) throw bad('Type must be restock or adjustment');
  if (!Number.isInteger(qty) || qty === 0) throw bad('Quantity must be a non-zero whole number');
  if (type === 'restock' && qty < 0) throw bad('A restock must be a positive number. Use an adjustment to remove stock.');
  if (type === 'adjustment' && !String(note || '').trim()) throw bad('Please give a reason for the adjustment');
  return tx(() => {
    const v = db.prepare('SELECT * FROM variants WHERE id = ?').get(variant_id);
    if (!v) throw new HttpError(404, 'Variant not found');
    if (v.stock + qty < 0) throw bad(`Stock cannot go below zero (current: ${v.stock})`);
    db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?').run(qty, v.id);
    const after = v.stock + qty;
    logMove(v.id, v.product_id, type, qty, after, note, null, userId);
    return { variant_id: v.id, stock: after };
  });
}

// ---------- Sales ----------
function recordSale(b, userId) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length || items.length > 30) throw bad('Add at least one item');
  return tx(() => {
    let total = 0;
    const saleId = db.prepare('INSERT INTO sales(channel,customer_name,customer_phone,note,total,user_id) VALUES(?,?,?,?,0,?)')
      .run(b.channel, b.customer_name, b.customer_phone, b.note, userId).lastInsertRowid;
    for (const it of items) {
      const qty = it.qty, vid = it.variant_id;
      if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw bad('Each quantity must be a whole number of 1 or more');
      const v = db.prepare('SELECT v.*, p.name, p.code, p.status, p.price, p.sale_price FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?').get(vid);
      if (!v) throw new HttpError(404, 'Item not found');
      if (v.status !== 'active') throw bad(`${v.name} is archived`);
      // Atomic guard: only decrement when enough stock is left.
      const r = db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, vid, qty);
      if (r.changes !== 1) throw bad(`Not enough stock for ${v.name} (${v.size}/${v.color}). Available: ${v.stock}`);
      const unit = Number.isInteger(it.unit_price) && it.unit_price >= 0 ? it.unit_price : (v.sale_price != null && v.sale_price < v.price ? v.sale_price : v.price);
      db.prepare('INSERT INTO sale_items(sale_id,product_id,variant_id,qty,unit_price,product_name,product_code,size,color) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(saleId, v.product_id, vid, qty, unit, v.name, v.code, v.size, v.color);
      logMove(vid, v.product_id, 'sale', -qty, v.stock - qty, `Sale #${saleId}`, saleId, userId);
      total += unit * qty;
    }
    db.prepare('UPDATE sales SET total = ? WHERE id = ?').run(total, saleId);
    return getSale(saleId);
  });
}

function reverseSale(id, reason, userId) {
  return tx(() => {
    const s = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!s) throw new HttpError(404, 'Sale not found');
    if (s.status !== 'completed') throw bad('This sale was already reversed');
    for (const it of db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id)) {
      const v = db.prepare('SELECT * FROM variants WHERE id = ?').get(it.variant_id);
      if (!v) continue; // variant removed since; nothing to restore
      db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?').run(it.qty, v.id);
      logMove(v.id, it.product_id, 'sale_reversal', it.qty, v.stock + it.qty, `Reversed sale #${id}${reason ? ': ' + reason : ''}`, id, userId);
    }
    db.prepare("UPDATE sales SET status = 'reversed', reversed_at = datetime('now'), reversed_by = ?, reverse_reason = ? WHERE id = ?").run(userId, reason, id);
    return getSale(id);
  });
}

function getSale(id) {
  const s = db.prepare(`SELECT s.*, u.display_name AS recorded_by FROM sales s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
  if (s) s.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
  return s;
}

// ---------- Reviews ----------
function isVerifiedBuyer(productId, phoneNorm) {
  if (!phoneNorm) return false;
  return db.prepare(`SELECT s.customer_phone FROM sales s JOIN sale_items i ON i.sale_id = s.id
    WHERE s.status = 'completed' AND i.product_id = ? AND s.customer_phone != ''`).all(productId)
    .some(r => normPhone(r.customer_phone) === phoneNorm);
}

// ---------- Reports ----------
function reports() {
  const day = `date(s.created_at, '${tzMod}')`;
  const rev = `COALESCE(SUM(i.qty * i.unit_price), 0)`;
  const base = `FROM sales s JOIN sale_items i ON i.sale_id = s.id WHERE s.status = 'completed'`;
  const group = (expr, since, limit) => db.prepare(`SELECT ${expr} AS period, COUNT(DISTINCT s.id) AS sales, COALESCE(SUM(i.qty),0) AS units, ${rev} AS revenue
    ${base} AND date(s.created_at, '${tzMod}') >= date('now', '${tzMod}', ?) GROUP BY period ORDER BY period DESC LIMIT ?`).all(since, limit);
  const today = db.prepare(`SELECT COUNT(DISTINCT s.id) AS sales, COALESCE(SUM(i.qty),0) AS units, ${rev} AS revenue ${base} AND ${day} = date('now', '${tzMod}')`).get();
  const month = db.prepare(`SELECT COUNT(DISTINCT s.id) AS sales, COALESCE(SUM(i.qty),0) AS units, ${rev} AS revenue ${base} AND strftime('%Y-%m', s.created_at, '${tzMod}') = strftime('%Y-%m', 'now', '${tzMod}')`).get();
  const all = db.prepare(`SELECT COUNT(DISTINCT s.id) AS sales, COALESCE(SUM(i.qty),0) AS units, ${rev} AS revenue ${base}`).get();
  const threshold = parseInt(getSettings().low_stock_threshold, 10) || 3;
  return {
    today, month, all,
    daily: group(day, '-13 days', 14),
    weekly: group(`strftime('%Y-W%W', s.created_at, '${tzMod}')`, '-83 days', 12),
    monthly: group(`strftime('%Y-%m', s.created_at, '${tzMod}')`, '-364 days', 12),
    best: db.prepare(`SELECT i.product_id, i.product_name AS name, i.product_code AS code, SUM(i.qty) AS units, SUM(i.qty * i.unit_price) AS revenue
      ${base} GROUP BY i.product_id ORDER BY units DESC, revenue DESC LIMIT 8`).all(),
    low_stock: db.prepare(`SELECT v.id AS variant_id, p.id AS product_id, p.name, p.code, v.size, v.color, v.stock
      FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' AND v.stock <= ? ORDER BY v.stock ASC, p.name LIMIT 200`).all(threshold),
    threshold,
    stock_units: db.prepare(`SELECT COALESCE(SUM(v.stock),0) AS n FROM variants v JOIN products p ON p.id = v.product_id WHERE p.status = 'active'`).get().n,
    pending_reviews: db.prepare("SELECT COUNT(*) c FROM reviews WHERE status = 'pending'").get().c,
    open_shein: db.prepare("SELECT COUNT(*) c FROM shein_requests WHERE status NOT IN ('Delivered','Cancelled')").get().c,
  };
}

module.exports = { listProducts, getProduct, relatedProducts, changeStock, recordSale, reverseSale, getSale, isVerifiedBuyer, reports, decorate, PRODUCT_SELECT, logMove };
