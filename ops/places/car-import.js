// Brings cars from car dealers' OWN websites into bina.et/cars, the same way property-import.js fills /property:
// facts, the dealer's own photos (credited, "Photo: <dealer>"), description, and the DEALER's own phone/WhatsApp.
// Cars not updated on the dealer's site for 12 months are left out; cars gone from the site are switched off.
// A dealer who objects to its photos goes in /root/storage/directory/car-nophoto.json.
//   node --env-file=.env ops/places/car-import.js [--dry] [--only=<company-slug>]
const fs = require('fs');
const path = require('path');
const H = require('./property-import');
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
// All cars, old ones too (Ibrahim, 28 Sep): the card shows the date, older than a year says "ask if still available".
const MAX_AGE_DAYS = 3650;
const IMG_DIR = path.join(H.ROOT, 'public', 'cars', 'img');
const OUR_IMG = 'https://bina.et/static/cars/img/';
const IMG_CACHE = '/root/storage/directory/car-images.json';
const NOPHOTO_FILE = '/root/storage/directory/car-nophoto.json';
// company slug in addis-companies.json -> how its site lists cars
const SOURCES = {
  'ahad-car-market': { kind: 'vehica', type: 'vehica_car', currency: 'Birr' }, // used-car market (Vehica theme)
  'moenco': { kind: 'woo' },                                                     // Toyota/Suzuki dealer (WooCommerce)
  'proxima-auto': { kind: 'wp', type: 'cars' },                                  // EV importer
  // No data feed: their car pages are read one by one (sitemap or the showroom page -> pages matching `match`).
  'markon-car-importer': { kind: 'pages', sitemap: '/sitemap.xml', match: /\/cars\/[a-z0-9-]+$/ },
  'yami-car-importer': { kind: 'pages', sitemap: '/sitemap-index.xml', match: /\/vehicles\/[a-z0-9-]+$/ },
  'ries-engineering-ford-ethiopia': { kind: 'pages', list: '/showroom', match: /^\/ford-(?!offers|protect)[a-z0-9-]+$/ },
};
const BODY = [[/pick-?up|double cab|single cab|\b[dsr]cab\b|ranger|hilux/i, 'Pickup'], [/suv|crossover|4x4|everest|fortuner|prado|land ?cruiser|rav ?4|tucson|sportage|x-?trail/i, 'SUV'], [/sedan|saloon/i, 'Sedan'],
  [/hatch/i, 'Hatchback'], [/van|bus|minibus|hiace/i, 'Van / Bus'], [/truck|lorry/i, 'Truck'], [/coupe|sport/i, 'Coupe']];
// Make: a brand in the category or title, else the model name tells it (MOENCO files "Corolla Cross" under "SUV").
const BRANDS = /^(toyota|suzuki|hyundai|kia|nissan|byd|honda|volkswagen|vw|mitsubishi|isuzu|ford|mercedes(-benz)?|bmw|chery|geely|changan|jac|great wall|haval|mg|tesla|peugeot|renault|audi|lexus|mazda|subaru|dongfeng|jetour|zeekr|xpeng|lifan|foton|sinotruk|faw|land rover|range rover|jeep|volvo|porsche|neta|hongqi|wuling|leapmotor|aion|gac|exeed|ora|jmc|jetta|smart)$/i;
const MODEL_MAKE = [[/corolla|hilux|land ?cruiser|prado|rav ?4|yaris|vitz|fortuner|rush|hiace|coaster|\bbz\d|camry|avanza|raize|veloz|urban cruiser/i, 'Toyota'],
  [/vitara|swift|dzire|celerio|alto|s-?presso|ertiga|jimny|ciaz|baleno|fronx|xl7|eeco|\bcarry\b/i, 'Suzuki']];
