// Tiny dependency-free HTTP framework (Express-like subset) built on node:http.
const http = require('http'), fs = require('fs'), path = require('path');

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.woff2':'font/woff2' };

function compile(p) {
  const keys = [];
  const re = new RegExp('^' + p.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { re, keys };
}

class Router {
  constructor() { this.layers = []; }
  _add(method, p, handlers) { this.layers.push({ method, p: p == null ? null : compile(p), handlers: handlers.flat() }); return this; }
  use(...a) {
    const prefix = typeof a[0] === 'string' ? a.shift() : '';
    for (const h of a.flat()) this.layers.push({ method: null, prefix, handlers: [h] });
    return this;
  }
  handle(req, res, done) {
    let i = 0;
    const origPath = req.path;
    const next = err => {
      if (err) { req.path = origPath; return done(err); }
      const L = this.layers[i++];
      if (!L) { req.path = origPath; return done(); }
      if (L.method && L.method !== req.method && !(L.method === 'GET' && req.method === 'HEAD')) return next();
      let params = {};
      if (L.p) { const m = L.p.re.exec(req.path); if (!m) return next(); L.p.keys.forEach((k, j) => params[k] = decodeURIComponent(m[j + 1])); }
      if (L.prefix != null && L.method === null) {
        if (L.prefix && !(req.path === L.prefix || req.path.startsWith(L.prefix + '/'))) return next();
        const saved = req.path; req.path = L.prefix ? (req.path.slice(L.prefix.length) || '/') : req.path;
        return run(L.handlers[0], err2 => { req.path = saved; next(err2); });
      }
      req.params = params;
      let j = 0;
      const step = e => { if (e) return next(e); const h = L.handlers[j++]; if (!h) return next(); run(h, step); };
      step();
    };
    const run = (h, cb) => {
      try {
        if (h instanceof Router) return h.handle(req, res, cb);
        if (h.length >= 4) return cb();
        const r = h(req, res, cb);
        if (r && r.catch) r.catch(cb);
      } catch (e) { cb(e); }
    };
    next();
  }
}
for (const m of ['get', 'post', 'put', 'patch', 'delete']) Router.prototype[m] = function (p, ...h) { return this._add(m.toUpperCase(), p, h); };

function enhance(req, res, trustProxy) {
  const u = new URL(req.url, 'http://x');
  req.path = decodeURIComponent(u.pathname);
  req.query = Object.fromEntries(u.searchParams);
  req.get = n => req.headers[String(n).toLowerCase()];
  req.ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  req.body = undefined; req.params = {};
  res.status = n => { res.statusCode = n; return res; };
  res.set = (k, v) => { res.setHeader(k, v); return res; };
  res.type = t => { res.setHeader('Content-Type', t.includes('/') ? t : (MIME['.' + t] || t)); return res; };
  res.json = o => { const b = Buffer.from(JSON.stringify(o)); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', b.length); res.end(b); };
  res.send = b => { if (typeof b === 'object' && !Buffer.isBuffer(b)) return res.json(b); if (!res.getHeader('Content-Type')) res.type('text/html; charset=utf-8'); res.end(b); };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Upload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// JSON body parser (applies only to application/json)
const json = (limit = 1024 * 1024) => async (req, res, next) => {
  if (req.body !== undefined || !/application\/json/i.test(req.get('content-type') || '')) return next();
  try { const b = await readBody(req, limit); req.body = b.length ? JSON.parse(b.toString('utf8')) : {}; next(); }
  catch (e) { next(e.status ? e : Object.assign(new Error('Invalid JSON'), { status: 400 })); }
};
// Raw body for image uploads. Content-type must start with image/.
const raw = ({ limit = 5 * 1024 * 1024 } = {}) => async (req, res, next) => {
  if (!/^image\//i.test(req.get('content-type') || '')) return next(Object.assign(new Error('Send the image as image/jpeg, image/png or image/webp'), { status: 400 }));
  try { req.body = await readBody(req, limit); next(); } catch (e) { next(e); }
};
const parseLimit = s => typeof s === 'number' ? s : (/^(\d+)mb$/i.test(s) ? +RegExp.$1 * 1048576 : 1048576);

function serveStatic(root, { prefix = '', maxAge = 0, indexFile = 'index.html' } = {}) {
  root = path.resolve(root);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p = req.path;
    if (prefix) { if (!p.startsWith(prefix + '/')) return next(); p = p.slice(prefix.length); }
    let file = path.join(root, path.normalize(p));
    if (!file.startsWith(root + path.sep) && file !== root) return next();
    fs.stat(file, (e, st) => {
      if (!e && st.isDirectory()) { file = path.join(file, indexFile); return fs.stat(file, (e2, st2) => e2 ? next() : send(file, st2)); }
      if (e || !st.isFile()) return next();
      send(file, st);
    });
    function send(f, st) {
      const ext = path.extname(f).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : `public, max-age=${maxAge}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f).pipe(res);
    }
  };
}

function createApp({ trustProxy = false } = {}) {
  const app = new Router();
  app.errorHandler = (err, req, res) => { res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' }); };
  app.server = http.createServer((req, res) => {
    try { enhance(req, res, trustProxy); } catch { res.statusCode = 400; return res.end('Bad request'); }
    app.handle(req, res, err => {
      if (res.headersSent) return res.end();
      if (err) { if (!err.status) console.error(err); return app.errorHandler(err, req, res); }
      res.status(404).json({ error: 'Not found' });
    });
  });
  app.listen = (port, cb) => { app.server.on('error', e => {
      if (e.code === 'EADDRINUSE') { console.error(`\n  Port ${port} is already in use. Close the other copy of this server, or set PORT=3001 in .env.\n`); process.exit(1); }
      throw e; });
    return app.server.listen(port, cb); };
  return app;
}
module.exports = { createApp, Router, json, raw, serveStatic, parseLimit };
