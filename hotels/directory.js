'use strict';
// Every place to stay in Addis Ababa, from the city map, and the way an owner claims theirs.
//
//   GET  /api/hotels/directory               all of them (hotels, guest houses, hostels, motels, apartments)
//   GET  /hotels/:slug                        one place: what the map knows, and "is this your hotel?"
//   POST /api/hotels/claim                    an owner's claim - stored; a person decides. ref "new" = a hotel that is
//                                             not in the list (the map does not draw every one); it is added by hand
//   GET  /ops/hotel-claims/:id/:action?t=…    approve | reject, one tap from the Telegram message
//
// Source: /root/storage/osm-addis-latest.json (ops/places/refresh.sh, monthly) - the file ride/gazetteer.js
// and the places knowledge already read, so the directory, the ride search and Bini name the same places -
// plus Wikidata's Addis hotels (/root/storage/wikidata-addis-hotels.json, ops/places/wikidata-hotels.js).
//
// What a listing will not show:
//   · A mobile number. On the map a hotel's number is often the owner's own phone, typed in by a stranger.
//     Landlines (011…) are the hotel's; a mobile appears only after the owner claims the listing and says so.
//   · "Book". Only hotels that list rooms on BinaSmart (/hotel/<slug>) can be booked; a map entry is a map entry.
// A claim is not ownership. Anyone can type "I am the manager of the Hilton"; a person calls the number
// before anything changes, which is why approval is a tap by the owner of BinaSmart and nothing more.
const fs = require('fs');
const crypto = require('crypto');

const FILE = process.env.BINA_OSM_ADDIS || '/root/storage/osm-addis-latest.json';
const WD_FILE = process.env.BINA_WD_HOTELS || '/root/storage/wikidata-addis-hotels.json';
// Listings a hotel asked us to take down ("reply remove"): a JSON array of refs, e.g. ["node/123"]. Edited by hand.
const HIDDEN_FILE = process.env.BINA_HOTELS_HIDDEN || '/root/storage/hotel-outreach/hidden.json';
const KINDS = {
  hotel: { en: 'Hotel', am: 'ሆቴል' },
  guest_house: { en: 'Guest house', am: 'የእንግዳ ማረፊያ' },
  hostel: { en: 'Hostel', am: 'ሆስቴል' },
  motel: { en: 'Motel', am: 'ሞቴል' },
  apartment: { en: 'Apartment', am: 'አፓርትመንት' },
};
const SUB_AM = { 'Addis Ketema': 'አዲስ ከተማ', 'Akaki Kality': 'አቃቂ ቃሊቲ', Arada: 'አራዳ', Bole: 'ቦሌ', Gulele: 'ጉለሌ',
  Kirkos: 'ቂርቆስ', 'Kolfe Keranio': 'ኮልፌ ቀራኒዮ', Lideta: 'ልደታ', 'Nifas Silk-Lafto': 'ንፋስ ስልክ ላፍቶ', Yeka: 'የካ', 'Lemi Kura': 'ለሚ ኩራ' };
const MOBILE = /^(?:\+?251|0)?[79]\d{8}$/;

