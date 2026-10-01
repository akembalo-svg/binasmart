'use strict';
// BinaSmart Restaurants (1 Oct 2026, Ibrahim chose it after the restaurant call list): every restaurant, cafe and
// fast-food place on the city map gets a page, so a restaurant can be found (Google, AI assistants, Bini) and can
// claim its page through Bini. Until now the only restaurants in the directory were seeded demo shops, and a real
// restaurant could not join at all: a shop must be a tenant of a building BinaSmart manages.
//   GET  /restaurants                     the hub: search, kind filter, the places with most detail first
//   GET  /restaurants/:slug               one place: kind, cuisine, sub-city, landline, map, ride there, claim box
//   GET  /api/restaurants/directory       the list as JSON (the hub's search and "show all")
//   POST /api/restaurants/claim           Bini's company_request(kind "restaurant"): stored, NOT shown until approved
//   GET  /ops/restaurants/:id/:action?t=  one tap from Telegram: approve | reject
// From the map only landlines are shown (a mobile in a map tag is somebody's private phone). What the owner sends -
// the number to show, hours, a few dishes with prices, a line about the place - shows after the team has called.
// Stored in /root/storage/restaurants/entries.json (a few a day, one process writes).

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const H = require('../health/directory');   // esc, clean, kebab, landlines, ethPhone, SUB_AM, tokEq: one set of helpers
const { esc, clean, kebab, landlines, ethPhone, SUB_AM, tokEq } = H;
const OSM = () => process.env.RESTAURANTS_OSM_FILE || '/root/storage/osm-addis-latest.json';
const STORE = () => process.env.RESTAURANTS_FILE || '/root/storage/restaurants/entries.json';
const BASE = 'https://bina.et';

