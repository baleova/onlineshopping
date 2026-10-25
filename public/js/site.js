(() => {
'use strict';
/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, ''); else el.setAttribute(k, v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; }
const ICONS = {
  phone: 'M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.6 3.6a1 1 0 01-.25 1z',
  chat: 'M4 3h16a2 2 0 012 2v11a2 2 0 01-2 2H9l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2z',
  plane: 'M21.8 3.2L2.6 10.6a.8.8 0 000 1.5l4.9 1.7 1.9 5.8a.8.8 0 001.4.2l2.6-3.2 4.9 3.6a.8.8 0 001.3-.5L22.6 4a.8.8 0 00-.8-.8zM9.4 13l9-6.2-7 7.4-.3 3.1z',
  search: 'M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z', expand: 'M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z',
};
function icon(n, size = 18) { const s = svgEl('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: 'currentColor' }); s.append(svgEl('path', { d: ICONS[n] })); return s; }

/* ---------- language ---------- */
const TG = window.Telegram && window.Telegram.WebApp;
const inTG = !!(TG && TG.initData);
const safeStore = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const LANGS = [['en', 'EN', 'English'], ['om', 'OM', 'Afaan Oromoo'], ['am', 'አማ', 'አማርኛ']];
function guessLang() {
  const saved = safeStore.get('bv_lang'); if (LANGS.some(l => l[0] === saved)) return saved;
  const code = ((inTG && TG.initDataUnsafe && TG.initDataUnsafe.user && TG.initDataUnsafe.user.language_code) || navigator.language || 'en').toLowerCase();
  return code.startsWith('am') ? 'am' : code.startsWith('om') ? 'om' : 'en';
}
let LANG = guessLang();
const t = (k, ...a) => { const v = window.I18N[LANG][k] ?? window.I18N.en[k]; return typeof v === 'function' ? v(...a) : v; };
const etb = n => LANG === 'am' ? `${Number(n).toLocaleString('en-US')} ብር` : `${Number(n).toLocaleString('en-US')} ETB`;
async function api(url, opts) {
  const u = /^\/api\/(store|products|shein)/.test(url) && !opts ? url + (url.includes('?') ? '&' : '?') + 'lang=' + LANG : url;
  const r = await fetch(u, opts);
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error((d && d.error) || t('went_wrong'));
  return d;
}
let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }
if (TG) { try { TG.ready(); TG.expand(); } catch {} }

/* ---------- theme ---------- */
function applyTheme(m) { document.documentElement.dataset.theme = m; const meta = $('meta[name=theme-color]'); if (meta) meta.content = '#0a0a0a'; }
applyTheme(safeStore.get('bv_theme') || (inTG && TG.colorScheme) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

/* ---------- contact buttons ---------- */
let STORE = null;
const S = () => STORE.settings;
function openExternal(url) {
  if (inTG && /^https:\/\/t\.me\//.test(url)) return TG.openTelegramLink(url);
  if (inTG && /^https?:/.test(url)) return TG.openLink(url);
  if (/^tel:/.test(url)) { location.href = url; return; }
  window.open(url, '_blank', 'noopener');
}
const telUrl = () => S().phone ? 'tel:' + S().phone.replace(/[^\d+]/g, '') : '';
const waUrl = msg => S().whatsapp ? `https://wa.me/${S().whatsapp}?text=${encodeURIComponent(msg)}` : '';
const tgUrl = () => S().telegram ? `https://t.me/${S().telegram}` : '';
async function copyText(v) { try { await navigator.clipboard.writeText(v); return true; } catch { const a = h('textarea', { style: 'position:fixed;opacity:0' }); a.value = v; document.body.append(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} a.remove(); return ok; } }
// getMsg() returns the message text, or null when something required is still missing.
function contactButtons(getMsg, labels = {}, cls = 'btn') {
  const guard = (url, fn, name) => e => { e.preventDefault(); if (!url()) return toast(t('not_set_up', name)); const m = getMsg(); if (m == null) return; fn(m); };
  return [
    h('a', { class: `${cls} call`, href: telUrl() || '#', onclick: guard(telUrl, () => openExternal(telUrl()), t('call_short')) }, icon('phone'), labels.call || t('call_order')),
    h('a', { class: `${cls} wa`, href: waUrl('') || '#', onclick: guard(() => waUrl('x'), m => openExternal(waUrl(m)), 'WhatsApp') }, icon('chat'), labels.wa || t('wa_order')),
    h('a', { class: `${cls} tg`, href: tgUrl() || '#', onclick: guard(tgUrl, async m => { const ok = await copyText(m); toast(ok ? t('tg_copied') : t('tg_opening')); setTimeout(() => openExternal(tgUrl()), ok ? 700 : 0); }, 'Telegram') }, icon('plane'), labels.tg || t('tg_order')),
  ];
}

/* ---------- shared components ---------- */
function priceEl(p) { return h('div', { class: 'price' }, h('b', null, etb(p.final_price)), p.sale_price != null && [h('s', null, etb(p.price)), h('span', { class: 'off' }, `-${p.discount_percent}%`)]); }
function stars(avg) { const n = Math.round(avg); return h('span', { class: 'stars', role: 'img', 'aria-label': t('stars_label', avg) }, '★'.repeat(n) + '☆'.repeat(5 - n)); }
function img(src, alt, w = 400, hgt = 500, lazy = true) { return h('img', { src, alt, width: w, height: hgt, loading: lazy ? 'lazy' : null, decoding: 'async' }); }
function card(p) {
  return h('a', { class: 'card' + (p.cover2 ? ' two' : ''), href: `#/p/${p.id}` },
    h('div', { class: 'ph' }, p.cover && img(p.cover, p.name), p.cover2 && h('span', { class: 'alt' }, img(p.cover2, '')),
      h('div', { class: 'badges' }, p.stock_status === 'out' && h('span', { class: 'badge out' }, t('sold_out')), p.is_new && p.stock_status !== 'out' && h('span', { class: 'badge' }, t('new')), p.condition === 'bonda' && h('span', { class: 'badge bonda' }, t('bonda_short')), p.discount_percent > 0 && h('span', { class: 'badge gold' }, `-${p.discount_percent}%`))),
    h('div', { class: 'meta' }, h('span', { class: 'nm' }, p.name), priceEl(p), p.rating_avg != null && h('span', { class: 'rate' }, stars(p.rating_avg), ` (${p.review_count})`)));
}
const grid = list => h('div', { class: 'grid' }, list.map(card));
const sectionHead = (title, link) => h('div', { class: 'sh' }, h('h2', null, title), link && h('a', { href: link }, t('view_all')));

/* ---------- lightbox with zoom ---------- */
function openLightbox(urls, start = 0) {
  const lb = $('#lightbox'); let i = start, zoomed = false;
  const im = h('img', { alt: '' });
  const set = n => { i = (n + urls.length) % urls.length; im.src = urls[i]; zoomed = false; im.classList.remove('z'); };
  const close = () => { lb.hidden = true; lb.replaceChildren(); document.removeEventListener('keydown', key); document.body.style.overflow = ''; };
  const key = e => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight' && urls.length > 1) set(i + 1); else if (e.key === 'ArrowLeft' && urls.length > 1) set(i - 1); };
  const origin = e => { const r = im.getBoundingClientRect(); im.style.transformOrigin = `${Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))}% ${Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))}%`; };
  im.addEventListener('click', e => { zoomed = !zoomed; im.classList.toggle('z', zoomed); origin(e); });
  im.addEventListener('mousemove', e => { if (zoomed) origin(e); });
  let sx = null; lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => { if (sx == null || zoomed || urls.length < 2) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) set(i + (dx < 0 ? 1 : -1)); sx = null; });
  lb.replaceChildren(im, h('button', { class: 'lb', style: 'top:16px;right:16px', 'aria-label': 'Close', onclick: close }, '✕'),
    urls.length > 1 && h('button', { class: 'lb', style: 'left:16px', 'aria-label': 'Previous', onclick: () => set(i - 1) }, '‹'),
    urls.length > 1 && h('button', { class: 'lb', style: 'right:16px', 'aria-label': 'Next', onclick: () => set(i + 1) }, '›'));
  lb.hidden = false; document.body.style.overflow = 'hidden'; document.addEventListener('keydown', key); set(start);
}

/* ---------- Bale contour lines (the one signature graphic) ---------- */
function contours(cx, cy, rings, step, seed) {
  const g = svgEl('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1' });
  for (let k = 1; k <= rings; k++) {
    const r = k * step, pts = [];
    for (let a = 0; a < 64; a++) {
      const th = (a / 64) * Math.PI * 2, w = 1 + 0.11 * Math.sin(3 * th + seed + k * .35) + 0.07 * Math.sin(5 * th + seed * 2 + k * .2) + 0.04 * Math.sin(8 * th + k);
      pts.push([cx + Math.cos(th) * r * w * 1.25, cy + Math.sin(th) * r * w * .85]);
    }
    g.append(svgEl('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z', opacity: (0.85 - k / (rings * 1.4)).toFixed(2) }));
  }
  return g;
}
function contourBg() {
  const s = svgEl('svg', { class: 'contours', viewBox: '0 0 1200 700', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  s.append(contours(930, 330, 16, 30, 1.3), contours(130, 640, 9, 34, 4.1));
  return s;
}

/* ---------- layout ---------- */
function mark() { return h('img', { class: 'logo-mark', src: '/brand/mark-gold.svg', alt: '', width: 28, height: 34 }); }
function renderTop() {
  const s = S();
  const form = h('form', { class: 'search', role: 'search', onsubmit: e => { e.preventDefault(); const q = $('input', e.target).value.trim(); if (q) location.hash = `#/shop?q=${encodeURIComponent(q)}`; } },
    icon('search', 16), h('input', { type: 'search', placeholder: t('search_ph'), 'aria-label': t('search'), maxlength: '60' }), h('button', { class: 'sbtn', type: 'submit' }, t('search_btn')));
  const langs = h('div', { class: 'langs', role: 'group', 'aria-label': t('language') }, LANGS.map(([k, short, full]) => h('button', { class: k === LANG ? 'on' : '', lang: k, 'aria-label': full, 'aria-pressed': String(k === LANG), onclick: () => setLang(k) }, short)));
  const themeBtn = h('button', { class: 'iconbtn', 'aria-label': t('theme'), onclick: () => { const m = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(m); safeStore.set('bv_theme', m); } }, icon('moon', 18));
  const cats = STORE.categories;
  $('#top').replaceChildren(h('div', { class: 'wrap' },
    h('div', { class: 'bar' }, h('a', { class: 'logo', href: '#/', 'aria-label': `${s.store_name} ${t('home')}` }, mark(), s.store_name), form,
      h('button', { class: 'iconbtn mobsearch', 'aria-label': t('search'), onclick: () => { form.classList.toggle('open'); $('input', form).focus(); } }, icon('search', 18)), langs, themeBtn),
    h('nav', { class: 'nav', 'aria-label': t('nav_label') }, h('a', { href: '#/shop', 'data-k': 'all' }, t('all')), h('a', { href: '#/c/men', 'data-k': 'men' }, t('men')), h('a', { href: '#/c/women', 'data-k': 'women' }, t('women')), h('a', { href: '#/c/brand-new', 'data-k': 'brand-new' }, t('brand_new')), h('a', { href: '#/c/bonda', 'data-k': 'bonda' }, t('bonda_short')), h('a', { href: '#/c/new-arrivals', 'data-k': 'new-arrivals' }, t('new_arrivals')), cats.map(c => h('a', { href: `#/c/${c.slug}`, 'data-k': c.slug }, c.name)),
      h('a', { href: '#/c/best-sellers', 'data-k': 'best-sellers' }, t('best_sellers')), h('a', { href: '#/c/special-offers', 'data-k': 'special-offers' }, t('special_offers')), h('a', { class: 'gold', href: '#/shein', 'data-k': 'shein' }, t('shein')))));
}
function renderFooter() {
  const s = S(), tel = telUrl();
  const link = (u, txt) => u ? h('p', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, txt)) : null;
  $('#footer').replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'cols' },
    h('div', null, h('h3', null, s.store_name), h('p', null, s.tagline), s.address && h('p', null, s.address), link(s.map_url, t('open_maps')), s.hours && h('p', null, `${t('hours')}: ${s.hours}`)),
    h('div', null, h('h3', null, t('order')), tel && h('p', null, h('a', { href: tel }, t('call_n', s.phone))), s.whatsapp && link(`https://wa.me/${s.whatsapp}`, 'WhatsApp +' + s.whatsapp), s.telegram && link(`https://t.me/${s.telegram}`, 'Telegram @' + s.telegram), !tel && !s.whatsapp && !s.telegram && h('p', null, t('contact_soon')), h('p', { class: 'dim' }, t('no_payment_note'))),
    h('div', null, h('h3', null, t('delivery')), h('p', null, s.delivery_info), h('p', null, h('a', { href: '#/shein' }, t('shein')))),
    h('div', null, h('h3', null, t('follow')), link(s.instagram, 'Instagram'), link(s.facebook, 'Facebook'), link(s.tiktok, 'TikTok'), h('h3', { style: 'margin-top:18px' }, t('policies')), h('p', null, s.policies))),
    h('div', { class: 'fine' }, `© ${new Date().getFullYear()} ${s.store_name}. ${s.tagline}`)));
}
function setActive(k) { document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.k === k)); }
function title(txt) { document.title = txt ? `${txt} - ${S().store_name}` : `${S().store_name} - ${S().tagline}`; }

