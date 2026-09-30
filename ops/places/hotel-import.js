// Photos and details for /hotels (owner, 28 Sep 2026: "better than booking.com, add all pictures and details").
// Three sources, every one credited on the page:
//   1. The hotel's OWN website: photos, its own words, facilities, rooms and prices when it publishes them, and the
//      phone / WhatsApp it publishes (a business contact, like the companies on /property).
//   2. Wikimedia Commons: free-licence photos taken at the hotel (author and licence shown under each photo).
//   3. Our own route engine and ride fares: distance, drive time and the BinaSmart ride price from Bole airport.
// Never Booking.com, TripAdvisor or Google: their photos belong to the hotels and to them.
//   node --env-file=.env ops/places/hotel-import.js [--only=<slug>] [--no-web] [--no-commons] [--no-ride] [--dry]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const H = require('./property-import');
const ROOT = H.ROOT;
const IMG_DIR = path.join(ROOT, 'public', 'hotels', 'img');
const OUR = 'https://bina.et/static/hotels/img/';
const OUT = '/root/storage/hotels/details.json';
const arg = k => process.argv.includes(k);
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);   // one slug, or several with commas
const DRY = arg('--dry');
const AIRPORT = { lat: 8.9779, lng: 38.7993 };
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' };
const WIKI_UA = { 'User-Agent': 'BinaSmartBot/1.0 (https://bina.et; hotel directory of Addis Ababa)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function hotels() {
  const fake = { get() {}, post() {}, register() {}, addHook() {}, log: { error() {}, warn() {}, info() {} } };
  require(path.join(ROOT, 'hotels', 'directory'))(fake, { prisma: {}, limiter: () => () => true }, () => {});
  return require(path.join(ROOT, 'hotels', 'directory')).list();
}
async function text(url, t = 20000) {
  try { const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(t) }); if (!r.ok) return null;
    if (!/html/i.test(r.headers.get('content-type') || '')) return null; return await r.text(); } catch (e) { return null; }
}
// download, keep only real photos (at least 640x360, not a strip or a logo), convert to our WebP
async function savePhoto(url, dst, mode) {
  let buf;
  try { const r = await fetch(url, { headers: url.includes('wikimedia') ? WIKI_UA : UA, signal: AbortSignal.timeout(30000) });
    if (!r.ok || !/^image\//i.test(r.headers.get('content-type') || '')) return false; buf = Buffer.from(await r.arrayBuffer()); } catch (e) { return false; }
  if (buf.length < 15000 || buf.length > 15e6) return false;
  const tmp = path.join('/tmp', 'bina-hotel-' + process.pid + '-' + crypto.randomBytes(4).toString('hex'));
  fs.writeFileSync(tmp, buf);
  try {
    const o = execFileSync('python3', [path.join(__dirname, 'img-size.py'), tmp], { timeout: 20000 }).toString().trim().split(/\s+/), w = +o[0], h = +o[1], white = +o[2];
    if (w < 640 || h < 360 || w / h > 2.6 || w / h < 0.6 || white > 0.6) return false;   // too small, a strip, or a logo on a white page
    execFileSync('python3', [path.join(__dirname, 'property-img.py'), mode, tmp, dst + '.part'], { timeout: 60000, stdio: 'pipe' });
    fs.renameSync(dst + '.part', dst); return o[3] || crypto.createHash('sha1').update(buf).digest('hex');
  } catch (e) { try { fs.unlinkSync(dst + '.part'); } catch (x) {} return false; }
  finally { try { fs.unlinkSync(tmp); } catch (x) {} }
}
// stock photos, AI pictures and page furniture on hotel sites (C Fun showed a pexels church and a "Generated_Image",
// Capital a pexels airplane, Belle View a testimonial avatar, Al Nahari a map screenshot), 28 Sep 2026
const STOCK = /pexels|unsplash|shutterstock|istockphoto|pixabay|freepik|depositphotos|dreamstime|123rf|adobestock|generated[_ -]?image|testimonial|screenshot|avatar|placeholder/i;
const dec = u => { try { return decodeURIComponent(String(u)); } catch (e) { return String(u); } };
// two fingerprints 6 bits apart or less = the same photo (resized, recompressed)
const near = (a, b) => a === b || (/^[0-9a-f]{16}$/.test(a) && /^[0-9a-f]{16}$/.test(b) && (BigInt('0x' + a) ^ BigInt('0x' + b)).toString(2).split('1').length - 1 <= 6);
const abs = (u, base) => { try { return new URL(u.replace(/&amp;/g, '&'), base).href; } catch (e) { return null; } };
const JUNK = /logo|icon|favicon|sprite|avatar|flag|payment|visa|mastercard|tripadvisor|booking\.com|expedia|badge|award|placeholder|blank|spinner|loader|arrow|social|facebook|twitter|instagram|whatsapp|map|qr/i;
function imagesIn(html, base) {
  const out = [];
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0], ss = t.match(/\s(?:data-)?srcset=["']([^"']+)/i);
    if (ss) { const c = ss[1].split(',').map(x => x.trim().split(/\s+/)).sort((a, b) => parseInt(b[1] || 0) - parseInt(a[1] || 0)); if (c[0]) out.push(c[0][0]); }
    const s = t.match(/\s(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)/i); if (s) out.push(s[1]);
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) out.push(m[2]);
  return [...new Set(out.map(u => abs(u, base)).filter(u => u && /^https?:/.test(u) && /\.(jpe?g|png|webp)(\?|$)/i.test(u) && !JUNK.test(u.split('/').slice(-2).join('/'))))];
}
const visible = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const FAC = [['wifi', /wi-?fi|wireless internet|free internet/i], ['pool', /swimming pool|\bpool\b/i], ['spa', /\bspa\b|massage|sauna|steam bath/i], ['gym', /\bgym\b|fitness/i],
  ['restaurant', /restaurant|dining/i], ['bar', /\bbar\b|lounge|cocktail/i], ['parking', /parking/i], ['airport', /airport (shuttle|transfer|pick ?-?up)|shuttle service/i],
  ['meeting', /conference|meeting room|banquet|event hall/i], ['breakfast', /breakfast/i], ['laundry', /laundry/i], ['roomservice', /room service/i],
  ['reception24', /24[- ]?(hour|hr|h)s? (front desk|reception)|24\/7 (front desk|reception)/i], ['aircon', /air[- ]?condition/i], ['elevator', /elevator|\blift\b/i], ['garden', /garden|terrace/i]];
const ROOM = /\b((?:standard|deluxe|superior|executive|junior|premium|classic|family|twin|double|single|king|queen|presidential|royal|studio|business)(?:\s+(?:king|queen|twin|double|single|room|suite|studio|bed))*\s*(?:room|suite|studio)s?)\b[^.]{0,90}?\b(USD|US\$|\$|ETB|Birr|Br)\s?([\d,]{2,9})/gi;
function details(pages) {
  const all = pages.map(p => visible(p.html)).join(' . ');
  const fac = FAC.filter(([k, re]) => re.test(all)).map(([k]) => k);
  const rooms = []; const seen = new Set();
  for (const m of all.matchAll(ROOM)) { const name = m[1].replace(/\s+/g, ' ').trim(); const k = name.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    const n = Number(m[3].replace(/,/g, '')); if (!n || n < 20) continue; rooms.push({ name: name.replace(/\b\w/g, c => c.toUpperCase()), price: (/usd|\$/i.test(m[2]) ? 'USD ' : 'ETB ') + n.toLocaleString('en-US') }); if (rooms.length >= 6) break; }
  const ci = all.match(/check[- ]?in[^0-9]{0,25}(\d{1,2}[:.]\d{2}\s?(?:am|pm|AM|PM)?)/), co = all.match(/check[- ]?out[^0-9]{0,25}(\d{1,2}[:.]\d{2}\s?(?:am|pm|AM|PM)?)/);
  const st = all.match(/\b([1-5])[- ]?star\b|\b(one|two|three|four|five)[- ]star\b/i);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  let own = []; for (const p of pages) for (const m of p.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) own.push(visible(m[1]).trim());
  own = [...new Set(own.map(s => String(s).trim()))].filter(s => s.length > 80 && s.length < 900 && !/cookie|copyright|all rights reserved|privacy|javascript/i.test(s)).slice(0, 4);
  return { facilities: fac, rooms, checkin: ci ? ci[1] : null, checkout: co ? co[1] : null, starsClaim: st ? Number(st[1] || words[String(st[2]).toLowerCase()]) : null, ownText: own.join('\n\n').slice(0, 2400) || null };
}
// found = a website we found by search (not the map's own tag): it must name the hotel and Addis, or it is not used
async function fromWebsite(p, found) {
  const home = await text(p.website); if (!home) return null;
  if (found) { const t = (visible(home) + ' ' + ((home.match(/<title[^>]*>([^<]*)/i) || [])[1] || '')).toLowerCase(), w = toks(p.name).filter(x => x.length >= 4);
    if (!/addis|\u12a0\u12f2\u1235 \u12a0\u1260\u1263|bole/.test(t) || !(w.length ? w.some(x => t.includes(x)) : t.includes(String(p.name).toLowerCase()))) { console.log('  found site does not name this hotel in Addis, skipped:', p.slug, p.website); return { mismatch: true }; } }
  if (!/addis|ethiopia|\u12a0\u12f2\u1235 \u12a0\u1260\u1263|\u12a2\u1275\u12ee\u1335\u12eb|bole|\+251/i.test(visible(home))) { console.log('  not an Addis site, skipped:', p.name, p.website); return { foreign: true }; }
  const base = p.website, host = (() => { try { return new URL(base).host.replace(/^www\./, ''); } catch (e) { return ''; } })();
  const links = [...new Set([...home.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)].map(m => abs(m[1], base)).filter(u => u && u.includes(host)
    && /room|suite|accommodat|gallery|photo|about|facilit|amenit|dining|restaurant|spa|meeting|conference|stay/i.test(u) && !/\.(pdf|jpe?g|png)$/i.test(u)))].slice(0, 6);
  const pages = [{ url: base, html: home }];
  for (const u of links) { const h = await text(u, 15000); if (h) pages.push({ url: u, html: h }); await sleep(400); }
  const imgs = [...new Set(pages.flatMap(pg => imagesIn(pg.html, pg.url)))].slice(0, 30);
  const c = (() => { try { return H.contactsIn(pages.map(x => x.html).join('\n')); } catch (e) { return {}; } })();
  const txtPhone = (visible(pages.map(x => x.html).join(' ')).match(/(?:\+251|\b0)[\s-]?(?:11|9\d|7\d)[\s-]?\d{3}[\s-]?\d{3,4}\b/) || [])[0];
  return { imgs, contacts: { phone: c.phone || (txtPhone ? txtPhone.replace(/\s+/g, ' ').trim() : null), whatsapp: c.whatsapp || null }, ...details(pages) };
}
async function wikiJson(q) {
  try { const r = await fetch('https://commons.wikimedia.org/w/api.php?format=json&' + q, { headers: WIKI_UA, signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
// words that name a street, an area or the country, not a hotel: "Churchill" matched Churchill Avenue, "Ethiopia" a bank tower
const GENERIC = /^(hotel|hotels|pension|guest|house|guesthouse|lodge|inn|resort|hostel|motel|apartment|apartments|addis|ababa|international|the|and|plc|bole|new|grand|city|view|ethiopia|ethiopian|africa|african|churchill|piassa|piazza|mexico|kazanchis|meskel|square|road|avenue|street|national|royal|star|park|plaza|home|homes|palace|tower|center|centre)$/i;
async function fromCommons(p) {
  const tokens = String(p.name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !GENERIC.test(w));
  if (!tokens.length || p.lat == null) return [];
  const g = await wikiJson('action=query&list=geosearch&gsnamespace=6&gsradius=350&gslimit=50&gscoord=' + p.lat + '|' + p.lng);
  const titles = ((g && g.query && g.query.geosearch) || []).map(x => x.title).filter(t => tokens.some(w => t.toLowerCase().includes(w)) && /\.(jpe?g|png)$/i.test(t)).slice(0, 5);
  if (!titles.length) return [];
  await sleep(700);
  const ii = await wikiJson('action=query&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1400&titles=' + encodeURIComponent(titles.join('|')));
  const out = [];
  for (const pg of Object.values((ii && ii.query && ii.query.pages) || {})) {
    const i = pg.imageinfo && pg.imageinfo[0]; if (!i) continue; const md = i.extmetadata || {};
    const lic = (md.LicenseShortName && md.LicenseShortName.value) || '';
    if (!/^(CC|Public domain|PD)/i.test(lic)) continue;
    const author = String((md.Artist && md.Artist.value) || '').replace(/<[^>]+>/g, '').trim().slice(0, 80) || 'Wikimedia Commons';
    out.push({ url: i.thumburl || i.url, credit: author + ' / ' + lic, page: i.descriptionurl });
  }
  return out;
}

// named Wikimedia files (free licence only, author and licence kept for the credit line)
async function fromTitles(titles) {
  const ii = await wikiJson('action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1400&titles=' + encodeURIComponent(titles.slice(0, 40).join('|')));
  const out = [];
  for (const pg of Object.values((ii && ii.query && ii.query.pages) || {})) { const i = pg.imageinfo && pg.imageinfo[0]; if (!i) continue; const md = i.extmetadata || {};
    const lic = (md.LicenseShortName && md.LicenseShortName.value) || ''; if (!/^(CC|Public domain|PD)/i.test(lic)) continue;
    out.push({ url: i.thumburl || i.url, credit: (String((md.Artist && md.Artist.value) || '').replace(/<[^>]+>/g, '').trim().slice(0, 80) || 'Wikimedia Commons') + ' / ' + lic, page: i.descriptionurl, order: titles.indexOf(pg.title) }); }
  return out.sort((a, b) => a.order - b.order).map(({ order, ...s }) => s);
}

// Wikidata: a hotel's own item often has an official photo (P18). Matched to our place by id, or by name within 400 m.
async function wikidataPhotos() {
  let wd = []; try { wd = JSON.parse(fs.readFileSync('/root/storage/wikidata-addis-hotels.json', 'utf8')).hotels || []; } catch (e) { return []; }
  const out = [];
  for (let i = 0; i < wd.length; i += 45) {
    try { const r = await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=' + wd.slice(i, i + 45).map(h => h.qid).join('|'), { headers: WIKI_UA, signal: AbortSignal.timeout(30000) });
      const d = await r.json(); for (const [q, e] of Object.entries(d.entities || {})) { const c = e.claims && e.claims.P18; if (c) { const h = wd.find(x => x.qid === q); out.push(Object.assign({}, h, { file: c[0].mainsnak.datavalue.value })); } } } catch (e) {}
  }
  return out;
}
const toks = n => String(n || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !GENERIC.test(w));
function wdFor(p, wdp) {
  if (String(p.ref).startsWith('wikidata/')) return wdp.find(h => 'wikidata/' + h.qid === p.ref) || null;
  const t = toks(p.name); if (!t.length || p.lat == null) return null;
  return wdp.find(h => Math.hypot((h.lat - p.lat) * 111, (h.lng - p.lng) * 109.5) < 0.4 && toks(h.name).some(w => t.includes(w))) || null;
}
async function wdPhoto(h) {
  const ii = await wikiJson('action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1400&titles=' + encodeURIComponent('File:' + h.file));
  for (const pg of Object.values((ii && ii.query && ii.query.pages) || {})) { const i = pg.imageinfo && pg.imageinfo[0]; if (!i) continue; const md = i.extmetadata || {};
    const lic = (md.LicenseShortName && md.LicenseShortName.value) || ''; if (!/^(CC|Public domain|PD)/i.test(lic)) continue;
    return { url: i.thumburl || i.url, credit: (String((md.Artist && md.Artist.value) || '').replace(/<[^>]+>/g, '').trim().slice(0, 80) || 'Wikimedia Commons') + ' / ' + lic, page: i.descriptionurl }; }
  return null;
}

(async () => {
  let list = hotels().filter(p => !p.unsure);
  const wdp = await wikidataPhotos();
  if (arg('--wikidata-only')) list = list.filter(p => wdFor(p, wdp));
  if (ONLY) list = list.filter(p => ONLY.split(',').includes(p.slug));
  const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  // photos the team found wrong on 28 Sep (a street, a bank tower, a stock photo): never shown again
  let BLOCK = {}; try { BLOCK = JSON.parse(fs.readFileSync('/root/storage/hotels/photo-block.json', 'utf8')); } catch (e) {}
  // the hotel's own website found by search when the map has none or a wrong one (slug -> url), and Wikimedia files
  // picked by hand from the "Hotels in Addis Ababa" category (ref -> ["File:..."]), 28 Sep 2026
  let SITES = {}; try { SITES = JSON.parse(fs.readFileSync('/root/storage/hotels/websites.json', 'utf8')); } catch (e) {}
  let EXTRA = {}; try { EXTRA = JSON.parse(fs.readFileSync('/root/storage/hotels/commons-extra.json', 'utf8')); } catch (e) {}
  const out = {}; const today = new Date().toISOString().slice(0, 10);
  let geo = null, settings = null, quoteAll = null;
  if (!arg('--no-ride')) {
    const prisma = new (require('@prisma/client').PrismaClient)();
    geo = require(path.join(ROOT, 'ride', 'geo')).makeGeo({ routerUrl: process.env.ROUTER_URL || 'http://127.0.0.1:8989', prisma });
    settings = await require(path.join(ROOT, 'ride', 'settings')).makeSettings(prisma).get();
    quoteAll = require(path.join(ROOT, 'ride', 'fare')).quoteAll;
  }
  let n = 0, withPhotos = 0, web = 0, com = 0;
  for (const p of list) {
    n++; const d = { updated: today, photos: [], credits: [] }; const prev = old[p.ref] || {};
    // 1. the airport: distance, time and our ride fare
    if (geo && p.lat != null) {
      try { const r = await geo.route(AIRPORT, { lat: p.lat, lng: p.lng }); const all = quoteAll(settings, r.distanceM, r.durationS).filter(x => x.fareEtb != null); const q = all.filter(x => x.tier === 'economy').concat(all.filter(x => !/moto|bajaj/i.test(x.tier)).sort((a, b) => a.fareEtb - b.fareEtb));
        d.airport = { km: +(r.distanceM / 1000).toFixed(1), min: Math.max(1, Math.round(r.durationS / 60)), fareFrom: q[0] ? q[0].fareEtb : null, tier: q[0] ? q[0].tier : null, estimate: !!r.estimate }; } catch (e) {}
    }
    // 2. the hotel's own website
    let srcs = [];
    for (const site of [...new Set([SITES[p.slug], p.website].filter(Boolean))]) {
      if (arg('--no-web')) break;
      const found = site !== p.website, w = await fromWebsite(Object.assign({}, p, { website: site }), found);
      if (w && w.foreign) { if (!found) d.foreignWebsite = true; continue; }
      if (!w || w.mismatch) continue;
      { web++; if (found) d.website = site; Object.assign(d, { facilities: w.facilities, rooms: w.rooms, checkin: w.checkin, checkout: w.checkout, starsClaim: w.starsClaim, ownText: w.ownText, contacts: w.contacts });
        srcs = srcs.concat(w.imgs.map(u => ({ url: u, credit: 'Photo: ' + p.name + ' (its own website)', page: site }))); }
      break;
    }
    // 3. the hotel's Wikidata photo first, then other Wikimedia Commons photos taken there
    const wdh = wdFor(p, wdp); if (wdh) { const ph = await wdPhoto(wdh); if (ph) srcs.unshift(ph); await sleep(500); }
    if (EXTRA[p.ref] && !arg('--no-commons')) { srcs = srcs.concat(await fromTitles(EXTRA[p.ref])); await sleep(700); }
    if (!arg('--no-commons')) { const c = await fromCommons(p); if (c.length) com++; srcs = srcs.concat(c); await sleep(700); }
    // the best pictures first: the building, the pool, the garden, a room; never a cash machine or a door
    const rank = s => { const t = decodeURIComponent(String(s.page || s.url)).toLowerCase();
      return (/exterior|facade|fa\u00e7ade|view|vista|pool|piscina|garden|jard|lobby|room|suite|restaurant|terrace|building|hotel/.test(t) ? 0 : 1) + (/atm|cajero|door|puerta|sign|logo|menu|receipt/.test(t) ? 5 : 0); };
    srcs = srcs.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]).filter(s => rank(s) < 5 && !STOCK.test(dec(s.url)));
    if (BLOCK[p.ref] === 'all') srcs = [];
    else if (Array.isArray(BLOCK[p.ref])) srcs = srcs.filter(s => !BLOCK[p.ref].some(b => String(s.url).includes(b)));
    // photos: up to 8, the same picture once
    const hashes = new Set();
    for (const s of srcs) {
      if (d.photos.length >= 8) break;
      const i = d.photos.length, file = path.join(IMG_DIR, p.slug + '-g' + i + '.webp');
      if (DRY) { d.photos.push(s.url); d.credits.push(s); continue; }
      const h = await savePhoto(s.url, file, 'gallery'); if (!h || [...hashes].some(x => near(x, h))) continue; hashes.add(h);
      d.photos.push(OUR + p.slug + '-g' + i + '.webp?v=' + Math.floor(fs.statSync(file).mtimeMs / 1000)); d.credits.push({ credit: s.credit, page: s.page, src: s.url });
    }
    if (!DRY && d.photos.length) {
      const card = path.join(IMG_DIR, p.slug + '.webp');
      try { execFileSync('python3', [path.join(__dirname, 'property-img.py'), 'photo', path.join(IMG_DIR, p.slug + '-g0.webp'), card + '.part'], { timeout: 60000, stdio: 'pipe' }); fs.renameSync(card + '.part', card);
        d.card = OUR + p.slug + '.webp?v=' + Math.floor(fs.statSync(card).mtimeMs / 1000); } catch (e) {}
    }
    for (let i = d.photos.length; i < 12; i++) { try { fs.unlinkSync(path.join(IMG_DIR, p.slug + '-g' + i + '.webp')); } catch (e) {} }
    if (d.photos.length) withPhotos++; else if (!DRY) { try { fs.unlinkSync(path.join(IMG_DIR, p.slug + '.webp')); } catch (e) {} }
    if (!d.photos.length && prev.photos && prev.photos.length && arg('--no-web') && arg('--no-commons')) { d.photos = prev.photos; d.credits = prev.credits; d.card = prev.card; }
    out[p.ref] = d;
    if (n % 25 === 0) { console.log('progress', n, '/', list.length, 'photos', withPhotos, 'web', web, 'commons', com); if (!DRY) fs.writeFileSync(OUT + '.part', JSON.stringify(Object.assign({}, old, out))); }
  }
  const final = Object.assign({}, ONLY || arg('--wikidata-only') ? old : {}, out);
  if (DRY) console.log(JSON.stringify(Object.values(out).slice(0, 3), null, 1).slice(0, 3000));
  else { fs.writeFileSync(OUT, JSON.stringify(final)); try { fs.unlinkSync(OUT + '.part'); } catch (e) {} }
  console.log('hotels:', list.length, 'with photos', withPhotos, '| own website read', web, '| commons', com);
  console.log('END-IMPORT'); process.exit(0);
})().catch(e => { console.log('FAILED', e.stack); process.exit(1); });
