(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const etb = n => `${Number(n || 0).toLocaleString('en-US')} ETB`;
const when = s => s ? s.replace('T', ' ').slice(0, 16) + ' UTC' : '';
const localWhen = s => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
let toastT;
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 3500); }

let ME = null;
async function api(method, url, body, rawType) {
  const r = await fetch('/api/admin' + url, { method, headers: { 'X-Requested-With': 'baleova', ...(rawType ? { 'Content-Type': rawType } : body ? { 'Content-Type': 'application/json' } : {}) }, body: rawType ? body : body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch {}
  if (r.status === 401 && ME) { ME = null; renderLogin('Your session ended. Please sign in again.'); throw new Error('Signed out'); }
  if (!r.ok) throw new Error((d && d.error) || 'Something went wrong');
  return d;
}
const act = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r === undefined ? true : r; } catch (e) { if (e.message !== 'Signed out') toast(e.message, true); return false; } };
const RANK = { staff: 1, manager: 2, owner: 3 }, can = r => RANK[ME.role] >= RANK[r];

/* ---------- modal ---------- */
function modal(title, body, actions = []) {
  return new Promise(resolve => {
    const d = h('dialog', null, h('div', { class: 'hd' }, h('b', null, title), h('button', { class: 'btn sm', onclick: () => d.close() }, 'Close')), h('div', { class: 'bd' }, body),
      actions.length > 0 && h('div', { class: 'ft' }, actions.map(a => h('button', { class: 'btn ' + (a.cls || ''), onclick: async e => { e.target.disabled = true; const ok = await a.run(d); e.target.disabled = false; if (ok) d.close(); } }, a.label))));
    d.addEventListener('close', () => { d.remove(); resolve(); });
    document.body.append(d); d.showModal();
  });
}
const field = (label, input, hint) => h('label', { class: 'f' }, label, input, hint && h('small', null, hint));
const ask = (title, fields, submitLabel, run, cls = 'pri') => modal(title, fields, [{ label: submitLabel, cls, run }]);

/* ---------- login ---------- */
function renderLogin(msg) {
  const err = h('p', { class: 'err', role: 'alert' }, msg || '');
  const u = h('input', { autocomplete: 'username', required: true }), p = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  $('#app').replaceChildren(h('div', { class: 'login' }, h('form', { class: 'card', onsubmit: async e => {
    e.preventDefault(); err.textContent = '';
    try { const r = await api('POST', '/login', { username: u.value, password: p.value }); ME = r.user; start(); } catch (x) { err.textContent = x.message; }
  } }, h('img', { src: '/brand/mark.svg', alt: 'BALEOVA', width: 64, height: 64, style: 'display:block;margin:0 auto 10px' }), h('h1', { style: 'text-align:center' }, 'BALEOVA'), h('p', { class: 'sub', style: 'margin:0' }, 'Admin sign in'), field('Username', u), field('Password', p), err, h('button', { class: 'btn pri', type: 'submit', style: 'justify-content:center' }, 'Sign in'))));
  u.focus();
}

