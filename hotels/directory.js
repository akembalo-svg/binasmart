'use strict';
// Every place to stay in Addis Ababa, from the city map, and the way an owner claims theirs.
//
//   GET  /api/hotels/directory               all of them (hotels, guest houses, hostels, motels, apartments)
//   GET  /hotels/:slug                        one place: what the map knows, and "is this your hotel?"
//   POST /api/hotels/claim                    an owner's claim - stored; a person decides
//   GET  /ops/hotel-claims/:id/:action?t=…    approve | reject, one tap from the Telegram message
//
// Source: /root/storage/osm-addis-latest.json (ops/places/refresh.sh, monthly) - the file ride/gazetteer.js
// and the places knowledge already read, so the directory, the ride search and Bini name the same places.
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

function buildDirectory(osm) {
  const els = (osm && osm.elements) || [], bySub = (osm && osm.bySub) || {};
  const out = [];
  for (const e of els) {
    const t = e.tags || {}, kind = t.tourism;
    if (!KINDS[kind] || !(t.name || t['name:en'] || t['name:am'])) continue;
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    // Many Addis entries carry the Amharic name as "name" and the English one as "name:en": list them by the
    // English name, with the Amharic under it, so "Semien Hotel" is found by the name a visitor types.
    const ethiopic = /[ሀ-፿]/.test(t.name || '') && !/[a-z]/i.test(t.name || '');
    const name = String((ethiopic && t['name:en']) || t.name || t['name:en'] || t['name:am']).trim();
    const nameAm = String(t['name:am'] || (ethiopic ? t.name : '') || '').trim();
    const stars = parseInt(t.stars, 10);
    const sub = bySub[e.type + e.id] || '';
    out.push({ ref: e.type + '/' + e.id, slug: slugOf({ ...e, tags: { ...t, name } }), name, nameAm: nameAm && nameAm !== name ? nameAm : '',
      kind, sub, subAm: SUB_AM[sub] || '', lat: +lat.toFixed(6), lng: +lng.toFixed(6), stars: stars >= 1 && stars <= 5 ? stars : null,
      phones: landlines(t.phone || t['contact:phone']), website: website(t), street: t['addr:street'] || '', rich: Object.keys(t).length });
  }
  // The same place is often mapped twice (a node and a building): one name within 300 m is one listing.
  out.sort((a, b) => b.rich - a.rich);
  const kept = [];
  for (const p of out) {
    if (kept.some(k => k.name.toLowerCase() === p.name.toLowerCase() && Math.hypot((k.lat - p.lat) * 111, (k.lng - p.lng) * 109.5) < 0.3)) continue;
    kept.push(p);
  }
  kept.forEach(p => delete p.rich);
  return kept.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name));
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

async function tellOwner(text) {
  const tok = process.env.BINASMART_TG_TOKEN, chat = process.env.BINA_OWNER_TG_CHAT || process.env.BINASMART_ADMIN_TG_CHAT;
  if (!tok || !chat) return false;
  try {
    const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
    return (await r.json()).ok === true;
  } catch (e) { return false; }
}

function page(p, claimed) {
  const k = KINDS[p.kind];
  const map = 'https://www.openstreetmap.org/' + p.ref + '#map=18/' + p.lat + '/' + p.lng;
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
<p class="src">From the city map (© OpenStreetMap contributors, ODbL). This is where the place is and what the map says about it, not an official licence register, and BinaSmart cannot book it yet. Call before you go.</p>
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
    if (st.mtimeMs === cache.mtime) return cache;
    try {
      const list = buildDirectory(JSON.parse(fs.readFileSync(FILE, 'utf8')));
      cache = { mtime: st.mtimeMs, list, bySlug: new Map(list.map(p => [p.slug, p])), byRef: new Map(list.map(p => [p.ref, p])) };
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
        stars: p.stars, phone: p.phones.length > 0, website: !!p.website, claimed: ok.has(p.ref) })) };
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
    const p = load().byRef.get(String(b.ref || ''));
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
    await tellOwner('🏨 <b>Hotel claim</b> · ' + esc(p.name) + ' (' + esc(KINDS[p.kind].en) + (p.sub ? ', ' + esc(p.sub) : '') + ')\n'
      + '👤 ' + esc(name) + ' — ' + role + '\n📞 ' + esc(digits) + (p.phones.length ? '\n☎ map says: ' + esc(p.phones.join(', ')) : '') + (note ? '\n📝 ' + esc(note) : '')
      + '\n\nCall before approving.\n<a href="https://bina.et/hotels/' + p.slug + '">listing</a> · <a href="' + base + 'approve?t=' + c.token + '">✅ approve</a> · <a href="' + base + 'reject?t=' + c.token + '">❌ reject</a>');
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
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + (action === 'approve' ? '✅ Approved' : '❌ Rejected') + ': ' + esc(c.placeName) + ' — ' + esc(c.name) + '. <a href="/hotels/' + esc(c.slug) + '">listing</a></p>');
  });
  done();
};
module.exports.buildDirectory = buildDirectory;
module.exports.landlines = landlines;