/* ---------- pages ---------- */
const skeletons = (n = 8) => h('div', { class: 'grid' }, Array.from({ length: n }, () => h('div', { class: 'skeleton' })));

async function pageHome(main) {
  title(''); setActive('');
  const featured = await api('/api/products?category=featured&limit=6').catch(() => []);
  const pool = featured.length ? featured : await api('/api/products?limit=6').catch(() => []);
  const hero = STORE.banners.filter(b => b.placement === 'hero'), promos = STORE.banners.filter(b => b.placement === 'promo');
  const slides = hero.length ? hero : [{ title: S().tagline, subtitle: t('hero_default_sub'), link: '#/shop' }];
  let cur = 0, timer;
  const slideEls = slides.map((b, i) => {
    const prod = pool[i % Math.max(pool.length, 1)];
    return h('div', { class: 'slide' + (i ? '' : ' on'), style: b.image ? `background-image:linear-gradient(90deg,rgba(0,0,0,.82),rgba(0,0,0,.25)),url("${b.image.replace(/["\\()]/g, '')}")` : null },
      h('div', { class: 'wrap hero-grid' },
        h('div', { class: 'hero-copy' }, h(i ? 'h2' : 'h1', { class: 'display' }, b.title), b.subtitle && h('p', null, b.subtitle), h('a', { class: 'btn gold', href: b.link || '#/shop' }, t('shop_now'))),
        prod && !b.image && h('a', { class: 'arch', href: `#/p/${prod.id}`, 'aria-label': prod.name }, prod.cover && img(prod.cover, prod.name, 560, 700, i > 0), h('span', { class: 'tag' }, h('b', null, prod.name), etb(prod.final_price)))));
  });
  const dots = slides.length > 1 ? h('div', { class: 'dots' }, slides.map((_, i) => h('button', { 'aria-label': `${i + 1}`, class: i ? '' : 'on', onclick: () => go(i, true) }))) : null;
  const go = (n, user) => { cur = n; slideEls.forEach((e, i) => e.classList.toggle('on', i === n)); dots && [...dots.children].forEach((d, i) => d.classList.toggle('on', i === n)); if (user) restart(); };
  const restart = () => { clearInterval(timer); if (slides.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => { if (!document.body.contains(dots)) return clearInterval(timer); go((cur + 1) % slides.length); }, 7000); };
  restart();
  const heroEl = h('section', { class: 'hero' }, contourBg(), h('div', { class: 'slides' }, slideEls), dots, h('p', { class: 'caption' }, t('hero_caption')));
  const sections = h('div', { class: 'wrap' });
  main.replaceChildren(heroEl, sections);
  const audName = { men: t('men'), women: t('women'), 'brand-new': t('brand_new'), bonda: t('bonda') };
  const audTiles = (STORE.audiences || []).map(a => h('a', { class: 'tile aud' + (a.cover ? '' : ' plain'), href: `#/c/${a.slug}` }, a.cover && img(a.cover, '', 400, 500), h('span', { class: 'cap' }, h('b', null, audName[a.slug]), h('small', null, t('items_n', a.count)))));
  if (audTiles.length) sections.append(h('section', { class: 's' }, sectionHead(t('shop_by_group')), h('div', { class: 'tiles auds' }, audTiles)));
  const tiles = STORE.categories.map((c, i) => h('a', { class: 'tile' + (i === 0 ? ' big' : ''), href: `#/c/${c.slug}` }, c.cover && img(c.cover, '', 400, 500), h('span', { class: 'cap' }, h('b', null, c.name), h('small', null, t('items_n', c.count)))));
  tiles.push(h('a', { class: 'tile gilt', href: '#/shein' }, h('span', { class: 'cap' }, h('b', null, t('shein')), h('small', null, t('shein_custom_title')))));
  sections.append(h('section', { class: 's' }, sectionHead(t('shop_by')), h('div', { class: 'tiles' }, tiles)));
  const holder = h('div'); sections.append(holder); holder.append(skeletons(4));
  try {
    const [news, best] = await Promise.all(['new-arrivals', 'best-sellers'].map(c => api(`/api/products?category=${c}&limit=8`)));
    holder.replaceChildren();
    for (const [txt, list, link] of [[t('featured'), featured, '#/c/featured'], [t('new_arrivals'), news, '#/c/new-arrivals'], [t('best_sellers'), best, '#/c/best-sellers']]) if (list.length) holder.append(h('section', { class: 's' }, sectionHead(txt, link), grid(list.slice(0, list.length >= 4 ? Math.min(8, Math.floor(list.length / 4) * 4) : list.length))));
    if (!featured.length && !news.length && !best.length) holder.append(h('section', { class: 's' }, sectionHead(t('all_products'), '#/shop'), grid(await api('/api/products?limit=8'))));
  } catch (e) { holder.replaceChildren(h('p', { class: 'empty' }, e.message)); }
  if (promos.length) sections.append(h('div', { class: 'promos' }, promos.map((b, i) => h('a', { class: 'promo' + (i % 2 ? ' alt' : ''), href: b.link || '#/shop', style: b.image ? `background-image:linear-gradient(0deg,rgba(0,0,0,.72),rgba(0,0,0,.1)),url("${b.image.replace(/["\\()]/g, '')}")` : null }, h('h2', null, b.title), b.subtitle && h('p', null, b.subtitle)))));
}