/* ---------- shell ---------- */
const VIEWS = [['dashboard', 'Dashboard', 'staff'], ['sales', 'Sales', 'staff'], ['products', 'Products', 'staff'], ['inventory', 'Inventory', 'staff'], ['reviews', 'Reviews', 'manager'], ['shein', 'SHEIN Orders', 'staff'], ['settings', 'Settings', 'manager']];
let current = 'dashboard', counts = {};
async function start() {
  const view = h('main', { id: 'view' });
  const nav = h('aside', null, h('div', { class: 'brand' }, h('img', { src: '/brand/mark.svg', alt: '', width: 30, height: 30 }), 'BALEOV', h('b', null, 'A')),
    VIEWS.filter(v => can(v[2])).map(([k, label]) => h('button', { class: 'nav' + (k === current ? ' on' : ''), 'data-k': k, onclick: () => go(k) }, label, h('span', { class: 'pill-n', 'data-c': k, hidden: true }))),
    h('a', { class: 'nav', style: 'padding:10px 12px;opacity:.78;text-decoration:none', href: '/', target: '_blank' }, 'View store ↗'),
    h('div', { class: 'who' }, h('div', null, ME.display_name, ' · ', ME.role), h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: async () => { await api('POST', '/logout'); ME = null; renderLogin(); } }, 'Sign out')));
  $('#app').replaceChildren(h('div', { class: 'shell' }, nav, view));
  go(location.hash.slice(1) && VIEWS.some(v => v[0] === location.hash.slice(1) && can(v[2])) ? location.hash.slice(1) : 'dashboard');
}
async function go(k) {
  current = k; location.hash = k;
  document.querySelectorAll('aside .nav[data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  const v = $('#view'); v.replaceChildren(h('p', { class: 'muted' }, 'Loading...'));
  try { await ({ dashboard, sales, products, inventory, reviews, shein, settings })[k](v); } catch (e) { if (e.message !== 'Signed out') v.replaceChildren(h('p', { class: 'err' }, e.message)); }
}
const header = (title, sub, ...right) => h('div', { class: 'top' }, h('div', null, h('h1', null, title), sub && h('p', { class: 'sub', style: 'margin:0' }, sub)), h('div', { class: 'row' }, right));
const table = (cols, rows, empty = 'Nothing here yet.') => rows.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, cols.map(c => h('th', { class: c.startsWith('#') ? 'num' : '' }, c.replace(/^#/, ''))))), h('tbody', null, rows))) : h('p', { class: 'muted' }, empty);

/* ---------- dashboard ---------- */
async function dashboard(v) {
  const d = await api('GET', '/dashboard');
  const kpi = (t, s) => h('div', { class: 'card kpi' }, h('small', null, t), h('b', null, etb(s.revenue)), h('span', null, `${s.units} unit${s.units === 1 ? '' : 's'} · ${s.sales} sale${s.sales === 1 ? '' : 's'}`));
  let tab = 'daily';
  const rep = h('div');
  const drawRep = () => {
    const rows = [...d[tab]].reverse(), max = Math.max(1, ...rows.map(r => r.revenue));
    rep.replaceChildren(rows.length ? h('div', null, h('div', { class: 'chart', role: 'img', 'aria-label': `${tab} revenue` }, rows.map(r => h('div', { title: `${r.period}: ${etb(r.revenue)}` }, h('i', { style: `height:${Math.max(2, r.revenue / max * 100)}%` }), h('span', null, r.period.slice(tab === 'monthly' ? 2 : 5))))), table(['Period', '#Sales', '#Units', '#Revenue'], [...d[tab]].map(r => h('tr', null, h('td', null, r.period), h('td', { class: 'num' }, r.sales), h('td', { class: 'num' }, r.units), h('td', { class: 'num' }, etb(r.revenue)))))) : h('p', { class: 'muted' }, 'No sales recorded in this period yet.'));
  };
  drawRep();
  const tabs = h('div', { class: 'tabs' }, [['daily', 'Daily (14 days)'], ['weekly', 'Weekly (12 weeks)'], ['monthly', 'Monthly (12 months)']].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: e => { tab = k; [...tabs.children].forEach(b => b.classList.toggle('on', b === e.target)); drawRep(); } }, l)));
  setBadges({ reviews: d.pending_reviews, shein: d.open_shein });
  v.replaceChildren(header('Dashboard', 'Sales are only counted when you record them. Figures are in ETB.', h('button', { class: 'btn gold', onclick: () => go('sales') }, 'Record a sale')),
    h('div', { class: 'kpis' }, kpi('Today', d.today), kpi('This month', d.month), kpi('All time', d.all), h('div', { class: 'card kpi' }, h('small', null, 'Units in stock'), h('b', null, d.stock_units), h('span', null, `${d.low_stock.length} low or empty`))),
    h('h2', null, 'Sales report'), tabs, rep,
    h('h2', null, 'Best sellers'), table(['Product', '#Units sold', '#Revenue'], d.best.map(b => h('tr', null, h('td', null, b.name, h('span', { class: 'muted' }, ` ${b.code}`)), h('td', { class: 'num' }, b.units), h('td', { class: 'num' }, etb(b.revenue)))), 'No sales yet.'),
    h('h2', null, `Low stock (${d.threshold} or fewer)`), table(['Product', 'Size', 'Colour', '#Left', ''], d.low_stock.map(l => h('tr', null, h('td', null, l.name, h('span', { class: 'muted' }, ` ${l.code}`)), h('td', null, l.size), h('td', null, l.color), h('td', { class: 'num' }, h('span', { class: 'tag ' + (l.stock === 0 ? 'bad' : 'warn') }, l.stock)), h('td', null, can('manager') && h('button', { class: 'btn sm', onclick: () => stockDialog(l.variant_id, `${l.name} ${l.size}/${l.color}`, l.stock, 'restock', () => go('dashboard')) }, 'Restock')))), 'Nothing is running low.'));
}
function setBadges(m) { for (const [k, n] of Object.entries(m)) { const b = $(`[data-c="${k}"]`); if (b) { b.hidden = !n; b.textContent = n; } } }

/* ---------- stock dialog ---------- */
function stockDialog(variantId, label, current, type, done) {
  const qty = h('input', { type: 'number', step: '1', value: type === 'restock' ? '' : '', required: true }), note = h('input', { maxlength: '300', placeholder: type === 'restock' ? 'e.g. new batch from supplier' : 'Reason (required)' });
  return ask(type === 'restock' ? 'Add stock' : 'Adjust stock', [h('p', { class: 'muted', style: 'margin:0' }, `${label} - currently ${current} in stock`),
    field(type === 'restock' ? 'Units to add' : 'Change (use a minus to remove, e.g. -2)', qty), field(type === 'restock' ? 'Note (optional)' : 'Reason', note)],
    'Save', async () => { const ok = await act(() => api('POST', '/inventory/change', { variant_id: variantId, type, qty: Number(qty.value), note: note.value }), 'Stock updated'); if (ok) done && done(); return !!ok; });
}

/* ---------- sales ---------- */
async function sales(v) {
  const lines = [];
  const list = h('div'), linesEl = h('div'), results = h('div');
  const channel = h('select', null, [['whatsapp', 'WhatsApp'], ['phone', 'Phone call'], ['telegram', 'Telegram'], ['in_person', 'In person'], ['other', 'Other']].map(([k, l]) => h('option', { value: k }, l)));
  const cname = h('input', { maxlength: '80', placeholder: 'Customer name (optional)' }), cphone = h('input', { type: 'tel', maxlength: '30', placeholder: 'Phone (needed for "Verified purchase" reviews)' }), note = h('input', { maxlength: '300', placeholder: 'Note (optional)' });
  const total = h('b'), search = h('input', { type: 'search', placeholder: 'Search product name or code to add...' });
  const drawLines = () => {
    total.textContent = etb(lines.reduce((s, l) => s + l.qty * l.price, 0));
    linesEl.replaceChildren(lines.length ? table(['Item', '#Available', 'Qty', 'Unit price', ''], lines.map((l, i) => h('tr', null, h('td', null, l.name, h('div', { class: 'muted' }, `${l.code} · ${l.size} / ${l.color}`)), h('td', { class: 'num' }, l.stock),
      h('td', { style: 'width:90px' }, h('input', { type: 'number', min: '1', max: l.stock, value: l.qty, oninput: e => { l.qty = Math.floor(+e.target.value) || 0; total.textContent = etb(lines.reduce((s, x) => s + x.qty * x.price, 0)); } })),
      h('td', { style: 'width:130px' }, h('input', { type: 'number', min: '0', value: l.price, oninput: e => { l.price = Math.floor(+e.target.value) || 0; total.textContent = etb(lines.reduce((s, x) => s + x.qty * x.price, 0)); } })),
      h('td', null, h('button', { class: 'btn sm', onclick: () => { lines.splice(i, 1); drawLines(); } }, 'Remove'))))) : h('p', { class: 'muted' }, 'Search above and pick the exact size and colour that was sold.'));
  };
  let st; search.addEventListener('input', () => { clearTimeout(st); st = setTimeout(async () => {
    if (!search.value.trim()) return results.replaceChildren();
    const vs = await act(() => api('GET', '/variants?q=' + encodeURIComponent(search.value)));
    if (!vs) return;
    results.replaceChildren(table(['Item', 'Size', 'Colour', '#Stock', '#Price', ''], vs.map(x => h('tr', null, h('td', null, x.name, h('span', { class: 'muted' }, ` ${x.code}`)), h('td', null, x.size), h('td', null, x.color), h('td', { class: 'num' }, x.stock), h('td', { class: 'num' }, etb(x.price)),
      h('td', null, h('button', { class: 'btn sm', disabled: x.stock < 1, onclick: () => { const ex = lines.find(l => l.id === x.id); if (ex) ex.qty = Math.min(ex.qty + 1, x.stock); else lines.push({ id: x.id, name: x.name, code: x.code, size: x.size, color: x.color, stock: x.stock, qty: 1, price: x.price }); drawLines(); } }, x.stock < 1 ? 'Sold out' : 'Add')))), 'No matching products.'));
  }, 250); });
  const submit = h('button', { class: 'btn gold', onclick: async e => {
    if (!lines.length) return toast('Add at least one item first.', true);
    if (lines.some(l => l.qty < 1)) return toast('Every quantity must be 1 or more.', true);
    e.target.disabled = true;
    const ok = await act(() => api('POST', '/sales', { channel: channel.value, customer_name: cname.value, customer_phone: cphone.value, note: note.value, items: lines.map(l => ({ variant_id: l.id, qty: l.qty, unit_price: l.price })) }), 'Sale recorded. Stock updated.');
    e.target.disabled = false; if (ok) go('sales');
  } }, 'Record sale');
  async function loadList() {
    const rows = await api('GET', '/sales');
    list.replaceChildren(table(['#', 'When', 'Items', 'Customer', 'Channel', '#Total', 'Status', ''], rows.map(s => h('tr', null, h('td', null, s.id), h('td', null, localWhen(s.created_at)),
      h('td', null, s.items.map(i => h('div', null, `${i.qty} × ${i.product_name} (${i.size}/${i.color})`))), h('td', null, s.customer_name || '-', s.customer_phone && h('div', { class: 'muted' }, s.customer_phone)), h('td', null, s.channel.replace('_', ' ')), h('td', { class: 'num' }, etb(s.total)),
      h('td', null, h('span', { class: 'tag ' + (s.status === 'completed' ? 'ok' : 'bad') }, s.status), s.status === 'reversed' && s.reverse_reason && h('div', { class: 'muted' }, s.reverse_reason)),
      h('td', null, can('manager') && s.status === 'completed' && h('button', { class: 'btn sm danger', onclick: () => { const reason = h('input', { maxlength: '200', placeholder: 'e.g. customer returned item' }); ask(`Reverse sale #${s.id}`, [h('p', { class: 'muted', style: 'margin:0' }, 'The items go back into stock and the sale no longer counts in reports.'), field('Reason', reason)], 'Reverse sale', async () => !!(await act(() => api('POST', `/sales/${s.id}/reverse`, { reason: reason.value }), 'Sale reversed. Stock restored.')) && (loadList(), true), 'danger'); } }, 'Reverse')))), 'No sales recorded yet.'));
  }
  v.replaceChildren(header('Sales', 'Record each sale after you agree it with the customer. Stock goes down automatically.'),
    h('div', { class: 'card', style: 'display:grid;gap:12px' }, h('b', null, 'Record a sale'), searchBox(search), results, linesEl,
      h('div', { class: 'grid2' }, field('Sold through', channel), field('Customer', cname), field('Customer phone', cphone), field('Note', note)),
      h('div', { class: 'row' }, h('span', null, 'Total: ', total), h('span', { class: 'right' }, submit))),
    h('h2', null, 'Recent sales'), list);
  drawLines(); await loadList();
}

/* ---------- products ---------- */
const searchBox = inp => { inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.dispatchEvent(new Event('input')); } });
  return h('div', { class: 'sbox' }, inp, h('button', { class: 'btn gold sm', type: 'button', onclick: () => inp.dispatchEvent(new Event('input')) }, 'Search')); };
