// Real-estate companies whose websites have NO data feed (no WordPress property API): find each project or
// listing page (the site's sitemap first, then links on its home page), read it the way a person would - title,
// photos, price, bedrooms, size, area - and keep only pages that really describe a home or a project.
// Same rules as property-import.js: facts + the company's own photos (credited) + a link back, the company's own
// contacts, a page gone from the site is switched off. Portals that compete with /property are never read.
//   node --env-file=.env ops/places/project-import.js [--dry] [--only=<company-slug>]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./property-import');
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const IMG_CACHE = '/root/storage/directory/property-images.json';
const NOPHOTO_FILE = '/root/storage/directory/property-nophoto.json';
// Read by property-import.js (data feed), or portals with thousands of listings (RealEthio, Ethiopian Properties,
// Living Ethio): never read here.
const SKIP = new Set(['in-addis-properties', 'real-addis', 'woyni-realtor', 'enqopa-properties', 'gift-real-estate', 'hosea-real-estate',
  'dema-hope-real-estate', 'meba-marketing-solutions', 'africon-real-estate', 'rockstone-ethiopia-kefita', 'realethio', 'ethiopian-properties',
  'live-ethio-real-estate-consulting']);
const GOOD = /\/(projects?|propert(y|ies)|listings?|apartments?|villas?|sites?|residences?|towers?|homes?|units?|estates?|developments?|portfolio(-item)?|buildings?|commercial|residential|for-sale|for-rent|project_detail|propertydetail)(\/|-|\.|$)/i;
const BAD = /\/(blog|news|posts?|about|contact|careers?|jobs?|team|faq|privacy|terms|category|categories|tag|tags|author|page\/\d|feed|cart|checkout|account|login|events?|media|press|services?|components|wp-content|wp-includes|plugins|assets|front-page)(\/|$)|\/\d{4}\/\d{2}\/|\.(css|js|jpe?g|png|webp|gif|svg|pdf|xml)(\?|$)|(list|grid|sidebar|layout|standard|full-width|two-columns|masonry|home-?\d|home-(two|three|four))|\/[a-z]+-(type|city|features?|county-state|status|label|area|categor(y|ies)|tag)s?\/|-area\/?$|\/(type|city|features?|status|label|state|county)\//i;
// Index, category and demo pages, and work abroad (a contractor's Istanbul portfolio is not an Addis home).
const NOT_A_HOME = /archives?\b|categor(y|ies)|^our\b|^developments? by|^available\b|^explore\b|^all\b|^welcome|\broad\b|bridge|real estate php|lorem|\bdemo\b|\bsample\b|turkey|istanbul|bursa|tuzla|dubai|nairobi|kenya|\bhotels?\b|sold\s?out|\bsold\b|ተሽጧል/i;
const GENERIC = /^(commercial|residential|mixed use|home|homes|projects?|our projects|ongoing projects|completed projects|properties|our properties|listings?|portfolio|gallery|about( us)?|contact( us)?|services?|blog|news|property|for sale|for rent|apartments?|villas?|welcome|index|real estate|available properties)$/i;
const AREAS = ['Bole', 'Sarbet', 'CMC', 'Ayat', 'Kazanchis', 'Megenagna', 'Piassa', 'Gerji', 'Summit', 'Lebu', 'Jemo', 'Old Airport', 'Mexico', 'Lafto',
  'Kality', 'Kolfe', 'Yeka', 'Gulele', 'Arada', 'Lideta', 'Kirkos', 'Akaki', 'Atlas', 'Bisrate Gabriel', 'La Gare', 'Lagare', 'Tor Hailoch', 'Wello Sefer',
  'Goro', 'Hayat', 'Shola', 'Signal', 'Gotera', 'Saris', 'Jackros', 'Tekle Haymanot', 'Bulbula', 'Meskel Square', 'Mekanisa', 'Kotebe', 'Figa', 'Beshale', 'Lamberet', 'Haya Hulet', 'Imperial', 'Rwanda', 'Edna Mall'];
