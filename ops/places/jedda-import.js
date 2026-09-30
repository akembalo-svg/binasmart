// Jedda Star (Ibrahim's own China car-export company, jeddastar.com): its ELECTRIC cars on bina.et/cars.
// Ethiopia bans petrol and diesel car imports (2024; trucks 2025), so only fully electric cars are listed.
// Every car is IN CHINA: the price is the China price in USD, before shipping, customs duty and taxes, and the
// card, the page and Bini all say so. Buyers contact Ibrahim's Ethiopian number (his choice, 28 Sep 2026).
//   node ops/places/jedda-import.js [--dry] [--cached]   (--cached = reuse /root/storage/directory/jedda/cars.json)
const fs = require('fs');
const path = require('path');
const H = require('./property-import');
const DRY = process.argv.includes('--dry'), CACHED = process.argv.includes('--cached');
const IMG_DIR = path.join(H.ROOT, 'public', 'cars', 'img');
const OUR_IMG = 'https://bina.et/static/cars/img/';
const DATA = '/root/storage/directory/jedda/cars.json';
const IMG_CACHE = '/root/storage/directory/jedda/images.json';
const CO = { slug: 'jedda-star', name: 'Jedda Star' };
const PHONE = '+251911244344';
const AED_PER_USD = 3.6725;
const UA = 'Mozilla/5.0 (compatible; BinaSmartBot/1.0; +https://bina.et)';
const PHOTOS = 5;

const get = async (u, tries = 3) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) }); if (r.ok) return await r.text(); if (r.status === 404) return null; } catch (e) {} await new Promise(r => setTimeout(r, 1500 * (i + 1))); } return null; };
async function fetchAll() {
  const sm = await get('https://jeddastar.com/sitemap.xml');
  if (!sm) throw new Error('sitemap unreachable');
  const urls = [...new Set([...sm.matchAll(/<loc>(https:\/\/jeddastar\.com\/car-uni\/[^<]+)<\/loc>/g)].map(m => m[1]))];
  const out = []; let i = 0;
  async function worker() { while (i < urls.length) { const u = urls[i++]; const h = await get(u); if (!h) continue;
    for (const b of h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)) { try { const d = JSON.parse(b[1]); for (const x of (Array.isArray(d) ? d : (d['@graph'] || [d]))) if (x && (x['@type'] === 'Car' || x['@type'] === 'Vehicle')) out.push(x); } catch (e) {} } } }
  await Promise.all(Array.from({ length: 6 }, worker));
  if (out.length < 100) throw new Error('only ' + out.length + ' cars read; keeping the old list');
  fs.writeFileSync(DATA, JSON.stringify(out));
  return out;
}
const electric = c => /^(bev|electric|ev|battery electric)$/i.test(String(c.fuelType || '').trim());
const BODY = [[/pick-?up|\bshark\b/i, 'Pickup'], [/\bmpv\b|denza d9|\bm9\b|\bx9\b|voyah dream|\bd9\b/i, 'MPV'], [/\bsuv\b|crossover|sealion|\bsong\b|\btang\b|\byuan\b|\batto\b|model y|\bix\d?\b|\bix\b|eq[abc]|id\.?[46]|\bgx\b|\bg[69]\b|7x|\bl[6789]\b|yu7|\bx[1-7]\b|\bq[4-8]\b|bz4x|\bti ?[37]\b|leopard|avatr 1[12]|\baion y\b/i, 'SUV'], [/sedan|\bseal\b|model 3|\bp7\b|\bsu7\b|\bi[3-7]\b|\bqin\b|\bhan\b|\bet[57]\b|\bmona\b/i, 'Sedan'], [/hatch|dolphin|seagull|\bid\.?3\b|\bgolf\b/i, 'Hatchback']];
const bodyOf = t => { for (const [re, b] of BODY) if (re.test(t)) return b; return null; };
const FIX = [[/\bGACHonda\b/g, 'GAC Honda'], [/\bLongRange\b/g, 'Long Range'], [/\bAllWheelDrive\b/g, 'All-Wheel Drive'], [/\bFourWheel\b/g, 'Four-Wheel'],
  [/\bTwoWheel\b/g, 'Two-Wheel'], [/\bRearWheelDrive\b/g, 'Rear-Wheel Drive'], [/\bRearWheel\b/g, 'Rear-Wheel'], [/\bFrontWheelDrive\b/g, 'Front-Wheel Drive']];
// jeddastar.com titles are supplier text: "2025 Model Y L LongRange AllWheelDrive Version" -> "Tesla Model Y L Long Range All-Wheel Drive Version".
function cleanTitle(t, make) {
  let s = String(t || '').replace(/[\u2010\u2011\u2012\u2013]/g, '-').replace(/[\s\u00a0]+/g, ' ').trim();
  for (const [re, b] of FIX) s = s.replace(re, b);
  s = s.replace(/^(19|20)\d\d\s+/, '');
  if (make && !s.toLowerCase().includes(make.toLowerCase())) s = make + ' ' + s;
  return s.slice(0, 120);
}
const absolute = u => { try { return new URL(u, 'https://jeddastar.com').href; } catch (e) { return null; } };