async function products(v) {
  const cats = await api('GET', '/categories');
  const q = h('input', { type: 'search', placeholder: 'Search name or code' }), status = h('select', null, [['', 'All'], ['active', 'Active'], ['archived', 'Archived']].map(([k, l]) => h('option', { value: k }, l)));
  const list = h('div');
  async function load() {
    const rows = await api('GET', `/products?status=${status.value}&q=${encodeURIComponent(q.value)}`);
    list.replaceChildren(table(['', 'Product', 'Category', '#Price', '#Stock', '#Sold', 'Flags', ''], rows.map(p => h('tr', null,
      h('td', null, p.cover && h('img', { class: 'thumb', src: p.cover, alt: '', loading: 'lazy' })), h('td', null, h('b', null, p.name), h('div', { class: 'muted' }, p.code)), h('td', null, p.category_name),
      h('td', { class: 'num' }, etb(p.final_price), p.sale_price != null && h('div', { class: 'muted' }, h('s', null, etb(p.price)))),
      h('td', { class: 'num' }, h('span', { class: 'tag ' + (p.stock_status === 'out' ? 'bad' : p.stock_status === 'low' ? 'warn' : 'ok') }, p.total_stock)), h('td', { class: 'num' }, p.units_sold),
      h('td', null, p.status === 'archived' && h('span', { class: 'tag bad' }, 'Archived'), p.condition === 'bonda' && h('span', { class: 'tag warn' }, 'Bonda'), p.gender !== 'unisex' && h('span', { class: 'tag' }, p.gender === 'men' ? 'Men' : 'Women'), p.is_featured && h('span', { class: 'tag gold' }, 'Featured'), p.is_new && h('span', { class: 'tag' }, 'New'), p.is_best && h('span', { class: 'tag' }, 'Best seller'), p.is_offer && h('span', { class: 'tag' }, 'Offer'), p.out_of_stock && h('span', { class: 'tag bad' }, 'Marked out')),
      h('td', { style: 'white-space:nowrap' }, can('manager') && [h('button', { class: 'btn sm', onclick: () => editor(p.id) }, 'Edit'), ' ',
        h('button', { class: 'btn sm', onclick: async () => { if (await act(() => api('PATCH', `/products/${p.id}/status`, { status: p.status === 'active' ? 'archived' : 'active' }), p.status === 'active' ? 'Archived' : 'Restored')) load(); } }, p.status === 'active' ? 'Archive' : 'Restore'), ' ',
        h('button', { class: 'btn sm danger', onclick: async () => { if (confirm(`Delete "${p.name}" permanently? This cannot be undone.`) && await act(() => api('DELETE', `/products/${p.id}`), 'Deleted')) load(); } }, 'Delete')]))), 'No products found.'));
  }
  q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(load, 250); }); status.addEventListener('change', load);

  async function editor(id) {
    const P = id ? await api('GET', `/products/${id}`) : { code: '', name: '', category_id: cats[0].id, price: '', sale_price: null, description: '', material: '', fit: '', specs: [], images: [], variants: [], gender: 'unisex', condition: 'new', is_featured: false, is_new: true, is_best: false, is_offer: false, out_of_stock: false };
    const F = {}, mk = (k, a = {}) => (F[k] = h('input', { value: P[k] ?? '', ...a }));
    const cat = h('select', null, cats.map(c => h('option', { value: c.id, selected: c.id === P.category_id }, c.name)));
    const gender = h('select', null, [['unisex', 'Unisex (men and women)'], ['men', 'Men'], ['women', 'Women']].map(([k, l]) => h('option', { value: k, selected: k === (P.gender || 'unisex') }, l)));
    const cond = h('select', null, [['new', 'Brand new'], ['bonda', 'Bonda (second-hand)']].map(([k, l]) => h('option', { value: k, selected: k === (P.condition || 'new') }, l)));
    const desc = h('textarea', { rows: '3', maxlength: '3000' }); desc.value = P.description || '';
    const descOm = h('textarea', { rows: '2', maxlength: '3000' }), descAm = h('textarea', { rows: '2', maxlength: '3000' }); descOm.value = P.description_om || ''; descAm.value = P.description_am || '';
    const specs = h('textarea', { rows: '3', maxlength: '1500', placeholder: 'One per line' }); specs.value = (P.specs || []).join('\n');
    const chk = (k, label) => (F[k] = h('input', { type: 'checkbox', checked: !!P[k], style: 'width:auto' })) && h('label', { class: 'row' }, F[k], label);
    let images = P.images.map(i => i.url), vars = P.variants.map(x => ({ ...x }));
    const imgEl = h('div', { class: 'imgs' }), varEl = h('div');
    const drawImgs = () => imgEl.replaceChildren(...images.map((u, i) => h('figure', null, h('img', { src: u, alt: '' }), h('figcaption', null, h('span', null, i === 0 ? 'Cover' : i + 1), h('span', null, i > 0 && h('button', { title: 'Move earlier', onclick: () => { [images[i - 1], images[i]] = [images[i], images[i - 1]]; drawImgs(); } }, '←'), h('button', { title: 'Remove', onclick: () => { images.splice(i, 1); drawImgs(); } }, '✕'))))));
    const fileIn = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, onchange: async e => {
      for (const f of e.target.files) { if (images.length >= 10) break; const ok = await act(async () => { const blob = await shrink(f); const r = await api('POST', '/upload/products', blob, 'image/jpeg'); images.push(r.url); drawImgs(); }); if (!ok) break; }
      e.target.value = '';
    } });
    const drawVars = () => varEl.replaceChildren(vars.length ? table(['Size', 'Colour', '#Stock', ''], vars.map((x, i) => h('tr', null,
      h('td', null, h('input', { value: x.size, maxlength: '20', oninput: e => x.size = e.target.value })), h('td', null, h('input', { value: x.color, maxlength: '30', oninput: e => x.color = e.target.value })),
      h('td', { class: 'num', style: 'width:130px' }, x.id ? h('span', { title: 'Change stock from the Inventory page so the history stays accurate' }, x.stock, ' ', h('small', { class: 'muted' }, '(Inventory)')) : h('input', { type: 'number', min: '0', value: x.stock, oninput: e => x.stock = e.target.value })),
      h('td', null, h('button', { class: 'btn sm', onclick: () => { vars.splice(i, 1); drawVars(); } }, 'Remove')))) ) : h('p', { class: 'muted' }, 'Add sizes and colours below. Each combination has its own stock.'));
    const gs = h('input', { placeholder: 'Sizes, e.g. S, M, L, XL' }), gc = h('input', { placeholder: 'Colours, e.g. Black, White' }), gq = h('input', { type: 'number', min: '0', value: '0', style: 'width:90px' });
    const gen = () => { const S = gs.value.split(',').map(s => s.trim()).filter(Boolean), C = gc.value.split(',').map(s => s.trim()).filter(Boolean); if (!S.length || !C.length) return toast('Enter at least one size and one colour.', true);
      for (const s of S) for (const c of C) if (!vars.some(x => x.size.toLowerCase() === s.toLowerCase() && x.color.toLowerCase() === c.toLowerCase())) vars.push({ size: s, color: c, stock: gq.value || 0 }); drawVars(); gs.value = gc.value = ''; };
    drawImgs(); drawVars();
    const body = [h('div', { class: 'grid2' }, field('Product code', mk('code', { maxlength: '40', placeholder: 'BLV-TS-010' })), field('Name', mk('name', { maxlength: '120' })), field('Category', cat)),
      h('div', { class: 'grid2' }, field('Price (ETB)', mk('price', { type: 'number', min: '0' })), field('Discount price (ETB, optional)', mk('sale_price', { type: 'number', min: '0' }), 'Must be lower than the price')),
      h('div', { class: 'grid2' }, field('For', gender), field('Condition', cond)),
      field('Description', desc), h('div', { class: 'card', style: 'display:grid;gap:10px' }, h('b', null, 'Translations (optional)'), h('p', { class: 'muted', style: 'margin:0' }, 'Shown when a customer picks Afaan Oromoo or Amharic. Leave blank to show the English text.'), h('div', { class: 'grid2' }, field('Name in Afaan Oromoo', mk('name_om', { maxlength: '120' })), field('Name in Amharic', mk('name_am', { maxlength: '120' }))), field('Description in Afaan Oromoo', descOm), field('Description in Amharic', descAm)), h('div', { class: 'grid2' }, field('Material', mk('material', { maxlength: '300' })), field('Fit', mk('fit', { maxlength: '200' }))), field('Specifications', specs),
      h('div', null, h('b', null, 'Photos'), h('p', { class: 'muted', style: 'margin:2px 0 8px' }, 'First photo is the cover. Up to 10. Large photos are shrunk automatically.'), imgEl, fileIn),
      h('div', null, h('b', null, 'Sizes, colours and stock'), varEl, h('div', { class: 'row', style: 'margin-top:8px' }, gs, gc, h('label', { class: 'row' }, 'Stock each', gq), h('button', { class: 'btn sm', onclick: gen }, 'Add combinations'))),
      h('div', { class: 'row' }, chk('is_featured', 'Featured'), chk('is_new', 'New arrival'), chk('is_best', 'Best seller'), chk('is_offer', 'Special offer'), chk('out_of_stock', 'Mark as out of stock'))];
    await modal(id ? `Edit ${P.name}` : 'Add product', body, [{ label: 'Save product', cls: 'pri', run: async () => {
      const payload = { code: F.code.value, name: F.name.value, category_id: +cat.value, gender: gender.value, condition: cond.value, price: F.price.value, sale_price: F.sale_price.value, description: desc.value, name_om: F.name_om.value, name_am: F.name_am.value, description_om: descOm.value, description_am: descAm.value, material: F.material.value, fit: F.fit.value, specs: specs.value, images,
        variants: vars.map(x => ({ id: x.id, size: x.size, color: x.color, stock: x.stock })), ...Object.fromEntries(['is_featured', 'is_new', 'is_best', 'is_offer', 'out_of_stock'].map(k => [k, F[k].checked])) };
      const ok = await act(() => id ? api('PUT', `/products/${id}`, payload) : api('POST', '/products', payload), 'Product saved'); if (ok) load(); return !!ok;
    } }]);
  }
  v.replaceChildren(header('Products', 'Manage what customers see in the store.', can('manager') && h('button', { class: 'btn gold', onclick: () => editor() }, '+ Add product')), h('div', { class: 'bar' }, searchBox(q), status), list);
  await load();
}
// Shrink a photo in the browser before upload (max 1600px, JPEG)
function shrink(file, max = 1600) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = h('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error('Could not read the image')), 'image/jpeg', .85); };
    im.onerror = () => rej(new Error('That file is not a usable image')); im.src = u; });
}

