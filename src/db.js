const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SETTING_TRANSLATIONS } = require('./i18n');

const DATA_DIR = path.resolve(process.env.DATA_DIR || '.');
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'products'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'reviews'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'shein'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'banners'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'baleova.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Run fn inside an IMMEDIATE transaction (takes the write lock up front, so stock checks are race-free).
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id), price INTEGER NOT NULL CHECK(price >= 0),
  sale_price INTEGER CHECK(sale_price IS NULL OR sale_price >= 0),
  description TEXT DEFAULT '', material TEXT DEFAULT '', fit TEXT DEFAULT '', specs TEXT DEFAULT '',
  is_featured INTEGER DEFAULT 0, is_new INTEGER DEFAULT 0, is_best INTEGER DEFAULT 0, is_offer INTEGER DEFAULT 0,
  out_of_stock INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  is_demo INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS product_images(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS variants(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL, color TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  UNIQUE(product_id, size, color));
CREATE TABLE IF NOT EXISTS inventory_movements(
  id INTEGER PRIMARY KEY, variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, type TEXT NOT NULL CHECK(type IN ('initial','restock','adjustment','sale','sale_reversal')),
  qty_change INTEGER NOT NULL, stock_after INTEGER NOT NULL, note TEXT DEFAULT '', sale_id INTEGER,
  user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL CHECK(channel IN ('phone','whatsapp','telegram','in_person','other')),
  customer_name TEXT DEFAULT '', customer_phone TEXT DEFAULT '', note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','reversed')),
  total INTEGER NOT NULL, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_at TEXT, reversed_by INTEGER, reverse_reason TEXT);
CREATE TABLE IF NOT EXISTS sale_items(
  id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, variant_id INTEGER NOT NULL, qty INTEGER NOT NULL CHECK(qty > 0),
  unit_price INTEGER NOT NULL, product_name TEXT, product_code TEXT, size TEXT, color TEXT);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT DEFAULT '',
  phone_norm TEXT DEFAULT '', tg_user_id TEXT DEFAULT '', verified INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  admin_reply TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS review_photos(
  id INTEGER PRIMARY KEY, review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shein_items(
  id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, link TEXT DEFAULT '',
  est_price INTEGER, sizes TEXT DEFAULT '', colors TEXT DEFAULT '', note TEXT DEFAULT '', image TEXT DEFAULT '',
  active INTEGER DEFAULT 1, is_demo INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS shein_requests(
  id INTEGER PRIMARY KEY, item_id INTEGER REFERENCES shein_items(id) ON DELETE SET NULL,
  item_ref TEXT DEFAULT '', customer_name TEXT NOT NULL, customer_phone TEXT DEFAULT '', channel TEXT DEFAULT 'whatsapp',
  size TEXT DEFAULT '', color TEXT DEFAULT '', qty INTEGER DEFAULT 1, quoted_price INTEGER, note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Requested' CHECK(status IN ('Requested','Price Quoted','Confirmed','Ordered','In Transit','Arrived','Delivered','Cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS shein_request_log(
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES shein_requests(id) ON DELETE CASCADE,
  status TEXT, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS banners(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT DEFAULT '', image TEXT DEFAULT '',
  link TEXT DEFAULT '', placement TEXT NOT NULL DEFAULT 'hero' CHECK(placement IN ('hero','promo')),
  sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id, status);
CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_moves_product ON inventory_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, status);
`);

const SETTING_DEFAULTS = {
  store_name: 'BALEOVA', tagline: 'Born in Bale. Worn Everywhere.',
  phone: '', whatsapp: '', telegram: '', bot_username: '',
  address: 'Bale, Oromia, Ethiopia', map_url: '', hours: 'Mon-Sat 8:30 AM - 7:00 PM',
  delivery_info: 'We deliver across Ethiopia. Delivery fee and time depend on your town and are confirmed when you contact us.',
  policies: 'Prices are in Ethiopian birr (ETB). Availability is confirmed when you contact us. Payment and delivery are arranged directly with BALEOVA. Please check size and colour with us before buying.',
  shein_notice: 'SHEIN prices, shipping cost, availability and delivery time must be confirmed with us before we accept your order. The price shown is only an estimate.',
  instagram: '', facebook: '', tiktok: '', low_stock_threshold: '3',
  tg_autopost: '1',   // 1 = every new product is posted to the active Telegram channels (can be switched off per product)
  tg_miniapp: '',     // optional: short name of the Mini App from BotFather, so channel posts open the product inside Telegram
};
Object.assign(SETTING_DEFAULTS, SETTING_TRANSLATIONS);
for (const [k, v] of Object.entries(SETTING_DEFAULTS)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
const getSettings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));

const CATEGORIES = [['tshirts','T-shirts'],['hoodies','Hoodies & Sweatshirts'],['shoes','Sneakers & Shoes'],['trousers','Trousers & Pants'],['bags','Bags & Accessories'],['electronics','Electronics'],['other','Other']];
CATEGORIES.forEach(([slug, name], i) => db.prepare('INSERT OR IGNORE INTO categories(slug,name,sort) VALUES(?,?,?)').run(slug, name, i));

// Add translation columns / tables to databases created before languages were added.
for (const [t, c, d] of [['products','name_om'],['products','name_am'],['products','description_om'],['products','description_am'],
  ['products','gender',"'unisex'"],['products','cond',"'new'"],
  ['banners','title_om'],['banners','title_am'],['banners','subtitle_om'],['banners','subtitle_am'],['shein_items','title_om'],['shein_items','title_am']]) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT NOT NULL DEFAULT ${d || "''"}`); } catch { /* already there */ }
}
db.exec('CREATE TABLE IF NOT EXISTS bot_users(chat_id TEXT PRIMARY KEY, lang TEXT NOT NULL DEFAULT \'en\')');
// Telegram channels / groups the shop posts new products to. One bot can post to many of them.
db.exec(`
CREATE TABLE IF NOT EXISTS channels(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, chat TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL DEFAULT 'en' CHECK(lang IN ('en','om','am')),
  audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','men','women')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS channel_posts(
  id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  message_id INTEGER, ok INTEGER NOT NULL DEFAULT 1, error TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_posts_product ON channel_posts(product_id);
`);

module.exports = { db, tx, DATA_DIR, getSettings, SETTING_DEFAULTS };
