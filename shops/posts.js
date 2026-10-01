'use strict';
// bina.et/shop: products and offers posted by shop owners through Bini (30 Sep 2026, Ibrahim: "any shop owner post
// will come show here"). Any shop in Addis can post, in a building on BinaSmart or not; nothing is public until a person
// on the team has called the owner and tapped approve. Only real posts are shown: the sample shops and products that
// seed the mall/building demos (no slug, invented items) never appear here.
//
//   POST /api/shop/post                    ONLY from Bini's tool (x-bini-internal key): add | change | remove
//   GET  /ops/shop-posts/:id/:action?t=    one tap from the team's Telegram: approve | reject | photo?n= | remove
//   GET  /api/shop/feed                    live posts, newest first (for the page, Bini and the MCP server)
//   GET  /shop                             the page: posts drawn on the server, so search engines read real items
//
// Photos come from the chat's camera button: the widget sends them to /api/property/photo, which keeps them PRIVATE
// in uploads/listing-photos/<uid>/ (the same store the home listings use). On approve each one is re-encoded by
// ops/places/owner-photo.py (EXIF and GPS stripped) into public/shop/img/<id>-gN.webp.
// Posts live in /root/storage/shop/posts.json: a handful a day, one process writes, so a JSON file is enough.

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const PEND = path.join(ROOT, 'uploads', 'listing-photos');
const PUB = path.join(ROOT, 'public', 'shop', 'img');
const STORE = process.env.SHOP_POSTS_FILE || '/root/storage/shop/posts.json';
const PAGE = path.join(ROOT, 'public', 'shop.html');
const INTERNAL_KEY = crypto.randomBytes(24).toString('hex');   // same process as assistant/tools.js; never leaves the box

// what can be posted; medicines, weapons, alcohol, tobacco, counterfeit and adult items are refused by Bini and the team
const CATS = {
  fashion: ['\u{1F457}', 'Clothes', 'ልብስ'], shoes: ['\u{1F45F}', 'Shoes', 'ጫማ'], electronics: ['\u{1F4BB}', 'Electronics', 'ኤሌክትሮኒክስ'],
  phones: ['\u{1F4F1}', 'Phones', 'ስልክ'], beauty: ['\u{1F484}', 'Beauty', 'ውበት'], food: ['\u{1F9FA}', 'Food & groceries', 'ምግብ'],
  home: ['\u{1F6CB}', 'Home & furniture', 'የቤት ዕቃ'], kids: ['\u{1F9F8}', 'Kids', 'ልጆች'], books: ['\u{1F4DA}', 'Books & stationery', 'መጻሕፍት'],
  other: ['\u{1F6CD}', 'Other', 'ሌሎች'],
};
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ethPhone(raw) {                       // 0911..., 911..., +251911... -> +251911...
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^0[79]\d{8}$/.test(d)) d = '+251' + d.slice(1);
  else if (/^[79]\d{8}$/.test(d)) d = '+251' + d;
  else if (/^251[79]\d{8}$/.test(d)) d = '+' + d;
  else if (/^0(11|2\d|3\d|4\d|5\d)\d{7}$/.test(d)) d = '+251' + d.slice(1);   // an Addis or regional landline
  return /^\+251\d{9}$/.test(d) ? d : '';
}
const uidOk = u => /^[A-Za-z0-9_-]{6,64}$/.test(String(u || ''));
const tokEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
// a number for JSON-LD when the price reads as one ("1,200 birr", "ብር 950"); "20% off" or "from 500" stays text only
const priceNum = p => { const m = String(p || '').replace(/,/g, '').match(/^\D{0,6}(\d{2,9})(?:\.\d+)?\s*(?:birr|br|etb|ብር)?\.?$/i); return m ? Number(m[1]) : null; };

function readStore() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return { posts: [] }; } }
function writeStore(s) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE + '.part', JSON.stringify(s, null, 1)); fs.renameSync(STORE + '.part', STORE); }
function pendingPhotos(uid) {                  // newest last
  const dir = path.join(PEND, uid);
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.img')).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs); }
  catch (e) { return []; }
}
const live = () => readStore().posts.filter(p => p.status === 'live').sort((a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)));
// what the public sees of a post: never the owner's name, the submitter uid or the review tokens
const pub = p => ({ id: p.id, kind: p.kind, category: p.category, title: p.title, price: p.price, description: p.description || null,
  shop: p.shop.name, area: p.shop.area || null, phone: p.shop.phone, whatsapp: p.shop.whatsapp ? p.shop.phone : null,
  photos: p.photos || [], postedAt: p.approvedAt, url: 'https://bina.et/shop#p-' + p.id });

