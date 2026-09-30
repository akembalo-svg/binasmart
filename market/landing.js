'use strict';
// SEO landing pages: what people type into a search engine - "apartment for rent in Bole", "Toyota for sale Addis
// Ababa", "electric car price Ethiopia". One real page per area / make / kind, built from the same page files as
// /property and /cars (listing-cards.js writes the first 24 cards; the filters and "Show more" still work), with the
// live listings, price ranges computed from them, a short FAQ, and links to the neighbouring pages.
// Only combinations with at least MIN listings exist: an empty landing page is worse than none.
//   /property/for-sale  /property/for-rent  /property/for-sale/<area>  /property/for-rent/<area>
//   /cars/make/<make>   /cars/type/<electric|hybrid|diesel|new|used|suv|pickup|sedan>
const MIN = 3;
let H = null;   // helpers from server.js (set at register time; urls() for the sitemap uses them too)

const kebab = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const titleCase = s => String(s).replace(/\b\w/g, c => c.toUpperCase()).replace(/\bCmc\b/, 'CMC');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const areaAm = g => g.find(v => /[ሀ-፿]/.test(v)) || '';
function areaGroup(p) {
  const a = H.squash(String(p.location || '').split(',')[0]);
  if (!a || a === 'addisababa') return null;
  return H.AREA_GROUPS.find(x => x.some(v => a === H.squash(v) || a.includes(H.squash(v)))) || null;
}
// A price range from the listings themselves: plain birr totals (a monthly rent for rentals); per-m² and USD are left out.
function stats(list, floor) {
  const ns = list.map(x => { const s = String(x.price || ''); if (!s || /m²|m2|usd|\$|request/i.test(s)) return null;
    const m = s.replace(/,/g, '').match(/\d+(\.\d+)?/); const n = m ? Number(m[0]) : 0; return n >= floor ? n : null; }).filter(Boolean).sort((a, b) => a - b);
  if (ns.length < 3) return null;
  // A price far below the typical one is a daily rate, a deposit or a typo on the company's site ("1,500" for a Bole
  // flat, a RAV4 at 1.4 million): it must not become the "from" price in a title.
  const mid = ns[Math.floor(ns.length / 2)], ok = ns.filter(n => n >= mid / 5);
  if (ok.length < 3) return null;
  const f = n => Math.round(n).toLocaleString('en-US');
  return { min: f(ok[0]), max: f(ok[ok.length - 1]), mid: f(mid) };
}
const CAR_TYPES = {
  electric: { ks: ['fuel', 'bodyType'], re: '\\belectric\\b|^ev$|\\bev\\b', en: 'Electric cars', am: 'ኤሌክትሪክ መኪኖች' },
  hybrid: { ks: ['fuel'], re: 'hybrid', en: 'Hybrid cars', am: 'ሃይብሪድ መኪኖች' },
  diesel: { ks: ['fuel'], re: 'diesel', en: 'Diesel cars', am: 'የናፍጣ መኪኖች' },
  new: { ks: ['condition'], re: '^new$', en: 'New cars', am: 'አዲስ መኪኖች' },
  used: { ks: ['condition'], re: '^used$', en: 'Used cars', am: 'ያገለገሉ መኪኖች' },
  suv: { ks: ['bodyType'], re: '^suv$', en: 'SUVs', am: 'SUV መኪኖች' },
  pickup: { ks: ['bodyType'], re: '^pickup$', en: 'Pickups', am: 'ፒካፕ መኪኖች' },
  sedan: { ks: ['bodyType'], re: '^sedan$', en: 'Sedans', am: 'ሰዳን መኪኖች' },
};
const carHit = (c, t) => new RegExp(t.re, 'i').test(t.ks.map(k => c[k] || '').join(' '));

async function homesIndex() {
  const props = (await H.prisma.propertyListing.findMany({ where: { active: true }, orderBy: [{ verified: 'desc' }, { createdAt: 'desc' }], take: 600 })).map(H.pubProperty);
  const out = { props, sale: new Map(), rent: new Map() };
  for (const p of props) {
    const g = areaGroup(p); if (!g) continue;
    const m = out[p.listingType === 'rent' ? 'rent' : 'sale'], k = kebab(g[0]);
    if (!m.has(k)) m.set(k, { g, list: [] }); m.get(k).list.push(p);
  }
  return out;
}
async function carsIndex() {
  const cars = (await H.prisma.carListing.findMany({ where: { active: true }, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: 1500 }))
    .sort((a, b) => (/china/i.test(a.city || '') ? 1 : 0) - (/china/i.test(b.city || '') ? 1 : 0)).map(H.pubCar);
  const makes = new Map();
  for (const c of cars) if (c.make) { const k = kebab(c.make); if (!makes.has(k)) makes.set(k, { make: c.make, list: [] }); makes.get(k).list.push(c); }
  const types = {}; for (const [k, t] of Object.entries(CAR_TYPES)) types[k] = cars.filter(c => carHit(c, t));
  return { cars, makes, types };
}
// the order cars.html shows: a price and a photo first
const carOrder = list => list.map((c, i) => [c, i]).sort((a, b) => ((b[0].price ? 2 : 0) + (b[0].imageUrl ? 1 : 0)) - ((a[0].price ? 2 : 0) + (a[0].imageUrl ? 1 : 0)) || a[1] - b[1]).map(x => x[0]);

