// Brings recent property listings from real-estate companies' OWN websites into bina.et/property.
// Only facts (title, type, price, beds, size, area) and a link back to the company's page; no photos
// or descriptions are copied (they belong to the company; photos come when the company claims its page).
// Portals that compete with /property (RealEthio, Ethiopian Properties) are deliberately NOT sources.
// Listings not changed in 6 months, or gone from the company's site, are switched off here.
//   node --env-file=.env ops/places/property-import.js [--dry] [--only=<company-slug>]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const IMG_DIR = path.join(ROOT, 'public', 'property', 'img'), LOGO_DIR = path.join(ROOT, 'public', 'property', 'logo');
const OUR_IMG = 'https://bina.et/static/property/img/';
const IMG_CACHE = '/root/storage/directory/property-images.json'; // slug -> photo URL on the company site
// Company slugs whose photos must NOT be shown (a company asked us to remove them): their cards fall back to the name box.
const NOPHOTO_FILE = '/root/storage/directory/property-nophoto.json';
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7); // e.g. --only=dema-hope-real-estate
// Ibrahim (28 Sep): add ALL listings, old ones too - each card shows its date and one older than a year says
// "ask if still available". Only a listing marked sold, or gone from the company's site, is left out.
const MAX_AGE_DAYS = 3650;
const UA = { 'User-Agent': 'BinaSmartBot/1.0 (+https://bina.et/real-estate-companies)', Accept: 'application/json' };
// company slug in /root/storage/directory/addis-companies.json -> WordPress post type holding its listings
const SOURCES = {
  'in-addis-properties': 'property', 'real-addis': 'property', 'woyni-realtor': 'property',
  'enqopa-properties': 'property', 'gift-real-estate': 'property', 'hosea-real-estate': 'estate_property',
  'dema-hope-real-estate': 'properties', 'meba-marketing-solutions': 'property',
  'africon-real-estate': 'property', 'rockstone-ethiopia-kefita': 'apartment',
};
// Order matters: the first match wins, so a "Mixed Use Apartment" is an Apartment, not Commercial.
const PT = [[/condo|ኮንዶ/i, 'Condominium'], [/apart|flat|studio|penthouse|duplex|አፓርት/i, 'Apartment'],
  [/villa|house|ቪላ|መኖሪያ ቤት/i, 'House / Villa'], [/\bland\b|plot|መሬት/i, 'Land'],
  [/commerc|shop|office|retail|warehouse|ንግድ|ቢሮ/i, 'Commercial'], [/building|ሕንፃ|ህንፃ/i, 'Building']];