async function pageShop(main, { slug, q }) {
  const known = { 'new-arrivals': t('new_arrivals'), 'best-sellers': t('best_sellers'), 'special-offers': t('special_offers'), featured: t('featured'), men: t('men'), women: t('women'), 'brand-new': t('brand_new'), bonda: t('bonda') };
  const name = slug ? (known[slug] || (STORE.categories.find(c => c.slug === slug) || {}).name || t('all_products')) : (q ? t('search_for', q) : t('all_products'));
  title(name); setActive(slug || (q ? '' : 'all'));
  const out = h('div'), f = { sort: 'newest', size: '', color: '', min: '', max: '', instock: false, g: slug === 'men' || slug === 'women' ? slug : '', c: slug === 'brand-new' ? 'new' : slug === 'bonda' ? 'bonda' : '' };
  const AUD = ['men', 'women', 'brand-new', 'bonda'];
  main.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'pagehead' }, h('div', { class: 'crumbs' }, h('a', { href: '#/' }, t('home')), ' / ', name), h('h1', { class: 'display' }, name)), h('form', { class: 'shopsearch', role: 'search', onsubmit: e => { e.preventDefault(); const v = $('input', e.target).value.trim(); location.hash = v ? `#/shop?q=${encodeURIComponent(v)}` : '#/shop'; } }, h('input', { type: 'search', value: q || '', placeholder: t('search_ph'), 'aria-label': t('search'), maxlength: '60' }), h('button', { class: 'btn', type: 'submit' }, icon('search', 16), t('search_btn'))), h('div', { id: 'chips' }), h('div', { id: 'filters' }), out));
  out.append(skeletons());
  let all;
  try { all = await api('/api/products?' + new URLSearchParams({ ...(slug && !AUD.includes(slug) ? { category: slug } : {}), ...(q ? { q } : {}), limit: 100 })); }
  catch (e) { return out.replaceChildren(h('p', { class: 'empty' }, e.message)); }
  const uniq = k => [...new Set(all.flatMap(p => p[k]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sel = (label, key, opts, any) => h('select', { 'aria-label': label, onchange: e => { f[key] = e.target.value; draw(); } }, h('option', { value: '' }, any), opts.map(o => h('option', { value: o[0] ?? o }, o[1] ?? o)));
  $('#filters').replaceChildren(h('div', { class: 'filters' },
    sel(t('sort_newest'), 'sort', [['price_asc', t('sort_price_asc')], ['price_desc', t('sort_price_desc')], ['popular', t('sort_popular')], ['name', t('sort_name')]], t('sort_newest')),
    uniq('sizes').length > 0 && sel(t('size'), 'size', uniq('sizes'), t('any_size')), uniq('colors').length > 0 && sel(t('colour'), 'color', uniq('colors'), t('any_colour')),
    h('input', { type: 'number', min: '0', placeholder: t('min_price'), 'aria-label': t('min_price'), oninput: e => { f.min = e.target.value; draw(); } }),
    h('input', { type: 'number', min: '0', placeholder: t('max_price'), 'aria-label': t('max_price'), oninput: e => { f.max = e.target.value; draw(); } }),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: e => { f.instock = e.target.checked; draw(); } }), t('in_stock_only'))));
  const chipRow = (label, key, opts) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, opts.map(([v, txt]) => h('button', { type: 'button', class: f[key] === v ? 'on' : '', 'aria-pressed': String(f[key] === v), onclick: () => { f[key] = v; drawChips(); draw(); } }, txt)));
  function drawChips() { $('#chips').replaceChildren(h('div', { class: 'chips' }, chipRow(t('gender_lbl'), 'g', [['', t('everyone')], ['men', t('men')], ['women', t('women')]]), chipRow(t('cond_lbl'), 'c', [['', t('all')], ['new', t('brand_new')], ['bonda', t('bonda')]]))); }
  drawChips();
  function draw() {
    let list = all.filter(p => (!f.g || p.gender === f.g || p.gender === 'unisex') && (!f.c || p.condition === f.c) && (!f.size || p.sizes.includes(f.size)) && (!f.color || p.colors.includes(f.color)) && (!f.min || p.final_price >= +f.min) && (!f.max || p.final_price <= +f.max) && (!f.instock || p.stock_status !== 'out'));
    const by = { price_asc: (a, b) => a.final_price - b.final_price, price_desc: (a, b) => b.final_price - a.final_price, popular: (a, b) => b.units_sold - a.units_sold, name: (a, b) => a.name.localeCompare(b.name), newest: (a, b) => b.id - a.id }[f.sort || 'newest'];
    list = [...list].sort(by);
    out.replaceChildren(h('p', { class: 'count' }, t('products_n', list.length)), list.length ? grid(list) : h('p', { class: 'empty' }, t('nothing_matches')));
  }
  draw();
}