const AREA_RE = new RegExp('\\b(' + AREAS.map(a => a.replace(/ /g, '\\s?')).join('|') + ')\\b', 'i');
let CACHE = {}; try { CACHE = JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')); } catch (e) {}
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const strip = h => String(h || '').replace(/<(script|style|noscript|svg|header|nav|footer|form)\b[\s\S]*?<\/\1>/gi, ' ');
async function get(url, t) {
  try { const r = await fetch(url, { headers: { 'User-Agent': H.UA['User-Agent'] }, signal: AbortSignal.timeout(t || 20000) }); return r.ok ? await r.text() : null; }
  catch (e) { return null; }
}
async function sitemapUrls(base, url, depth) {
  const x = await get(base + url); if (!x || !/<loc>/.test(x)) return [];
  let out = [];
  for (const m of x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>(?:\s*<lastmod>\s*([^<\s]+))?/g)) {
    if (/sitemap[^/]*\.xml/i.test(m[1]) && depth < 2) { try { out = out.concat(await sitemapUrls('', m[1], depth + 1)); } catch (e) {} }
    else out.push({ url: m[1], lastmod: m[2] || null });
  }
  return out;
}
async function candidates(base) {
  const host = new URL(base).host.replace(/^www\./, '');
  let urls = [];
  for (const sm of ['/sitemap_index.xml', '/wp-sitemap.xml', '/sitemap.xml']) { urls = await sitemapUrls(base, sm, 0); if (urls.length) break; }
  const home = await get(base + '/');
  if (home) for (const m of home.matchAll(/href=["']([^"'#]+)["']/g)) { try { urls.push({ url: new URL(m[1], base + '/').href, lastmod: null }); } catch (e) {} }
  const seen = new Set(), out = [];
  for (const u of urls) {
    let x; try { x = new URL(u.url); } catch (e) { continue; }
    if (x.host.replace(/^www\./, '') !== host) continue;
    const key = x.origin + x.pathname.replace(/\/+$/, '');
    if (seen.has(key) || !GOOD.test(x.pathname) || BAD.test(x.pathname + x.search)) continue;
    seen.add(key); out.push({ url: key + (x.search || ''), lastmod: u.lastmod });
  }
  const lang = u => u.url.replace(/\/(en|am|ar)(?=\/)/i, '');
  out.sort((a, b) => (/\/en\//i.test(b.url) ? 1 : 0) - (/\/en\//i.test(a.url) ? 1 : 0));
  const one = new Set(); return out.filter(u => { const k = lang(u); if (one.has(k)) return false; one.add(k); return true; }).slice(0, 140);
}
function read(url, html) {
  const og = (p) => { const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + p + '["\'][^>]+content=["\']([^"\']+)', 'i')) || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + p, 'i')); return m ? H.decode(m[1]) : ''; };
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  // The page's own title first: a heading is often a slogan ("WHERE PRIME BUSINESS FINDS ITS ADDRESS.").
  const clean = t => String(t || '').split(/\s[|–—-]\s(?=[^|–—-]*$)/)[0].replace(/[.\s]+$/, '').trim();
  let title = [og('title'), H.decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]), H.decode(h1)].map(clean)
    .find(t => t && t.length > 2 && !GENERIC.test(t.replace(/[^\w\s]/g, '').trim())) || clean(H.decode(h1));
  title = title.slice(0, 140);
  const body = strip(html);
  const text = H.paragraphs((body.match(/<(article|main)\b[\s\S]*?<\/\1>/i) || [body])[0]);
  const flat = text.replace(/\n/g, ' ');
  const imgs = [], base = new Set();
  const addImg = u => { if (!u) return; let a; try { a = new URL(u.replace(/&amp;/g, '&'), url).href; } catch (e) { return; }
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(a) || /logo|icon|favicon|avatar|placeholder|spinner|loader|flag|whatsapp|telegram|facebook|payment/i.test(a) || /-(1[0-9]{2}|[0-9]{2})x\d{2,3}\./.test(a)) return;
    const k = a.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, ''); if (base.has(k)) return; base.add(k); imgs.push(a); };
  addImg(og('image'));
  for (const m of body.matchAll(/<img\b[^>]+?(?:data-lazy-src|data-src|src)=["']([^"']+)["']/gi)) addImg(m[1]);
  const priceM = flat.match(/(?:ETB|Birr|ብር|USD|\$)\s?\d[\d,]{3,}(?:\.\d+)?|\d[\d,]{3,}(?:\.\d+)?\s?(?:ETB|Birr|ብር|USD)\b/i);
  let price = priceM ? priceM[0].replace(/\s+/g, ' ').trim() : null;
  if (price && /per\s?(sq|square|m²|m2)|\/\s?(m²|m2|sqm)|ካሬ/i.test(flat.slice(Math.max(0, flat.indexOf(priceM[0]) - 60), flat.indexOf(priceM[0]) + priceM[0].length + 40))) price += ' / m²';
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const bw = title.match(/\b(\d|one|two|three|four|five|six)\s?-?\s?(?:bed ?rooms?|beds?|br\b)|ባለ\s?(\d)\s?መኝታ/i);
  const bedsM = bw ? [null, String(WORDS[String(bw[1] || '').toLowerCase()] || bw[1] || bw[2])] : (/studio/i.test(title) ? [null, '0'] : null);
  const SIZE_RE = /(\d{2,4}(?:\.\d+)?)\s?(?:m²|m2\b|sqm|sq\.?\s?m\b|square met(?:er|re)s?|ካሬ)/i;
  const sizeM = title.match(SIZE_RE) || (bedsM ? flat.match(SIZE_RE) : null);
  const areaM = (title + ' ' + flat).match(AREA_RE);
  const kinds = title + ' ' + flat.slice(0, 600);
  const type = (H.PT.find(([re]) => re.test(title)) || H.PT.find(([re]) => re.test(kinds)) || [])[1] || null;
  const listingType = /for rent|rental|to let|ለኪራይ|የሚከራይ/i.test(title) ? 'rent' : 'sale';
  // How much this page looks like ONE home or project (not a list, a blog post or a contact page).
  const score = (price ? 2 : 0) + (bedsM ? 1 : 0) + (sizeM ? 1 : 0) + (H.PT.some(([re]) => re.test(title)) ? 1 : 0) + (areaM ? 1 : 0)
    + (new URL(url).pathname.split('/').filter(Boolean).length >= 2 ? 1 : 0) + (text.length >= 200 ? 1 : 0);
  return { title, text: text.slice(0, 5000), imgs: imgs.slice(0, 12), price, beds: bedsM ? bedsM[1] : null, size: sizeM ? sizeM[1] + ' m²' : null,
    area: areaM ? areaM[1].replace(/\s+/g, ' ') : null, type, listingType, score, contacts: H.contactsIn(html) };
}