/* ---------- inventory ---------- */
async function inventory(v) {
  const q = h('input', { type: 'search', placeholder: 'Search product to adjust stock' }), res = h('div'), hist = h('div'); let pid = '';
  async function loadHist() {
    const rows = await api('GET', `/inventory/movements?limit=100${pid ? '&product_id=' + pid : ''}`);
    const label = { initial: 'Opening stock', restock: 'Restock', adjustment: 'Adjustment', sale: 'Sale', sale_reversal: 'Sale reversed' };
    hist.replaceChildren(table(['When', 'Product', 'Size / colour', 'Type', '#Change', '#Stock after', 'Note', 'By'], rows.map(m => h('tr', null, h('td', null, localWhen(m.created_at)), h('td', null, m.product_name), h('td', null, `${m.size} / ${m.color}`), h('td', null, label[m.type]), h('td', { class: 'num' }, h('span', { class: 'tag ' + (m.qty_change > 0 ? 'ok' : 'bad') }, (m.qty_change > 0 ? '+' : '') + m.qty_change)), h('td', { class: 'num' }, m.stock_after), h('td', null, m.note), h('td', null, m.user_name || ''))), 'No stock movements yet.'));
  }
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    if (!q.value.trim()) return res.replaceChildren();
    const vs = await act(() => api('GET', '/variants?q=' + encodeURIComponent(q.value))); if (!vs) return;
    res.replaceChildren(table(['Product', 'Size', 'Colour', '#Stock', ''], vs.map(x => h('tr', null, h('td', null, x.name, h('span', { class: 'muted' }, ` ${x.code}`)), h('td', null, x.size), h('td', null, x.color), h('td', { class: 'num' }, x.stock),
      h('td', { style: 'white-space:nowrap' }, can('manager') && [h('button', { class: 'btn sm', onclick: () => stockDialog(x.id, `${x.name} ${x.size}/${x.color}`, x.stock, 'restock', () => { q.dispatchEvent(new Event('input')); loadHist(); }) }, 'Add stock'), ' ', h('button', { class: 'btn sm', onclick: () => stockDialog(x.id, `${x.name} ${x.size}/${x.color}`, x.stock, 'adjustment', () => { q.dispatchEvent(new Event('input')); loadHist(); }) }, 'Adjust')]))), 'No matching products.'));
  }, 250); });
  v.replaceChildren(header('Inventory', 'Every change to stock is recorded below. Sales and reversals update stock automatically.'), can('manager') ? h('div', { class: 'card', style: 'display:grid;gap:10px' }, h('b', null, 'Add or adjust stock'), searchBox(q), res) : h('p', { class: 'muted' }, 'Managers can add or adjust stock. You can view the history.'), h('h2', null, 'Movement history'), hist);
  await loadHist();
}