// Bini's search_shops looks here too, so a buyer who asks "where can I buy X" finds what shops posted (30 Sep 2026).
// Buyers ask in Amharic or English while posts may be in either, so words also map to a category.
const CATWORDS = {
  fashion: ['cloth', 'dress', 'shirt', 'suit', 'jean', 'trouser', 'skirt', 'jacket', 'fashion', 'boutique', 'ልብስ', 'ቀሚስ', 'ሸሚዝ', 'ሱሪ', 'ጃኬት', 'ቡቲክ', 'ቱታ'],
  shoes: ['shoe', 'sneaker', 'boot', 'sandal', 'ጫማ', 'ነጠላ ጫማ'],
  electronics: ['electronic', 'laptop', 'computer', 'speaker', 'fridge', 'television', 'ኤሌክትሮኒክስ', 'ቲቪ', 'ኮምፒውተር', 'ላፕቶፕ', 'ፍሪጅ'],
  phones: ['phone', 'mobile', 'iphone', 'samsung', 'tecno', 'charger', 'ስልክ', 'ሞባይል', 'ቻርጀር'],
  beauty: ['beauty', 'cosmetic', 'perfume', 'makeup', 'cream', 'ውበት', 'ኮስሞቲክስ', 'ሽቶ', 'ቅባት'],
  food: ['food', 'bread', 'bakery', 'grocery', 'groceries', 'coffee', 'spice', 'ምግብ', 'ዳቦ', 'ቡና', 'በርበሬ', 'ቅመም'],
  home: ['furniture', 'sofa', 'bed', 'chair', 'kitchen', 'ፈርኒቸር', 'ሶፋ', 'አልጋ', 'ጠረጴዛ', 'ወንበር', 'የቤት ዕቃ'],
  kids: ['kid', 'child', 'baby', 'toy', 'ልጆች', 'ልጅ', 'ሕፃን', 'አሻንጉሊት'],
  books: ['book', 'stationery', 'notebook', 'መጽሐፍ', 'መጻሕፍት', 'ደብተር', 'እስክሪብቶ'],
};
const ETH = /\p{Script=Ethiopic}/u;
function searchLive(q, limit = 4, { strict = false } = {}) {   // strict: the item or category must match, not just the area
  const words = String(q || '').toLowerCase().split(/[\s,.;:!?·\/()«»"'፣።]+/).filter(w => w.length >= (ETH.test(w) ? 2 : 3));
  const posts = live();
  if (!words.length) return posts.slice(0, limit).map(pub);
  const cats = new Set(Object.keys(CATWORDS).filter(k => words.some(w => w === CATS[k][1].toLowerCase() || w === CATS[k][2]
    || CATWORDS[k].some(c => c === w || (w.length >= 3 && (c.includes(w) || w.includes(c)))))));
  return posts.map(p => {
    const c = CATS[p.category] || [], hay = [p.title, p.description, p.shop.name, strict ? '' : p.shop.area, c[1], c[2]].join(' ').toLowerCase();
    return { p, s: words.filter(w => hay.includes(w)).length * 2 + (cats.has(p.category) ? 1 : 0) };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => pub(x.p));
}

async function tellTeam(text) {                // same bot and chats as company / hotel / home-listing requests
  const tok = process.env.BINA_RIDER_BOT_TOKEN;
  const chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].filter(Boolean);
  if (!tok || !chats.length) return false;
  let ok = false;
  for (const chat of [...new Set(chats)]) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
      ok = (await r.json()).ok === true || ok;
    } catch (e) { /* the other chat may still get it */ }
  }
  return ok;
}