async function importCompany(co, prisma) {
  const base = co.website.replace(/\/+$/, '').replace(/\/(en|am)$/i, '');
  if (await H.robotsBlocks(base)) return { skipped: 'robots.txt' };
  const cands = await candidates(base);
  const rows = [], seenTitle = new Set(), why = {};
  for (const c of cands.slice(0, 120)) {
    const html = await get(c.url, 25000); if (!html) { why.fetch = (why.fetch || 0) + 1; continue; }
    const r = read(c.url, html);
    if (!r.title || GENERIC.test(r.title.replace(/[^\w\s]/g, '').trim()) || NOT_A_HOME.test(r.title)) { why.generic = (why.generic || 0) + 1; if (process.env.WHY) console.error('generic:', JSON.stringify(r.title), c.url); continue; }
    // A top-level page (/projects, /apartment-for-sale) is a list, unless it reads very much like one home.
    const depth = new URL(c.url).pathname.split('/').filter(x => x && !/^(en|am|ar)$/i.test(x)).length;
    if (depth <= 1 && r.score < 6) { why.index = (why.index || 0) + 1; continue; }
    if (!r.imgs.length) { why.noPhoto = (why.noPhoto || 0) + 1; continue; }
    if (r.score < 3) { why.lowScore = (why.lowScore || 0) + 1; continue; }
    const tk = r.title.toLowerCase(); if (seenTitle.has(tk)) { why.dup = (why.dup || 0) + 1; continue; } seenTitle.add(tk);
    rows.push({ slug: (co.slug + '-p-' + hash(c.url)).slice(0, 80), title: r.title, listingType: r.listingType, propertyType: r.type, price: r.price,
      beds: r.beds, baths: null, area: r.size, city: 'Addis Ababa', location: r.area ? r.area + ', Addis Ababa' : 'Addis Ababa', imageUrl: null,
      agency: co.name, agencyPhone: r.contacts.phone || (co.phones || [])[0] || null, agencyWhatsapp: r.contacts.whatsapp || null, agencyTelegram: null,
      verified: false, active: true, sourceUrl: c.url, companySlug: co.slug, checkedAt: new Date(), _r: r, _lastmod: c.lastmod, _tg: r.contacts.telegram });
  }
  if (DRY) return { cands: cands.length, kept: rows.length, why, rows };
  if (!rows.length) return { cands: cands.length, kept: 0, why, off: 0 };   // nothing read: leave what was there
  await H.saveLogo(co, base);
  const noPhoto = (() => { try { return JSON.parse(fs.readFileSync(NOPHOTO_FILE, 'utf8')).includes(co.slug); } catch (e) { return false; } })();
  const cache = CACHE;
  for (const row of rows) {
    const r = row._r, photos = [];
    if (!noPhoto) {
      for (let i = 0; i < r.imgs.length; i++) {
        const key = row.slug + '#g' + i, file = path.join(H.IMG_DIR, row.slug + '-g' + i + '.webp');
        if (!(cache[key] === r.imgs[i] && fs.existsSync(file))) { if (await H.saveImage(r.imgs[i], file, 'gallery')) cache[key] = r.imgs[i]; else continue; }
        photos.push(H.OUR_IMG + row.slug + '-g' + i + '.webp?v=' + Math.floor(fs.statSync(file).mtimeMs / 1000));
      }
      const card = path.join(H.IMG_DIR, row.slug + '.webp');
      if (r.imgs[0] && !(cache[row.slug] === r.imgs[0] && fs.existsSync(card))) { if (await H.saveImage(r.imgs[0], card, 'photo')) cache[row.slug] = r.imgs[0]; }
      if (fs.existsSync(card)) row.imageUrl = H.OUR_IMG + row.slug + '.webp?v=' + Math.floor(fs.statSync(card).mtimeMs / 1000);
    }
    row.agencyTelegram = await H.telegramChat(row._tg);
    row.details = { description: r.text || null, photos, features: [], coords: null, address: null, year: null, garage: null, floor: null,
      updated: row._lastmod ? String(row._lastmod).slice(0, 10) : null };
  }
  fs.writeFileSync(IMG_CACHE, JSON.stringify(CACHE));
  const most = k => { const n = {}; for (const r of rows) if (r[k]) n[r[k]] = (n[r[k]] || 0) + 1; return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null; };
  const usual = { agencyPhone: most('agencyPhone'), agencyWhatsapp: most('agencyWhatsapp') };
  for (const r of rows) if (!r.agencyPhone && !r.agencyWhatsapp) Object.assign(r, usual);
  const had = Object.fromEntries((await prisma.propertyListing.findMany({ where: { companySlug: co.slug }, select: { slug: true, imageUrl: true } })).map(x => [x.slug, x.imageUrl]));
  for (const r of rows) {
    const { _r, _lastmod, _tg, slug, ...data } = r;
    const own = had[slug] && !had[slug].startsWith(H.OUR_IMG);
    const { imageUrl, ...rest } = data;
    await prisma.propertyListing.upsert({ where: { slug }, update: own ? rest : data, create: { slug, ...data } });
  }
  const off = (await prisma.propertyListing.updateMany({ where: { companySlug: co.slug, slug: { startsWith: co.slug + '-p-', notIn: rows.map(r => r.slug) }, active: true },
    data: { active: false } })).count;
  return { cands: cands.length, kept: rows.length, why, off };
}

