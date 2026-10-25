// Checks the Telegram backup/restore with a fake Telegram server. Run: npm run test:backup
const http = require('http'), { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pinned = null, files = {};
const tg = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks), m = req.url.replace(/^\/bot[^/]+\//, '');
    const out = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/file/')) return res.end(files[req.url.split('/').pop()]);
    if (m === 'getChat') return out({ ok: true, result: { id: 1, pinned_message: pinned } });
    if (m === 'sendDocument') {
      const b = /boundary=(.+)$/.exec(req.headers['content-type'])[1], parts = body.toString('latin1').split('--' + b);
      const part = parts.find(p => p.includes('name="document"')), start = part.indexOf('\r\n\r\n') + 4;
      const data = Buffer.from(part.slice(start, part.lastIndexOf('\r\n')), 'latin1');
      const fname = /filename="([^"]+)"/.exec(part)[1], id = 'f' + Date.now(); files[id] = data;
      pinned = { message_id: 7, document: { file_id: id, file_name: fname } };
      return out({ ok: true, result: { message_id: 7 } });
    }
    if (m === 'getFile') { const id = JSON.parse(body).file_id; return out({ ok: true, result: { file_path: id } }); }
    if (m === 'getUpdates') return setTimeout(() => out({ ok: true, result: [] }), 500);
    out({ ok: true, result: true });
  });
});
tg.listen(0, async () => {
  const base = `http://localhost:${tg.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-bk-')), PORT = 4100 + Math.floor(Math.random() * 90);
  const env = { ...process.env, PORT, DATA_DIR: dir, TG_API: base, BOT_TOKEN: '1:TEST', ADMIN_CHAT_ID: '1', ADMIN_PASSWORD: 'pw-test-12345', WEBAPP_URL: 'http://localhost', NODE_NO_WARNINGS: '1' };
  const run = () => spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  const api = async (m, u, b, ck) => { const r = await fetch(`http://localhost:${PORT}${u}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'baleova', Cookie: ck || '' }, body: b ? JSON.stringify(b) : undefined }); return { r, j: await r.json().catch(() => null) }; };
  const up = async () => { for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/healthz`); return; } catch { await sleep(200); } } throw new Error('server did not start'); };
  let s = run(); await up();
  const login = await api('POST', '/api/admin/login', { username: 'owner', password: 'pw-test-12345' });
  const ck = login.r.headers.get('set-cookie').split(';')[0];
  const cats = (await api('GET', '/api/admin/categories', null, ck)).j;
  const mk = await api('POST', '/api/admin/products', { code: 'BK-1', name: 'Backup Tee', category_id: cats[0].id, price: 500, variants: [{ size: 'M', color: 'Black', stock: 4 }] }, ck);
  assert.strictEqual(mk.r.status, 201); console.log('  ok - product created');
  s.kill('SIGTERM'); await sleep(2500);                       // shutdown triggers the pending backup
  assert(pinned && pinned.document.file_name.startsWith('baleova-backup-'), 'backup was sent and pinned'); console.log('  ok - backup sent to Telegram on shutdown');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);   // host wiped the disk
  s = run(); await up();
  const list = (await api('GET', '/api/products?limit=10')).j;
  assert(list.some(p => p.code === 'BK-1'), 'product restored'); console.log('  ok - fresh disk restored from the Telegram backup (product is back)');
  const l2 = await api('POST', '/api/admin/login', { username: 'owner', password: 'pw-test-12345' }); assert.strictEqual(l2.r.status, 200); console.log('  ok - owner login still works after restore');
  s.kill('SIGKILL'); tg.close(); fs.rmSync(dir, { recursive: true, force: true }); console.log('\nbackup checks passed'); process.exit(0);
});
