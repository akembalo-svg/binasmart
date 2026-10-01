'use strict';
// Addis Ababa real estate companies and car sellers (owner's request, 27 Sep 2026).
//
//   GET  /real-estate-companies · /car-dealers      the two lists (indexable)
//   GET  /companies/:slug                           one company (noindex, like /hotels/<slug>)
//   GET  /api/companies?kind=real_estate|car_seller the list as JSON
//   POST /api/companies/claim                       "this is my company" / "my company is missing"
//   GET  /ops/company-claims/:id/:action?t=…        one tap from the owner's Telegram message
//
// Data: /root/storage/directory/addis-companies.json, built by ops/places/companies-build.js from the city map
// (© OpenStreetMap contributors, ODbL), employers on our job board, and web research confirmed per company;
// checked by Jev (ops/jev-audit-companies.js). /root/storage/directory/exclude.json (names, keys or slugs)
// hides a company at once - the file is re-read when it changes.
// What a listing never shows: a mobile number (landlines only - a mobile on the map is often a person's own phone),
// and any claim of a licence. A claim is stored in the HotelClaim table with placeRef "company:<slug>" (no new
// table), and approving it only adds "✓ Company confirmed" - a person calls first.
const fs = require('fs');
const { brandTile, suffix } = require('../brand/sections');
const crypto = require('crypto');