function recent(add) {
  let ids = []; try { ids = JSON.parse(safeStore.get('bv_recent') || '[]'); } catch {}
  if (add) { ids = [add, ...ids.filter(x => x !== add)].slice(0, 10); safeStore.set('bv_recent', JSON.stringify(ids)); }
  return ids;
}

async function pageProduct(main, id) {
  main.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'pd', style: 'margin-top:30px' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton', style: 'aspect-ratio:auto;height:400px' }))));
  let p; try { p = await api(`/api/products/${id}`); } catch (e) { return main.replaceChildren(h('div', { class: 'wrap empty' }, h('h2', null, t('product_not_found')), h('p', null, e.message), h('a', { class: 'btn', href: '#/shop' }, t('back_to_shop')))); }
  title(p.name); setActive(p.category);
  const prev = recent().filter(x => x !== p.id); recent(p.id);
  const sizes = [...new Set(p.variants.map(v => v.size))], colors = [...new Set(p.variants.map(v => v.color))];
  const st = { size: sizes.length === 1 ? sizes[0] : '', color: colors.length === 1 ? colors[0] : '', img: 0 };
  const qtyOf = (s, c) => { const v = p.variants.find(x => x.size === s && x.color === c); return v ? v.stock : 0; };
  const imgs = p.images.map(i => i.url);
  const mainImg = imgs.length ? img(imgs[0], p.name, 800, 1000, false) : h('div');
  const thumbs = h('div', { class: 'thumbs' }, imgs.length > 1 && imgs.map((u, i) => h('button', { class: i ? '' : 'on', 'aria-label': t('photo_n', i + 1), onclick: () => { st.img = i; mainImg.src = u; [...thumbs.children].forEach((b, j) => b.classList.toggle('on', j === i)); } }, img(u, '', 150, 190))));
  const stockEl = h('span', { class: 'stock' }), sizeRow = h('div', { class: 'pills', role: 'group', 'aria-label': t('size') }), colorRow = h('div', { class: 'pills', role: 'group', 'aria-label': t('colour') });
  function refresh() {
    sizeRow.replaceChildren(...sizes.map(s => h('button', { class: 'pill' + (st.size === s ? ' on' : ''), disabled: !colors.some(c => (!st.color || c === st.color) && qtyOf(s, c) > 0), onclick: () => { st.size = st.size === s ? '' : s; refresh(); } }, s)));
    colorRow.replaceChildren(...colors.map(c => h('button', { class: 'pill' + (st.color === c ? ' on' : ''), disabled: !sizes.some(s => (!st.size || s === st.size) && qtyOf(s, c) > 0), onclick: () => { st.color = st.color === c ? '' : c; refresh(); } }, c)));
    let status, text;
    if (st.size && st.color) { const q = qtyOf(st.size, st.color); status = q <= 0 ? 'out' : q <= 3 ? 'low' : 'in'; text = q <= 0 ? t('stock_out_combo') : q <= 3 ? t('stock_low_combo', q) : (q <= 10 ? t('stock_n_combo', q) : t('in_stock')); }
    else { status = p.stock_status; text = status === 'out' ? t('out_stock') : status === 'low' ? t('choose_hint_low') : t('choose_hint_in'); }
    stockEl.className = `stock ${status}`; stockEl.textContent = text;
  }
  refresh();
  const message = () => {
    if ((sizes.length > 1 && !st.size) || (colors.length > 1 && !st.color)) { toast(t('choose_size_colour')); $('#opts').scrollIntoView({ behavior: 'smooth', block: 'center' }); return null; }
    return [t('order_hello', S().store_name), `${p.name} (${p.code})`, `${t('cond_line')}: ${p.condition === 'bonda' ? t('bonda') : t('brand_new')}`, `${t('size_lbl')}: ${st.size || t('one_size')}`, `${t('colour_lbl')}: ${st.colour || st.color || '-'}`, `${t('price_lbl')}: ${etb(p.final_price)}`, '', t('available_q')].join('\n');
  };
  const cta = h('div', { class: 'cta' }, contactButtons(message));
  const bar = h('div', { class: 'stickybar' }, contactButtons(message, { call: t('call_short'), wa: t('wa_short'), tg: t('tg_short') }, 'btn sm'));
  document.body.classList.add('has-bar');
  const info = h('div', { class: 'info' },
    h('div', { class: 'code' }, `${p.category_name}, ${t('code')} ${p.code}`), h('h1', { class: 'display' }, p.name),
    h('div', { class: 'tags' }, h('span', { class: 'tag' + (p.condition === 'bonda' ? ' bonda' : '') }, p.condition === 'bonda' ? t('bonda') : t('brand_new')), h('span', { class: 'tag' }, `${t('for_lbl')}: ${p.gender === 'men' ? t('men') : p.gender === 'women' ? t('women') : t('anyone')}`)),
    p.condition === 'bonda' && h('p', { class: 'bondanote' }, t('bonda_note')),
    h('div', { class: 'price big' }, h('b', null, etb(p.final_price)), p.sale_price != null && [h('s', null, etb(p.price)), h('span', { class: 'off' }, `-${p.discount_percent}%`)]),
    p.rating_avg != null && h('p', { class: 'rate' }, stars(p.rating_avg), ` ${p.rating_avg} (${p.review_count})`),
    h('p', { class: 'stockline' }, stockEl, p.units_sold > 0 && h('span', { class: 'muted' }, t('sold_n', p.units_sold))),
    h('div', { id: 'opts' }, sizes.length > 0 && h('div', { class: 'opt' }, h('span', { class: 'lbl' }, t('size')), sizeRow), colors.length > 0 && h('div', { class: 'opt' }, h('span', { class: 'lbl' }, t('colour')), colorRow)),
    cta, h('p', { class: 'note' }, t('no_checkout')),
    p.description && h('p', { class: 'desc' }, p.description),
    (p.material || p.fit) && h('dl', { class: 'dl' }, p.material && [h('dt', null, t('material')), h('dd', null, p.material)], p.fit && [h('dt', null, t('fit')), h('dd', null, p.fit)]),
    p.specs.length > 0 && h('ul', { class: 'specs' }, p.specs.map(x => h('li', null, x))),
    h('p', { class: 'muted small' }, `${t('delivery')}: ${S().delivery_info}`));
  const gallery = h('div', { class: 'gal' }, h('div', { class: 'main', onclick: () => imgs.length && openLightbox(imgs, st.img), role: 'button', tabindex: '0', 'aria-label': t('zoom'), onkeydown: e => { if (e.key === 'Enter') openLightbox(imgs, st.img); } }, mainImg, imgs.length > 0 && h('span', { class: 'expand' }, icon('expand', 14), t('zoom'))), thumbs);
  const reviews = h('section', { class: 's' }, h('h2', null, t('reviews')),
    p.reviews.length ? h('div', { class: 'rvlist' }, p.reviews.map(r => h('div', { class: 'rv' },
      h('div', { class: 'who' }, stars(r.rating), h('b', null, r.name), r.verified ? h('span', { class: 'vb' }, '✓ ' + t('verified')) : h('span', { class: 'uv' }, t('unverified')), h('span', { class: 'muted small' }, r.created_at.slice(0, 10))),
      r.comment && h('p', null, r.comment), r.photos.length > 0 && h('div', { class: 'rvphotos' }, r.photos.map(u => h('img', { src: u, alt: '', loading: 'lazy', onclick: () => openLightbox(r.photos, r.photos.indexOf(u)) }))),
      r.admin_reply && h('div', { class: 'reply' }, h('b', null, `${S().store_name}: `), r.admin_reply)))) : h('p', { class: 'muted' }, t('reviews_none')), reviewForm(p));
  const wrap = h('div', { class: 'wrap' }, h('div', { class: 'crumbs' }, h('a', { href: '#/' }, t('home')), ' / ', h('a', { href: `#/c/${p.category}` }, p.category_name), ' / ', p.name), h('div', { class: 'pd' }, gallery, info), reviews);
  if (p.related.length) wrap.append(h('section', { class: 's' }, sectionHead(t('related')), grid(p.related)));
  main.replaceChildren(wrap, bar);
  if (prev.length) api(`/api/products-by-ids?ids=${prev.join(',')}`).then(list => { if (list.length && document.body.contains(wrap)) wrap.append(h('section', { class: 's' }, sectionHead(t('recent')), grid(prev.map(i => list.find(x => x.id === i)).filter(Boolean).slice(0, 4)))); }).catch(() => {});
}