/* ---------- reviews ---------- */
async function reviews(v) {
  let st = 'pending'; const list = h('div', { class: 'rvc' });
  const tabs = h('div', { class: 'tabs' }, [['pending', 'Waiting'], ['approved', 'Published'], ['rejected', 'Rejected']].map(([k, l]) => h('button', { class: k === st ? 'on' : '', onclick: e => { st = k; [...tabs.children].forEach(b => b.classList.toggle('on', b === e.target)); load(); } }, l)));
  async function load() {
    const rows = await api('GET', '/reviews?status=' + st);
    list.replaceChildren(...(rows.length ? rows.map(r => {
      const reply = h('textarea', { rows: '2', maxlength: '600', placeholder: 'Public reply (optional)' }); reply.value = r.admin_reply || '';
      const set = (status) => async () => { if (await act(() => api('PATCH', `/reviews/${r.id}`, { status, admin_reply: reply.value }), status === 'approved' ? 'Published' : 'Saved')) load(); };
      return h('div', { class: 'card rvc' }, h('div', { class: 'row' }, h('b', null, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)), h('b', null, r.name), h('span', { class: 'tag ' + (r.verified ? 'ok' : '') }, r.verified ? 'Verified purchase' : 'Unverified'), h('span', { class: 'muted right' }, localWhen(r.created_at))),
        h('div', { class: 'muted' }, `${r.product_name} (${r.code})`, r.phone_norm && ` · phone given ${r.phone_norm}`), r.comment && h('p', { style: 'margin:0' }, r.comment), r.photos.length > 0 && h('div', { class: 'photos' }, r.photos.map(u => h('a', { href: u, target: '_blank' }, h('img', { src: u, alt: 'Customer photo' })))),
        reply, h('div', { class: 'row' }, r.status !== 'approved' && h('button', { class: 'btn pri sm', onclick: set('approved') }, 'Approve & publish'), r.status === 'approved' && h('button', { class: 'btn sm', onclick: set('approved') }, 'Save reply'), r.status !== 'rejected' && h('button', { class: 'btn sm', onclick: set('rejected') }, 'Reject'),
          h('button', { class: 'btn sm danger right', onclick: async () => { if (confirm('Delete this review permanently?') && await act(() => api('DELETE', `/reviews/${r.id}`), 'Deleted')) load(); } }, 'Delete')));
    }) : [h('p', { class: 'muted' }, 'No reviews here.')]));
  }
  v.replaceChildren(header('Reviews', '"Verified purchase" is shown only when the reviewer\'s phone matches a sale you recorded.'), tabs, list); await load();
}