const KINDS = { restaurant: ['🍽️', 'Restaurant', 'ምግብ ቤት', 'Restaurant'], cafe: ['☕', 'Café', 'ካፌ', 'CafeOrCoffeeShop'],
  fast_food: ['🍔', 'Fast food', 'ፈጣን ምግብ', 'FastFoodRestaurant'] };
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 109.5);
const phoneKey = t => { const d = String(t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || '').split(/[;,/]/)[0].replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
// A name that only says what it is ("Cafe", "ምግብ ቤት") names nothing: it keeps a page, but not an indexed one.
const GENERIC_NAME = /^(the\s+)?(restaurant|resturant|cafe|café|coffee|coffee house|fast food|burger|pizza|juice( house)?|bar and restaurant|cafe and restaurant|ምግብ ቤት|ካፌ|ሬስቶራንት|ቡና ቤት|ጁስ ቤት)$/i;
const cuisineOf = t => String(t.cuisine || '').split(/[;,]/).map(s => s.trim().replace(/_/g, ' ')).filter(s => s && s.length < 30).slice(0, 6);

function buildPlaces(osm) {
  const els = (osm && osm.elements) || [], bySub = (osm && osm.bySub) || {}, out = [];
  for (const e of els) {
    const t = e.tags || {}, kind = KINDS[t.amenity] ? t.amenity : null;
    if (!kind) continue;
    const ethiopic = /[ሀ-፿]/.test(t.name || '') && !/[a-z]/i.test(t.name || '');
    let name = clean((ethiopic && t['name:en']) || t.name || t['name:en'] || t['name:am'], 90), mixedAm = '';
    // one tag holding both scripts ("Kiyab Cafe ኪያብ ካፌ"): English as the name, the Amharic as its subtitle
    if (/[ሀ-፿]/.test(name) && /[a-z]{3}/i.test(name)) {
      const am = (name.match(/[ሀ-፿][ሀ-፿\s.\/()-]*/g) || []).join(' ').replace(/\s+/g, ' ').trim();
      const en = clean(name.replace(/[ሀ-፿]+/g, ' ').replace(/^[\s.\/()|-]+|[\s.\/(|-]+$/g, ''), 90);
      if (en.length >= 3) { name = en; mixedAm = am; }
    }
    name = name.split(/\s*;\s*/)[0].replace(/[\s|,;:\/-]+$/, '');
    if (!name || name.length < 2) continue;
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    let nameAm = clean(ethiopic ? t.name : t['name:am'] || mixedAm, 90);
    if (/[ሀ-፿]/.test(nameAm)) nameAm = nameAm.replace(/[A-Za-z][A-Za-z .'&-]*/g, ' ').replace(/\s+/g, ' ').trim();
    const sub = bySub[e.type + e.id] || '', web = String(t.website || t['contact:website'] || '').trim().split(/[;\s]/)[0];
    out.push({ ref: e.type + '/' + e.id, slug: (kebab(name) || 'restaurant') + '-' + e.type[0] + e.id, name, nameAm: nameAm && nameAm !== name ? nameAm : '', kind, sub, subAm: SUB_AM[sub] || '',
      lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), phones: landlines(t.phone || t['contact:phone']), website: /^https?:\/\//i.test(web) ? web : null,
      street: clean(t['addr:street'], 60), cuisine: cuisineOf(t), hours: clean(t.opening_hours, 80), generic: GENERIC_NAME.test(name.trim()),
      rich: Object.keys(t).length, _pk: phoneKey(t) });
  }
  out.sort((a, b) => b.rich - a.rich);
  const kept = [];
  // one place, one listing: the same name, or the same phone number, within 300 m
  for (const p of out) { if (kept.some(k => km(k, p) < 0.3 && (k.name.toLowerCase() === p.name.toLowerCase() || (p._pk && k._pk === p._pk)))) continue; delete p.rich; kept.push(p); }
  kept.forEach(p => { delete p._pk; });
  const order = { restaurant: 0, fast_food: 1, cafe: 2 };
  return kept.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

// The map, parsed once per file change and shared by the pages, Bini's food answers and the MCP (via /api/places/food).
let cache = { file: '', mtime: -1, list: [], bySlug: new Map(), byRef: new Map() };
function places() {
  try {
    const f = OSM(), st = fs.statSync(f);
    if (f !== cache.file || st.mtimeMs !== cache.mtime) {
      const l = buildPlaces(JSON.parse(fs.readFileSync(f, 'utf8')));
      cache = { file: f, mtime: st.mtimeMs, list: l, bySlug: new Map(l.map(p => [p.slug, p])), byRef: new Map(l.map(p => [p.ref, p])) };
    }
  } catch (e) { /* no map on this machine: an empty directory, not an error */ }
  return cache;
}
function readStore() { try { return JSON.parse(fs.readFileSync(STORE(), 'utf8')); } catch (e) { return { entries: [] }; } }
function writeStore(s) { const f = STORE(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.part', JSON.stringify(s, null, 1)); fs.renameSync(f + '.part', f); }
const live = () => readStore().entries.filter(e => e.status === 'live');
// one place as every door sees it: the map plus what the restaurant sent and the team approved (the latest wins)
function placeOut(p, L) {
  const stamp = e => String(e.updatedAt || e.approvedAt || '');
  const mine = (L || live()).filter(e => e.ref === p.ref).sort((a, b) => stamp(b).localeCompare(stamp(a)));
  const top = mine[0] || {};
  return Object.assign({}, p, { phones: [...new Set([top.publicPhone].filter(Boolean).concat(p.phones))], hours: top.hours || p.hours || '',
    hoursFromOwner: !!top.hours, dishes: top.dishes || [], about: top.about || '', confirmed: mine.length > 0,
    tableOrders: !!(top.ordersOn && (top.dishes || []).length) });   // the owner switched on table QR ordering (restaurants/orders.js)
}
// Indexed only with something to say beyond a name on a map: a number, a website, a cuisine, or the owner's word.
const findable = f => !f.generic && (f.confirmed || f.phones.length > 0 || !!f.website || f.cuisine.length > 0);
const pageUrl = ref => { const p = places().byRef.get(ref); return p ? BASE + '/restaurants/' + p.slug : null; };

async function tellTeam(text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN, chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].filter(Boolean);
  if (!tok || !chats.length) return false;
  let ok = false;
  for (const chat of [...new Set(chats)]) {
    try { const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) }); ok = (await r.json()).ok === true || ok; } catch (e) {}
  }
  return ok;
}

// ---- pages ----
const HEAD = (title, desc, canon, extra) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canon)}"><meta name="theme-color" content="#00704A">
<meta property="og:type" content="website"><meta property="og:site_name" content="BinaSmart Restaurants"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="https://bina.et/static/og-image.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon-32.png"><link rel="stylesheet" href="/static/fonts/fonts.css?v=2"><link rel="stylesheet" href="/static/restaurants.css?v=1"><script>document.documentElement.classList.add('js')</script>${extra || ''}</head><body>`;
const TOP = '<header class="top"><div class="w"><a class="brand" href="/restaurants"><i>🍽</i>BinaSmart <small>Restaurants · ምግብ ቤቶች</small></a><nav><a href="/restaurants#all">All places</a><a href="/shop">Offers</a></nav><a class="join" href="/restaurants#own">Own one?</a></div></header>';
const FOOT = '<footer class="foot w">BinaSmart Restaurants · <span class="am">ቢናስማርት ምግብ ቤቶች</span><br>Places from the city map (© OpenStreetMap contributors, ODbL); phone, hours and dishes from the restaurants themselves, checked by our team. We do not deliver food or take payments.<br><a href="/">bina.et</a></footer>'
  + '<script src="/static/bina-assistant.js?v=16" defer></script><script src="/static/restaurants.js?v=1" defer></script></body></html>';
const ld = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
const kindChip = k => { const K = KINDS[k] || KINDS.restaurant; return K[0] + ' ' + K[1] + ' · <span class="am">' + K[2] + '</span>'; };
const card = f => '<a class="fc rv" href="/restaurants/' + esc(f.slug) + '" data-k="' + f.kind + '" data-q="' + esc((f.name + ' ' + f.nameAm + ' ' + f.sub + ' ' + (KINDS[f.kind] || KINDS.restaurant)[1] + ' ' + f.cuisine.join(' ')).toLowerCase()) + '">'
  + '<span class="ki">' + (KINDS[f.kind] || KINDS.restaurant)[0] + '</span><span class="tx"><b>' + esc(f.name) + '</b>' + (f.nameAm ? '<small class="am">' + esc(f.nameAm) + '</small>' : '')
  + '<em>' + kindChip(f.kind) + (f.sub ? ' · ' + esc(f.sub) : '') + '</em>' + (f.cuisine.length ? '<i class="sv">' + esc(f.cuisine.slice(0, 3).join(' · ')) + '</i>' : '')
  + '<span class="bd">' + (f.confirmed ? '<u class="ok">✓ Confirmed</u>' : '') + (f.phones.length ? '<u>☎️ Phone</u>' : '') + (f.dishes.length ? '<u>🍲 Dishes</u>' : '') + '</span></span></a>';

module.exports = function restaurantDirectory(fastify, { limiter, tell }, done) {
  const notify = tell || tellTeam;
  const claimRL = limiter(3600000, 6);

  fastify.get('/api/restaurants/directory', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    const L = live();
    return { source: 'OpenStreetMap contributors (ODbL) + the restaurants themselves', kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v[1]])),
      places: places().list.map(p => placeOut(p, L)).map(f => ({ slug: f.slug, name: f.name, nameAm: f.nameAm, kind: f.kind, sub: f.sub, cuisine: f.cuisine,
        lat: f.lat, lng: f.lng, phone: f.phones[0] || null, confirmed: f.confirmed, dishes: f.dishes.length })) };
  });

  // ---- the hub ----
  fastify.get('/restaurants', async (req, reply) => {
    const L = live(), F = places().list.map(p => placeOut(p, L));
    const counts = Object.fromEntries(Object.keys(KINDS).map(k => [k, F.filter(f => f.kind === k).length]));
    const top = F.filter(findable).sort((a, b) => (b.confirmed - a.confirmed) || (b.phones.length - a.phones.length) || (b.cuisine.length - a.cuisine.length)).slice(0, 60);
    const html = HEAD('Restaurants and cafés in Addis Ababa · ምግብ ቤቶች | BinaSmart', 'Find a restaurant, café or fast-food place in Addis Ababa by area or cuisine: phone, map and a ride there. Restaurants claim their page free.', BASE + '/restaurants',
      ld({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Restaurants and cafés in Addis Ababa', itemListElement: top.slice(0, 30).map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: BASE + '/restaurants/' + f.slug, name: f.name })) }))
      + TOP
      + '<section class="hero"><div class="bl b1"></div><div class="bl b2"></div><div class="w in"><span class="eb up d1">🍽 BinaSmart Restaurants · <span class="am">ምግብ ቤቶች</span></span>'
      + '<h1 class="up d2">Where to eat<br><span class="gr">in Addis.</span></h1><div class="am big up d3">በአዲስ አበባ የት ይመገቡ?</div>'
      + '<p class="sub up d4">Restaurants, cafés and fast food by area and cuisine, with the phone, the map and a ride there.</p>'
      + '<form class="sr up d5" onsubmit="return false"><span>🔎</span><input id="hq" type="search" placeholder="Name, area or food: Bole, pizza, kitfo…" autocomplete="off"></form>'
      + '<div class="stats up d5"><div><b>' + counts.restaurant + '</b>restaurants</div><div><b>' + counts.cafe + '</b>cafés</div><div><b>' + counts.fast_food + '</b>fast food</div></div></div></section>'
      + '<main class="w" id="all"><div class="fl" id="hk"><button class="on" data-k="">All · ሁሉም</button><button data-k="restaurant">🍽️ Restaurants</button><button data-k="cafe">☕ Cafés</button><button data-k="fast_food">🍔 Fast food</button></div>'
      + '<h2 class="h2 rv">Restaurants and cafés<span class="am">ምግብ ቤቶችና ካፌዎች</span></h2><div class="fg" id="fg">' + top.map(card).join('') + '</div>'
      + '<button class="more" id="more" data-n="' + F.length + '">Show all ' + F.length + ' places · ሁሉንም አሳይ</button><div class="none" id="none" hidden>Nothing matches. Try another spelling, an area or a dish.</div>'
      + '<section class="joinb rv" id="own"><div><h2>Own a restaurant or café?<span class="am">ምግብ ቤት ወይም ካፌ አለዎት?</span></h2><p>Find your place above, open its page and press <b>Claim this page</b>. Bini asks for your number, hours and dishes; our team calls to confirm before anything shows. Free, no commission.</p></div>'
      + '<div class="jb"><a class="btn" href="#all" onclick="document.getElementById(\'hq\').focus();return false">🔎 Find my restaurant</a><a class="btn lite" href="/shop?bini=shop">🏷 Post a dish or offer</a></div></section></main>'
      + FOOT;
    reply.header('Cache-Control', 'public, max-age=120');
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ---- one place ----
  fastify.get('/restaurants/:slug', async (req, reply) => {
    const p = places().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).type('text/html; charset=utf-8').send(HEAD('Not found | BinaSmart Restaurants', '', BASE + '/restaurants') + TOP + '<main class="w"><div class="none">This place is not in the directory. <a href="/restaurants">All restaurants and cafés</a></div></main>' + FOOT);
    const L = live(), f = placeOut(p, L), K = KINDS[f.kind] || KINDS.restaurant;
    const map = 'https://www.openstreetmap.org/' + p.ref + '#map=18/' + p.lat + '/' + p.lng;
    const near = places().list.filter(x => x.ref !== p.ref).map(x => Object.assign({ d: km(p, x) }, x)).filter(x => x.d < 1.5).sort((a, b) => a.d - b.d).slice(0, 6);
    const desc = f.name + ' is a ' + K[1].toLowerCase() + ' in ' + (f.sub ? f.sub + ', ' : '') + 'Addis Ababa' + (f.cuisine.length ? ' (' + f.cuisine.slice(0, 3).join(', ') + ')' : '') + '. Phone, map and a ride there on BinaSmart.';
    if (!findable(f)) reply.header('X-Robots-Tag', 'noindex, follow');
    const html = HEAD(f.name + ' · ' + K[1] + (f.sub ? ' in ' + f.sub : '') + ', Addis Ababa | BinaSmart', desc.slice(0, 158), BASE + '/restaurants/' + f.slug,
      ld({ '@context': 'https://schema.org', '@type': K[3], name: f.name, alternateName: f.nameAm || undefined, url: BASE + '/restaurants/' + f.slug, telephone: f.phones[0] || undefined,
        address: { '@type': 'PostalAddress', streetAddress: f.street || undefined, addressLocality: f.sub || 'Addis Ababa', addressRegion: 'Addis Ababa', addressCountry: 'ET' },
        geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng }, servesCuisine: f.cuisine.length ? f.cuisine : undefined, sameAs: f.website ? [f.website] : undefined,
        hasMenu: f.dishes.length ? { '@type': 'Menu', hasMenuSection: { '@type': 'MenuSection', hasMenuItem: f.dishes.map(d => ({ '@type': 'MenuItem', name: d.name,
          offers: d.price ? { '@type': 'Offer', price: String(d.price).replace(/[^\d.]/g, '') || undefined, priceCurrency: 'ETB' } : undefined })) } } : undefined })
        + (findable(f) ? '' : '<meta name="robots" content="noindex, follow">'))
      + TOP + '<section class="cov"><div class="bl b1"></div></section>'
      + '<main class="w"><div class="card rv in"><span class="kb">' + kindChip(f.kind) + '</span><h1>' + esc(f.name) + '</h1>' + (f.nameAm ? '<div class="an am">' + esc(f.nameAm) + '</div>' : '')
      + '<div class="chips">' + (f.sub ? '<span>📍 ' + esc(f.sub) + (f.subAm ? ' · <span class="am">' + esc(f.subAm) + '</span>' : '') + '</span>' : '') + f.cuisine.map(c => '<span>🍴 ' + esc(c) + '</span>').join('')
      + (f.hours ? '<span>🕐 ' + esc(f.hours) + (f.hoursFromOwner ? '' : ' (map)') + '</span>' : '') + (f.confirmed ? '<span class="g">✓ Confirmed by the restaurant</span>' : '') + (f.tableOrders ? '<span class="g">🪑 Order from your table</span>' : '') + '</div>'
      + '<div class="acts">' + (f.phones[0] ? '<a class="btn" href="tel:' + esc(f.phones[0].replace(/[^\d+]/g, '')) + '">📞 Call · ይደውሉ</a>' : '') + '<a class="btn lite" href="' + esc(map) + '" target="_blank" rel="noopener">🗺 Map</a>'
      + '<a class="btn lite" href="/ride?to=' + encodeURIComponent(f.name) + '&lat=' + f.lat + '&lng=' + f.lng + '">🚕 Ride there</a>' + (f.website ? '<a class="btn lite" href="' + esc(f.website) + '" target="_blank" rel="nofollow noopener">🌐 Website</a>' : '') + '</div></div>'
      + (f.about ? '<p class="about rv">' + esc(f.about).replace(/\n+/g, '<br>') + '</p>' : '')
      + '<h2 class="h2 rv">Dishes<span class="am">ምግቦች</span></h2>' + (f.dishes.length ? '<div class="dishes">' + f.dishes.map(d => '<div class="dish rv"><b>' + esc(d.name) + '</b>' + (d.price ? '<span>' + esc(d.price) + '</span>' : '') + '</div>').join('') + '</div><p class="muted">Prices as sent by the restaurant. Call to check before you go.' + (f.tableOrders ? ' At the restaurant, scan the QR card on your table to order; you pay at the table. · በጠረጴዛዎ ያለውን QR ቃኝተው ይዘዙ።' : '') + '</p>'
        : '<p class="muted rv">This ' + esc(K[1].toLowerCase()) + ' has not added its dishes yet.</p>')
      + '<section class="joinb rv"><div><h2>Is this your ' + esc(K[1].toLowerCase()) + '?<span class="am">ይህ የእርስዎ ነው?</span></h2><p>Claim this page free: add the number to call, your hours and your dishes with prices. Bini asks the questions; our team calls to confirm before anything shows. Then, if you like, guests can order from their table with free QR cards. No commission.</p></div>'
      + '<div class="jb"><a class="btn" href="?bini=restaurant" rel="nofollow">🔑 Claim this page · ገጹን ይያዙ</a><a class="btn lite" href="/restaurants/dashboard" rel="nofollow">Already confirmed? Dashboard →</a></div></section>'
      + (near.length ? '<h2 class="h2 rv">Nearby<span class="am">በአቅራቢያ</span></h2><div class="fg">' + near.map(x => card(placeOut(x, L)).replace('</b>', '</b><small>' + (x.d < 1 ? Math.round(x.d * 1000) + ' m' : x.d.toFixed(1) + ' km') + '</small>')).join('') + '</div>' : '')
      + '<p class="src">From the city map (© OpenStreetMap contributors, ODbL)' + (f.confirmed ? '; the number, hours and dishes from the restaurant, checked by BinaSmart' : '') + '. Call before you go. BinaSmart does not deliver food or take payments.</p></main>'
      + FOOT;
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ---- a claim or an update, from Bini ----
  fastify.post('/api/restaurants/claim', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const b = req.body || {}, ip = String(req.headers['x-real-ip'] || req.ip || '');
    const phone = ethPhone(b.phone), name = clean(b.name, 80);
    if (!claimRL('ip:' + ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone' });
    if (!claimRL('ph:' + phone)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const p = b.ref && b.ref !== 'new' ? places().byRef.get(String(b.ref)) : null;
    if (!p && clean(b.restaurant, 90).length < 2) return reply.code(400).send({ ok: false, error: 'restaurant' });
    const dishes = (Array.isArray(b.dishes) ? b.dishes : []).map(d => ({ name: clean(d && d.name, 60), price: clean(d && d.price, 30) })).filter(d => d.name.length > 1).slice(0, 30);
    const e = { id: crypto.randomBytes(5).toString('hex'), token: crypto.randomBytes(16).toString('hex'), status: 'pending', createdAt: new Date().toISOString(),
      ref: p ? p.ref : null, restaurant: p ? p.name : clean(b.restaurant, 90), name, role: ['owner', 'manager', 'staff'].includes(b.role) ? b.role : 'staff', phone,
      publicPhone: ethPhone(b.publicPhone) || null, hours: clean(b.hours, 120) || null, about: clean(b.about, 400) || null, dishes, note: clean(b.note, 500) || null };
    const S = readStore();
    // The same person about the same place within half an hour is one request: the model sometimes calls the tool again
    // on "yes, send it" (claim replay, 1 Oct 2026). The newer details are folded in; the team gets one message.
    const same = S.entries.find(x => x.status === 'pending' && x.phone === e.phone && x.restaurant.toLowerCase() === e.restaurant.toLowerCase() && Date.now() - Date.parse(x.createdAt) < 30 * 60000);
    if (same) {
      for (const k of ['publicPhone', 'hours', 'about']) if (e[k]) same[k] = e[k];
      if (e.dishes.length) same.dishes = e.dishes;
      if (e.note && e.note !== same.note) same.note = ((same.note || '') + ' | ' + e.note).slice(0, 800);
      writeStore(S);
      return { ok: true, duplicate: true, id: same.id, page: p ? BASE + '/restaurants/' + p.slug : null };
    }
    S.entries.push(e); writeStore(S);
    const base = BASE + '/ops/restaurants/' + e.id + '/';
    await notify('🍽 <b>Restaurant page request via Bini</b> (not live)\n' + esc(e.restaurant) + (p ? ' · ' + esc(p.sub || '') + ' (on the map)' : ' (NOT on the map)') + '\n👤 ' + esc(name) + ' — ' + esc(e.role) + '\n📞 ' + esc(phone)
      + (e.publicPhone ? '\n☎️ number to show: ' + esc(e.publicPhone) : '') + (e.hours ? '\n🕐 ' + esc(e.hours) : '') + (dishes.length ? '\n🍲 ' + esc(dishes.map(d => d.name + (d.price ? ' ' + d.price : '')).join(', ')) : '')
      + (e.about ? '\nℹ️ ' + esc(e.about) : '') + (e.note ? '\n📝 ' + esc(e.note) : '')
      + '\n\nCall the restaurant before approving.' + (p ? '\n<a href="' + BASE + '/restaurants/' + p.slug + '">page</a>' : '') + '\n<a href="' + base + 'approve?t=' + e.token + '">✅ approve - goes live</a> · <a href="' + base + 'reject?t=' + e.token + '">❌ reject</a>');
    return { ok: true, id: e.id, page: p ? BASE + '/restaurants/' + p.slug : null };
  });

  fastify.get('/ops/restaurants/:id/:action', async (req, reply) => {
    const S = readStore(), E = S.entries.find(e => e.id === String(req.params.id).slice(0, 20)), act = String(req.params.action);
    reply.header('X-Robots-Tag', 'noindex');
    if (!E || !tokEq(req.query.t, E.token)) return reply.code(404).send('not found');
    const page = msg => reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + msg + '</p>');
    if (E.status !== 'pending') return page('Already ' + esc(E.status) + ': ' + esc(E.restaurant));
    if (act === 'reject') { Object.assign(E, { status: 'rejected', token: null, decidedAt: new Date().toISOString() }); writeStore(S); return page('❌ Rejected: ' + esc(E.restaurant)); }
    if (act !== 'approve') return reply.code(400).send('approve or reject');
    // The dashboard code (restaurants/dashboard.js): read out on the call; signed in at bina.et/restaurants/dashboard, the
    // owner types it once and edits the page themselves from then on. 30 days, works once.
    Object.assign(E, { status: 'live', token: null, approvedAt: new Date().toISOString(), dashCode: H.newCode(), dashCodeExpires: new Date(Date.now() + 30 * 864e5).toISOString(),
      manageToken: crypto.randomBytes(16).toString('hex') });
    writeStore(S);
    const p = E.ref ? places().byRef.get(E.ref) : null, mb = BASE + '/ops/restaurants/' + E.id + '/manage/';
    notify('✅ <b>' + esc(E.restaurant) + '</b> is live.\n🔑 Dashboard code: <b>' + H.fmtCode(E.dashCode) + '</b> (30 days)\nGive it on the call: they sign in at bina.et/restaurants/dashboard and type it.'
      + '\n<a href="' + mb + 'newcode?t=' + E.manageToken + '">new code</a> · <a href="' + mb + 'hide?t=' + E.manageToken + '">hide page</a>').catch(() => {});
    return page('✅ Live: ' + (p ? '<a href="/restaurants/' + esc(p.slug) + '">' + esc(E.restaurant) + '</a>' : esc(E.restaurant) + ' (NOT on the map: add it to the map or tell the developer)')
      + '<br><br>🔑 Dashboard code: <b style="font-size:22px;letter-spacing:.08em">' + H.fmtCode(E.dashCode) + '</b><br>Tell them on the call: sign in at bina.et/restaurants/dashboard and type this code. It works once, for 30 days.');
  });
  done();
};
Object.assign(module.exports, { buildPlaces, places, placeOut, findable, pageUrl, KINDS, readStore, writeStore, tellTeam });
module.exports.list = () => places().list;
module.exports.findableSlugs = () => { const L = live(); return places().list.map(p => placeOut(p, L)).filter(findable).map(f => '/restaurants/' + f.slug); };