function linksHtml(title, groups) {
  return `<div style="margin-top:18px"><b style="font-size:15px">${title}</b><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">`
    + groups.map(l => `<a href="${esc(l.href)}" style="border:1px solid var(--line);background:#fff;border-radius:999px;padding:7px 13px;font-size:13.5px;font-weight:600;color:var(--ink)">${esc(l.text)} <span style="color:var(--mut)">${l.n}</span></a>`).join('') + '</div></div>';
}
function faqHtml(faq) {
  return faq.map(q => `<details style="border-top:1px solid var(--line);padding:12px 0"><summary style="font-weight:800;cursor:pointer">${esc(q.q)}</summary><p style="margin-top:8px;color:var(--mut)">${esc(q.a)}</p></details>`).join('');
}
// The page file, with this landing page's title, heading, intro, FAQ, links and the filter it opens with.
function render(o) {
  let html = H.withCards(o.file, o.gridOpen, o.list.slice(0, 24).map(o.card).join(''), H.itemList(o.h1, o.base, o.list));
  const url = 'https://bina.et' + o.path;
  // One FAQPage per page: the guide's own (cars.html has one) gives way to this page's questions.
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, b => /"FAQPage"/.test(b) ? '' : b);
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(o.title) + '</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(o.desc) + '">')
    .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(o.title) + '">')
    .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(o.desc) + '">')
    .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + url + '">')
    .replace(/<h1([^>]*)>[\s\S]*?<\/h1>(\s*)<p([^>]*)>[\s\S]*?<\/p>/, (m, a, sp, pa) => `<h1${a}>${esc(o.h1)}</h1>${sp}<p class="am" style="font-weight:700">${esc(o.h1am)}</p><p${pa.replace(/class="am"/, '')}>${esc(o.intro)}</p>`);
  const ld = [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: o.faq.map(q => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: o.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: 'https://bina.et' + c[1] })) }];
  html = html.replace('</head>', ld.map(H.ldScript).join('') + '<script>window.__PRESET=' + JSON.stringify(o.preset).replace(/</g, '\\u003c') + '</script></head>');
  const band = `<section class="wrap"><div class="band"><h2>${esc(o.faqTitle)}</h2>${faqHtml(o.faq)}${o.links.map(l => linksHtml(l[0], l[1])).join('')}</div></section>\n`;
  return html.replace('<section class="wrap" id="request">', band + '<section class="wrap" id="request">');
}