// ---- the page ----
function ago(iso) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}
function card(p) {
  const c = CATS[p.category] || CATS.other, tel = p.phone.replace(/[^\d+]/g, '');
  const wa = p.whatsapp ? 'https://wa.me/' + p.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent('Hello, I saw "' + p.title + '" on BinaSmart (bina.et/shop). Is it available?') : null;
  const img = p.photos[0] ? '<img src="' + esc(p.photos[0]) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async">' : '<span class="ph">' + c[0] + '</span>';
  return '<article class="pc rv" id="p-' + esc(p.id) + '" data-cat="' + esc(p.category) + '">'
    + '<div class="pi">' + img + '<span class="cb">' + c[0] + ' ' + esc(c[1]) + '</span>' + (p.kind === 'offer' ? '<span class="ob">Offer · ቅናሽ</span>' : '')
    + (p.photos.length > 1 ? '<span class="pn">\u{1F4F7} ' + p.photos.length + '</span>' : '') + '</div>'
    + '<div class="pb"><h3>' + esc(p.title) + '</h3><div class="pp">' + esc(p.price) + '</div>'
    + (p.description ? '<p class="pd">' + esc(p.description) + '</p>' : '')
    + '<div class="ps">' + esc(p.shop) + (p.area ? ' · ' + esc(p.area) : '') + '</div>'
    + '<div class="pa"><a class="bt call" href="tel:' + esc(tel) + '">\u{1F4DE} Call · ይደውሉ</a>'
    + (wa ? '<a class="bt wa" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</div>'
    + '<div class="pt" data-t="' + esc(p.postedAt) + '">' + ago(p.postedAt) + '</div></div></article>';
}
function itemListLd(posts) {
  if (!posts.length) return '';
  return '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'New from shop owners in Addis Ababa',
    itemListElement: posts.slice(0, 30).map((p, i) => { const n = priceNum(p.price); return { '@type': 'ListItem', position: i + 1, item: { '@type': 'Product', name: p.title,
      url: p.url, image: p.photos.slice(0, 3), description: p.description || undefined, category: (CATS[p.category] || CATS.other)[1],
      offers: n ? { '@type': 'Offer', price: n, priceCurrency: 'ETB', availability: 'https://schema.org/InStock',
        seller: { '@type': 'LocalBusiness', name: p.shop, telephone: p.phone, address: { '@type': 'PostalAddress', addressLocality: p.area || 'Addis Ababa', addressCountry: 'ET' } } } : undefined } }; }) })
    .replace(/</g, '\\u003c') + '</script>';
}
// real businesses in JJ Darule Building that have their own page (the demo restaurant and café are left out)
const DEMO = new Set(['bina-restaurant', 'kaldis-cafe']);
async function darulleShops(prisma) {
  try {
    const rows = await prisma.shop.findMany({ where: { slug: { not: null }, NOT: { category: 'OFFICE' } }, select: { slug: true, name: true, nameAm: true, category: true }, take: 40 });
    return rows.filter(s => !DEMO.has(s.slug));
  } catch (e) { return []; }
}
const SHOPICON = { PHARMACY: '\u{1F48A}', BANK: '\u{1F3E6}', CAFE: '☕', RESTAURANT: '\u{1F37D}', RETAIL: '\u{1F6D2}', SERVICE: '\u{1F6E0}', SALON: '\u{1F487}', GYM: '\u{1F3CB}', CLINIC: '\u{1FA7A}' };

let tpl = { mtime: 0, html: '' };
function template() { const st = fs.statSync(PAGE); if (st.mtimeMs !== tpl.mtime) tpl = { mtime: st.mtimeMs, html: fs.readFileSync(PAGE, 'utf8') }; return tpl.html; }

