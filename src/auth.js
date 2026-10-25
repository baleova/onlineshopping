const crypto = require('crypto');
const { db } = require('./db');
const { HttpError, rateLimit, rateClear } = require('./util');

const SESSION_HOURS = 12;
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

function login(username, password, ip) {
  const key = `login:${ip}:${String(username).toLowerCase()}`;
  if (!rateLimit(key, 6, 15 * 60 * 1000)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  const u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1').get(String(username));
  // Always run scrypt so response time does not reveal whether the user exists.
  const ok = verifyPassword(String(password), u ? u.password_hash : 'scrypt$00$00') && u;
  if (!ok) throw new HttpError(401, 'Wrong username or password');
  rateClear(key);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now',?))").run(hashToken(token), u.id, `+${SESSION_HOURS} hours`);
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return { token, user: publicUser(u) };
}
const publicUser = u => ({ id: u.id, username: u.username, display_name: u.display_name || u.username, role: u.role });

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function currentUser(req) {
  const t = parseCookies(req.headers.cookie).bv_session;
  if (!t) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`).get(hashToken(t));
  return row ? publicUser(row) : null;
}
function logout(req) {
  const t = parseCookies(req.headers.cookie).bv_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(t));
}
function cookieHeader(token, maxAgeSec) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `bv_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// Role ranks: owner > manager > staff
const RANK = { staff: 1, manager: 2, owner: 3 };
const requireRole = min => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  if (RANK[req.user.role] < RANK[min]) return res.status(403).json({ error: 'You do not have permission to do this' });
  next();
};
// Mutating admin requests must carry a custom header (blocks cross-site form posts).
const csrfGuard = (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) && req.get('x-requested-with') !== 'baleova') return res.status(403).json({ error: 'Bad request origin' });
  next();
};

function ensureOwner() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  const username = process.env.ADMIN_USERNAME || 'owner';
  let pw = process.env.ADMIN_PASSWORD, generated = false;
  if (!pw) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
  db.prepare("INSERT INTO users(username,display_name,password_hash,role) VALUES(?,?,?,'owner')").run(username, 'Owner', hashPassword(pw));
  console.log('\n  First run: owner account created.');
  console.log(`  Username: ${username}`);
  if (generated) console.log(`  Password: ${pw}   (shown once - change it in Admin > Settings > Team)`);
  else console.log('  Password: the ADMIN_PASSWORD from your .env');
  console.log('');
}

module.exports = { hashPassword, verifyPassword, login, logout, currentUser, cookieHeader, requireRole, csrfGuard, ensureOwner, SESSION_HOURS };