const decode = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const blank = v => v == null || /^\s*(0|0\.0+)?\s*$/.test(String(v));
const one = v => Array.isArray(v) ? v[0] : v;
async function getJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return { body: await r.json(), total: +r.headers.get('x-wp-total') || 0, pages: +r.headers.get('x-wp-totalpages') || 1 };
}
async function allPages(url) {
  const out = [];
  for (let p = 1; p <= 20; p++) {
    const { body, pages } = await getJson(url + (url.includes('?') ? '&' : '?') + 'per_page=100&page=' + p);
    out.push(...body); if (p >= pages) break;
  }
  return out;
}
// Respect robots.txt: skip a site whose rules for all robots block /wp-json/.
async function robotsBlocks(base) {
  try {
    const r = await fetch(base + '/robots.txt', { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    let star = false, blocked = false;
    for (const line of (await r.text()).split(/\r?\n/)) {
      const [k, ...rest] = line.split(':'); const v = rest.join(':').trim(); const key = k.trim().toLowerCase();
      if (key === 'user-agent') star = v === '*' || /binasmart/i.test(v);
      else if (star && key === 'disallow' && v && ('/wp-json/'.startsWith(v) || v === '/')) blocked = true;
    }
    return blocked;
  } catch (e) { return false; }
}
function priceOf(m, text, sale) {
  const raw = one(m.fave_property_price) || one(m.REAL_HOMES_property_price);
  if (blank(raw)) return null;
  let s = String(raw).trim();
  const pre = one(m.fave_property_price_prefix) || one(m.REAL_HOMES_property_price_prefix);
  const post = one(m.fave_property_price_postfix) || one(m.REAL_HOMES_property_price_postfix);
  if (pre && !s.toLowerCase().includes(String(pre).trim().toLowerCase())) s = String(pre).trim() + ' ' + s;
  if (post && !s.toLowerCase().includes(String(post).trim().toLowerCase())) s = s + ' ' + String(post).trim();
  // "/moth", "Month", "per month" -> "/ month"
  s = s.replace(/\s*(\/|per)?\s*\b(month|moth|mnth|monthly)\b\.?/i, ' / month');
  // "123,125.00$" / "$ 123125" -> "USD 123,125"
  if (/\$|usd/i.test(s)) s = 'USD ' + s.replace(/\$|usd/gi, '').replace(/\.00\b/, '').trim();
  s = s.replace(/(\d)(ETB|Birr|USD)/gi, '$1 $2').replace(/\d{4,}/g, n => Number(n).toLocaleString('en-US'));
  // A bare sale price of 20,000-800,000 birr can't buy a whole flat in Addis: it's the price per square metre
  // (Meba writes it five different ways: የካሬ ዋጋ, በካሬ ሜትር, በካሬ ...). A total like 19,800,000 stays a total.
  const n = /^[\d,.\s]+$/.test(s) ? Number(s.replace(/[^\d.]/g, '')) : 0;
  if (sale && n >= 20000 && n <= 800000 && PER_M2.test(text)) s += ' birr / m²';
  return s.slice(0, 60);
}
const PER_M2 = /ካሬ|sq\.?\s*m|m²|\bm2\b|square\s*met/i;
function sizeOf(m) {
  const raw = one(m.fave_property_size) || one(m.REAL_HOMES_property_size);
  if (blank(raw)) return null;
  let s = String(raw).trim();
  const unit = one(m.fave_property_size_prefix) || one(m.REAL_HOMES_property_size_postfix);
  // Some sites put the number itself in the unit box ("82" + "82"); only a real unit is added.
  if (unit && /[a-z²]/i.test(unit) && !/[a-z²]/i.test(s)) s += ' ' + String(unit).trim();
  if (!/[a-z²]/i.test(s)) s += ' m²';
  return s.replace(/\s*(sq\.?\s*(m|mt|mtr|meters?|metres?)|sqm|m2|square\s*met(er|re)s?)\b\.?/i, ' m²').slice(0, 30);
}
// Phone numbers as companies write them ("+2519-000-000-12", "0900000013", "+251%209%2000...") -> "+251900000012".
function etPhone(raw) {
  let d = String(raw || ''); try { d = decodeURIComponent(d); } catch (e) {}
  d = d.replace(/[^\d]/g, '');
  if (/^0[1-9]\d{8}$/.test(d)) d = '251' + d.slice(1);
  if (/^[79]\d{8}$/.test(d)) d = '251' + d;
  return /^251[1-9]\d{8}$/.test(d) ? '+' + d : null;
}
// The company's own contact buttons on a listing page: tel:, WhatsApp and Telegram links.
function contactsIn(html) {
  const first = (re, f) => { for (const m of html.matchAll(re)) { const v = f(m[1]); if (v) return v; } return null; };
  return {
    phone: first(/href=["']tel:([^"']+)/gi, etPhone),
    whatsapp: first(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{9,15})/gi, etPhone),
    telegram: first(/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})\b/g, h => /^(share|joinchat|s|addstickers|proxy|iv|bina_smart)$/i.test(h) ? null : h),
  };
}
async function pageContacts(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(25000) });
        return r.ok ? contactsIn(await r.text()) : {}; } catch (e) { return {}; }
}
// Only a Telegram account that can be messaged (person or bot) is a contact; a channel can't receive messages.
const tgOk = {};
async function telegramChat(handle) {
  if (!handle) return null;
  if (!(handle in tgOk)) {
    try { const t = await (await fetch('https://t.me/' + handle, { signal: AbortSignal.timeout(15000) })).text();
          tgOk[handle] = /tgme_action_button_new[^>]*>\s*Send Message/i.test(t) && !/subscribers?</i.test(t); }
    catch (e) { tgOk[handle] = false; }
  }
  return tgOk[handle] ? handle : null;
}
// Text with its line breaks kept: the description on the /property/<slug> page.
function paragraphs(html) {
  let t = String(html || '').replace(/<\s*(br|\/p|\/li|\/h\d|\/div|\/tr)\b[^>]*>/gi, '\n').replace(/<\s*li\b[^>]*>/gi, '\n• ').replace(/<[^>]*>/g, '');
  t = t.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return t.split(/\n+/).map(x => x.replace(/[ \t\u00a0\u200b\u200e]+/g, ' ').trim()).filter(x => x.length > 1).join('\n').slice(0, 5000);
}
// Map point, only when it is really in Ethiopia (one site leaves its theme's Miami demo pin on every listing).
function coordsOf(m) {
  let lat = 0, lng = 0;
  const rh = m.REAL_HOMES_property_location;
  if (rh && typeof rh === 'object') { lat = +rh.latitude; lng = +rh.longitude; }
  if (!lat) { lat = +one(m.houzez_geolocation_lat) || 0; lng = +one(m.houzez_geolocation_long) || 0; }
  if (!lat && one(m.fave_property_location)) { const p = String(one(m.fave_property_location)).split(','); lat = +p[0] || 0; lng = +p[1] || 0; }
  return lat > 3 && lat < 15 && lng > 33 && lng < 48 ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : null;
}
// Every photo of the listing on the company's site (RealHomes lists URLs, Houzez lists media ids), at most 12.
async function galleryOf(base, m, first) {
  const out = []; const add = u => { if (u && /^https?:\/\//i.test(u) && !out.includes(u)) out.push(u); };
  add(first);
  for (const g of (Array.isArray(m.REAL_HOMES_property_images) ? m.REAL_HOMES_property_images : [])) {
    const z = g && g.sizes, x = z && (z.large || z.medium_large || z['1536x1536'] || z.medium); if (x && x.url) add(x.url); else if (g && g.url) add(g.url);
  }
  const ids = (Array.isArray(m.fave_property_images) ? m.fave_property_images : []).map(Number).filter(n => n > 0).slice(0, 15);
  if (ids.length) {
    try {
      const media = (await getJson(base + '/wp-json/wp/v2/media?include=' + ids.join(',') + '&per_page=50&_fields=id,source_url,media_details')).body;
      const byId = Object.fromEntries(media.map(x => [x.id, x]));
      for (const id of ids) { const x = byId[id]; if (!x) continue; const z = (x.media_details && x.media_details.sizes) || {}; add((z.large || z.medium_large || z.full || {}).source_url || x.source_url); }
    } catch (e) {}
  }
  return out.slice(0, 12);
}
// Downloads one image and shrinks it with property-img.py. Returns true when dst was written.
async function saveImage(url, dst, mode) {
  if (!/^https?:\/\//i.test(url || '')) return false;
  const r = await fetch(url, { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(30000) });
  if (!r.ok || !/^image\//i.test(r.headers.get('content-type') || '')) return false;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 12e6 || buf.length < 200) return false;
  const tmp = path.join('/tmp', 'bina-prop-' + process.pid + '-' + Math.random().toString(36).slice(2));
  fs.writeFileSync(tmp, buf);
  try { execFileSync('python3', [path.join(__dirname, 'property-img.py'), mode, tmp, dst + '.part'], { timeout: 60000, stdio: 'pipe' });
        fs.renameSync(dst + '.part', dst); return true; }
  catch (e) { try { fs.unlinkSync(dst + '.part'); } catch (x) {} return false; }
  finally { try { fs.unlinkSync(tmp); } catch (x) {} }
}
// The listing's main photo on the company's site: featured image, else the SEO share image, else the theme's gallery.
async function photoOf(it, base, m) {
  const media = async id => {
    const x = (await getJson(base + '/wp-json/wp/v2/media/' + id + '?_fields=source_url,media_details')).body;
    const sz = (x.media_details && x.media_details.sizes) || {};
    return (sz.medium_large || sz.large || sz.full || {}).source_url || x.source_url;
  };
  try { if (+it.featured_media > 0) return await media(it.featured_media); } catch (e) {}
  const og = it.yoast_head_json && it.yoast_head_json.og_image && it.yoast_head_json.og_image[0];
  if (og && og.url) return og.url;
  const rh = (m.REAL_HOMES_property_images || [])[0];
  if (rh && rh.sizes) { const s = rh.sizes.large || rh.sizes['medium_large'] || rh.sizes.medium; if (s && s.url) return s.url; }
  const fave = one(m.fave_property_images);
  try { if (+fave > 0) return await media(fave); } catch (e) {}
  return null;
}
// The company's logo for the little circle: the WordPress site icon, else an icon link, else the header logo.
async function saveLogo(co, base) {
  const dst = path.join(LOGO_DIR, co.slug + '.webp');
  try { if (Date.now() - fs.statSync(dst).mtimeMs < 30 * 864e5) return; } catch (e) {}
  const cands = [];
  try { const root = (await getJson(base + '/wp-json/?_fields=site_icon_url')).body; if (root.site_icon_url) cands.push(root.site_icon_url); } catch (e) {}
  try {
    const html = await (await fetch(base + '/', { headers: { 'User-Agent': UA['User-Agent'] }, signal: AbortSignal.timeout(20000) })).text();
    for (const re of [/<link[^>]+rel=["']apple-touch-icon[^>]*href=["']([^"']+)/i, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon/i,
                      /<img[^>]+class=["'][^"']*custom-logo[^"']*["'][^>]*src=["']([^"']+)/i, /<link[^>]+rel=["']icon["'][^>]*sizes=["'](?:1[5-9]\d|[2-9]\d\d)[^>]*href=["']([^"']+)/i]) {
      const mm = html.match(re); if (mm) cands.push(new URL(mm[1].replace(/&amp;/g, '&'), base + '/').href);
    }
  } catch (e) {}
  for (const u of cands) if (await saveImage(u, dst, 'logo')) return;
}
async function importCompany(co, type, prisma) {
  const base = co.website.replace(/\/+$/, '');
  if (await robotsBlocks(base)) return { skipped: 'robots.txt' };
  const types = (await getJson(base + '/wp-json/wp/v2/types')).body;
  const rb = (types[type] && types[type].rest_base) || type;
  const taxes = (await getJson(base + '/wp-json/wp/v2/taxonomies?type=' + type)).body;
  const terms = {}; // item field -> id -> name
  for (const [slug, t] of Object.entries(taxes)) {
    const field = t.rest_base || slug;
    try { terms[field] = Object.fromEntries((await allPages(base + '/wp-json/wp/v2/' + field)).map(x => [x.id, decode(x.name)])); } catch (e) {}
  }
  const names = (item, re) => Object.keys(terms).filter(f => re.test(f)).flatMap(f => (item[f] || []).map(id => terms[f][id]).filter(Boolean));
  const items = await allPages(base + '/wp-json/wp/v2/' + rb + '?orderby=modified&order=desc');
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5, rows = [];
  let old = 0, sold = 0;
  for (const it of items) {
    if (Date.parse(it.modified_gmt + 'Z') < cutoff) { old++; continue; }
    const m = it.property_meta || it.meta || {};
    const status = names(it, /status|action|label/i).join(' ');
    if (/\bsold\b|ተሸጧል/i.test(status + ' ' + decode(it.title && it.title.rendered))) { sold++; continue; }
    const terms = names(it, /type|categor|usage/i).join(' '), rawTitle = decode(it.title && it.title.rendered);
    // What the lister wrote in the title wins ("Luxury G+2 House" is a house even if filed under Apartment),
    // then the site's category, then the description as a last resort (homes only).
    const ptype = (PT.find(([re]) => re.test(rawTitle)) || PT.find(([re]) => re.test(terms)) || PT.slice(0, 3).find(([re]) => re.test(decode(it.content && it.content.rendered))) || [])[1] || null;
    const area = names(it, /area|neighbo|district|sub|location/i)[0] || null;
    const city = names(it, /city|state|county/i)[0] || null;
    const beds = blank(one(m.fave_property_bedrooms) || one(m.REAL_HOMES_property_bedrooms)) ? null : String(one(m.fave_property_bedrooms) || one(m.REAL_HOMES_property_bedrooms)).slice(0, 10);
    const baths = blank(one(m.fave_property_bathrooms) || one(m.REAL_HOMES_property_bathrooms)) ? null : String(one(m.fave_property_bathrooms) || one(m.REAL_HOMES_property_bathrooms)).slice(0, 10);
    // Brokers often title a listing with the developer's name only ("Prime Real Estate"); say what it is.
    let title = decode(it.title && it.title.rendered).slice(0, 140) || 'Property';
    if (/real ?estate|propert|homes|developer|\bplc\b/i.test(title) && !/apart|villa|house|condo|bed|shop|office|land/i.test(title) && (beds || ptype))
      title = ((beds ? beds + '-bedroom ' : '') + (ptype || 'home').toLowerCase() + ' · ' + title).replace(/^./, c => c.toUpperCase());
    const listingType = /rent|ኪራይ/i.test(status) ? 'rent' : 'sale';
    rows.push({
      slug: (co.slug + '-' + it.id).slice(0, 80), title: title.slice(0, 140),
      listingType, propertyType: ptype, price: priceOf(m, decode(it.content && it.content.rendered), listingType === 'sale'), beds, baths,
      area: sizeOf(m), city, location: [area, city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || null,
      imageUrl: null, agency: co.name, agencyPhone: (co.phones || [])[0] || null, verified: false, active: true,
      sourceUrl: it.link, companySlug: co.slug, checkedAt: new Date(),
    });
  }
  if (!DRY) {
    await saveLogo(co, base);
    const noPhoto = (() => { try { return JSON.parse(fs.readFileSync(NOPHOTO_FILE, 'utf8')).includes(co.slug); } catch (e) { return false; } })();
    let cache = {}; try { cache = JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')); } catch (e) {}
    const byId = Object.fromEntries(items.map(it => [(co.slug + '-' + it.id).slice(0, 80), it]));
    for (const r of rows) {
      const file = path.join(IMG_DIR, r.slug + '.webp');
      if (noPhoto) { try { fs.unlinkSync(file); } catch (e) {} delete cache[r.slug]; r.imageUrl = null; continue; }
      const it = byId[r.slug]; let src = null;
      try { src = await photoOf(it, base, it.property_meta || it.meta || {}); } catch (e) {}
      if (src && !(cache[r.slug] === src && fs.existsSync(file))) { if (await saveImage(src, file, 'photo')) cache[r.slug] = src; }
      r.imageUrl = fs.existsSync(file) ? OUR_IMG + r.slug + '.webp?v=' + Math.floor(fs.statSync(file).mtimeMs / 1000) : null;
    }
    fs.writeFileSync(IMG_CACHE, JSON.stringify(cache));
    // Contact buttons go to the company that listed it: the listing page's own phone/WhatsApp/Telegram,
    // else the company home page, else the office landline from our directory.
    const home = await pageContacts(base + '/');
    for (const r of rows) {
      const c = await pageContacts(r.sourceUrl);
      r.agencyPhone = c.phone || home.phone || r.agencyPhone || null;
      r.agencyWhatsapp = c.whatsapp || home.whatsapp || null;
      r.agencyTelegram = await telegramChat(c.telegram || home.telegram);
    }
    // A listing page without a number (1 of Gift's 26) gets the company's usual sales number from its other listings.
    const most = k => { const n = {}; for (const r of rows) if (r[k]) n[r[k]] = (n[r[k]] || 0) + 1; return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || null; };
    const usual = { agencyPhone: most('agencyPhone'), agencyWhatsapp: most('agencyWhatsapp'), agencyTelegram: most('agencyTelegram') };
    for (const r of rows) if (!r.agencyPhone && !r.agencyWhatsapp) Object.assign(r, usual);
    // The details page: description, all photos, features, map point, address, year, parking.
    const byId2 = Object.fromEntries(items.map(it => [(co.slug + '-' + it.id).slice(0, 80), it]));
    for (const r of rows) {
      const it = byId2[r.slug], m = it.property_meta || it.meta || {};
      const photos = [];
      if (!noPhoto) {
        const srcs = await galleryOf(base, m, cache[r.slug]);
        for (let i = 0; i < srcs.length; i++) {
          const key = r.slug + '#g' + i, file = path.join(IMG_DIR, r.slug + '-g' + i + '.webp');
          if (!(cache[key] === srcs[i] && fs.existsSync(file))) { if (await saveImage(srcs[i], file, 'gallery')) cache[key] = srcs[i]; else continue; }
          photos.push(OUR_IMG + r.slug + '-g' + i + '.webp?v=' + Math.floor(fs.statSync(file).mtimeMs / 1000));
        }
      }
      // photos that are gone from the company's listing are deleted here too
      for (let i = photos.length; i < 20; i++) { try { fs.unlinkSync(path.join(IMG_DIR, r.slug + '-g' + i + '.webp')); delete cache[r.slug + '#g' + i]; } catch (e) {} }
      const addr = decode(one(m.fave_property_address) || one(m.fave_property_map_address) || one(m.REAL_HOMES_property_address) || '');
      const val = v => { const x = one(v); return x == null || /^\s*(0|)\s*$/.test(String(x)) ? null : String(x).slice(0, 20); };
      r.details = {
        description: paragraphs(it.content && it.content.rendered) || null,
        photos, features: names(it, /feature|amenit/i).slice(0, 40), coords: coordsOf(m), address: addr || null,
        year: val(m.fave_property_year || m.REAL_HOMES_property_year_built), garage: val(m.fave_property_garage || m.REAL_HOMES_property_garage),
        floor: val(m.fave_property_floor_no), updated: String(it.modified_gmt || '').slice(0, 10) || null,
      };
    }
    fs.writeFileSync(IMG_CACHE, JSON.stringify(cache));
  }
  let off = 0;
  if (!DRY) {
    const had = Object.fromEntries((await prisma.propertyListing.findMany({ where: { companySlug: co.slug }, select: { slug: true, imageUrl: true } })).map(x => [x.slug, x.imageUrl]));
    for (const r of rows) {
      const { slug, ...data } = r;
      // A photo the company added itself (after claiming) is never replaced; only an empty or imported one is.
      const own = had[slug] && !had[slug].startsWith(OUR_IMG);
      const { imageUrl, ...rest } = data;
      await prisma.propertyListing.upsert({ where: { slug }, update: own ? rest : data, create: r });
    }
    off = (await prisma.propertyListing.updateMany({
      where: { companySlug: co.slug, sourceUrl: { not: null }, active: true, slug: { notIn: rows.map(r => r.slug) } },
      data: { active: false } })).count;
  }
  return { total: items.length, kept: rows.length, old, sold, off, rows };
}
// Run as a script (cron); when required (ops/places/car-import.js) it only lends the helpers below.
if (require.main === module) (async () => {
  const dir = JSON.parse(fs.readFileSync('/root/storage/directory/addis-companies.json', 'utf8')).companies;
  const prisma = DRY ? null : new (require('@prisma/client').PrismaClient)();
  const lines = [], dump = [];
  for (const [slug, type] of Object.entries(SOURCES)) {
    if (ONLY && slug !== ONLY) continue;
    const co = dir.find(c => c.slug === slug);
    if (!co || !co.website) { lines.push(slug + ': not in directory'); continue; }
    try {
      const r = await importCompany(co, type, prisma);
      if (r.skipped) { lines.push(slug + ': skipped (' + r.skipped + ')'); continue; }
      lines.push(`${slug}: ${r.kept} listed, ${r.old} older than 10 years, ${r.sold} sold, ${r.off} switched off`);
      if (DRY) dump.push(...r.rows.map(x => ({ ...x, checkedAt: undefined })));
      if (DRY) for (const x of r.rows.slice(0, 4)) lines.push('   ' + JSON.stringify({ t: x.title, lt: x.listingType, pt: x.propertyType, p: x.price, b: x.beds, a: x.area, l: x.location }));
    } catch (e) { lines.push(slug + ': FAILED ' + e.message.slice(0, 120) + ' (its listings left as they were)'); }
  }
  if (DRY) fs.writeFileSync('/root/storage/directory/property-survey/dry-rows.json', JSON.stringify(dump, null, 1));
  console.log(lines.join('\n'));
  if (prisma) await prisma.$disconnect();
  console.log('END-IMPORT');
  process.exit(0);
})();
module.exports = { UA, decode, blank, one, getJson, allPages, robotsBlocks, etPhone, contactsIn, pageContacts, telegramChat,
  paragraphs, saveImage, saveLogo, ROOT, PT, IMG_DIR, OUR_IMG };