function makeOf(cats, title) {
  const c = cats.find(x => BRANDS.test(x.trim())); if (c) return c.trim();
  const w = (title.match(/^\s*(land rover|range rover|great wall|mercedes-benz|[a-z]+)/i) || [])[1]; if (w && BRANDS.test(w)) return w.charAt(0).toUpperCase() + w.slice(1);
  const h = MODEL_MAKE.find(([re]) => re.test(title)); return h ? h[1] : null;
}
const num = v => { const m = String(v == null ? '' : v).replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

// ---- one adapter per kind of dealer website; each returns plain car objects ----
async function vehica(base, cfg) {
  const types = (await H.getJson(base + '/wp-json/wp/v2/types')).body;
  const rb = (types[cfg.type] && types[cfg.type].rest_base) || cfg.type;
  const taxes = (await H.getJson(base + '/wp-json/wp/v2/taxonomies?type=' + cfg.type)).body;
  const label = {}, terms = {};
  for (const [slug, t] of Object.entries(taxes)) {
    const f = t.rest_base || slug; label[f] = t.name;
    try { terms[f] = Object.fromEntries((await H.allPages(base + '/wp-json/wp/v2/' + f)).map(x => [x.id, H.decode(x.name)])); } catch (e) { terms[f] = {}; }
  }
  const by = (it, name) => Object.keys(label).filter(f => label[f].toLowerCase() === name).flatMap(f => (it[f] || []).map(id => terms[f][id]).filter(Boolean));
  const items = await H.allPages(base + '/wp-json/wp/v2/' + rb + '?orderby=modified&order=desc');
  return items.map(it => {
    const own = Object.entries(it).filter(([k]) => /^vehica_\d+$/.test(k) && !(k in label));
    let price = null, year = null, gallery = [];
    const specs = {};
    for (const [k, v] of own) {
      if (v && typeof v === 'object' && !Array.isArray(v)) { const c = Object.entries(v).find(([kk]) => /^vehica_currency/.test(kk)); if (c && +c[1] > 0) price = +c[1]; continue; }
      const sv = Array.isArray(v) ? v.join(',') : String(v == null ? '' : v).trim();
      if (!sv) continue;
      if (/^\d+(,\d+)+$/.test(sv) && sv.split(',').length >= 2) { gallery = sv.split(',').map(Number); continue; }
      if (/^(19|20)\d\d$/.test(sv)) { year = sv; continue; }
      if (/kwh/i.test(sv)) specs['Battery'] = sv;
      else if (/\bkm\b/i.test(sv) && k !== 'vehica_6664') specs['Range'] = sv;
    }
    const mileage = num(it.vehica_6664);
    return {
      id: it.id, title: H.decode(it.title && it.title.rendered), link: it.link, modified: it.modified_gmt,
      make: by(it, 'make')[0] || null, model: by(it, 'model')[0] || null, year, bodyType: by(it, 'type')[0] || null,
      condition: by(it, 'condition')[0] || null, fuel: by(it, 'fuel type')[0] || null, transmission: by(it, 'transmission')[0] || null,
      mileage: mileage != null ? mileage.toLocaleString('en-US') + ' km' : null,
      price: price ? price.toLocaleString('en-US') + ' ' + (cfg.currency || 'Birr') : null,
      features: by(it, 'features').concat(by(it, 'safety features')).slice(0, 40),
      specs: Object.assign(specs, { 'Drive': by(it, 'drive type')[0], 'Colour': by(it, 'color')[0], 'Doors': by(it, 'doors')[0], 'Cylinders': by(it, 'cylinders')[0] }),
      description: H.paragraphs(it.content && it.content.rendered), featuredId: +it.featured_media || 0, galleryIds: gallery,
    };
  });
}
async function woo(base) {
  const out = [];
  for (let p = 1; p <= 10; p++) {
    const { body, pages } = await H.getJson(base + '/wp-json/wc/store/v1/products?per_page=100&page=' + p);
    for (const x of body) {
      const pr = x.prices || {}, n = Number(pr.price || 0) / Math.pow(10, pr.currency_minor_unit || 0);
      const title = H.decode(x.name), cats = (x.categories || []).map(c => H.decode(c.name));
      const make = makeOf(cats, title), body = cats.map(c => (BODY.find(([re]) => re.test(c)) || [])[1]).find(Boolean) || null;
      const specs = {}; for (const a of x.attributes || []) specs[H.decode(a.name)] = (a.terms || []).map(t => H.decode(t.name)).join(', ');
      out.push({ id: x.id, title, link: x.permalink, modified: null, make,
        model: make ? title.replace(new RegExp('^\\s*' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim() || null : null,
        year: null, bodyType: body, condition: null, fuel: /hybrid/i.test(title) ? 'Hybrid' : /\bev\b|electric/i.test(title) ? 'Electric' : null,
        transmission: null, mileage: null, price: n > 0 ? n.toLocaleString('en-US') + ' ' + (pr.currency_code || 'ETB') : null,
        features: [], specs, description: H.paragraphs(x.description || x.short_description), photos: (x.images || []).map(i => i.src).filter(Boolean).slice(0, 12) });
    }
    if (p >= (pages || 1)) break;
  }
  return out;
}
async function wp(base, cfg) {
  const types = (await H.getJson(base + '/wp-json/wp/v2/types')).body;
  const rb = (types[cfg.type] && types[cfg.type].rest_base) || cfg.type;
  let makes = {}; try { makes = Object.fromEntries((await H.allPages(base + '/wp-json/wp/v2/tax_makes')).map(x => [x.id, H.decode(x.name)])); } catch (e) {}
  const items = await H.allPages(base + '/wp-json/wp/v2/' + rb + '?orderby=modified&order=desc');
  return items.map(it => {
    const text = H.paragraphs(it.content && it.content.rendered);
    const pm = text.match(/(?:price|ዋጋ)[^0-9\n]{0,20}([\d,]{5,})\s*(ETB|Birr|ብር|USD)?/i);
    const title = H.decode(it.title && it.title.rendered);
    return { id: it.id, title, link: it.link, modified: it.modified_gmt, make: (it.tax_makes || []).map(id => makes[id]).filter(Boolean)[0] || title.split(' ')[0],
      model: null, year: null, bodyType: null, condition: null, fuel: /\bev\b|electric|seagull|id-?4|bz4x|model-?y|e-star|eado ev/i.test(title) ? 'Electric' : null,
      transmission: null, mileage: null, price: pm ? pm[1] + ' ' + (pm[2] || 'Birr') : null, features: [], specs: {}, description: text.slice(0, 3000),
      featuredId: +it.featured_media || 0, galleryIds: [], og: it.yoast_head_json && it.yoast_head_json.og_image && it.yoast_head_json.og_image[0] && it.yoast_head_json.og_image[0].url };
  });
}
// ---- dealers without a data feed: read each car page like a person would ----
const crypto = require('crypto');
async function getText(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': H.UA['User-Agent'] }, signal: AbortSignal.timeout(25000) }); return r.ok ? await r.text() : null; } catch (e) { return null; }
}
async function sitemapLocs(url, depth) {
  const x = await getText(url); if (!x) return [];
  let out = [];
  for (const m of x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) out = /\.xml(\?|$)/i.test(m[1]) && depth < 2 ? out.concat(await sitemapLocs(m[1], depth + 1)) : out.concat([m[1]]);
  return out;
}
function readCarPage(url, html) {
  const og = p => { const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + p + '["\'][^>]+content=["\']([^"\']+)', 'i')) || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + p, 'i')); return m ? H.decode(m[1]) : ''; };
  // A pop-up's heading ("Disclosure" on Ford's pages) is not the car: take the first real title.
  const NOT = /^(disclosure|menu|search|cookies?( policy)?|privacy|home|welcome|close|loading)$/i;
  let title = [H.decode((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]), og('title'), H.decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1])]
    .find(t => t && !NOT.test(t.trim())) || '';
  title = title.split(/\s[|–—-]\s(?=[^|–—-]*$)/)[0].trim().slice(0, 140);
  if (!title) return null;
  const body = html.replace(/<(script|style|noscript|svg|header|nav|footer|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const text = H.paragraphs((body.match(/<(article|main)\b[\s\S]*?<\/\1>/i) || [body])[0]).slice(0, 4000), flat = (title + ' ' + text).replace(/\n/g, ' ');
  const imgs = [], seen = new Set();
  const add = u => { if (!u) return; let a; try { a = new URL(u.replace(/&amp;/g, '&'), url).href; } catch (e) { return; }
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(a) && !/\/_next\/image\?url=/.test(a)) return;
    if (/logo|icon|favicon|avatar|placeholder|flag|whatsapp|telegram|facebook|payment|banner-?bg/i.test(a) || /-(1[0-9]{2}|[0-9]{2})x\d{2,3}\./.test(a)) return;
    const k = a.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, ''); if (seen.has(k)) return; seen.add(k); imgs.push(a); };
  add(og('image'));
  for (const m of body.matchAll(/<img\b[^>]+?(?:data-lazy-src|data-src|src)=["']([^"']+)["']/gi)) add(m[1]);
  const make = makeOf([], title);
  const price = (flat.match(/(?:ETB|Birr|ብር|USD|\$)\s?\d[\d,]{3,}|\d[\d,]{3,}\s?(?:ETB|Birr|ብር|USD)\b/i) || [])[0] || null;
  const specs = {};
  const rng = flat.match(/(\d{3})\s?km\b[^.]{0,12}(range|cltc|nedc|wltp)|(range|cltc|nedc|wltp)[^.\d]{0,20}(\d{3})\s?km/i); if (rng) specs['Range'] = (rng[1] || rng[4]) + ' km';
  const bat = flat.match(/(\d{2,3}(?:\.\d)?)\s?kwh/i); if (bat) specs['Battery'] = bat[1] + ' kWh';
  const seats = flat.match(/(\d)\s?-?\s?seat(?:s|er)?\b/i); if (seats) specs['Seats'] = seats[1];
  return { title, make, model: make ? title.replace(new RegExp('^\\s*' + make + '\\s*', 'i'), '').trim() || null : null,
    year: (title.match(/\b(20[12]\d)\b/) || [])[1] || null, bodyType: (BODY.find(([re]) => re.test(title)) || [])[1] || null,
    condition: /\bused\b|second-?hand|ያገለገለ/i.test(title) ? 'Used' : null,
    fuel: /\bev\b|electric|kwh|battery electric/i.test(flat) ? 'Electric' : /hybrid|phev|dm-i/i.test(flat) ? 'Hybrid' : /diesel/i.test(flat) ? 'Diesel' : /petrol|gasoline|benzine/i.test(flat) ? 'Petrol' : null,
    transmission: /automatic|\bat\b/i.test(flat) ? 'Automatic' : /manual/i.test(flat) ? 'Manual' : null, mileage: null, price, features: [], specs,
    description: text, imgs: imgs.slice(0, 12) };
}
async function pages(base, cfg) {
  const host = new URL(base).host.replace(/^www\./, '');
  let urls = cfg.sitemap ? await sitemapLocs(base + cfg.sitemap, 0) : [];
  if (cfg.list) { const h = await getText(base + cfg.list); if (h) for (const m of h.matchAll(/href=["']([^"'#]+)["']/g)) { try { urls.push(new URL(m[1], base + '/').href); } catch (e) {} } }
  urls = [...new Set(urls.map(u => u.replace(/\/+$/, '')))].filter(u => { try { const x = new URL(u); return x.host.replace(/^www\./, '') === host && cfg.match.test(x.pathname.replace(/\/+$/, '')); } catch (e) { return false; } }).slice(0, 60);
  const out = [], titles = new Set();
  for (const u of urls) {
    const html = await getText(u); if (!html) continue;
    const r = readCarPage(u, html); if (!r || !r.imgs.length || titles.has(r.title.toLowerCase())) continue;
    titles.add(r.title.toLowerCase());   // two pages of one model (Ford's /ford-ranger and /ford-ranger-dcab)
    out.push(Object.assign(r, { id: crypto.createHash('sha1').update(u).digest('hex').slice(0, 8), link: u, modified: null, photos: r.imgs, _html: html }));
  }
  return out;
}
async function mediaUrls(base, ids) {
  if (!ids.length) return [];
  try {
    const media = (await H.getJson(base + '/wp-json/wp/v2/media?include=' + ids.slice(0, 15).join(',') + '&per_page=50&_fields=id,source_url,media_details')).body;
    const byId = Object.fromEntries(media.map(x => [x.id, x]));
    return ids.map(id => byId[id]).filter(Boolean).map(x => { const z = (x.media_details && x.media_details.sizes) || {}; return (z.large || z.medium_large || z.full || {}).source_url || x.source_url; });
  } catch (e) { return []; }
}

