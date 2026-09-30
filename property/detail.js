'use strict';
// bina.et/property/<slug> - one listing in full: every photo, the description, features, map, and the listing
// company's own Call / WhatsApp / Telegram. Data from ops/places/property-import.js (PropertyListing.details),
// which takes it from the company's own website; the page says so and links the original listing.
// noindex: the text is the company's, so the company's page is the one search engines should rank.
const fs = require('fs');
const path = require('path');
const { brandTile, suffix } = require('../brand/sections');
// Same guard as server.js: a "</script>" inside a value must not end the JSON-LD block early.
const ldScript = obj => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';

const LOGO_DIR = path.join(__dirname, '..', 'public', 'property', 'logo');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = s => String(s || '').replace(/\D/g, '');
function logoOf(slug) {
  try { const f = path.join(LOGO_DIR, slug + '.webp'); return '/static/property/logo/' + encodeURIComponent(slug) + '.webp?v=' + Math.floor(fs.statSync(f).mtimeMs / 1000); }
  catch (e) { return null; }
}
const IC = {
  bed: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',
  bath: 'M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.68 3 4 3.68 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M2 12h20M7 19v2M17 19v2',
  area: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  year: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  car: 'M5 17h14M6 17v2M18 17v2M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4H3v-4zM7 13h.01M17 13h.01',
  floor: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1',
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  call: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  wa: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z',
  tg: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  check: 'M20 6 9 17l-5-5',
  gauge: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
  fuel: 'M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M15 10h2a2 2 0 0 1 2 2v5a2 2 0 0 0 4 0V9l-3-3M7 7h4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};
const ic = (n, s) => `<svg viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[n]}"/></svg>`;

const CSS = `*{margin:0;padding:0;box-sizing:border-box}
:root{--em:#00C896;--em2:#009688;--ink:#081120;--mut:#64748B;--bg:#F8FAFC;--line:#e3ecea;--gold:#F59E0B}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
a{color:inherit;text-decoration:none}
.top{position:sticky;top:0;z-index:50;background:rgba(245,249,248,.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .in{max-width:1180px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:12px}
.logo{font-weight:900;font-size:21px;letter-spacing:-.5px;display:flex;align-items:center}.logo .g{color:var(--em)}.logo .zena{color:var(--gold);font-size:15px;margin-left:4px}
.badge{font-size:12px;font-weight:700;color:var(--em);background:#e6f7f4;border-radius:999px;padding:4px 12px}
.back{margin-left:auto;font-weight:700;font-size:14px;color:var(--em2)}
.wrap{max-width:1180px;margin:0 auto;padding:18px 20px 40px}
.crumbs{font-size:13px;color:var(--mut);margin-bottom:12px}.crumbs a{color:var(--em2);font-weight:600}
.gal{display:grid;grid-template-columns:1fr;gap:10px}
.gmain{position:relative;border-radius:20px;overflow:hidden;background:#dfe9e6;aspect-ratio:16/9;cursor:zoom-in}
.gmain img{width:100%;height:100%;object-fit:cover;display:block}
.gmain .none{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#5f7f78;text-align:center;padding:20px;cursor:default}
.gnav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.92);font-size:24px;line-height:1;cursor:pointer;box-shadow:0 6px 18px -6px rgba(0,0,0,.4);color:var(--ink)}
.gprev{left:12px}.gnext{right:12px}
.gcount,.gcr,.glt{position:absolute;background:rgba(15,32,39,.72);color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px}
.gcount{right:12px;bottom:12px}.gcr{left:12px;bottom:12px;font-weight:500;font-size:11px}.glt{left:12px;top:12px}
.gthumbs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
.gthumbs button{flex:none;width:96px;height:64px;border-radius:10px;overflow:hidden;border:2px solid transparent;padding:0;cursor:pointer;background:#dfe9e6;opacity:.75}
.gthumbs button.on{border-color:var(--em);opacity:1}.gthumbs img{width:100%;height:100%;object-fit:cover;display:block}
.cols{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:28px;margin-top:22px;align-items:start}
.ty{font-size:12.5px;font-weight:800;color:var(--em2);letter-spacing:.06em;text-transform:uppercase}
h1{font-size:clamp(24px,3.4vw,34px);font-weight:800;line-height:1.2;letter-spacing:-.5px;margin-top:4px}
.loc{display:flex;align-items:center;gap:6px;color:var(--mut);margin-top:8px;font-size:15px}.loc svg{flex:none}
.pm{display:none;font-size:26px;font-weight:800;color:var(--em2);margin-top:10px}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:18px}
.fact{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.fact svg{color:var(--em)}.fact b{display:block;font-size:17px;margin-top:4px}.fact span{font-size:12px;color:var(--mut)}
.sec{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;margin-top:18px}
.sec h2{font-size:19px;font-weight:800;margin-bottom:10px}.sec h2 small{font-family:'Noto Sans Ethiopic',sans-serif;color:var(--mut);font-weight:600;font-size:14px}
.desc{white-space:normal;color:#243741;font-size:15.5px;position:relative}.desc p{margin-bottom:8px}
.desc.clip{max-height:260px;overflow:hidden}.desc.clip:after{content:'';position:absolute;left:0;right:0;bottom:0;height:80px;background:linear-gradient(transparent,#fff)}
.more{margin-top:8px;border:0;background:none;color:var(--em2);font-weight:800;font-size:14px;cursor:pointer;font-family:inherit}
.feats{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 16px}
.feats li{display:flex;align-items:center;gap:8px;font-size:14.5px}.feats svg{color:var(--em);flex:none}
.map{width:100%;height:280px;border:0;border-radius:14px;margin-top:10px;background:#e6efed}
.spec{width:100%;border-collapse:collapse;font-size:14.5px}.spec th{text-align:left;color:var(--mut);font-weight:600;padding:8px 0;width:42%;border-bottom:1px solid var(--line)}.spec td{padding:8px 0;font-weight:700;border-bottom:1px solid var(--line)}
.src{font-size:13px;color:var(--mut);margin-top:16px}.src a{color:var(--em2);font-weight:700}
.card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 24px 50px -30px rgba(15,32,39,.35);position:sticky;top:78px}
.co{display:flex;align-items:center;gap:12px}.co img{width:54px;height:54px;border-radius:50%;border:1px solid var(--line);object-fit:cover;background:#fff}
.co .ph{width:54px;height:54px;border-radius:50%;background:#e6f7f4;display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--em2);font-size:20px}
.co small{display:block;font-size:12px;color:var(--mut)}.co a{font-weight:800;font-size:16px}
.price{font-size:28px;font-weight:800;color:var(--em2);margin:16px 0 4px;line-height:1.2}.price.ask{font-size:20px;color:var(--mut)}
.pnote{font-size:12.5px;color:var(--mut)}
.btns{display:grid;gap:8px;margin-top:16px}
.b{display:flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;padding:13px;font-weight:800;font-size:15px;border:1.5px solid transparent;cursor:pointer;font-family:inherit}
.b.call{background:var(--ink);color:#fff}.b.wa{background:#25D366;color:#fff}.b.tg{background:#229ED9;color:#fff}
.b.web{background:#fff;color:var(--ink);border-color:var(--line)}
.b.ask{background:linear-gradient(135deg,#064e3b,#059669 55%,#10b981);color:#fff}
.b.sh{background:#fff;color:var(--mut);border-color:var(--line);font-size:14px;padding:10px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.trust{font-size:12px;color:var(--mut);margin-top:14px;line-height:1.5}
.sim{margin-top:34px}.sim h2{font-size:22px;font-weight:800;margin-bottom:14px}
.sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.sc{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;display:block;transition:transform .15s}
.sc:hover{transform:translateY(-2px)}.sc .i{aspect-ratio:16/10;background:#e6efed center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-weight:700;color:#5f7f78;font-size:14px;text-align:center;padding:10px}
.sc .t{padding:12px 14px}.sc .p{font-weight:800;color:var(--em2)}.sc h3{font-size:14.5px;font-weight:700;line-height:1.3;margin-top:2px}.sc .l{font-size:12.5px;color:var(--mut);margin-top:4px}
.mbar{display:none}
.lb{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.94);display:none;align-items:center;justify-content:center}
.lb.open{display:flex}.lb img{max-width:96vw;max-height:88vh;object-fit:contain}
.lb button{position:absolute;border:0;background:rgba(255,255,255,.14);color:#fff;width:48px;height:48px;border-radius:50%;font-size:26px;cursor:pointer}
.lb .x{top:16px;right:16px}.lb .p{left:14px;top:50%}.lb .n{right:14px;top:50%}.lb .c{bottom:18px;left:50%;transform:translateX(-50%);color:#fff;font-size:13px;position:absolute}
.gone{background:#fff7e6;border:1px solid #f5d38a;color:#7a5200;border-radius:14px;padding:14px 16px;margin-bottom:16px;font-weight:600}
@media(max-width:900px){.cols{grid-template-columns:1fr}.card{position:static}.sgrid{grid-template-columns:1fr 1fr}.pm{display:block}
  .mbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:60;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);backdrop-filter:blur(8px);border-top:1px solid var(--line)}
  .mbar a{flex:1}.mbar .b{padding:12px}body{padding-bottom:78px}
  #biniBtn{bottom:92px!important}}
@media(max-width:560px){.wrap{padding:12px 14px 30px}.gmain{border-radius:14px;aspect-ratio:4/3}.gthumbs button{width:72px;height:52px}.sgrid{grid-template-columns:1fr}.gnav{width:38px;height:38px}}`;

function waOf(p) { let w = digits(p.agencyWhatsapp); if (!w) { const t = digits(p.agencyPhone); if (/^251[79]\d{8}$/.test(t)) w = t; } return w; }
function contactBtns(p, big) {
  const tel = digits(p.agencyPhone).length >= 9 ? '+' + digits(p.agencyPhone) : '';
  const wa = waOf(p), tg = /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(p.agencyTelegram || '') ? p.agencyTelegram : '';
  const link = p.sourceUrl || 'https://bina.et/property/' + p.slug; // the company's own page when there is one
  const msg = 'Hello' + (p.agency ? ' ' + p.agency : '') + ', I saw this property on BinaSmart (bina.et) and I am interested:\n' + p.title + (p.price ? '\n' + p.price : '') + '\n' + link;
  const out = [];
  if (tel) out.push(`<a class="b call" href="tel:${esc(tel)}">${ic('call')}${big ? 'Call ' + esc(p.agency || '') : 'Call'}</a>`);
  if (wa) out.push(`<a class="b wa" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ic('wa')}WhatsApp</a>`);
  if (tg) out.push(`<a class="b tg" href="https://t.me/${tg}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ic('tg')}Telegram</a>`);
  return out;
}
const areaOf = p => String(p.location || '').split(',')[0].trim();

function similar(p, all) {
  const others = all.filter(x => x.slug !== p.slug && x.listingType === p.listingType);
  const score = x => (areaOf(x) && areaOf(x) === areaOf(p) ? 2 : 0) + (x.propertyType && x.propertyType === p.propertyType ? 1 : 0) + (x.imageUrl ? 0.5 : 0);
  return others.sort((a, b) => score(b) - score(a)).slice(0, 6);
}
function simCard(x, base) {
  const img = x.imageUrl && /^https:\/\/bina\.et\/static\//.test(x.imageUrl) ? x.imageUrl : '';
  return `<a class="sc" href="${base}/${encodeURIComponent(x.slug)}"><div class="i"${img ? ` style="background-image:url('${esc(img)}')"` : ''}>${img ? '' : esc(x.agency || '')}</div>
<div class="t"><div class="p">${esc(x.price || 'Price on request')}</div><h3>${esc(x.title)}</h3><div class="l">${esc(x.location || '')}${x.agency ? ' · ' + esc(x.agency) : ''}</div></div></a>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = d => { const t = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? '' : MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear(); };
const TYPE_AM = { 'Apartment': 'አፓርትመንት', 'Condominium': 'ኮንዶሚኒየም', 'House / Villa': 'ቤት / ቪላ', 'Land': 'መሬት', 'Commercial': 'የንግድ ቦታ', 'Building': 'ሕንፃ' };
const areaName = p => String(p.location || '').split(',')[0].trim();
// A price search engines can read: a plain total in birr (or USD). "135,000 birr / m²" is not the price of the home.
function priceValue(price) {
  const s = String(price || ''); if (!s || /m²|m2|request/i.test(s)) return null;
  const m = s.replace(/,/g, '').match(/\d+(\.\d+)?/); const n = m ? Number(m[0]) : 0;
  return n >= 1000 ? { n, cur: /usd|\$/i.test(s) ? 'USD' : 'ETB' } : null;
}
// Our own words for a home, written from its facts. This is what search engines read on /property/<slug>; the company's
// own description (copied text) is only fetched when a reader asks for it, from /api/ which robots.txt keeps out.
function homeSummary(p, d, n) {
  const rent = p.listingType === 'rent', area = areaName(p) || 'Addis Ababa', type = (p.propertyType || 'property').toLowerCase();
  const beds = p.beds && p.beds !== '0' ? p.beds + '-bedroom ' : /studio/i.test(p.title) ? 'studio ' : '';
  const en = [(beds + type + ' ' + (rent ? 'for rent' : 'for sale') + ' in ' + area + (area !== 'Addis Ababa' ? ', Addis Ababa' : '')).replace(/^./, c => c.toUpperCase())
      + (p.price ? ', ' + p.price : '') + (p.area ? ', ' + p.area : '') + '.',
    'Listed by ' + (p.agency || 'the company') + ' on its own website' + (d.updated ? ' (updated ' + monthYear(d.updated) + ')' : '') + '; BinaSmart shows it with '
      + n + (n === 1 ? ' photo' : ' photos') + ' and the company\'s own phone.',
    'Contact ' + (p.agency || 'the company') + ' directly: BinaSmart is not the agent and takes no fee. Never pay before you see the home and its documents.'].join(' ');
  const am = [(rent ? 'የሚከራይ' : 'የሚሸጥ') + ' ' + (p.beds && p.beds !== '0' ? 'ባለ ' + p.beds + ' መኝታ ' : '') + (TYPE_AM[p.propertyType] || 'ቤት') + ' — ' + area + (area !== 'Addis Ababa' ? '፣ አዲስ አበባ' : '') + '።',
    p.price ? 'ዋጋ፦ ' + p.price + '።' : '', 'አቅራቢ፦ ' + (p.agency || 'ድርጅቱ') + '።', 'ድርጅቱን በቀጥታ ያነጋግሩ — ቢናስማርት ደላላ አይደለም፣ ክፍያም አይቀበልም።'].filter(Boolean).join(' ');
  return { en, am };
}
function homeLd(p, d, url, photos, sum) {
  const pv = priceValue(p.price), size = Number(String(p.area || '').replace(/[^\d.]/g, '')) || null;
  return { '@context': 'https://schema.org', '@type': 'RealEstateListing', name: p.title, url, description: sum.en,
    image: photos.slice(0, 6).map(u => u.split('?')[0]), datePosted: d.updated || undefined,
    offers: pv ? { '@type': 'Offer', price: pv.n, priceCurrency: pv.cur, businessFunction: p.listingType === 'rent' ? 'http://purl.org/goodrelations/v1#LeaseOut' : 'http://purl.org/goodrelations/v1#Sell',
      seller: { '@type': 'Organization', name: p.agency || undefined } } : undefined,
    about: { '@type': p.propertyType === 'House / Villa' ? 'House' : p.propertyType === 'Land' ? 'Place' : 'Apartment', numberOfRooms: Number(p.beds) || undefined,
      floorSize: size ? { '@type': 'QuantitativeValue', value: size, unitCode: 'MTK' } : undefined,
      address: { '@type': 'PostalAddress', addressLocality: areaName(p) || 'Addis Ababa', addressRegion: 'Addis Ababa', addressCountry: 'ET' } } };
}
const HOMES = { section: 'property', summary: homeSummary, ld: homeLd, base: '/property', badge: '🏠 ቤት · Property', allLabel: '← All homes', similar: 'Similar homes · ተመሳሳይ ቤቶች',
  ask: '✨ Ask Bini about this home', gone: 'This listing is no longer on the company\'s website - it may be sold or rented. Similar homes are below. · ይህ ቤት ከድርጅቱ ድረ-ገጽ ተነስቷል።',
  typeLine: (p, lt) => (p.propertyType || 'Property') + ' · ' + lt, facts: null };
function page(p, all, cfg) {
  cfg = cfg || HOMES;
  const d = (p.details && typeof p.details === 'object') ? p.details : {};
  const photos = (Array.isArray(d.photos) && d.photos.length ? d.photos : (p.imageUrl ? [p.imageUrl] : [])).filter(u => /^https:\/\/bina\.et\/static\//.test(u));
  const rent = p.listingType === 'rent', lt = rent ? 'For rent' : 'For sale', ltAm = rent ? 'ለኪራይ' : 'ለሽያጭ';
  const logo = p.companySlug ? logoOf(p.companySlug) : null;
  const facts = cfg.facts ? cfg.facts(p, d).filter(Boolean) : [
    p.beds && [ic('bed'), p.beds, /studio/i.test(p.title) && p.beds === '1' ? 'Studio / bedroom' : 'Bedrooms'],
    p.baths && [ic('bath'), p.baths, 'Bathrooms'], p.area && [ic('area'), p.area, 'Size'],
    d.year && [ic('year'), d.year, 'Year built'], d.garage && [ic('car'), d.garage, 'Parking'], d.floor && [ic('floor'), d.floor, 'Floor'],
  ].filter(Boolean);
  const desc = String(d.description || '').split('\n').filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('');
  const specs = Object.entries(d.specs && typeof d.specs === 'object' ? d.specs : {}).filter(([k, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const feats = (Array.isArray(d.features) ? d.features : []).map(f => `<li>${ic('check', 16)}${esc(f)}</li>`).join('');
  const c = d.coords && typeof d.coords.lat === 'number' ? d.coords : null;
  const map = c ? `<iframe class="map" loading="lazy" title="Map" src="https://www.openstreetmap.org/export/embed.html?bbox=${c.lng - 0.006}%2C${c.lat - 0.004}%2C${c.lng + 0.006}%2C${c.lat + 0.004}&amp;layer=mapnik&amp;marker=${c.lat}%2C${c.lng}"></iframe>
<p class="src"><a href="https://www.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener">Open in Google Maps ↗</a> · the pin is where the company placed it</p>` : '';
  const btns = contactBtns(p, true);
  const checked = p.checkedAt ? new Date(p.checkedAt).toISOString().slice(0, 10) : null;
  const url = 'https://bina.et' + cfg.base + '/' + p.slug;
  const metaDesc = [p.propertyType, lt.toLowerCase(), p.location && 'in ' + p.location, p.beds && p.beds + ' bedrooms', p.area, p.price, p.agency && 'listed by ' + p.agency].filter(Boolean).join(', ');
  const sims = similar(p, all);
  const gone = !p.active;
  const old = d.updated && Date.now() - Date.parse(d.updated) > 365 * 864e5;
  const sum = cfg.summary(p, d, photos.length || (p.imageUrl ? 1 : 0));
  const indexable = !gone && !old;
  // A unique, readable <title>: companies reuse generic titles ("G+1 Villa"; "BYD Seagull" at two dealers), so add what
  // tells two listings apart (bedrooms and size for a home; year, and mileage when used, for a car), then the price.
  const inChina = /china/i.test(p.city || '');
  const cut = (x, n) => { x = String(x || '').trim(); if (x.length <= n) return x; const t = x.slice(0, n); return t.slice(0, Math.max(t.lastIndexOf(' '), n - 12)).replace(/[\s,.;:-]+$/, '') + '\u2026'; };
  const extra = cfg.section === 'cars'
    ? [p.year && !String(p.title).includes(String(p.year)) ? String(p.year) : '', p.condition === 'Used' && p.mileage ? p.mileage : '']
    : [p.beds && !/bed|\u1218\u129d\u1273/i.test(p.title) ? p.beds + ' bed' : '', p.area && !String(p.title).includes(String(p.area)) ? String(p.area) : ''];
  let pageTitle = [cut(p.title, 46) + (inChina ? ' (in China)' : ''), ...extra.filter(Boolean), p.price || (cfg.section === 'cars' && p.dealer ? p.dealer : '')].filter(Boolean).join(' \u00b7 ') + ' | BinaSmart';
  if (pageTitle.length > 66) pageTitle = pageTitle.slice(0, -' | BinaSmart'.length);   // Google shows ~60 characters: the listing first
  const ogImg = photos[0] ? photos[0].split('?')[0] : 'https://bina.et/static/' + (cfg.section === 'cars' ? 'bina-carimport.png' : 'bina-property.png');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc((cfg.section === 'cars' || !metaDesc ? sum.en : p.title + ': ' + metaDesc + '. ' + sum.en).slice(0, 158))}"><meta name="robots" content="${indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'}"><link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(p.title)}${p.price ? ' · ' + esc(p.price) : ''}"><meta property="og:description" content="${esc(cfg.section === 'cars' ? sum.en.slice(0, 200) : (metaDesc || sum.en.slice(0, 200)))}">
<meta property="og:image" content="${esc(ogImg)}"><meta property="og:url" content="${esc(url)}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#009688">
${ldScript(cfg.ld(p, d, url, photos, sum))}<link rel="icon" href="/icon-32.png"><link rel="stylesheet" href="/static/fonts/fonts.css?v=2"><style>${CSS}</style></head><body>
<header class="top"><div class="in"><a href="/" class="logo">${brandTile(cfg.section)}Bina<span class="g">Smart</span><span class="zena">${suffix(cfg.section)}</span></a><a class="badge" href="${cfg.base}">${cfg.badge}</a><a class="back" href="${cfg.base}">${cfg.allLabel}</a></div></header>
<main class="wrap">
${gone ? '<div class="gone">' + esc(cfg.gone) + '</div>' : ''}${cfg.notice ? cfg.notice(p, d) : ''}
<div class="crumbs"><a href="${cfg.base}">${cfg.base === '/cars' ? 'Cars' : 'Property'}</a> › ${esc(lt)}${areaOf(p) ? ' › ' + esc(areaOf(p)) : ''}</div>
<section class="gal">
  <div class="gmain" id="gMain">${photos.length ? `<img id="gImg" src="${esc(photos[0])}" alt="${esc(p.title)}" fetchpriority="high">` : `<div class="none">${esc(p.agency || 'BinaSmart')}</div>`}
    <span class="glt">${lt} · ${ltAm}</span>${photos.length ? `<span class="gcr">Photo: ${esc(p.agency || 'the company')}</span>` : ''}
    ${photos.length > 1 ? `<button class="gnav gprev" id="gPrev" aria-label="Previous photo">‹</button><button class="gnav gnext" id="gNext" aria-label="Next photo">›</button><span class="gcount" id="gCount">1 / ${photos.length}</span>` : ''}</div>
  ${photos.length > 1 ? `<div class="gthumbs" id="gThumbs">${photos.map((u, i) => `<button${i ? '' : ' class="on"'} data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
</section>
<div class="cols">
<article>
  <div class="ty">${esc(cfg.typeLine(p, lt))}</div>
  <h1>${esc(p.title)}</h1>
  ${p.location ? `<div class="loc">${ic('pin')}${esc(p.location)}</div>` : ''}
  <div class="pm">${esc(p.price || 'Price on request')}</div>
  ${facts.length ? `<div class="facts">${facts.map(f => `<div class="fact">${f[0]}<b>${esc(f[1])}</b><span>${f[2]}</span></div>`).join('')}</div>` : ''}
  <div class="sec"><h2>About this ${cfg.base === '/cars' ? 'car' : 'home'} <small>· መግለጫ</small></h2><div class="desc"><p>${esc(sum.en)}</p><p class="am">${esc(sum.am)}</p></div>
    ${desc ? `<div class="desc" id="desc" hidden></div><button class="more" id="more" data-src="/api/listing-text${cfg.base}/${encodeURIComponent(p.slug)}">Show ${esc(p.agency || 'the company')}'s own description ↓</button>` : ''}</div>
  ${specs ? `<div class="sec"><h2>Specifications <small>· ዝርዝር</small></h2><table class="spec">${specs}</table></div>` : ''}
  ${feats ? `<div class="sec"><h2>Features <small>· ምቹ ነገሮች</small></h2><ul class="feats">${feats}</ul></div>` : ''}
  ${(c || d.address) ? `<div class="sec"><h2>Location <small>· አድራሻ</small></h2>${d.address ? `<p>${esc(d.address)}</p>` : ''}${map}</div>` : ''}
  ${d.updated && Date.now() - Date.parse(d.updated) > 365 * 864e5 ? `<div class="gone">⚠️ The company last updated this listing on ${esc(d.updated)} - ask them if it is still available before you visit. · ይህ ማስታወቂያ ከአንድ ዓመት በላይ ሆኖታል።</div>` : ''}
  <p class="src">Details and photos from ${esc(p.agency || 'the company')}'s own website${d.updated ? ', last updated there ' + esc(d.updated) : ''}${checked ? ', checked by BinaSmart ' + checked : ''}.
  ${p.sourceUrl ? `<a href="${esc(p.sourceUrl)}" target="_blank" rel="noopener nofollow">See the original listing ↗</a>` : ''}
  ${p.companySlug ? ` · Is this your company? <a href="/companies/${encodeURIComponent(p.companySlug)}">Claim your free page</a>` : ''}</p>
</article>
<aside><div class="card">
  <div class="co">${logo ? `<img src="${esc(logo)}" alt="${esc(p.agency || '')} logo">` : `<div class="ph">${esc((p.agency || 'B').charAt(0))}</div>`}
    <div><small>Listed by · የሚያቀርበው</small>${p.companySlug ? `<a href="/companies/${encodeURIComponent(p.companySlug)}">${esc(p.agency || '')}</a>` : `<b>${esc(p.agency || '')}</b>`}</div></div>
  <div class="price${p.price ? '' : ' ask'}">${esc(p.price || 'Price on request')}</div>
  <div class="pnote">${rent ? 'Monthly rent as the company lists it.' : 'Price as the company lists it; ask them for the payment plan.'}</div>
  <div class="btns">${btns.join('')}
    ${p.sourceUrl ? `<a class="b web" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener nofollow">${ic('ext')}${btns.length ? 'Company website' : 'Contact on their website'}</a>` : ''}
    <button class="b ask" type="button" id="askBini">${cfg.ask}</button>
    <div class="row2"><button class="b sh" type="button" id="share">${ic('share', 16)}Share</button><a class="b sh" href="${cfg.base}#request">🔎 Find me similar</a></div>
  </div>
  <div class="trust">You contact ${esc(p.agency || 'the company')} directly - BinaSmart is not the agent and takes no fee. Never pay before you see the home and the documents.</div>
</div></aside>
</div>
${sims.length ? `<section class="sim"><h2>${cfg.similar}</h2><div class="sgrid">${sims.map(x => simCard(x, cfg.base)).join('')}</div></section>` : ''}
</main>
${btns.length ? `<div class="mbar">${contactBtns(p, false).slice(0, 2).join('')}</div>` : ''}
<div class="lb" id="lb"><img id="lbImg" alt=""><button class="x" id="lbX" aria-label="Close">×</button><button class="p" id="lbP" aria-label="Previous">‹</button><button class="n" id="lbN" aria-label="Next">›</button><span class="c" id="lbC"></span></div>
<script>
(function(){
  var P=${JSON.stringify(photos).replace(/</g, '\\u003c')},i=0,img=document.getElementById('gImg');
  function show(n){if(!P.length)return;i=(n+P.length)%P.length;if(img)img.src=P[i];var c=document.getElementById('gCount');if(c)c.textContent=(i+1)+' / '+P.length;
    document.querySelectorAll('#gThumbs button').forEach(function(b){b.classList.toggle('on',+b.dataset.i===i)});
    var t=document.querySelector('#gThumbs button.on');if(t)t.scrollIntoView({block:'nearest',inline:'center'});
    var lb=document.getElementById('lb');if(lb.classList.contains('open')){document.getElementById('lbImg').src=P[i];document.getElementById('lbC').textContent=(i+1)+' / '+P.length}}
  function on(id,f){var e=document.getElementById(id);if(e)e.addEventListener('click',f)}
  on('gPrev',function(e){e.stopPropagation();show(i-1)});on('gNext',function(e){e.stopPropagation();show(i+1)});
  document.querySelectorAll('#gThumbs button').forEach(function(b){b.addEventListener('click',function(){show(+b.dataset.i)})});
  on('gMain',function(){if(!P.length)return;document.getElementById('lb').classList.add('open');show(i)});
  on('lbX',function(){document.getElementById('lb').classList.remove('open')});on('lbP',function(){show(i-1)});on('lbN',function(){show(i+1)});
  document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')show(i-1);else if(e.key==='ArrowRight')show(i+1);else if(e.key==='Escape')document.getElementById('lb').classList.remove('open')});
  var x0=null;[document.getElementById('gMain'),document.getElementById('lb')].forEach(function(el){if(!el)return;
    el.addEventListener('touchstart',function(e){x0=e.touches[0].clientX},{passive:true});
    el.addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)show(dx<0?i+1:i-1);x0=null})});
  var d=document.getElementById('desc'),m=document.getElementById('more');
  if(d&&m)m.addEventListener('click',function(){if(!d.hidden){d.hidden=true;m.textContent=m.dataset.l;return}m.dataset.l=m.dataset.l||m.textContent;
    if(d.childNodes.length){d.hidden=false;m.textContent='Hide ↑';return}m.disabled=true;
    fetch(m.dataset.src).then(function(r){return r.json()}).then(function(j){String(j.text||'').split('\n').forEach(function(l){if(l.trim()){var p=document.createElement('p');p.textContent=l;d.appendChild(p)}});
      d.hidden=false;m.disabled=false;m.textContent='Hide ↑'}).catch(function(){m.disabled=false})});
  on('askBini',function(){var q=${JSON.stringify('Tell me about this listing: ' + p.title + (p.agency ? ' by ' + p.agency : '') + (p.location ? ', ' + p.location : '')).replace(/</g, '\\u003c')};
    if(window.biniAsk)window.biniAsk(q)});
  on('share',function(){var u=location.origin+location.pathname,t=document.title;
    if(navigator.share){navigator.share({title:t,url:u}).catch(function(){})}
    else{window.open('https://wa.me/?text='+encodeURIComponent(t+'\\n'+u),'_blank','noopener')}});
})();
</script>
<script src="/static/bina-assistant.js?v=14" defer></script>
</body></html>`;
}

// An owner listing sent through Bini (property/owner-listing.js) stays invisible until the team approves it.
const unreviewed = p => !!(p && p.details && p.details.review && p.details.review.status !== 'approved');
module.exports = function propertyDetail(fastify, { prisma }, done) {
  fastify.get('/api/listing-text/property/:slug', async (req, reply) => {
    const p = await prisma.propertyListing.findUnique({ where: { slug: String(req.params.slug || '').slice(0, 100) }, select: { details: true } }).catch(() => null);
    reply.header('X-Robots-Tag', 'noindex');
    if (unreviewed(p)) return { text: '' };
    return { text: (p && p.details && p.details.description) || '' };
  });
  fastify.get('/property/:slug', async (req, reply) => {
    const slug = String(req.params.slug || '').slice(0, 100);
    const p = await prisma.propertyListing.findUnique({ where: { slug } }).catch(() => null);
    if (!p || unreviewed(p)) return reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">This listing was not found. <a href="/property">See all homes for sale and rent</a></p>');
    const all = await prisma.propertyListing.findMany({ where: { active: true }, take: 400,
      select: { slug: true, title: true, price: true, location: true, agency: true, imageUrl: true, listingType: true, propertyType: true } });
    return reply.type('text/html; charset=utf-8').send(page(p, all));
  });
  done();
};
module.exports.page = page;
module.exports.ic = ic;
module.exports.monthYear = monthYear;
module.exports.priceValue = priceValue;
