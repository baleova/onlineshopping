// Free hosts (Render, Hugging Face...) wipe the disk on every restart. This keeps your data safe without any paid disk:
// the server sends a compressed backup (database + uploaded photos) to YOUR private Telegram chat with the bot and pins it.
// On a fresh start with an empty disk it downloads the pinned backup and restores it before anything else runs.
// Needs BOT_TOKEN and ADMIN_CHAT_ID. Without them nothing happens (fine for a VPS or a local PC).
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const DATA_DIR = path.resolve(process.env.DATA_DIR || '.');
const TOKEN = () => process.env.BOT_TOKEN, CHAT = () => process.env.ADMIN_CHAT_ID;
const TG = () => (process.env.TG_API || 'https://api.telegram.org').replace(/\/+$/, '');
const enabled = () => !!(TOKEN() && CHAT() && process.env.BACKUP !== '0');
const LIMIT = 19 * 1024 * 1024;               // Telegram bots can download files up to 20 MB
const PREFIX = 'baleova-backup-';
let dirty = false, blocked = false, running = false;

const call = (m, body) => fetch(`${TG()}/bot${TOKEN()}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
}).then(r => r.json());

// ---- tiny archive format: [u32 nameLen][name][u32 size][data] ..., gzip-compressed ----
function pack(files) {
  const parts = [];
  for (const [name, data] of files) { const n = Buffer.from(name), h = Buffer.alloc(4); h.writeUInt32BE(n.length); const z = Buffer.alloc(4); z.writeUInt32BE(data.length); parts.push(h, n, z, data); }
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}
function unpack(buf) {
  const b = zlib.gunzipSync(buf), out = []; let o = 0;
  while (o < b.length) { const nl = b.readUInt32BE(o); o += 4; const name = b.toString('utf8', o, o + nl); o += nl; const sz = b.readUInt32BE(o); o += 4; out.push([name, b.subarray(o, o + sz)]); o += sz; }
  return out;
}
function listUploads(dir = path.join(DATA_DIR, 'uploads'), rel = 'uploads') {
  let out = [];
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name), r = rel + '/' + e.name;
    if (e.isDirectory()) out = out.concat(listUploads(p, r)); else if (e.isFile() && e.name !== '.gitkeep') out.push([r, p]);
  }
  return out;
}

function snapshot(withUploads = true) {
  const { db } = require('./db');
  const tmp = path.join(DATA_DIR, `.snapshot-${process.pid}.db`);
  try { fs.rmSync(tmp, { force: true }); db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); } catch (e) { throw new Error('database snapshot failed: ' + e.message); }
  const files = [['baleova.db', fs.readFileSync(tmp)]]; fs.rmSync(tmp, { force: true });
  if (withUploads) for (const [rel, p] of listUploads()) { try { files.push([rel, fs.readFileSync(p)]); } catch {} }
  return pack(files);
}

async function runBackup(reason = 'auto') {
  if (!enabled() || blocked || running) return false;
  running = true;
  try {
    let buf = snapshot(true), note = '';
    if (buf.length > LIMIT) { buf = snapshot(false); note = ' (photos too big for a Telegram backup - database only)'; console.log('  Backup: photos exceed 19 MB, saving database only.'); }
    if (buf.length > LIMIT) throw new Error('database alone is over 19 MB');
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const old = await call('getChat', { chat_id: CHAT() }).then(r => r.ok && r.result.pinned_message).catch(() => null);
    const fd = new FormData();
    fd.append('chat_id', CHAT()); fd.append('disable_notification', 'true');
    fd.append('caption', `BALEOVA data backup${note}\nKeep this message pinned - it restores your shop if the host restarts.`);
    fd.append('document', new Blob([buf]), `${PREFIX}${stamp}.bin`);
    const r = await fetch(`${TG()}/bot${TOKEN()}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) }).then(x => x.json());
    if (!r.ok) throw new Error(r.description);
    await call('pinChatMessage', { chat_id: CHAT(), message_id: r.result.message_id, disable_notification: true });
    if (old && old.document && String(old.document.file_name || '').startsWith(PREFIX)) {
      call('unpinChatMessage', { chat_id: CHAT(), message_id: old.message_id }).catch(() => {});
      call('deleteMessage', { chat_id: CHAT(), message_id: old.message_id }).catch(() => {});
    }
    dirty = false; console.log(`  Backup saved to Telegram (${(buf.length / 1024).toFixed(0)} KB, ${reason}).`);
    return true;
  } catch (e) { console.error('  Backup failed:', e.message); return false; }
  finally { running = false; }
}

// Called on a fresh disk, BEFORE the database is opened. Returns normally if the app may start.
async function restoreIfNeeded() {
  if (!enabled()) return;
  const dbFile = path.join(DATA_DIR, 'baleova.db');
  if (fs.existsSync(dbFile)) return;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const chat = await call('getChat', { chat_id: CHAT() });
      if (!chat.ok) throw new Error(chat.description + ' (open your bot in Telegram and press Start, and check ADMIN_CHAT_ID)');
      const pm = chat.result.pinned_message;
      if (!pm || !pm.document || !String(pm.document.file_name || '').startsWith(PREFIX)) { console.log('  Restore: no backup found - starting a new shop.'); return; }
      const f = await call('getFile', { file_id: pm.document.file_id });
      if (!f.ok) throw new Error(f.description);
      const res = await fetch(`${TG()}/file/bot${TOKEN()}/${f.result.file_path}`, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('download failed ' + res.status);
      const files = unpack(Buffer.from(await res.arrayBuffer()));
      if (!files.some(([n]) => n === 'baleova.db')) throw new Error('backup has no database');
      for (const [name, data] of files) {
        if (name !== 'baleova.db' && !/^uploads\/(products|reviews|shein|banners)\/[\w.-]+$/.test(name)) continue;   // never write anywhere else
        const dest = path.join(DATA_DIR, name); fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(name === 'baleova.db' ? dest + '.tmp' : dest, data);
      }
      fs.renameSync(dbFile + '.tmp', dbFile);
      console.log(`  Restore: shop data restored from your Telegram backup (${files.length - 1} photos).`);
      return;
    } catch (e) {
      console.error(`  Restore attempt ${attempt} failed: ${e.message}`);
      await new Promise(r => setTimeout(r, 4000 * attempt));
    }
  }
  // Starting empty now would let the next backup overwrite the good one. Refuse to start instead.
  blocked = true;
  console.error('\n  Could not reach your Telegram backup, so the server will not start (this protects your data). It will retry when the host restarts it.\n');
  process.exit(1);
}

function markDirty() { dirty = true; }
function start() {
  if (!enabled()) return console.log('  Backup: off (set BOT_TOKEN and ADMIN_CHAT_ID to back up to Telegram)');
  console.log('  Backup: on - data is saved to your Telegram chat after changes');
  setTimeout(() => runBackup('startup'), 20000).unref();                                  // makes sure a fresh deploy has a backup
  setInterval(() => { if (dirty) runBackup('after changes'); }, 5 * 60 * 1000).unref();   // at most one backup per 5 minutes
  const bye = async () => { if (dirty) await runBackup('shutdown'); process.exit(0); };
  process.once('SIGTERM', bye); process.once('SIGINT', bye);
}
module.exports = { restoreIfNeeded, start, markDirty, runBackup, enabled, pack, unpack };