const FILE = process.env.BINA_COMPANIES || '/root/storage/directory/addis-companies.json';
const EXCLUDE = '/root/storage/directory/exclude.json';
const KINDS = {
  real_estate: { en: 'Real estate company', am: 'ሪል እስቴት ኩባንያ', path: '/real-estate-companies', listings: '/property',
    title: 'Real estate companies in Addis Ababa', titleAm: 'በአዲስ አበባ የሚገኙ የሪል እስቴት ኩባንያዎች',
    intro: 'Developers, agencies and property managers in Addis Ababa, from the city map, companies hiring on BinaSmart, and their own websites.',
    introAm: 'በአዲስ አበባ የሚገኙ የቤት አልሚዎች፣ ደላላ ድርጅቶችና የንብረት አስተዳዳሪዎች ዝርዝር።', listLabel: 'Homes for sale and rent', listLabelAm: 'የሚሸጡና የሚከራዩ ቤቶች' },
  car_seller: { en: 'Car seller', am: 'መኪና ሻጭ', path: '/car-dealers', listings: '/cars',
    title: 'Car dealers in Addis Ababa', titleAm: 'በአዲስ አበባ የሚገኙ የመኪና ሻጮች',
    intro: 'Brand dealers, importers, assemblers and car markets in Addis Ababa, from the city map, companies hiring on BinaSmart, and their own websites.',
    introAm: 'በአዲስ አበባ የሚገኙ የመኪና አከፋፋዮች፣ አስመጪዎች፣ ገጣጣሚዎችና የመኪና ገበያዎች ዝርዝር።', listLabel: 'Cars for sale', listLabelAm: 'የሚሸጡ መኪኖች' },
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const kebab = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const host = u => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const href = u => { const h = host(u); return h ? (/^https?:/i.test(u) ? u : 'https://' + u) : ''; };

async function tellOwner(text) {       // same bot and chats as the hotel claims (hotels/directory.js)
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

const CSS = `:root{--bg:#F8FAFC;--card:#fff;--ink:#081120;--mut:#64748B;--line:#e3e8ee;--em:#00C896;--em2:#009688;--ok:#047857}
@media (prefers-color-scheme:dark){:root{--bg:#0e1120;--card:#171b2e;--ink:#e8eaf3;--mut:#9aa3ba;--line:#262c45;--em:#34d399;--em2:#6ee7b7;--ok:#34d399;color-scheme:dark}}
.morebtn{display:block;margin:4px auto 0;border:1.5px solid var(--line);background:var(--card);border-radius:999px;padding:12px 26px;font-weight:800;font-size:14.5px;color:var(--ink);cursor:pointer;font-family:inherit}.morebtn:hover{border-color:var(--em)}
.brandbar{display:flex;align-items:center;font-weight:900;font-size:21px;letter-spacing:-.5px;color:var(--ink);text-decoration:none}.brandbar .g{color:#00C896}.brandbar .zena{color:#F59E0B;font-size:15px;margin-left:4px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Ethiopic',sans-serif}
.w{max-width:960px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:16px}.am{font-family:'Noto Sans Ethiopic','Nyala',system-ui,sans-serif}
a{color:var(--em2)}h1{font-size:clamp(1.6rem,4.5vw,2.3rem);line-height:1.15;margin:0}h2{font-size:1.15rem;margin:0}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;display:grid;gap:10px}
.kind{display:inline-flex;gap:6px;font-size:11.5px;font-weight:800;color:var(--em2);background:rgba(124,112,232,.12);padding:5px 10px;border-radius:999px;width:max-content}
.mut{color:var(--mut)}.top a{text-decoration:none;font-weight:600}
ul.facts{list-style:none;margin:0;padding:0;display:grid;gap:8px}ul.facts li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;border-bottom:1px solid var(--line);padding-bottom:8px}
ul.facts li span{color:var(--mut);font-size:14px}.acts{display:flex;flex-wrap:wrap;gap:8px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:9px 14px;text-decoration:none;font-weight:700;font-size:14px;color:var(--ink);background:var(--card)}
.btn.pri{background:var(--em);border-color:var(--em);color:#fff}.src{font-size:13px;color:var(--mut)}
.ok{color:var(--ok);font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.co{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:grid;gap:4px;text-decoration:none;color:var(--ink)}
.co b{font-size:15.5px}.co .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.co .tags span{font-size:11.5px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:2px 8px}
input,select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
label{display:grid;gap:4px;font-size:14px;font-weight:600}form{display:grid;gap:10px}
button{font:inherit;font-weight:800;padding:12px 16px;border:0;border-radius:999px;background:var(--em);color:#fff;cursor:pointer}
#q{font-size:16px}.count{font-weight:800}`;

const FORM = (ref, isNew) => `<form id="f"><input type="hidden" name="ref" value="${esc(ref)}">
${isNew ? '<label>Company name · <span class="am">የድርጅቱ ስም</span><input name="company" required minlength="2" maxlength="120"></label><label>Area · <span class="am">አካባቢ</span><input name="area" maxlength="80" placeholder="Bole, Kazanchis…"></label>' : ''}
<label>Your name · <span class="am">ስምዎ</span><input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
<label>Your role · <span class="am">ኃላፊነትዎ</span><select name="role"><option value="owner">Owner · ባለቤት</option><option value="manager">Manager · ሥራ አስኪያጅ</option><option value="staff">Staff · ሠራተኛ</option></select></label>
<label>Phone · <span class="am">ስልክ</span><input name="phone" required inputmode="tel" autocomplete="tel" placeholder="09… / +251…"></label>
<label>Anything we should know? (optional) · <span class="am">ማስታወሻ</span><textarea name="note" rows="3" maxlength="500"></textarea></label>
<button type="submit"><span class="am">ይላኩ</span> · Send</button><div id="msg" role="status"></div></form>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, m = document.getElementById('msg'), b = f.querySelector('button');
  b.disabled = true; m.textContent = '…';
  try {
    const r = await fetch('/api/companies/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
    const d = await r.json();
    if (d.ok) { f.innerHTML = '<p class="ok">✓ ተቀብለናል · Received. We will call you on the number you gave to confirm.</p>'; return; }
    m.textContent = ({ phone: 'Please check the phone number · ስልኩን ያረጋግጡ', name: 'Please write your name · ስምዎን ይጻፉ', company: 'Please write the company name', slow_down: 'Too many tries, please wait an hour.' })[d.error] || 'Could not send. Please try again.';
  } catch (x) { m.textContent = 'Could not send. Please try again.'; }
  b.disabled = false;
});
</script>`;

// Real estate companies sit in the Property section, car sellers in Cars: the same tile and word as those pages.
const brandbar = path => { const sec = path === '/car-dealers' ? 'cars' : 'property';
  return `<a class="brandbar" href="/">${brandTile(sec)}Bina<span class="g">Smart</span><span class="zena">${suffix(sec)}</span></a>`; };
function head(title, desc, canonical, noindex, img) {
  desc = String(desc || ''); if (desc.length > 158) desc = desc.slice(0, 157).replace(/\s+\S*$/, '') + '\u2026';   // Google shows ~155
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<link rel="canonical" href="https://bina.et${esc(canonical)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="https://bina.et${esc(canonical)}"><meta property="og:type" content="website"><meta property="og:image" content="${esc(img || 'https://bina.et/static/bina-property.png')}"><meta name="twitter:card" content="summary_large_image">
<style>${CSS}</style></head><body><div class="w">`;
}

function listPage(kind, list, confirmed) {
  const k = KINDS[kind];
  const cards = list.map(c => `<a class="co" href="/companies/${esc(c.slug)}" data-n="${esc((c.name + ' ' + (c.nameAm || '') + ' ' + (c.sub || '') + ' ' + (c.brands || '')).toLowerCase())}">
<b>${esc(c.name)}</b>${c.nameAm ? '<span class="am mut">' + esc(c.nameAm) + '</span>' : ''}
<span class="mut">${c.sub ? esc(c.sub) + (c.subAm ? ' · <span class="am">' + esc(c.subAm) + '</span>' : '') : 'Addis Ababa'}${c.brands ? ' · ' + esc(c.brands) : ''}</span>
<span class="tags">${confirmed.has(c.slug) ? '<span class="ok">✓ Confirmed</span>' : ''}${c.places.length ? '<span>📍 On the map</span>' : ''}${c.employer ? '<span>💼 Hiring on BinaSmart</span>' : ''}${c.website ? '<span>🌐 Website</span>' : ''}</span></a>`).join('\n');
  return head(k.title + ' · BinaSmart', k.intro, k.path, false, k.path === '/car-dealers' ? 'https://bina.et/static/bina-carimport.png' : undefined) + ldJson({ '@context': 'https://schema.org', '@type': 'CollectionPage', name: k.title, url: 'https://bina.et' + k.path, mainEntity: { '@type': 'ItemList', numberOfItems: list.length, itemListElement: list.slice(0, 50).map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: 'https://bina.et/companies/' + c.slug, name: c.name })) } }) + `
${brandbar(k.path)}
<div class="top"><a href="${k.listings}">← <span class="am">${k.listLabelAm}</span> · ${k.listLabel}</a></div>
<div class="card"><span class="kind"><span class="am">${k.am}</span> · ${k.en}</span>
<h1><span class="am">${k.titleAm}</span><br>${k.title}</h1>
<p class="am">${k.introAm}</p><p class="mut">${k.intro} <span class="count">${list.length}</span> companies. This is a directory, not a licence register: call before you pay anyone.</p>
<label for="q" class="am">ፈልግ · Search</label><input id="q" type="search" placeholder="Name, area or brand · ስም፣ አካባቢ ወይም ብራንድ" autocomplete="off"></div>
<div class="grid" id="list">${cards}</div>
<div class="card" id="add"><h2 class="am">ድርጅትዎ በዝርዝሩ ውስጥ የለም?</h2><p><b>Your company is missing?</b> Tell us and we add it, free. We call you to confirm first.</p>${FORM('new:' + kind, true)}</div>
</div><script>
const q=document.getElementById('q'),cards=[...document.querySelectorAll('#list .co')];
// All companies stay in the page (search engines read them); people see 24 at a time, and a search looks at all.
let shown=24;const more=document.createElement('button');more.type='button';more.className='morebtn';document.getElementById('list').after(more);
function paint(){const v=q.value.trim().toLowerCase();let n=0;cards.forEach(c=>{const ok=!v||c.dataset.n.includes(v);c.hidden=!ok||(!v&&n++>=shown)});
  const left=v?0:cards.length-shown;more.hidden=left<=0;more.textContent='Show more \u00b7 \u1270\u1328\u121b\u122a \u12ed\u1218\u120d\u12a8\u1271 ('+left+' more)'}
q.addEventListener('input',paint);more.addEventListener('click',()=>{shown+=24;paint()});paint();
</script><script src="/static/bina-footer.js?v=10" defer></script></body></html>`;
}

// Search engines and AI assistants should know every company on the list (Ibrahim, 28 Sep: "google search know them
// and all ai"). So the page is indexable, says what the company is in schema.org, and lists what it sells on BinaSmart.
// A company we know only by name stays noindex - an empty page would count against the whole site.
const ldJson = obj => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
function companyLd(c, k) {
  const pin = c.places && c.places[0];
  return { '@context': 'https://schema.org', '@type': c.kind === 'car_seller' ? 'AutoDealer' : 'RealEstateAgent', name: c.name, alternateName: c.nameAm || undefined,
    url: 'https://bina.et/companies/' + c.slug, sameAs: c.website ? [c.website] : undefined, telephone: (c.phones || [])[0] || undefined,
    address: { '@type': 'PostalAddress', streetAddress: c.address || c.street || undefined, addressLocality: c.sub || 'Addis Ababa', addressRegion: 'Addis Ababa', addressCountry: 'ET' },
    geo: pin ? { '@type': 'GeoCoordinates', latitude: pin.lat, longitude: pin.lng } : undefined, areaServed: 'Addis Ababa' };
}
function listingsCard(c, L) {
  if (!L || !L.items.length) return '';
  const car = c.kind === 'car_seller', base = car ? '/cars/' : '/property/';
  return `<div class="card"><h2>${car ? 'Cars for sale from' : 'Homes and projects from'} ${esc(c.name)} on BinaSmart · ${L.count}</h2>
<p class="mut">${car ? 'Taken from the dealer\'s own website and checked every week.' : 'Taken from the company\'s own website and checked every week.'}</p>
<ul class="facts">${L.items.map(x => `<li><span><a href="${base}${esc(encodeURIComponent(x.slug))}">${esc(x.title)}</a></span><b>${esc(x.price || 'Price on request')}${x.where ? ' · ' + esc(x.where) : ''}</b></li>`).join('')}</ul>
${L.count > L.items.length ? `<p><a href="${car ? '/cars' : '/property'}">See all ${L.count} on ${car ? '/cars' : '/property'} →</a></p>` : ''}</div>`;
}
function companyPage(c, confirmed, L) {
  const k = KINDS[c.kind];
  const map = c.places[0] ? (c.places[0].ref.startsWith('employer/') ? 'https://www.openstreetmap.org/?mlat=' + c.places[0].lat + '&mlon=' + c.places[0].lng + '#map=18/' + c.places[0].lat + '/' + c.places[0].lng
    : 'https://www.openstreetmap.org/' + c.places[0].ref + '#map=18/' + c.places[0].lat + '/' + c.places[0].lng) : '';
  const site = href(c.website);
  const facts = [
    `<li><span>Type · ዓይነት</span><b>${esc(c.type || k.en)} · <span class="am">${k.am}</span></b></li>`,
    c.sub ? `<li><span>Sub-city · ክፍለ ከተማ</span><b>${esc(c.sub)}${c.subAm ? ' · <span class="am">' + esc(c.subAm) + '</span>' : ''}</b></li>` : '',
    c.address ? `<li><span>Area · አካባቢ</span><b>${esc(c.address)}</b></li>` : '',
    c.street ? `<li><span>Street · መንገድ</span><b>${esc(c.street)}</b></li>` : '',
    c.brands ? `<li><span>Brands · ብራንዶች</span><b>${esc(c.brands)}</b></li>` : '',
    c.branches && c.branches.length ? `<li><span>Also listed as · ሌሎች ቦታዎች</span><b>${c.branches.map(esc).join(' · ')}</b></li>` : '',
    c.phones && c.phones.length ? `<li><span>Office phone · የቢሮ ስልክ</span><b>${c.phones.map(esc).join(', ')}</b></li>` : '',
    site ? `<li><span>Website · ድረ ገጽ</span><b><a href="${esc(site)}" rel="nofollow noopener" target="_blank">${esc(host(c.website))}</a></b></li>` : '',
  ].join('');
  const from = [c.sources.includes('map') ? 'the city map (© OpenStreetMap contributors, ODbL)' : '', c.sources.includes('job board') ? 'job adverts it placed on BinaSmart' : '',
    c.sources.includes('web') ? 'public sources' + ((c.sourceUrls || []).length ? ' (' + c.sourceUrls.map(u => '<a href="' + esc(u) + '" rel="nofollow noopener" target="_blank">' + esc(host(u)) + '</a>').join(', ') + ')' : '') : ''].filter(Boolean).join(', ');
  return head(c.name + ' · ' + k.en + ' · Addis Ababa', c.name + ', ' + k.en.toLowerCase() + ' in ' + (c.sub ? c.sub + ', ' : '') + 'Addis Ababa.' + (L && L.count ? ' ' + L.count + (c.kind === 'car_seller' ? ' cars' : ' homes') + ' on BinaSmart with photos and prices.' : '') + ' Location and office phone; claim it free.', '/companies/' + c.slug, !(c.website || (c.phones || []).length || (c.places || []).length || c.employer || (L && L.count)), c.kind === 'car_seller' ? 'https://bina.et/static/bina-carimport.png' : undefined) + ldJson(companyLd(c)) + `
${brandbar(k.path)}
<div class="top"><a href="${k.path}">← <span class="am">${k.titleAm}</span> · ${k.title}</a></div>
<div class="card"><span class="kind"><span class="am">${k.am}</span> · ${esc(k.en)}</span>
<h1>${esc(c.name)}</h1>${c.nameAm ? '<div class="am mut">' + esc(c.nameAm) + '</div>' : ''}
${confirmed ? '<span class="ok">✓ Company confirmed · <span class="am">ድርጅቱ አረጋግጧል</span></span>' : ''}
<ul class="facts">${facts}</ul>
<div class="acts">${map ? `<a class="btn pri" href="${esc(map)}" target="_blank" rel="noopener">📍 Map · <span class="am">ካርታ</span></a><a class="btn" href="/ride">🚕 Ride there · <span class="am">ይሂዱ</span></a>` : ''}${c.employer ? `<a class="btn" href="/employer/${esc(c.employer)}">💼 Jobs · <span class="am">ሥራዎች</span></a>` : ''}<a class="btn" href="${k.listings}">${c.kind === 'car_seller' ? '🚗' : '🏠'} ${k.listLabel}</a></div>
<p class="src">From ${from}. This is what those sources say about the company, not an official licence register. Call before you visit or pay.</p></div>
${listingsCard(c, L)}
<div class="card" id="claim"><h2 class="am">ይህ የእርስዎ ድርጅት ነው?</h2><p><b>Is this your company?</b> Claim it free. We call you to confirm, then you can correct the details and list your ${c.kind === 'car_seller' ? 'cars' : 'properties'} on BinaSmart.</p><p style="margin:10px 0 12px"><a href="?bini=company" style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:#0f766e;color:#fff;font-weight:700;text-decoration:none">💬 ቢኒን ይጠይቁ · Ask Bini, any time</a> <span style="font-size:13px;opacity:.75">Bini takes your changes; our team approves them.</span></p>
<p class="am">ስምዎንና ስልክዎን ይተዉ፤ ደውለን እናረጋግጣለን። ከዚያ መረጃውን ያስተካክላሉ፤ ${c.kind === 'car_seller' ? 'መኪኖችዎን' : 'ቤቶችዎን'} በቢናስማርት ላይ ያቀርባሉ።</p>${FORM('company:' + c.slug, false)}</div>
</div><script src="/static/bina-assistant.js?v=14" defer></script><script src="/static/bina-footer.js?v=10" defer></script></body></html>`;
}

module.exports = function companyDirectory(fastify, { prisma, limiter, tell }, done) {
  const tellTeam = tell || tellOwner;   // tests pass their own: no real Telegram
  let cache = { mtime: 0, list: [], bySlug: new Map() };
  function load() {
    let m = 0; try { m = fs.statSync(FILE).mtimeMs; } catch (e) { return cache; }
    try { m += fs.statSync(EXCLUDE).mtimeMs; } catch (e) { /* optional */ }
    if (m === cache.mtime) return cache;
    try {
      let ex = []; try { ex = JSON.parse(fs.readFileSync(EXCLUDE, 'utf8')); } catch (e) { /* none */ }
      const list = (JSON.parse(fs.readFileSync(FILE, 'utf8')).companies || []).filter(c => !ex.includes(c.name) && !ex.includes(c.key) && !ex.includes(c.slug));
      cache = { mtime: m, list, bySlug: new Map(list.map(c => [c.slug, c])) };
    } catch (e) { fastify.log.error('company directory: ' + e.message); }
    return cache;
  }
  // server.js's sitemap lists the indexable company pages from this same list.
  module.exports.list = () => load().list;
  let conf = { at: 0, set: new Set() };
  async function confirmed() {
    if (Date.now() - conf.at < 60000) return conf.set;
    const rows = await prisma.hotelClaim.findMany({ where: { status: 'approved', placeRef: { startsWith: 'company:' } }, select: { slug: true } }).catch(() => []);
    conf = { at: Date.now(), set: new Set(rows.map(r => r.slug)) };
    return conf.set;
  }
  const byKind = kind => load().list.filter(c => c.kind === kind);
  for (const kind of Object.keys(KINDS)) {
    fastify.get(KINDS[kind].path, async (req, reply) => reply.type('text/html; charset=utf-8').send(listPage(kind, byKind(kind), await confirmed())));
  }
  fastify.get('/companies/:slug', async (req, reply) => {
    const c = load().bySlug.get(String(req.params.slug));
    if (!c) return reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">Not found. <a href="/real-estate-companies">Real estate companies</a> · <a href="/car-dealers">Car dealers</a></p>');
    // what this company sells on BinaSmart (homes or cars imported from its own website)
    const car = c.kind === 'car_seller', where = { companySlug: c.slug, active: true };
    let L = null;
    try {
      const [count, items] = car
        ? await Promise.all([prisma.carListing.count({ where }), prisma.carListing.findMany({ where, take: 12, orderBy: { createdAt: 'desc' }, select: { slug: true, title: true, price: true, year: true } })])
        : await Promise.all([prisma.propertyListing.count({ where }), prisma.propertyListing.findMany({ where, take: 12, orderBy: { createdAt: 'desc' }, select: { slug: true, title: true, price: true, location: true } })]);
      L = { count, items: items.map(x => ({ slug: x.slug, title: x.title, price: x.price, where: car ? x.year : String(x.location || '').split(',')[0] })) };
    } catch (e) { /* the page still works without them */ }
    return reply.type('text/html; charset=utf-8').send(companyPage(c, (await confirmed()).has(c.slug), L));
  });
  fastify.get('/api/companies', async (req) => {
    const kind = KINDS[req.query.kind] ? req.query.kind : null, conf = await confirmed();
    const list = kind ? byKind(kind) : load().list;
    return { count: list.length, source: 'OpenStreetMap contributors (ODbL), BinaSmart job board, company websites',
      companies: list.map(c => ({ slug: c.slug, kind: c.kind, name: c.name, nameAm: c.nameAm, sub: c.sub, subAm: c.subAm, brands: c.brands || undefined,
        website: host(c.website) || undefined, onMap: c.places.length > 0, hiring: !!c.employer, confirmed: conf.has(c.slug), url: 'https://bina.et/companies/' + c.slug })) };
  });

  const ipRL = limiter(3600000, 5);
  fastify.post('/api/companies/claim', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    if (!ipRL(String(req.headers['x-real-ip'] || req.ip || ''))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const ref = String(b.ref || '');
    const isNew = /^new:(real_estate|car_seller)$/.test(ref), kind = isNew ? ref.slice(4) : null;
    const company = clean(b.company, 120), area = clean(b.area, 80);
    if (isNew && company.length < 2) return reply.code(400).send({ ok: false, error: 'company' });
    const c = isNew ? { slug: '', name: company, kind, sub: area, phones: [] } : load().bySlug.get(ref.replace(/^company:/, ''));
    if (!c) return reply.code(404).send({ ok: false, error: 'company' });
    const name = clean(b.name, 80), role = ['owner', 'manager', 'staff'].includes(b.role) ? b.role : 'owner', note = clean(b.note, 500);
    // An Ethiopian mobile or landline in one stored form, as hotel, restaurant and health claims (1 Oct 2026).
    const digits = require('../health/directory').ethPhone(b.phone);
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name' });
    if (!digits) return reply.code(400).send({ ok: false, error: 'phone' });
    const placeRef = isNew ? 'company-new:' + (kebab(company) || 'company') : 'company:' + c.slug;
    const dup = await prisma.hotelClaim.findFirst({ where: { placeRef, phone: digits, status: 'pending' } });
    if (dup) return { ok: true };
    const row = await prisma.hotelClaim.create({ data: { placeRef, placeName: c.name, slug: c.slug, name, role, phone: digits, note: note || null,
      token: crypto.randomBytes(16).toString('hex') } });
    const base = 'https://bina.et/ops/company-claims/' + row.id + '/';
    await tellTeam((isNew ? '🆕 <b>Company NOT in the list</b> (add it by hand after the call) · ' : (c.kind === 'car_seller' ? '🚗' : '🏢') + ' <b>Company claim</b> · ')
      + esc(c.name) + ' (' + esc(KINDS[c.kind].en) + (c.sub ? ', ' + esc(c.sub) : '') + ')\n👤 ' + esc(name) + ' — ' + role + '\n📞 ' + esc(digits)
      + (c.phones && c.phones.length ? '\n☎ listing says: ' + esc(c.phones.join(', ')) : '') + (note ? '\n📝 ' + esc(note) : '')
      + '\n\nCall before approving.\n' + (isNew ? '' : '<a href="https://bina.et/companies/' + c.slug + '">listing</a> · ')
      + '<a href="' + base + 'approve?t=' + row.token + '">✅ approve</a> · <a href="' + base + 'reject?t=' + row.token + '">❌ reject</a>');
    return { ok: true };
  });

  fastify.get('/ops/company-claims/:id/:action', async (req, reply) => {
    const c = await prisma.hotelClaim.findUnique({ where: { id: String(req.params.id) } });
    const t = Buffer.from(String(req.query.t || '')), want = Buffer.from(c ? c.token : '');
    if (!c || !/^company(-new)?:/.test(c.placeRef) || t.length !== want.length || !crypto.timingSafeEqual(t, want)) return reply.code(404).send('not found');
    const action = req.params.action;
    if (!['approve', 'reject'].includes(action)) return reply.code(400).send('approve or reject');
    // a second tap on approve does nothing (as hotel claims, 1 Oct 2026)
    if (action === 'approve' && c.status === 'approved') return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">Already approved: ' + esc(c.placeName) + '</p>');
    await prisma.hotelClaim.update({ where: { id: c.id }, data: { status: action === 'approve' ? 'approved' : 'rejected', decidedAt: new Date() } });
    conf.at = 0;
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + (action === 'approve' ? '✅ Approved' : '❌ Rejected') + ': ' + esc(c.placeName) + ' — ' + esc(c.name) + '. '
      + (c.slug ? '<a href="/companies/' + esc(c.slug) + '">listing</a>' : action === 'approve' ? 'Not in the directory yet: add it by hand.' : '') + '</p>');
  });
  done();
};