async function importDealer(co, cfg, prisma) {
  const base = co.website.replace(/\/+$/, '');
  if (await H.robotsBlocks(base)) return { skipped: 'robots.txt' };
  const cars = cfg.kind === 'vehica' ? await vehica(base, cfg) : cfg.kind === 'woo' ? await woo(base) : cfg.kind === 'pages' ? await pages(base, cfg) : await wp(base, cfg);
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const fresh = cars.filter(c => !c.modified || Date.parse(c.modified + 'Z') >= cutoff).filter(c => !/\bsold\b/i.test(c.title + ' ' + (c.condition || '')));
  const rows = fresh.map(c => ({
    slug: (co.slug + '-' + c.id).slice(0, 80), title: c.title.slice(0, 140) || 'Car', make: c.make, model: c.model, year: c.year, price: c.price,
    mileage: c.mileage, fuel: c.fuel, transmission: c.transmission, condition: c.condition,
    bodyType: c.bodyType || (BODY.find(([re]) => re.test(c.title)) || [])[1] || null, city: 'Addis Ababa',
    imageUrl: null, dealer: co.name, dealerPhone: (co.phones || [])[0] || null, dealerWhatsapp: null, dealerTelegram: null,
    featured: false, active: true, sourceUrl: c.link, companySlug: co.slug, checkedAt: new Date(), _c: c,
  }));
  if (DRY) return { total: cars.length, kept: rows.length, rows };
  await H.saveLogo(co, base);
  const noPhoto = (() => { try { return JSON.parse(fs.readFileSync(NOPHOTO_FILE, 'utf8')).includes(co.slug); } catch (e) { return false; } })();
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')); } catch (e) {}
  const home = await H.pageContacts(base + '/');
  for (const r of rows) {
    const c = r._c;
    // photos: the card photo + the gallery for /cars/<slug>
    // The car's own page is read once: its photos (Vehica lists every gallery photo as an og:image tag, over several
    // lines) and the dealer's contact buttons.
    let html = c._html || null;
    if (!html) try { const res = await fetch(r.sourceUrl, { headers: { 'User-Agent': H.UA['User-Agent'] }, signal: AbortSignal.timeout(25000) }); if (res.ok) html = await res.text(); } catch (e) {}
    let srcs = c.photos || [];
    if (!srcs.length) { srcs = await mediaUrls(base, [c.featuredId].filter(Boolean).concat(c.galleryIds || [])); if (!srcs.length && c.og) srcs = [c.og]; }
    if (!srcs.length && html) srcs = [...html.matchAll(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/gi)].map(m => m[1]).filter(u => /\.(jpe?g|png|webp)(\?|$)/i.test(u));
    srcs = [...new Set(srcs)].slice(0, 12);
    const photos = [];
    if (!noPhoto) {
      for (let i = 0; i < srcs.length; i++) {
        const key = r.slug + '#g' + i, file = path.join(IMG_DIR, r.slug + '-g' + i + '.webp');
        if (!(cache[key] === srcs[i] && fs.existsSync(file))) { if (await H.saveImage(srcs[i], file, 'gallery')) cache[key] = srcs[i]; else continue; }
        photos.push(OUR_IMG + r.slug + '-g' + i + '.webp?v=' + Math.floor(fs.statSync(file).mtimeMs / 1000));
      }
      const card = path.join(IMG_DIR, r.slug + '.webp');
      if (srcs[0] && !(cache[r.slug] === srcs[0] && fs.existsSync(card))) { if (await H.saveImage(srcs[0], card, 'photo')) cache[r.slug] = srcs[0]; }
      if (fs.existsSync(card)) r.imageUrl = OUR_IMG + r.slug + '.webp?v=' + Math.floor(fs.statSync(card).mtimeMs / 1000);
    } else {
      for (let i = 0; i < 20; i++) { try { fs.unlinkSync(path.join(IMG_DIR, r.slug + '-g' + i + '.webp')); } catch (e) {} delete cache[r.slug + '#g' + i]; }
      try { fs.unlinkSync(path.join(IMG_DIR, r.slug + '.webp')); } catch (e) {} delete cache[r.slug];
    }
    for (let i = photos.length; i < 20; i++) { try { fs.unlinkSync(path.join(IMG_DIR, r.slug + '-g' + i + '.webp')); delete cache[r.slug + '#g' + i]; } catch (e) {} }
    // the dealer's own contacts from the car's page, else its home page, else its office landline
    const pc = html ? H.contactsIn(html) : await H.pageContacts(r.sourceUrl);
    r.dealerPhone = pc.phone || home.phone || r.dealerPhone || null;
    r.dealerWhatsapp = pc.whatsapp || home.whatsapp || null;
    r.dealerTelegram = await H.telegramChat(pc.telegram || home.telegram);
    const specs = Object.fromEntries(Object.entries(c.specs || {}).filter(([k, v]) => v && String(v).trim()));
    r.details = { description: c.description || null, photos, features: c.features || [], specs, updated: c.modified ? String(c.modified).slice(0, 10) : null };
  }
  fs.writeFileSync(IMG_CACHE, JSON.stringify(cache));
  const most = k => { const n = {}; for (const r of rows) if (r[k]) n[r[k]] = (n[r[k]] || 0) + 1; return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null; };
  const usual = { dealerPhone: most('dealerPhone'), dealerWhatsapp: most('dealerWhatsapp'), dealerTelegram: most('dealerTelegram') };
  for (const r of rows) if (!r.dealerPhone && !r.dealerWhatsapp) Object.assign(r, usual);
  const had = Object.fromEntries((await prisma.carListing.findMany({ where: { companySlug: co.slug }, select: { slug: true, imageUrl: true } })).map(x => [x.slug, x.imageUrl]));
  for (const r of rows) {
    const { _c, slug, ...data } = r;
    const own = had[slug] && !had[slug].startsWith(OUR_IMG);   // a photo the dealer added itself is never replaced
    const { imageUrl, ...rest } = data;
    await prisma.carListing.upsert({ where: { slug }, update: own ? rest : data, create: { slug, ...data } });
  }
  const off = (await prisma.carListing.updateMany({ where: { companySlug: co.slug, sourceUrl: { not: null }, active: true, slug: { notIn: rows.map(r => r.slug) } },
    data: { active: false } })).count;
  return { total: cars.length, kept: rows.length, off };
}

