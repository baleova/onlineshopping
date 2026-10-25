const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DATA_DIR } = require('./db');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = m => new HttpError(400, m);

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
function reqStr(v, name, max = 200) { const s = str(v, max); if (!s) throw bad(`${name} is required`); return s; }
function int(v, name, { min = 0, max = 1e9, required = true } = {}) {
  if (v === '' || v == null) { if (required) throw bad(`${name} is required`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}`);
  return n;
}
const flag = v => (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`${name} is invalid`); return v; };

// Phone digits only; Ethiopian numbers normalised to 2519xxxxxxxx / 2517xxxxxxxx.
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 10) d = '251' + d.slice(1);
  if ((d.startsWith('9') || d.startsWith('7')) && d.length === 9) d = '251' + d;
  return d;
}

// ---- simple in-memory rate limiter ----
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < now) b = { n: 0, reset: now + windowMs };
  b.n++; buckets.set(key, b);
  return b.n <= max;
}
const rateClear = key => buckets.delete(key);
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 60000).unref();
const limiter = (name, max, windowMs) => (req, res, next) =>
  rateLimit(`${name}:${req.ip}`, max, windowMs) ? next() : res.status(429).json({ error: 'Too many requests, please try again later.' });

// ---- image sniffing & saving (no trust in client content-type) ----
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
function saveImage(buf, folder) {
  const ext = sniffImage(buf);
  if (!ext) throw bad('Only JPEG, PNG or WebP images are allowed');
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', folder, name), buf);
  return `/uploads/${folder}/${name}`;
}

const wrap = fn => (req, res, next) => { try { const r = fn(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } };
const money = n => Math.round(Number(n) || 0);

module.exports = { HttpError, bad, str, reqStr, int, flag, oneOf, normPhone, rateLimit, rateClear, limiter, saveImage, sniffImage, wrap, money };