/* ---------- SHEIN ---------- */
async function shein(v) {
  let tab = 'requests'; const body = h('div');
  const tabs = h('div', { class: 'tabs' }, [['requests', 'Customer requests'], ...(can('manager') ? [['items', 'Reference items shown on the site']] : [])].map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: e => { tab = k; [...tabs.children].forEach(b => b.classList.toggle('on', b === e.target)); draw(); } }, l)));
  async function draw() { body.replaceChildren(); await (tab === 'requests' ? requests : items)(); }
  async function requests() {
    const { statuses, requests: rows } = await api('GET', '/shein/requests'); setBadges({ shein: rows.filter(r => !['Delivered', 'Cancelled'].includes(r.status)).length });
    const items = (await api('GET', '/shein/items'));
    const form = r => {
      const F = { customer_name: h('input', { value: r?.customer_name || '', maxlength: '80' }), customer_phone: h('input', { value: r?.customer_phone || '', maxlength: '30' }), item_ref: h('input', { value: r?.item_ref || '', maxlength: '300', placeholder: 'SHEIN link or code' }),
        size: h('input', { value: r?.size || '', maxlength: '30' }), color: h('input', { value: r?.color || '', maxlength: '30' }), qty: h('input', { type: 'number', min: '1', value: r?.qty || 1 }), quoted_price: h('input', { type: 'number', min: '0', value: r?.quoted_price ?? '' }), note: h('input', { value: r?.note || '', maxlength: '400' }),
        channel: h('select', null, ['whatsapp', 'telegram', 'phone', 'in_person', 'other'].map(c => h('option', { value: c, selected: (r?.channel || 'whatsapp') === c }, c.replace('_', ' ')))),
        status: h('select', null, statuses.map(s => h('option', { selected: (r?.status || 'Requested') === s }, s))),
        item_id: h('select', null, h('option', { value: '' }, '- none (custom link) -'), items.map(i => h('option', { value: i.id, selected: r?.item_id === i.id }, `${i.code} ${i.title}`))) };
      return [F, [h('div', { class: 'grid2' }, field('Customer name', F.customer_name), field('Customer phone', F.customer_phone), field('Asked through', F.channel), field('Status', F.status)), h('div', { class: 'grid2' }, field('Reference item', F.item_id), field('Link or code', F.item_ref), field('Size', F.size), field('Colour', F.color), field('Quantity', F.qty), field('Quoted price (ETB)', F.quoted_price)), field('Note', F.note)]];
    };
    const open = async r => { const [F, nodes] = form(r); await modal(r ? `Request #${r.id}` : 'New SHEIN request', [...nodes, r && h('div', { class: 'muted' }, h('b', null, 'History: '), r.log.map(l => `${l.status} (${localWhen(l.created_at)}${l.user_name ? ', ' + l.user_name : ''})`).join(' → '))],
      [...(r && can('manager') ? [{ label: 'Delete', cls: 'danger', run: async () => { if (!confirm('Delete this request?')) return false; const ok = await act(() => api('DELETE', `/shein/requests/${r.id}`), 'Deleted'); if (ok) draw(); return !!ok; } }] : []),
        { label: 'Save', cls: 'pri', run: async () => { const p = Object.fromEntries(Object.entries(F).map(([k, el]) => [k, el.value])); const ok = await act(() => r ? api('PUT', `/shein/requests/${r.id}`, p) : api('POST', '/shein/requests', p), 'Saved'); if (ok) draw(); return !!ok; } }]); };
    body.replaceChildren(h('div', { class: 'bar' }, h('button', { class: 'btn gold', onclick: () => open() }, '+ New request')),
      table(['#', 'Customer', 'Item', 'Size / colour', '#Qty', '#Quoted', 'Status', 'Updated', ''], rows.map(r => h('tr', null, h('td', null, r.id), h('td', null, r.customer_name, r.customer_phone && h('div', { class: 'muted' }, r.customer_phone)), h('td', null, r.item_title || r.item_ref || '-'), h('td', null, `${r.size || '-'} / ${r.color || '-'}`), h('td', { class: 'num' }, r.qty), h('td', { class: 'num' }, r.quoted_price != null ? etb(r.quoted_price) : '-'),
        h('td', null, h('select', { 'aria-label': 'Status', style: 'min-width:130px', onchange: async e => { if (!await act(() => api('PUT', `/shein/requests/${r.id}`, { status: e.target.value }), 'Status updated')) e.target.value = r.status; else draw(); } }, statuses.map(s => h('option', { selected: s === r.status }, s)))),
        h('td', null, localWhen(r.updated_at)), h('td', null, h('button', { class: 'btn sm', onclick: () => open(r) }, 'Open')))), 'No SHEIN requests yet. Add one when a customer asks through WhatsApp, Telegram or phone.'));
  }
  async function items() {
    const rows = await api('GET', '/shein/items');
    const edit = async it => {
      const F = { code: h('input', { value: it?.code || '', maxlength: '40' }), title: h('input', { value: it?.title || '', maxlength: '150' }), title_om: h('input', { value: it?.title_om || '', maxlength: '150' }), title_am: h('input', { value: it?.title_am || '', maxlength: '150' }), link: h('input', { value: it?.link || '', placeholder: 'https://...' }), est_price: h('input', { type: 'number', min: '0', value: it?.est_price ?? '' }), sizes: h('input', { value: it?.sizes || '', placeholder: 'S, M, L' }), colors: h('input', { value: it?.colors || '', placeholder: 'Black, Beige' }), note: h('input', { value: it?.note || '', maxlength: '400' }), active: h('input', { type: 'checkbox', checked: it ? !!it.active : true, style: 'width:auto' }) };
      let image = it?.image || ''; const prev = h('div', { class: 'imgs' }), drawP = () => prev.replaceChildren(image && h('figure', null, h('img', { src: image, alt: '' })));
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', onchange: async e => { const f = e.target.files[0]; if (f) await act(async () => { image = (await api('POST', '/upload/shein', await shrink(f), 'image/jpeg')).url; drawP(); }); } }); drawP();
      await modal(it ? 'Edit reference item' : 'New reference item', [h('div', { class: 'grid2' }, field('Code', F.code), field('Title', F.title), field('Title in Afaan Oromoo', F.title_om), field('Title in Amharic', F.title_am), field('Estimated price (ETB)', F.est_price), field('SHEIN link', F.link), field('Sizes', F.sizes), field('Colours', F.colors)), field('Note', F.note), field('Reference photo', file), prev, h('label', { class: 'row' }, F.active, 'Show on the site')],
        [...(it ? [{ label: 'Delete', cls: 'danger', run: async () => { if (!confirm('Delete this item?')) return false; const ok = await act(() => api('DELETE', `/shein/items/${it.id}`), 'Deleted'); if (ok) draw(); return !!ok; } }] : []),
          { label: 'Save', cls: 'pri', run: async () => { const p = { code: F.code.value, title: F.title.value, title_om: F.title_om.value, title_am: F.title_am.value, link: F.link.value, est_price: F.est_price.value, sizes: F.sizes.value, colors: F.colors.value, note: F.note.value, image, active: F.active.checked }; const ok = await act(() => it ? api('PUT', `/shein/items/${it.id}`, p) : api('POST', '/shein/items', p), 'Saved'); if (ok) draw(); return !!ok; } }]);
    };
    body.replaceChildren(h('div', { class: 'bar' }, h('button', { class: 'btn gold', onclick: () => edit() }, '+ Add reference item')), table(['', 'Code', 'Title', '#Est. price', 'Shown', ''], rows.map(i => h('tr', null, h('td', null, i.image && h('img', { class: 'thumb', src: i.image, alt: '' })), h('td', null, i.code), h('td', null, i.title), h('td', { class: 'num' }, i.est_price != null ? etb(i.est_price) : '-'), h('td', null, i.active ? 'Yes' : 'No'), h('td', null, h('button', { class: 'btn sm', onclick: () => edit(i) }, 'Edit')))), 'No items yet.'));
  }
  v.replaceChildren(header('SHEIN Orders', 'Track customer requests from first message to delivery. These are separate from your in-stock products.'), tabs, body); await draw();
}