(async () => {
  const dir = JSON.parse(fs.readFileSync('/root/storage/directory/addis-companies.json', 'utf8')).companies;
  const prisma = DRY ? null : new (require('@prisma/client').PrismaClient)();
  const lines = [];
  for (const [slug, cfg] of Object.entries(SOURCES)) {
    if (ONLY && slug !== ONLY) continue;
    const co = dir.find(c => c.slug === slug);
    if (!co || !co.website) { lines.push(slug + ': not in directory'); continue; }
    try {
      const r = await importDealer(co, cfg, prisma);
      if (r.skipped) { lines.push(slug + ': skipped (' + r.skipped + ')'); continue; }
      lines.push(`${slug}: ${r.kept} listed of ${r.total}${r.off != null ? ', ' + r.off + ' switched off' : ''}`);
      if (DRY) for (const x of r.rows.slice(0, 5)) lines.push('   ' + JSON.stringify({ t: x.title, mk: x.make, md: x.model, y: x.year, p: x.price, km: x.mileage, f: x.fuel, tr: x.transmission, b: x.bodyType, c: x.condition, feats: (x._c.features || []).length, desc: (x._c.description || '').length }));
    } catch (e) { lines.push(slug + ': FAILED ' + e.message.slice(0, 120) + ' (its cars left as they were)'); }
  }
  console.log(lines.join('\n'));
  if (prisma) await prisma.$disconnect();
  console.log('END-IMPORT');
  process.exit(0);
})();