// "+251116292329/30, 0911…" -> the landline parts only, as written.
function landlines(raw) {
  return String(raw || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
    .filter(s => { const d = s.split('/')[0].replace(/[^\d+]/g, ''); return d.replace(/\D/g, '').length >= 9 && !MOBILE.test(d); });
}
const kebab = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const slugOf = e => (kebab(e.tags.name) || 'place') + '-' + e.type[0] + e.id;
const website = t => { const w = String(t.website || t['contact:website'] || t.url || '').trim().split(/[;\s]/)[0];
  return !w ? null : /^https?:\/\//i.test(w) ? w : /^[\w.-]+\.[a-z]{2,}/i.test(w) ? 'https://' + w : null; };

// A place the map does not tag as lodging, but whose name says it is one: "Besha Hotel" drawn as a building,
// "TM Pension" drawn as a restaurant. In Addis "ሆቴል" is also the word for an eatery ("… Kitfo and Hotel"), so
// a restaurant, bar or café counts only when its name says pension, guest house, lodge, inn or apartment - never
// on "hotel" alone. These listings say so on their page: call to check it takes guests.
const LODGE_WORD = /\b(hotels?|pension|guest ?house|lodge|inn|resort|hostel|motel|apartments?|suites)\b|ሆቴል|ፔንሲዮን|ፔኒሲዮን|ፔንስዮን|እንግዳ ማረፊያ|መኝታ ቤት|አፓርታማ|አፓርትመንት|ሪዞርት|ሎጅ/i;
const STAY_WORD = /\b(pension|guest ?house|lodge|inn|hostel|motel|apartments?)\b|ፔንሲዮን|ፔኒሲዮን|ፔንስዮን|እንግዳ ማረፊያ|መኝታ ቤት|አፓርታማ|አፓርትመንት|ሎጅ/i;
const NOT_STAY = /institute|college|collage|school|training|academy|embassy|residence|bowling|mall|\bbus\b|\bstop\b|terminal|lobby|lounge|homeowners|real ?estate|association|university|bank/i;
const EATERY = new Set(['restaurant', 'bar', 'cafe', 'fast_food', 'pub', 'hospital', 'clinic']);
const NOT_A_PLACE = ['public_transport', 'highway', 'railway', 'shop', 'healthcare'];
const GENERIC = new Set(['hotel', 'hotels', 'pension', 'guest', 'house', 'guesthouse', 'lodge', 'inn', 'resort', 'hostel', 'motel', 'apartment', 'apartments', 'suites',
  'addis', 'ababa', 'international', 'the', 'and', 'spa', 'by', 'plc', 'complex']);
const nameKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(w => w && !GENERIC.has(w)).join(' ');
const kindFromName = n => /apartment|suites|አፓርት|አፓርታማ/i.test(n) ? 'apartment' : /pension|guest ?house|ፔን|ፔኒ|እንግዳ ማረፊያ|መኝታ/i.test(n) ? 'guest_house'
  : /hostel/i.test(n) ? 'hostel' : /motel/i.test(n) ? 'motel' : 'hotel';
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 109.5);

// wikidata: [{ qid, name, nameAm, lat, lng }] from ops/places/wikidata-hotels.js (CC0) - hotels the map draws
// only as a bus stop or a building get their own listing at Wikidata's point.
function buildDirectory(osm, wikidata) {
  const els = (osm && osm.elements) || [], bySub = (osm && osm.bySub) || {};
  const out = [], extra = [];
  for (const e of els) {
    const t = e.tags || {};
    if (!(t.name || t['name:en'] || t['name:am'])) continue;
    let kind = t.tourism, unsure = false;
    // Many Addis entries carry the Amharic name as "name" and the English one as "name:en": list them by the
    // English name, with the Amharic under it, so "Semien Hotel" is found by the name a visitor types.
    const ethiopic = /[ሀ-፿]/.test(t.name || '') && !/[a-z]/i.test(t.name || '');
    const name = String((ethiopic && t['name:en']) || t.name || t['name:en'] || t['name:am']).trim();
    if (!KINDS[kind]) {
      const all = [t.name, t['name:en'], t['name:am']].filter(Boolean).join(' ');
      // ("ማረፊያ" alone is also the airport - አውሮፕላን ማረፊያ - so only "እንግዳ ማረፊያ" counts.) Any amenity other than an
      // eatery is a different business that borrowed a hotel's name: "Merab hotel" the bank, "111396 National Hotel" the internet café.
      if (!LODGE_WORD.test(all) || NOT_STAY.test(all) || NOT_A_PLACE.some(k => k in t) || t.tourism || t.office || (t.amenity && !EATERY.has(t.amenity))) continue;
      if (EATERY.has(t.amenity) && !STAY_WORD.test(all)) continue;
      if (!nameKey(name) && !/[ሀ-፿]/.test(name)) continue;          // just "Guest house"
      kind = kindFromName(all); unsure = true;
    }
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    const nameAm = String(t['name:am'] || (ethiopic ? t.name : '') || '').trim();
    const stars = parseInt(t.stars, 10);
    const sub = bySub[e.type + e.id] || '';
    (unsure ? extra : out).push({ ref: e.type + '/' + e.id, slug: slugOf({ ...e, tags: { ...t, name } }), name, nameAm: nameAm && nameAm !== name ? nameAm : '',
      kind, sub, subAm: SUB_AM[sub] || '', lat: +lat.toFixed(6), lng: +lng.toFixed(6), stars: stars >= 1 && stars <= 5 ? stars : null,
      phones: landlines(t.phone || t['contact:phone']), website: website(t), street: t['addr:street'] || '', unsure, rich: Object.keys(t).length });
  }
  // The same place is often mapped twice (a node and a building): one name within 300 m is one listing.
  out.sort((a, b) => b.rich - a.rich);
  const kept = [];
  for (const p of out) {
    if (kept.some(k => k.name.toLowerCase() === p.name.toLowerCase() && km(k, p) < 0.3)) continue;
    kept.push(p);
  }
  // An extra is dropped when a listing within 300 m already carries its name ("Ghion Hotel ግዮን ሆቴል" beside "Ghion Hotel").
  // Wikidata's "Jupiter International Hotel - Cazanchis" is the map's "Jupiter International Hotel (Kazanchis)": at the
  // same spot (250 m), the same first word is enough.
  const same = (a, b) => { const x = nameKey(a.name), y = nameKey(b.name);
    return (x && y && (x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)))
      || (km(a, b) < 0.25 && x.split(' ')[0].length > 2 && x.split(' ')[0] === y.split(' ')[0])
      || (km(a, b) < 0.1 && x.length > 3 && x.slice(0, 4) === y.slice(0, 4)))) || a.name.toLowerCase() === b.name.toLowerCase(); };   // "Elily" / "Elilly", 40 m apart
  for (const p of extra.sort((a, b) => b.rich - a.rich)) if (!kept.some(k => km(k, p) < 0.3 && same(k, p))) kept.push(p);
  // Wikidata's hotels, where nothing on the map within 1.5 km has the name. Sub-city from the nearest mapped place.
  const located = els.filter(e => bySub[e.type + e.id] && (e.lat != null || e.center));
  for (const w of wikidata || []) {
    if (!w || !w.name || w.lat == null || w.lng == null) continue;
    if (kept.some(k => km(k, w) < 1.5 && same(k, w))) continue;
    let near = null, best = 0.8;
    for (const e of located) { const d = km({ lat: e.lat != null ? e.lat : e.center.lat, lng: e.lon != null ? e.lon : e.center.lon }, w); if (d < best) { best = d; near = e; } }
    const sub = near ? bySub[near.type + near.id] : '';
    kept.push({ ref: 'wikidata/' + w.qid, slug: (kebab(w.name) || 'hotel') + '-' + String(w.qid).toLowerCase(), name: w.name, nameAm: w.nameAm && w.nameAm !== w.name ? w.nameAm : '',
      kind: kindFromName(w.name), sub, subAm: SUB_AM[sub] || '', lat: +(+w.lat).toFixed(6), lng: +(+w.lng).toFixed(6), stars: null, phones: [], website: null, street: '', unsure: false });
  }
  kept.forEach(p => delete p.rich);
  return kept.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name));
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Sent by @bina_smart_bot (BINA_RIDER_BOT_TOKEN) to the admin chats. Not BINASMART_TG_TOKEN: that is the old
// @gccandconectbot, which the owner never started - getChat on 26 Sep 2026 said "chat not found" for both chats,
// so every claim would have vanished. The sending bot and the chat must belong together.
async function tellOwner(text) {
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

function page(p, claimed) {
  const k = KINDS[p.kind];
  const wd = p.ref.startsWith('wikidata/');
  const map = wd ? 'https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=18/' + p.lat + '/' + p.lng
    : 'https://www.openstreetmap.org/' + p.ref + '#map=18/' + p.lat + '/' + p.lng;
  const facts = [
    '<li><span>Type · ዓይነት</span><b>' + esc(k.en) + ' · <span class="am">' + k.am + '</span></b></li>',
    p.sub ? '<li><span>Sub-city · ክፍለ ከተማ</span><b>' + esc(p.sub) + (p.subAm ? ' · <span class="am">' + p.subAm + '</span>' : '') + '</b></li>' : '',
    p.street ? '<li><span>Street · መንገድ</span><b>' + esc(p.street) + '</b></li>' : '',
    p.stars ? '<li><span>Stars · ኮከብ</span><b>' + '★'.repeat(p.stars) + '</b></li>' : '',
    p.phones.length ? '<li><span>Phone · ስልክ</span><b>' + p.phones.map(esc).join('<br>') + '</b></li>' : '',
    p.website ? '<li><span>Website · ድረ ገጽ</span><b><a href="' + esc(p.website) + '" rel="nofollow noopener" target="_blank">' + esc(p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a></b></li>' : '',
  ].join('');
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(p.name)} · ${esc(k.en)} in ${esc(p.sub || 'Addis Ababa')} · BinaSmart</title>
<meta name="description" content="${esc(p.name)} (${esc(k.en.toLowerCase())}${p.sub ? ', ' + esc(p.sub) + ' sub-city' : ''}, Addis Ababa): location and contact details from the city map. Hotel owner? Claim this listing free on BinaSmart.">
<meta name="robots" content="noindex, follow"><link rel="canonical" href="https://bina.et/hotels/${esc(p.slug)}">
<link rel="icon" href="/icon-32.png"><link rel="stylesheet" href="/static/fonts/fonts.css?v=2">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#F8FAFC;--ink:#081120;--mut:#64748B;--em:#7c70e8;--em2:#5146b7;--line:rgba(8,17,32,.08);--ok:#047857}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;padding:0 16px 60px}
.am{font-family:'Noto Sans Ethiopic','Plus Jakarta Sans',system-ui,sans-serif}
a{color:var(--em2);text-decoration:none}
.w{max-width:720px;margin:0 auto}
.top{display:flex;align-items:center;gap:10px;padding:16px 0;font-weight:800}
.top a{font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:20px;margin-top:12px}
.kind{display:inline-flex;gap:6px;font-size:11.5px;font-weight:800;color:var(--em2);background:rgba(124,112,232,.1);padding:5px 10px;border-radius:999px}
h1{font-size:30px;line-height:1.15;font-weight:900;letter-spacing:-.4px;margin-top:10px;text-wrap:balance}
.amn{font-size:18px;font-weight:700;color:var(--em2);margin-top:4px}
.ok{display:inline-block;margin-top:10px;font-size:12px;font-weight:800;color:var(--ok);background:rgba(4,120,87,.1);padding:5px 10px;border-radius:999px}
ul{list-style:none;margin-top:14px;display:grid;gap:8px}
li{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-top:1px solid var(--line);font-size:14px}
li span{color:var(--mut);font-weight:600}li b{text-align:right;font-weight:700;overflow-wrap:anywhere}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.btn{display:inline-flex;align-items:center;height:42px;padding:0 16px;border-radius:13px;border:1px solid var(--line);background:#fff;font-weight:800;font-size:13px;color:var(--ink)}
.btn.pri{background:linear-gradient(135deg,var(--em),var(--em2));color:#fff;border:0}
h2{font-size:21px;font-weight:900;letter-spacing:-.2px}
.claim p{font-size:14px;line-height:1.6;color:#334155;margin-top:6px}
form{display:grid;gap:10px;margin-top:14px}
label{display:grid;gap:4px;font-size:12px;font-weight:700;color:var(--mut)}
input,select,textarea{font:inherit;font-size:15px;color:var(--ink);padding:12px;border-radius:12px;border:1px solid rgba(8,17,32,.15);background:#fff;width:100%}
button{height:48px;border:0;border-radius:14px;background:linear-gradient(135deg,var(--em),var(--em2));color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer}
#msg{font-size:14px;font-weight:700}
.src{font-size:12px;color:var(--mut);margin-top:14px;line-height:1.5}
</style></head><body><div class="w">
<div class="top"><a href="/hotels#all">← <span class="am">ሁሉም ማረፊያዎች</span> · All places to stay</a></div>
<div class="card">
<span class="kind"><span class="am">${k.am}</span> · ${esc(k.en)}</span>
<h1>${esc(p.name)}</h1>${p.nameAm ? '<div class="amn am">' + esc(p.nameAm) + '</div>' : ''}
${claimed ? '<span class="ok">✓ Owner confirmed · <span class="am">ባለቤቱ አረጋግጧል</span></span>' : ''}
<ul>${facts}</ul>
<div class="acts"><a class="btn pri" href="${esc(map)}" target="_blank" rel="noopener">📍 Map · <span class="am">ካርታ</span></a><a class="btn" href="/ride">🚕 Ride there · <span class="am">ይሂዱ</span></a><a class="btn" href="/airport">✈️ From Bole airport</a></div>
${p.unsure ? '<p class="src"><b>The map marks this place as a building or a restaurant, not as somewhere to stay.</b> Its name says it is one; call to check it takes guests.</p>' : ''}
<p class="src">${wd ? 'From Wikidata (CC0), <a href="https://www.wikidata.org/wiki/' + esc(p.ref.slice(9)) + '" rel="nofollow noopener" target="_blank">' + esc(p.ref.slice(9)) + '</a>' : 'From the city map (© OpenStreetMap contributors, ODbL)'}. This is where the place is and what the source says about it, not an official licence register, and BinaSmart cannot book it yet. Call before you go.</p>
</div>
<div class="card claim" id="claim">
<h2 class="am">${claimed ? 'ይህ የእርስዎ ሆቴል ነው?' : 'ይህ የእርስዎ ሆቴል ነው? በነጻ ይረከቡት'}</h2>
<p><b>Is this your ${esc(k.en.toLowerCase())}?</b> Claim this listing free. We call you to confirm, then you can fix the details, add photos and rooms, and take bookings direct with 0% commission.</p>
<p class="am">ስምዎንና ስልክዎን ይተዉ፤ ደውለን እናረጋግጣለን። ከዚያ ፎቶ፣ ክፍሎችና ዋጋ ጨምረው እንግዶች በቀጥታ እንዲያስይዙ ያደርጋሉ፤ ኮሚሽን የለም።</p>
<form id="f"><input type="hidden" name="ref" value="${esc(p.ref)}">
<label>Your name · <span class="am">ስምዎ</span><input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
<label>Your role · <span class="am">ኃላፊነትዎ</span><select name="role"><option value="owner">Owner · ባለቤት</option><option value="manager">Manager · ሥራ አስኪያጅ</option><option value="staff">Staff · ሠራተኛ</option></select></label>
<label>Phone · <span class="am">ስልክ</span><input name="phone" required inputmode="tel" autocomplete="tel" placeholder="09… / +251…"></label>
<label>Anything we should know? (optional) · <span class="am">ማስታወሻ</span><textarea name="note" rows="3" maxlength="500"></textarea></label>
<button type="submit"><span class="am">ይረከቡ</span> · Claim this listing</button><div id="msg" role="status"></div></form>
</div></div>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, m = document.getElementById('msg'), b = f.querySelector('button');
  b.disabled = true; m.textContent = '…';
  try {
    const r = await fetch('/api/hotels/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
    const d = await r.json();
    if (d.ok) { f.innerHTML = '<p style="font-weight:800;color:#047857">✓ ተቀብለናል · Received. We will call you on the number you gave to confirm.</p>'; return; }
    m.textContent = ({ phone: 'Please check the phone number · ስልኩን ያረጋግጡ', name: 'Please write your name · ስምዎን ይጻፉ', slow_down: 'Too many tries, please wait an hour.' })[d.error] || 'Could not send. Please try again.';
  } catch (x) { m.textContent = 'Could not send. Please try again.'; }
  b.disabled = false;
});
</script><script src="/static/bina-footer.js?v=9" defer></script></body></html>`;
}

module.exports = function hotelDirectory(fastify, { prisma, limiter }, done) {
  let cache = { mtime: 0, list: [], bySlug: new Map(), byRef: new Map() };
  function load() {
    let st; try { st = fs.statSync(FILE); } catch (e) { return cache; }
    let wdm = 0; try { wdm = fs.statSync(WD_FILE).mtimeMs; } catch (e) { /* optional */ }
    try { wdm += fs.statSync(HIDDEN_FILE).mtimeMs; } catch (e) { /* optional */ }
    if (st.mtimeMs + wdm === cache.mtime) return cache;
    try {
      let wd = []; try { wd = JSON.parse(fs.readFileSync(WD_FILE, 'utf8')).hotels || []; } catch (e) { /* optional */ }
      let hidden = []; try { hidden = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8')); } catch (e) { /* optional */ }
      const list = buildDirectory(JSON.parse(fs.readFileSync(FILE, 'utf8')), wd).filter(p => !hidden.includes(p.ref));
      cache = { mtime: st.mtimeMs + wdm, list, bySlug: new Map(list.map(p => [p.slug, p])), byRef: new Map(list.map(p => [p.ref, p])) };
    } catch (e) { fastify.log.error('hotel directory: ' + e.message); }
    return cache;
  }
  let claimed = { at: 0, set: new Set() };
  async function approved() {
    if (Date.now() - claimed.at < 60000) return claimed.set;
    const rows = await prisma.hotelClaim.findMany({ where: { status: 'approved' }, select: { placeRef: true } }).catch(() => []);
    claimed = { at: Date.now(), set: new Set(rows.map(r => r.placeRef)) };
    return claimed.set;
  }

  fastify.get('/api/hotels/directory', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=600');
    const { list } = load(), ok = await approved();
    return { count: list.length, source: 'OpenStreetMap contributors (ODbL)', kinds: KINDS,
      places: list.map(p => ({ slug: p.slug, name: p.name, nameAm: p.nameAm, kind: p.kind, sub: p.sub, subAm: p.subAm,
        stars: p.stars, phone: p.phones.length > 0, website: !!p.website, unsure: p.unsure || undefined, claimed: ok.has(p.ref) })) };
  });

  fastify.get('/hotels/:slug', async (req, reply) => {
    const p = load().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).type('text/html').send('<!DOCTYPE html><meta name="robots" content="noindex"><p style="font-family:system-ui;padding:60px;text-align:center">Not found. <a href="/hotels#all">All places to stay in Addis →</a></p>');
    reply.header('X-Robots-Tag', 'noindex, follow');
    return reply.type('text/html; charset=utf-8').send(page(p, (await approved()).has(p.ref)));
  });

  const ipRL = limiter(3600000, 5);
  fastify.post('/api/hotels/claim', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    if (!ipRL(String(req.headers['x-real-ip'] || req.ip || ''))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const isNew = b.ref === 'new', hotel = clean(b.hotel, 120), area = clean(b.area, 80);
    if (isNew && hotel.length < 2) return reply.code(400).send({ ok: false, error: 'hotel' });
    const p = isNew ? { ref: 'new:' + (kebab(hotel) || 'hotel'), name: hotel, slug: '', kind: kindFromName(hotel), sub: area, phones: [] } : load().byRef.get(String(b.ref || ''));
    if (!p) return reply.code(404).send({ ok: false, error: 'place' });
    const name = clean(b.name, 80), role = ['owner', 'manager', 'staff'].includes(b.role) ? b.role : 'owner', note = clean(b.note, 500);
    const digits = String(b.phone || '').replace(/[^\d+]/g, '');
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name' });
    if (!/^\+?\d{9,15}$/.test(digits)) return reply.code(400).send({ ok: false, error: 'phone' });
    const dup = await prisma.hotelClaim.findFirst({ where: { placeRef: p.ref, phone: digits, status: 'pending' } });
    if (dup) return { ok: true };
    const c = await prisma.hotelClaim.create({ data: { placeRef: p.ref, placeName: p.name, slug: p.slug, name, role, phone: digits, note: note || null,
      token: crypto.randomBytes(16).toString('hex') } });
    const base = 'https://bina.et/ops/hotel-claims/' + c.id + '/';
    await tellOwner((isNew ? '🆕 <b>Hotel NOT in the list</b> (add it by hand after the call) · ' : '🏨 <b>Hotel claim</b> · ') + esc(p.name) + ' (' + esc(KINDS[p.kind].en) + (p.sub ? ', ' + esc(p.sub) : '') + ')\n'
      + '👤 ' + esc(name) + ' — ' + role + '\n📞 ' + esc(digits) + (p.phones.length ? '\n☎ map says: ' + esc(p.phones.join(', ')) : '') + (note ? '\n📝 ' + esc(note) : '')
      + '\n\nCall before approving.\n' + (isNew ? '' : '<a href="https://bina.et/hotels/' + p.slug + '">listing</a> · ') + '<a href="' + base + 'approve?t=' + c.token + '">✅ approve</a> · <a href="' + base + 'reject?t=' + c.token + '">❌ reject</a>');
    return { ok: true };
  });

  fastify.get('/ops/hotel-claims/:id/:action', async (req, reply) => {
    const c = await prisma.hotelClaim.findUnique({ where: { id: String(req.params.id) } });
    const t = Buffer.from(String(req.query.t || '')), want = Buffer.from(c ? c.token : '');
    if (!c || t.length !== want.length || !crypto.timingSafeEqual(t, want)) return reply.code(404).send('not found');
    const action = req.params.action;
    if (!['approve', 'reject'].includes(action)) return reply.code(400).send('approve or reject');
    await prisma.hotelClaim.update({ where: { id: c.id }, data: { status: action === 'approve' ? 'approved' : 'rejected', decidedAt: new Date() } });
    claimed.at = 0;
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + (action === 'approve' ? '✅ Approved' : '❌ Rejected') + ': ' + esc(c.placeName) + ' — ' + esc(c.name) + '. ' + (c.slug ? '<a href="/hotels/' + esc(c.slug) + '">listing</a>' : 'Not on the map yet: add it by hand.') + '</p>');
  });
  done();
};
module.exports.buildDirectory = buildDirectory;
module.exports.landlines = landlines;