/* ---------- settings ---------- */
async function settings(v) {
  const S = await api('GET', '/settings'), box = h('div');
  const F = {}, mk = (k, label, hint, area) => { F[k] = area ? h('textarea', { rows: '3' }) : h('input'); F[k].value = S[k] || ''; return field(label, F[k], hint); };
  const contact = h('div', { class: 'card', style: 'display:grid;gap:12px' }, h('b', null, 'Contact details used by the Call, WhatsApp and Telegram buttons'),
    h('div', { class: 'grid2' }, mk('phone', 'Phone number', 'e.g. +251 91 123 4567'), mk('whatsapp', 'WhatsApp number', 'With country code, e.g. 251911234567'), mk('telegram', 'Telegram username', 'e.g. baleova (no @)'), mk('bot_username', 'Telegram bot username', 'Optional')),
    h('div', { class: 'grid2' }, mk('store_name', 'Store name'), mk('tagline', 'Tagline'), mk('address', 'Store location'), mk('map_url', 'Map link', 'Google Maps link, optional'), mk('hours', 'Opening hours')),
    mk('delivery_info', 'Delivery information', '', true), mk('policies', 'Policies', '', true), mk('shein_notice', 'SHEIN notice shown to customers', '', true),
    h('div', { class: 'grid2' }, mk('instagram', 'Instagram link'), mk('facebook', 'Facebook link'), mk('tiktok', 'TikTok link'), mk('low_stock_threshold', 'Low-stock alert level', 'Items at or below this are flagged')),
    h('div', null, can('owner') ? h('button', { class: 'btn pri', onclick: async () => { await act(() => api('PUT', '/settings', Object.fromEntries(Object.entries(F).map(([k, e]) => [k, e.value]))), 'Settings saved'); } }, 'Save settings') : h('p', { class: 'muted' }, 'Only the owner can change these settings.')));
  const tr = h('div', { class: 'card', style: 'display:grid;gap:12px' }, h('b', null, 'Texts in Afaan Oromoo and Amharic'), h('p', { class: 'muted', style: 'margin:0' }, 'Shown on the site and in the Telegram bot when a customer picks that language. A native speaker should check the starting texts.'),
    h('div', { class: 'grid2' }, mk('tagline_om', 'Tagline (Afaan Oromoo)'), mk('tagline_am', 'Tagline (Amharic)')),
    mk('delivery_info_om', 'Delivery information (Afaan Oromoo)', '', true), mk('delivery_info_am', 'Delivery information (Amharic)', '', true), mk('policies_om', 'Policies (Afaan Oromoo)', '', true), mk('policies_am', 'Policies (Amharic)', '', true), mk('shein_notice_om', 'SHEIN notice (Afaan Oromoo)', '', true), mk('shein_notice_am', 'SHEIN notice (Amharic)', '', true),
    can('owner') && h('div', null, h('button', { class: 'btn pri', onclick: async () => { await act(() => api('PUT', '/settings', Object.fromEntries(Object.entries(F).map(([k, e]) => [k, e.value]))), 'Settings saved'); } }, 'Save settings')));
  const bn = h('div'); async function loadBanners() {
    const rows = await api('GET', '/banners');
    const edit = async b => {
      const F2 = { title: h('input', { value: b?.title || '', maxlength: '100' }), subtitle: h('input', { value: b?.subtitle || '', maxlength: '200' }), title_om: h('input', { value: b?.title_om || '', maxlength: '100' }), title_am: h('input', { value: b?.title_am || '', maxlength: '100' }), subtitle_om: h('input', { value: b?.subtitle_om || '', maxlength: '200' }), subtitle_am: h('input', { value: b?.subtitle_am || '', maxlength: '200' }), link: h('input', { value: b?.link || '', placeholder: '#/shop or #/c/hoodies or #/shein' }), sort: h('input', { type: 'number', min: '0', value: b?.sort ?? 0 }), placement: h('select', null, [['hero', 'Big banner at the top'], ['promo', 'Offer box below products']].map(([k, l]) => h('option', { value: k, selected: (b?.placement || 'hero') === k }, l))), active: h('input', { type: 'checkbox', checked: b ? !!b.active : true, style: 'width:auto' }) };
      let image = b?.image || ''; const prev = h('div', { class: 'imgs' }), dp = () => prev.replaceChildren(image && h('figure', null, h('img', { src: image, alt: '' })));
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', onchange: async e => { const f = e.target.files[0]; if (f) await act(async () => { image = (await api('POST', '/upload/banners', await shrink(f, 2000), 'image/jpeg')).url; dp(); }); } }); dp();
      await modal(b ? 'Edit banner' : 'New banner', [field('Title', F2.title), field('Subtitle', F2.subtitle), h('div', { class: 'grid2' }, field('Title in Afaan Oromoo', F2.title_om), field('Title in Amharic', F2.title_am), field('Subtitle in Afaan Oromoo', F2.subtitle_om), field('Subtitle in Amharic', F2.subtitle_am)), h('div', { class: 'grid2' }, field('Where', F2.placement), field('Order', F2.sort), field('Link', F2.link)), field('Background photo (optional)', file), prev, h('label', { class: 'row' }, F2.active, 'Show on the site')],
        [...(b ? [{ label: 'Delete', cls: 'danger', run: async () => { if (!confirm('Delete this banner?')) return false; const ok = await act(() => api('DELETE', `/banners/${b.id}`), 'Deleted'); if (ok) loadBanners(); return !!ok; } }] : []),
          { label: 'Save', cls: 'pri', run: async () => { const p = { title: F2.title.value, subtitle: F2.subtitle.value, title_om: F2.title_om.value, title_am: F2.title_am.value, subtitle_om: F2.subtitle_om.value, subtitle_am: F2.subtitle_am.value, link: F2.link.value, sort: F2.sort.value, placement: F2.placement.value, image, active: F2.active.checked }; const ok = await act(() => b ? api('PUT', `/banners/${b.id}`, p) : api('POST', '/banners', p), 'Saved'); if (ok) loadBanners(); return !!ok; } }]);
    };
    bn.replaceChildren(h('div', { class: 'bar' }, h('button', { class: 'btn gold', onclick: () => edit() }, '+ New banner')), table(['Title', 'Where', 'Link', 'Shown', ''], rows.map(b => h('tr', null, h('td', null, b.title), h('td', null, b.placement === 'hero' ? 'Top banner' : 'Offer box'), h('td', null, b.link), h('td', null, b.active ? 'Yes' : 'No'), h('td', null, h('button', { class: 'btn sm', onclick: () => edit(b) }, 'Edit')))), 'No banners.'));
  }
  const team = h('div'); async function loadTeam() {
    if (!can('owner')) return;
    const rows = await api('GET', '/users');
    const edit = async u => {
      const F3 = { username: h('input', { value: u?.username || '', disabled: !!u, maxlength: '40' }), display_name: h('input', { value: u?.display_name || '', maxlength: '60' }), role: h('select', null, [['staff', 'Staff - record sales, SHEIN requests'], ['manager', 'Manager - plus products, stock, reviews'], ['owner', 'Owner - everything, settings and team']].map(([k, l]) => h('option', { value: k, selected: (u?.role || 'staff') === k }, l))), password: h('input', { type: 'password', autocomplete: 'new-password', placeholder: u ? 'Leave blank to keep' : 'At least 8 characters' }), active: h('input', { type: 'checkbox', checked: u ? !!u.active : true, style: 'width:auto' }) };
      await modal(u ? `Edit ${u.username}` : 'New team member', [h('div', { class: 'grid2' }, field('Username', F3.username), field('Display name', F3.display_name), field('Role', F3.role), field(u ? 'New password' : 'Password', F3.password)), u && h('label', { class: 'row' }, F3.active, 'Can sign in')],
        [{ label: 'Save', cls: 'pri', run: async () => { const p = { username: F3.username.value, display_name: F3.display_name.value, role: F3.role.value, password: F3.password.value, active: F3.active.checked }; const ok = await act(() => u ? api('PUT', `/users/${u.id}`, p) : api('POST', '/users', p), 'Saved'); if (ok) loadTeam(); return !!ok; } }]);
    };
    team.replaceChildren(h('h2', null, 'Team'), h('div', { class: 'bar' }, h('button', { class: 'btn gold', onclick: () => edit() }, '+ Add team member')), table(['Username', 'Name', 'Role', 'Active', ''], rows.map(u => h('tr', null, h('td', null, u.username), h('td', null, u.display_name), h('td', null, u.role), h('td', null, u.active ? 'Yes' : 'No'), h('td', null, h('button', { class: 'btn sm', onclick: () => edit(u) }, 'Edit'))))));
  }
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  v.replaceChildren(header('Settings'), contact, h('h2', null, 'Languages'), tr, h('h2', null, 'Homepage banners and offers'), bn, team,
    h('h2', null, 'My password'), h('div', { class: 'card grid2' }, field('Current password', cur), field('New password (8+ characters)', nxt), h('div', null, h('button', { class: 'btn', onclick: async () => { if (await act(() => api('POST', '/me/password', { current: cur.value, next: nxt.value }), 'Password changed')) cur.value = nxt.value = ''; } }, 'Change password'))));
  await Promise.all([loadBanners(), loadTeam()]);
}

(async () => { try { const r = await api('GET', '/me'); ME = r.user; start(); } catch { renderLogin(); } })();
})();