(async () => {
  const dir = JSON.parse(fs.readFileSync('/root/storage/directory/addis-companies.json', 'utf8')).companies;
  const prisma = DRY ? null : new (require('@prisma/client').PrismaClient)();
  const lines = [], dump = [];
  const todo = dir.filter(c => c.kind === 'real_estate' && c.website && !SKIP.has(c.slug) && (!ONLY || c.slug === ONLY));
  const res = new Array(todo.length); let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < todo.length) { const i = next++; const co = todo[i];
    try { res[i] = { co, r: await importCompany(co, prisma) }; } catch (e) { res[i] = { co, e }; } } }));
  for (const { co, r: rr, e } of res) {
    try {
      if (e) throw e;
      const r = rr;
      if (r.skipped) { lines.push(co.slug + ': skipped (' + r.skipped + ')'); continue; }
      lines.push(`${co.slug}: ${r.kept} kept of ${r.cands} pages ${JSON.stringify(r.why)}${r.off != null ? ', ' + r.off + ' switched off' : ''}`);
      if (DRY) for (const x of r.rows) dump.push({ co: co.slug, t: x.title, p: x.price, b: x.beds, s: x.area, a: x.location, ty: x.propertyType, lt: x.listingType, img: x._r.imgs.length, sc: x._r.score, u: x.sourceUrl });
    } catch (e) { lines.push(co.slug + ': FAILED ' + String(e.message).slice(0, 120)); }
  }
  if (DRY) fs.writeFileSync('/root/storage/directory/dev-survey/dry-rows.json', JSON.stringify(dump, null, 1));
  console.log(lines.join('\n'));
  if (prisma) await prisma.$disconnect();
  console.log('END-IMPORT');
  process.exit(0);
})();