function resizeImage(file, max = 1400) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = h('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error(t('went_wrong'))), 'image/jpeg', .82); };
    im.onerror = () => rej(new Error(t('went_wrong'))); im.src = u; });
}
function reviewForm(p) {
  let rating = 0; const photos = [];
  const starRow = h('div', { class: 'starpick', role: 'group', 'aria-label': t('rating') }), thumbs = h('div', { class: 'rvphotos' }), msg = h('p', { class: 'muted', role: 'status' });
  const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map(n => h('button', { type: 'button', class: n <= rating ? 'on' : '', 'aria-label': `${n}`, onclick: () => { rating = n; drawStars(); } }, '★')));
  drawStars();
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, onchange: async e => {
    for (const f of [...e.target.files].slice(0, 3 - photos.length)) { try { const blob = await resizeImage(f); const r = await api('/api/review-photo', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }); photos.push(r.url); thumbs.append(h('img', { src: r.url, alt: '' })); } catch (er) { toast(er.message); } }
    e.target.value = ''; } });
  const name = h('input', { required: true, maxlength: '60', autocomplete: 'given-name' });
  if (inTG && TG.initDataUnsafe && TG.initDataUnsafe.user) name.value = TG.initDataUnsafe.user.first_name || '';
  return h('form', { class: 'box', onsubmit: async e => {
    e.preventDefault(); if (!rating) return toast(t('choose_rating'));
    const fd = new FormData(e.target), btn = $('button[type=submit]', e.target); btn.disabled = true;
    try { const r = await api(`/api/products/${p.id}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value, rating, comment: fd.get('comment'), phone: fd.get('phone'), photos, initData: inTG ? TG.initData : '' }) });
      e.target.reset(); photos.length = 0; thumbs.replaceChildren(); rating = 0; drawStars(); msg.textContent = r.message; toast(r.message);
    } catch (er) { toast(er.message); } btn.disabled = false; } },
    h('h3', null, t('write_review')), h('label', null, t('your_name'), name), h('div', null, h('span', { class: 'lbl' }, t('rating')), starRow),
    h('label', null, t('your_review'), h('textarea', { name: 'comment', rows: '3', maxlength: '1000' })),
    h('label', null, t('phone_label'), h('input', { name: 'phone', type: 'tel', autocomplete: 'tel', maxlength: '30' }), h('span', { class: 'hint' }, t('phone_hint'))),
    h('label', null, t('photos_label'), file), thumbs, h('button', { class: 'btn solid', type: 'submit' }, t('submit_review')), msg);
}

async function pageShein(main) {
  title(t('shein')); setActive('shein');
  main.replaceChildren(h('div', { class: 'wrap' }, skeletons(2)));
  let d; try { d = await api('/api/shein'); } catch (e) { return main.replaceChildren(h('div', { class: 'wrap empty' }, e.message)); }
  const reqMsg = o => [t('req_hello', S().store_name), o.code && `${t('req_code')}: ${o.code}`, o.title && `${t('req_item')}: ${o.title}`, o.link && `${t('req_link')}: ${o.link}`, `${t('size_lbl')}: ${o.size || '-'}`, `${t('colour_lbl')}: ${o.color || '-'}`, `${t('qty')}: ${o.qty || 1}`, o.est && `${t('req_est')}: ${etb(o.est)}`, '', t('req_confirm')].filter(x => x !== false && x != null).join('\n');
  const opts = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const pick = (list, ph) => list.length ? h('select', { 'aria-label': ph }, h('option', { value: '' }, ph), list.map(x => h('option', null, x))) : h('input', { placeholder: ph, 'aria-label': ph });
  const L = { call: t('call_inquire'), wa: t('wa_request'), tg: t('tg_request') };
  const cards = d.items.map(it => {
    const size = pick(opts(it.sizes), t('size')), color = pick(opts(it.colors), t('colour')), qty = h('input', { type: 'number', min: '1', max: '20', value: '1', 'aria-label': t('qty') });
    const get = () => reqMsg({ code: it.code, title: it.title, link: it.link, size: size.value, color: color.value, qty: qty.value, est: it.est_price });
    return h('div', { class: 'scard' }, it.image ? img(it.image, it.title, 220, 275) : h('div'), h('div', null, h('h3', null, it.title), h('div', { class: 'code' }, it.code), it.est_price != null && h('div', { class: 'price' }, h('b', null, t('about_price', etb(it.est_price))), h('span', { class: 'muted' }, t('estimate'))), it.note && h('p', { class: 'muted small' }, it.note),
      h('div', { class: 'row' }, size, color, qty), h('div', { class: 'btns' }, contactButtons(get, L, 'btn sm')), it.link && h('p', { class: 'small' }, h('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer' }, t('view_on_shein')))));
  });
  const link = h('input', { type: 'text', placeholder: t('shein_paste'), maxlength: '500', 'aria-label': t('shein_paste') });
  const size = h('input', { placeholder: t('size'), 'aria-label': t('size') }), color = h('input', { placeholder: t('colour'), 'aria-label': t('colour') }), qty = h('input', { type: 'number', min: '1', max: '20', value: '1', 'aria-label': t('qty') });
  const custom = h('form', { class: 'box', onsubmit: e => e.preventDefault() }, h('h3', null, t('shein_custom_title')), h('p', { class: 'muted' }, t('shein_custom_desc')), link, h('div', { class: 'row' }, size, color, qty),
    h('div', { class: 'cta' }, contactButtons(() => { const v = link.value.trim(); if (!v) { toast(t('shein_need_link')); return null; } const isUrl = /^https?:/i.test(v); return reqMsg({ link: isUrl ? v : '', code: isUrl ? '' : v, size: size.value, color: color.value, qty: qty.value }); }, L)));
  main.replaceChildren(h('div', { class: 'wrap' }, h('div', { class: 'crumbs' }, h('a', { href: '#/' }, t('home')), ' / ', t('shein')),
    h('div', { class: 'sheinhero' }, contourBg(), h('h1', { class: 'display' }, t('shein_title')), h('p', null, t('shein_intro')), h('p', null, h('b', null, t('shein_note_lbl') + ' '), d.notice)),
    d.items.length ? h('div', { class: 'slist' }, cards) : h('p', { class: 'muted' }, t('shein_none')), h('div', { style: 'margin-top:24px' }, custom)));
}

async function pageInfo(main) { title(t('delivery_policies')); setActive(''); main.replaceChildren(h('div', { class: 'wrap prose' }, h('div', { class: 'pagehead' }, h('h1', { class: 'display' }, t('delivery_policies'))), h('h3', null, t('delivery')), h('p', null, S().delivery_info), h('h3', null, t('policies')), h('p', null, S().policies), h('h3', null, t('how_ordering_works')), h('p', null, t('how_text')))); }

/* ---------- router ---------- */
async function route() {
  const main = $('#main'), raw = location.hash.slice(1) || '/', [path, qs] = raw.split('?'), q = Object.fromEntries(new URLSearchParams(qs || ''));
  document.body.classList.remove('has-bar'); $('#lightbox').hidden = true;
  const seg = path.split('/').filter(Boolean);
  try {
    if (!seg.length) await pageHome(main);
    else if (seg[0] === 'shop') await pageShop(main, { q: q.q });
    else if (seg[0] === 'c' && seg[1]) await pageShop(main, { slug: seg[1] });
    else if (seg[0] === 'p' && +seg[1]) await pageProduct(main, +seg[1]);
    else if (seg[0] === 'shein') await pageShein(main);
    else if (seg[0] === 'info') await pageInfo(main);
    else main.replaceChildren(h('div', { class: 'wrap empty' }, h('h2', null, t('page_not_found')), h('a', { class: 'btn', href: '#/' }, t('go_home'))));
  } catch (e) { console.error(e); main.replaceChildren(h('div', { class: 'wrap empty' }, h('h2', null, t('went_wrong')), h('p', null, t('refresh')))); }
  window.scrollTo(0, 0);
  if (TG && inTG) { try { seg.length ? TG.BackButton.show() : TG.BackButton.hide(); } catch {} }
}
async function setLang(k) {
  LANG = k; safeStore.set('bv_lang', k); document.documentElement.lang = k;
  try { STORE = await api('/api/store'); } catch {}
  $('.skip').textContent = t('skip'); renderTop(); renderFooter(); route();
}
addEventListener('hashchange', route);
if (inTG) { try { TG.BackButton.onClick(() => history.back()); } catch {} }

(async () => {
  document.documentElement.lang = LANG; $('.skip').textContent = t('skip');
  try { STORE = await api('/api/store'); }
  catch { $('#main').replaceChildren(h('div', { class: 'wrap empty' }, h('h2', null, t('be_right_back')), h('p', null, t('store_not_loaded')))); return; }
  // A channel post's "Open in store" button opens the Mini App with ?startapp=p_<id>: go straight to that product.
  try { const m = inTG && /^p_(\d{1,9})$/.exec((TG.initDataUnsafe && TG.initDataUnsafe.start_param) || ''); if (m && !location.hash.slice(1)) location.hash = `#/p/${m[1]}`; } catch {}
  renderTop(); renderFooter(); route();
})();
})();
