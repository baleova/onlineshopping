try { process.loadEnvFile(); } catch { /* no .env file - settings come from the host's environment */ }
const path = require('path');
const backup = require('./src/backup');

(async () => {
  await backup.restoreIfNeeded();          // fresh free-host disk: bring the shop back from Telegram first

  const { createApp, json, serveStatic } = require('./src/mini');
  const { DATA_DIR } = require('./src/db');
  const { ensureOwner } = require('./src/auth');
  const { seedBanners } = require('./src/firstrun');
  const { startBot, webhookHandler } = require('./src/telegram');

  const PORT = Number(process.env.PORT) || 3000;
  const app = createApp({ trustProxy: process.env.TRUST_PROXY === '1' });

  // Security headers. Telegram's script and Google Fonts are the only outside sources allowed.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.set('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self' https://telegram.org", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:", "connect-src 'self'",
      // The store must be embeddable inside Telegram (and nowhere else).
      "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org", "base-uri 'self'", "form-action 'self'"].join('; '));
    if (req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) res.set('Cache-Control', 'no-store');
    // Any successful change to the shop schedules a Telegram backup.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.startsWith('/api/') && !/login|logout|tg\//.test(req.path))
      res.on('finish', () => { if (res.statusCode < 400) backup.markDirty(); });
    next();
  });
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(json());
  app.post('/api/tg/webhook', webhookHandler);
  app.use('/api/admin', require('./src/admin-api'));
  app.use('/api', require('./src/public-api'));
  app.use(serveStatic(path.join(DATA_DIR, 'uploads'), { prefix: '/uploads', maxAge: 604800 }));
  app.use(serveStatic(path.join(__dirname, 'public'), { maxAge: 3600 }));

  ensureOwner();
  seedBanners();
  app.listen(PORT, () => {
    console.log(`\n  BALEOVA is running`);
    console.log(`  Store: http://localhost:${PORT}`);
    console.log(`  Admin: http://localhost:${PORT}/admin/\n`);
    startBot().catch(e => console.error('Telegram bot stopped:', e.message));
    backup.start();
    // Optional: free hosts put idle sites to sleep. Visiting our own public address every 10 minutes keeps it awake.
    if (process.env.KEEP_AWAKE === '1' && /^https:\/\//.test(process.env.WEBAPP_URL || ''))
      setInterval(() => fetch(process.env.WEBAPP_URL.replace(/\/+$/, '') + '/healthz').catch(() => {}), 10 * 60 * 1000).unref();
  });
})();