function toRow(c) {
  const aed = Number(c.offers && c.offers.price) || 0;
  const imgs = (Array.isArray(c.image) ? c.image : [c.image]).filter(Boolean).map(absolute).filter(Boolean);
  if (!electric(c) || aed <= 0 || !imgs.length || !c.sku) return null;
  const usd = Math.round(aed / AED_PER_USD / 100) * 100;
  const yr = Number(c.vehicleModelDate);
  if (usd < 6000) return null;   // jeddastar data errors: a Tesla at USD 4,900 (a deposit or a typo), never a real price
  const yearOk = yr >= 2010 && yr <= new Date().getFullYear() + 1;   // some rows carry a code in the year field ("4483"): hide it, keep the car
  const make = (c.brand && c.brand.name) || String(c.name || '').trim().split(' ')[0];
  const title = cleanTitle(c.name, make);
  const model = title.toLowerCase().startsWith(make.toLowerCase() + ' ') ? title.slice(make.length + 1) : title;
  let km = c.mileageFromOdometer && Number(c.mileageFromOdometer.value);
  if (km && new RegExp('\\b' + km + '\\s*km', 'i').test(String(c.name || ''))) km = null;   // "600KM" in the name is the range, not the mileage
  const cond = /Used/i.test(c.itemCondition || '') ? 'Used' : /New/i.test(c.itemCondition || '') ? 'New' : null;
  return {
    slug: 'jedda-' + String(c.sku).toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, make, model, year: yearOk ? String(yr) : null,
    price: 'USD ' + usd.toLocaleString('en-US'), mileage: km ? km.toLocaleString('en-US') + ' km' : null, fuel: 'Electric', transmission: 'Automatic',
    bodyType: bodyOf(title), condition: cond, city: 'China', dealer: CO.name, companySlug: CO.slug, sourceUrl: c.url || absolute('/car-uni/' + c.sku),
    dealerPhone: PHONE, dealerWhatsapp: PHONE, dealerTelegram: null, active: true, checkedAt: new Date(),
    _srcs: [...new Set(imgs)].slice(0, PHOTOS), _aed: aed, _sku: c.sku,
  };
}

(async () => {
  const cars = CACHED && fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : await fetchAll();
  const seen = new Set(), rows = [];
  for (const c of cars) { const r = toRow(c); if (r && !seen.has(r.slug)) { seen.add(r.slug); rows.push(r); } }
  const fuel = {}; for (const c of cars) fuel[c.fuelType || '?'] = (fuel[c.fuelType || '?'] || 0) + 1;
  console.log('read', cars.length, 'fuel', JSON.stringify(fuel), 'electric+priced+photo', rows.length);
  if (DRY) { for (const r of rows.slice(0, 8)) console.log(JSON.stringify({ t: r.title, mk: r.make, y: r.year, p: r.price, aed: r._aed, b: r.bodyType, c: r.condition, km: r.mileage, img: r._srcs[0] })); console.log('END-IMPORT'); process.exit(0); }
  const cache = fs.existsSync(IMG_CACHE) ? JSON.parse(fs.readFileSync(IMG_CACHE, 'utf8')) : {};
  const prisma = new (require('@prisma/client').PrismaClient)();
  const today = new Date().toISOString().slice(0, 10);
  let n = 0, i = 0;
  async function one(r) {
    const photos = [];
    for (let k = 0; k < r._srcs.length; k++) {
      const key = r.slug + '#g' + k, file = path.join(IMG_DIR, r.slug + '-g' + k + '.webp');
      if (!(cache[key] === r._srcs[k] && fs.existsSync(file))) { if (await H.saveImage(r._srcs[k], file, 'gallery')) cache[key] = r._srcs[k]; else continue; }
      photos.push(OUR_IMG + r.slug + '-g' + k + '.webp?v=' + Math.floor(fs.statSync(file).mtimeMs / 1000));
    }
    const card = path.join(IMG_DIR, r.slug + '.webp');
    if (!(cache[r.slug] === r._srcs[0] && fs.existsSync(card))) { if (await H.saveImage(r._srcs[0], card, 'photo')) cache[r.slug] = r._srcs[0]; }
    if (!fs.existsSync(card)) return;   // no usable photo: skip the car rather than show an empty card
    const { _srcs, _aed, _sku, slug, ...data } = r;
    data.imageUrl = OUR_IMG + slug + '.webp?v=' + Math.floor(fs.statSync(card).mtimeMs / 1000);
    data.details = { description: null, photos, features: [], inChina: true, aed: _aed, sku: _sku, updated: today,
      specs: { Location: 'In China. Jedda Star ships it to Addis Ababa through Djibouti', Price: 'China price in USD, before shipping, customs duty and taxes',
        'Price on jeddastar.com': 'AED ' + Math.round(_aed).toLocaleString('en-US'), 'Jedda Star ref.': _sku } };
    await prisma.carListing.upsert({ where: { slug }, update: data, create: { slug, ...data } });
    n++;
  }
  async function worker() { while (i < rows.length) { const r = rows[i++]; try { await one(r); } catch (e) { console.log('car failed', r.slug, e.message.slice(0, 100)); } if (i % 25 === 0) { fs.writeFileSync(IMG_CACHE, JSON.stringify(cache)); console.log('progress', i, '/', rows.length); } } }
  await Promise.all(Array.from({ length: 3 }, worker));
  fs.writeFileSync(IMG_CACHE, JSON.stringify(cache));
  const off = (await prisma.carListing.updateMany({ where: { companySlug: CO.slug, active: true, slug: { notIn: rows.map(r => r.slug) } }, data: { active: false } })).count;
  console.log('jedda-star:', n, 'listed of', rows.length, 'electric;', off, 'switched off');
  await prisma.$disconnect();
  console.log('END-IMPORT');
  process.exit(0);
})().catch(e => { console.log('FAILED', e.message); process.exit(1); });