async function homes(req, reply, lt, areaSlug) {
  const ix = await homesIndex(), rent = lt === 'rent', m = ix[lt];
  let list = ix.props.filter(p => (p.listingType === 'rent') === rent), g = null;
  if (areaSlug) { const e = m.get(areaSlug); if (!e || e.list.length < MIN) return reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">No page here. <a href="/property">All homes</a></p>'); list = e.list; g = e.g; }
  const place = g ? titleCase(g[0]) : 'Addis Ababa', am = g ? areaAm(g) : 'አዲስ አበባ', what = rent ? 'for rent' : 'for sale';
  const st = stats(list, rent ? 1000 : 100000), cos = new Set(list.map(p => p.agency).filter(Boolean)).size;
  const h1 = 'Homes ' + what + ' in ' + place + (g ? ', Addis Ababa' : '');
  const intro = list.length + ' homes ' + what + ' in ' + place + ' from ' + cos + (cos === 1 ? ' company' : ' companies')
    + (st ? '. ' + (rent ? 'Monthly rent' : 'Prices') + ' from ' + st.min + ' to ' + st.max + ' birr (typical: ' + st.mid + ' birr' + (rent ? ' a month' : '') + ')' : '')
    + '. Every listing has photos and the company\'s own phone, refreshed every week from the companies\' own websites. BinaSmart is not an agent and takes no fee.';
  const faq = [
    st ? { q: 'How much ' + (rent ? 'is rent' : 'does a home cost') + ' in ' + place + '?', a: 'On BinaSmart today, ' + list.length + ' homes ' + what + ' in ' + place + ' are listed from ' + st.min + ' to ' + st.max + ' birr' + (rent ? ' a month' : '') + ', typically about ' + st.mid + ' birr. Prices are as each company writes them; some are per square metre or in US dollars.' } : null,
    { q: 'Who do I call about a home?', a: 'Each listing shows the listing company\'s own phone and WhatsApp. You contact the company directly; BinaSmart is not the agent and takes no fee. Never pay before you see the home and its documents.' },
    { q: 'How current are these listings?', a: 'BinaSmart reads the companies\' own websites every week. Each home shows the date the company last updated it; one older than a year is marked "ask if still available".' },
  ].filter(Boolean);
  const other = [...m.entries()].filter(([k, e]) => e.list.length >= MIN && k !== areaSlug).sort((a, b) => b[1].list.length - a[1].list.length)
    .map(([k, e]) => ({ href: '/property/for-' + lt + '/' + k, text: titleCase(e.g[0]), n: e.list.length }));
  const path = '/property/for-' + lt + (areaSlug ? '/' + areaSlug : '');
  return reply.type('text/html; charset=utf-8').send(render({ file: 'property.html', gridOpen: '<div class="grid" id="props">', card: H.listingCards.propertyCard, base: '/property', path, list,
    title: h1 + ' (' + list.length + ')' + (st ? ' · from ' + st.min + ' birr' : '') + ' | BinaSmart', desc: intro.slice(0, 158), h1,
    h1am: (g ? 'በ' + am + ' ' : 'በአዲስ አበባ ') + (rent ? 'የሚከራዩ' : 'የሚሸጡ') + ' ቤቶች', intro, faq, faqTitle: 'Homes ' + what + ' in ' + place + ': questions',
    links: [['Homes ' + what + ' by area · በሰፈር', other], ['Also', [{ href: '/property/for-' + (rent ? 'sale' : 'rent') + (areaSlug && ix[rent ? 'sale' : 'rent'].has(areaSlug) && ix[rent ? 'sale' : 'rent'].get(areaSlug).list.length >= MIN ? '/' + areaSlug : ''), text: 'Homes ' + (rent ? 'for sale' : 'for rent') + ' in ' + place, n: '' }, { href: '/real-estate-companies', text: 'Real estate companies in Addis Ababa', n: '' }]]],
    preset: { type: lt, terms: g ? g.map(H.squash) : null, place: g ? place : null },
    crumbs: [['Property', '/property'], ['Homes ' + what, '/property/for-' + lt]].concat(g ? [[place, path]] : []) }));
}
async function cars(req, reply, kind, key) {
  const ix = await carsIndex();
  let list, label, am, path, preset;
  if (kind === 'make') {
    const e = ix.makes.get(key); if (!e || e.list.length < MIN) return reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">No page here. <a href="/cars">All cars</a></p>');
    list = e.list; label = e.make + ' cars'; am = 'የሚሸጡ ' + e.make + ' መኪኖች'; path = '/cars/make/' + key; preset = { ks: ['make'], re: '^' + e.make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', place: e.make };
  } else {
    const t = CAR_TYPES[key]; if (!t || (ix.types[key] || []).length < MIN) return reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">No page here. <a href="/cars">All cars</a></p>');
    list = ix.types[key]; label = t.en; am = 'የሚሸጡ ' + t.am; path = '/cars/type/' + key; preset = { ks: t.ks, re: t.re, place: t.en };
  }
  list = carOrder(list);
  // Jedda Star's electric cars are in China (ops/places/jedda-import.js): after the Addis cars, and never counted as "in Addis".
  const cn = list.filter(c => /china/i.test(c.city || '')), here = list.filter(c => !/china/i.test(c.city || ''));
  list = here.concat(cn);
  const lab = label.toLowerCase().replace(/^suvs$/, 'SUVs'), cnNote = cn.length ? cn.length + ' ' + (kind === 'make' ? label + (cn.length === 1 ? '' : '') + ' (electric)' : lab) + ' in China from Jedda Star, priced in US dollars before shipping, customs duty and taxes' : '';
  const st = stats(here, 100000), dealers = new Set(here.map(c => c.dealer).filter(Boolean)).size, h1 = here.length ? label + ' for sale in Addis Ababa' : label + ' from China (to order)';
  const intro = (here.length ? here.length + ' ' + lab + ' for sale in Addis Ababa from ' + dealers + (dealers === 1 ? ' dealer' : ' dealers')
    + (st ? '. Prices from ' + st.min + ' to ' + st.max + ' birr (typical: ' + st.mid + ' birr)' : '') + (cnNote ? '. Plus ' + cnNote : '') : cnNote + '. Ethiopia allows only electric cars to be imported; ask for the full price in birr before you pay')
    + '. Every car has photos and the dealer\'s own phone, refreshed every week from the dealers\' own websites. BinaSmart is not the seller.';
  const faq = [
    st ? { q: 'How much do ' + label.toLowerCase().replace(/^suvs$/, 'SUVs') + ' cost in Addis Ababa?', a: 'On BinaSmart today, ' + here.length + ' are listed in Addis Ababa from ' + st.min + ' to ' + st.max + ' birr, typically about ' + st.mid + ' birr, as each dealer writes it. Many new cars are "price on request": call the dealer.' } : null,
    { q: 'Who do I call about a car?', a: 'Each car shows the dealer\'s own phone and WhatsApp. You buy from the dealer; BinaSmart is not the seller. Check the libre and the car before you pay.' },
    { q: 'How current are these cars?', a: 'BinaSmart reads the dealers\' own websites every week; each car shows when the dealer last updated it.' },
  ].filter(Boolean);
  const makes = [...ix.makes.entries()].filter(([k, e]) => e.list.length >= MIN && !(kind === 'make' && k === key)).sort((a, b) => b[1].list.length - a[1].list.length).map(([k, e]) => ({ href: '/cars/make/' + k, text: e.make, n: e.list.length }));
  const types = Object.entries(CAR_TYPES).filter(([k]) => (ix.types[k] || []).length >= MIN && !(kind === 'type' && k === key)).map(([k, t]) => ({ href: '/cars/type/' + k, text: t.en, n: ix.types[k].length }));
  return reply.type('text/html; charset=utf-8').send(render({ file: 'cars.html', gridOpen: '<div class="grid" id="cars">', card: H.listingCards.carCard, base: '/cars', path, list,
    title: h1 + ' (' + (here.length || cn.length) + (here.length && cn.length ? ' + ' + cn.length + ' in China' : '') + ')' + (st ? ' · from ' + st.min + ' birr' : '') + ' | BinaSmart', desc: intro.slice(0, 158), h1, h1am: am + ' በአዲስ አበባ', intro, faq,
    faqTitle: label + ' in Addis Ababa: questions', links: [['By make · በዓይነት', makes], ['By kind', types], ['Also', [{ href: '/car-dealers', text: 'Car dealers in Addis Ababa', n: '' }]]],
    preset, crumbs: [['Cars', '/cars'], [h1, path]] }));
}

// Every landing page that exists right now (the sitemap and the link rows on /property and /cars use this).
async function urls() {
  if (!H) return [];
  const [hi, ci] = await Promise.all([homesIndex(), carsIndex()]);
  const out = [];
  for (const lt of ['sale', 'rent']) {
    if (hi.props.filter(p => (p.listingType === 'rent') === (lt === 'rent')).length >= MIN) out.push({ path: '/property/for-' + lt, text: 'Homes for ' + lt, n: '' });
    for (const [k, e] of hi[lt]) if (e.list.length >= MIN) out.push({ path: '/property/for-' + lt + '/' + k, text: 'Homes for ' + lt + ' in ' + titleCase(e.g[0]), n: e.list.length, lt });
  }
  for (const [k, e] of ci.makes) if (e.list.length >= MIN) out.push({ path: '/cars/make/' + k, text: e.make, n: e.list.length, car: true });
  for (const [k, t] of Object.entries(CAR_TYPES)) if ((ci.types[k] || []).length >= MIN) out.push({ path: '/cars/type/' + k, text: t.en, n: ci.types[k].length, car: true });
  return out;
}

module.exports = function landing(fastify, helpers, done) {
  H = helpers;
  fastify.get('/property/for-sale', (req, reply) => homes(req, reply, 'sale', null));
  fastify.get('/property/for-rent', (req, reply) => homes(req, reply, 'rent', null));
  fastify.get('/property/for-sale/:area', (req, reply) => homes(req, reply, 'sale', kebab(req.params.area)));
  fastify.get('/property/for-rent/:area', (req, reply) => homes(req, reply, 'rent', kebab(req.params.area)));
  fastify.get('/cars/make/:make', (req, reply) => cars(req, reply, 'make', kebab(req.params.make)));
  fastify.get('/cars/type/:t', (req, reply) => cars(req, reply, 'type', kebab(req.params.t)));
  done();
};
module.exports.urls = urls;
module.exports.linksHtml = linksHtml;