module.exports = function shopPosts(fastify, { prisma, limiter, tell }, done) {
  const notify = tell || tellTeam;
  const PY = (script, args) => require('child_process').execFileSync('python3', [path.join(ROOT, 'ops', 'places', script)].concat(args), { timeout: 60000, stdio: 'pipe' }).toString().trim();
  const postRL = limiter(3600000, 6);

  // ---- the Bini tool: add / change / remove ----
  fastify.post('/api/shop/post', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    if (!tokEq(req.headers['x-bini-internal'], INTERNAL_KEY)) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {}, ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!postRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const action = ['add', 'change', 'remove'].includes(b.action) ? b.action : 'add';
    const name = clean(b.name, 80), phone = ethPhone(b.phone), shop = clean(b.shop, 80);
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone' });
    const who = '\u{1F464} ' + esc(name) + (shop ? ' · ' + esc(shop) : '') + '\n\u{1F4DE} ' + esc(phone);
    const S = readStore();

    if (action !== 'add') {                     // change / remove: a person on the team does it after a call
      const ref = clean(b.post, 120).toLowerCase(), what = clean(b.request, 500);
      const mine = S.posts.filter(p => p.status === 'live' && p.shop.phone === phone);
      const P = mine.find(p => ref && (p.title.toLowerCase().includes(ref) || ref.includes(p.title.toLowerCase()) || ref.includes(p.id))) || (mine.length === 1 ? mine[0] : null);
      if (action === 'remove' && P) {
        P.removeToken = crypto.randomBytes(16).toString('hex'); writeStore(S);
        await notify('\u{1F5D1} <b>Shop post: remove request via Bini</b> · ' + esc(P.title) + '\n' + who + (what ? '\n\u{1F4DD} ' + esc(what) : '')
          + '\n\n<a href="https://bina.et/shop#p-' + P.id + '">post</a> · <a href="https://bina.et/ops/shop-posts/' + P.id + '/remove?t=' + P.removeToken + '">✅ take it down</a>');
      } else {
        await notify((action === 'remove' ? '\u{1F5D1} <b>Shop post: remove request via Bini</b> (post not matched)' : '✏️ <b>Shop post: change request via Bini</b>')
          + (P ? ' · ' + esc(P.title) : ref ? ' · ' + esc(ref) : '') + '\n' + who + (what ? '\n\u{1F4DD} ' + esc(what) : '') + '\n\nCall first, then edit by hand.');
      }
      return { ok: true, matched: !!P };
    }

    const title = clean(b.title, 90), price = clean(b.price, 50), area = clean(b.area, 60);
    const category = CATS[b.category] ? b.category : 'other', kind = b.kind === 'offer' ? 'offer' : 'product';
    if (shop.length < 2) return reply.code(400).send({ ok: false, error: 'shop' });
    if (title.length < 2) return reply.code(400).send({ ok: false, error: 'title' });
    if (price.length < 1) return reply.code(400).send({ ok: false, error: 'price' });
    const since = Date.now() - 6 * 3600000;
    if (S.posts.some(p => p.status === 'pending' && p.shop.phone === phone && p.title.toLowerCase() === title.toLowerCase() && Date.parse(p.createdAt) > since)) return { ok: true, duplicate: true };

    const id = crypto.randomBytes(5).toString('hex'), token = crypto.randomBytes(16).toString('hex');
    const pending = uidOk(b.uid) ? pendingPhotos(b.uid).slice(-6) : [];
    const post = { id, status: 'pending', token, createdAt: new Date().toISOString(), kind, category, title, price, description: clean(b.description, 400) || null,
      shop: { name: shop, area: area || null, phone, whatsapp: b.whatsapp !== false }, owner: { name }, pendingPhotos: pending, photos: [] };
    S.posts.push(post); writeStore(S);
    const base = 'https://bina.et/ops/shop-posts/' + id + '/', c = CATS[category];
    await notify('\u{1F6CD} <b>New shop ' + (kind === 'offer' ? 'OFFER' : 'post') + ' via Bini</b> (not live)\n' + c[0] + ' ' + c[1] + ' · <b>' + esc(title) + '</b>\n\u{1F4B0} ' + esc(price)
      + (post.description ? '\n\u{1F4DD} ' + esc(post.description.slice(0, 300)) : '') + '\n\u{1F3EA} ' + esc(shop) + (area ? ' · ' + esc(area) : '')
      + '\n' + who + (post.shop.whatsapp ? ' (WhatsApp ok)' : '')
      + '\n\u{1F4F7} ' + pending.length + ' photo(s)' + (pending.length ? ': ' + pending.map((_, i) => '<a href="' + base + 'photo?n=' + i + '&t=' + token + '">' + (i + 1) + '</a>').join(' ') : '')
      + '\n\nCall the shop before approving (real shop? real item? allowed?).\n<a href="' + base + 'approve?t=' + token + '">✅ approve - goes live</a> · <a href="' + base + 'reject?t=' + token + '">❌ reject</a>');
    return { ok: true, id, photos: pending.length };
  });

  // ---- one tap from Telegram ----
  fastify.get('/ops/shop-posts/:id/:action', async (req, reply) => {
    const S = readStore(), P = S.posts.find(p => p.id === String(req.params.id).slice(0, 20)), act = String(req.params.action);
    reply.header('X-Robots-Tag', 'noindex');
    if (!P || !tokEq(req.query.t, act === 'remove' ? P.removeToken : P.token)) return reply.code(404).send('not found');
    const page = msg => reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + msg + '</p>');
    if (act === 'photo') {
      const f = (P.pendingPhotos || [])[Number(req.query.n) || 0];
      if (!f || !f.startsWith(PEND) || !fs.existsSync(f)) return reply.code(404).send('no photo');
      return reply.type('image/jpeg').send(fs.readFileSync(f));
    }
    if (act === 'remove') { P.status = 'removed'; P.removeToken = null; P.removedAt = new Date().toISOString(); writeStore(S); return page('\u{1F5D1} Taken down: ' + esc(P.title)); }
    if (P.status !== 'pending') return page('Already ' + esc(P.status) + ': ' + esc(P.title));
    if (act === 'reject') {
      (P.pendingPhotos || []).forEach(f => { try { if (f.startsWith(PEND)) fs.unlinkSync(f); } catch (e) {} });
      Object.assign(P, { status: 'rejected', pendingPhotos: [], token: null, decidedAt: new Date().toISOString() }); writeStore(S);
      return page('❌ Rejected: ' + esc(P.title));
    }
    if (act !== 'approve') return reply.code(400).send('approve, reject, photo or remove');
    fs.mkdirSync(PUB, { recursive: true });
    const v = Math.floor(Date.now() / 1000), urls = [];
    (P.pendingPhotos || []).forEach(f => {
      if (!f.startsWith(PEND) || !fs.existsSync(f)) return;
      const out = path.join(PUB, P.id + '-g' + urls.length + '.webp');
      try { PY('owner-photo.py', [f, out]); urls.push('https://bina.et/static/shop/img/' + path.basename(out) + '?v=' + v); fs.unlinkSync(f); } catch (e) { /* skip a broken file */ }
    });
    Object.assign(P, { status: 'live', photos: urls, pendingPhotos: [], token: null, approvedAt: new Date().toISOString() }); writeStore(S);
    return page('✅ Live on <a href="/shop#p-' + P.id + '">bina.et/shop</a>: ' + esc(P.title) + ' (' + urls.length + ' photo' + (urls.length === 1 ? '' : 's') + ')');
  });

  // ---- public ----
  fastify.get('/api/shop/feed', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const cat = String((req.query || {}).category || '');
    const posts = live().map(pub).filter(p => !CATS[cat] || p.category === cat).slice(0, 60);
    return { count: posts.length, categories: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v[1]])), posts };
  });

  fastify.get('/shop', async (req, reply) => {
    const posts = live().map(pub), cats = [...new Set(posts.map(p => p.category))];
    const dar = await darulleShops(prisma);
    const html = template()
      .replace('<!--LD-->', itemListLd(posts))
      .replace('<!--COUNT-->', String(posts.length))
      .replace('<!--POSTS-->', posts.slice(0, 48).map(card).join(''))
      .replace('<!--EMPTY-->', posts.length ? '' : 'is-empty')
      .replace('<!--FILTERS-->', cats.length > 1 ? '<button class="ch on" data-f="">All · ሁሉም</button>' + cats.map(k => '<button class="ch" data-f="' + k + '">' + CATS[k][0] + ' ' + esc(CATS[k][1]) + '</button>').join('') : '')
      .replace('<!--DARULLE-->', dar.map(s => '<a class="ds rv" href="/shop/' + esc(s.slug) + '"><span>' + (SHOPICON[s.category] || '\u{1F3EA}') + '</span><div><b>' + esc(s.name) + '</b>' + (s.nameAm && s.nameAm !== s.name ? '<small class="am">' + esc(s.nameAm) + '</small>' : '') + '</div></a>').join(''));
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.type('text/html; charset=utf-8').send(html);
  });
  done();
};
module.exports.INTERNAL_KEY = INTERNAL_KEY;
module.exports.CATS = CATS;
module.exports.ethPhone = ethPhone;
module.exports.priceNum = priceNum;
module.exports.card = card;
module.exports.searchLive = searchLive;
// for shops/dashboard.js (sellers edit their own posts, 1 Oct 2026)
Object.assign(module.exports, { readStore, writeStore, clean, esc, tellTeam });
