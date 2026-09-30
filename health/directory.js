'use strict';
// BinaSmart Health (30 Sep 2026, Ibrahim: "company and under company or individual post doctors profile, all kind from
// big hospital to clinic dentist all … they can add service … AI Afiya not Bini … colour own").
//   GET  /health                   the directory: hospitals, clinics, dentists, doctors' clinics, labs + doctors
//   GET  /health/:slug             one facility: services, its doctors, landline, map
//   GET  /doctors/:slug            one doctor: profession, specialty, where they work, services, hours
//   GET  /api/health/directory     the same list as JSON (the page's filters, Afiya, the MCP server)
//   POST /api/health/submit        Afiya's sign-up form: a doctor profile, or a facility's services/claim. Public,
//                                  rate-limited; NOTHING is shown until a person on the team has called and approved.
//   GET  /ops/health/:id/:action?t=  one tap from Telegram: approve | reject | photo?n=
// Facilities start from the city map (OpenStreetMap, ODbL) like the hotel directory; only landlines are shown from it.
// A doctor must give a professional licence number and who issued it; the team checks it before approving. The number
// is kept for the team and never shown. A doctor's own phone is shown only when they said so.
// Stored in /root/storage/health/entries.json (a few a day, one process writes).

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const OSM = process.env.HEALTH_OSM_FILE || '/root/storage/osm-addis-latest.json';
const STORE = process.env.HEALTH_FILE || '/root/storage/health/entries.json';
const PEND = path.join(ROOT, 'uploads', 'listing-photos');
const PUB = path.join(ROOT, 'public', 'health', 'img');

const KINDS = { hospital: ['🏥', 'Hospital', 'ሆስፒታል', 'Hospital'], clinic: ['🩺', 'Clinic', 'ክሊኒክ', 'MedicalClinic'],
  dentist: ['🦷', 'Dental clinic', 'የጥርስ ክሊኒክ', 'Dentist'], doctors: ['👩🏾‍⚕️', "Doctor's clinic", 'የሐኪም ክሊኒክ', 'MedicalClinic'],
  lab: ['🔬', 'Laboratory', 'ላቦራቶሪ', 'DiagnosticLab'] };
const PROS = { gp: ['General practitioner', 'ጠቅላላ ሐኪም'], specialist: ['Specialist doctor', 'ስፔሻሊስት ሐኪም'], dentist: ['Dentist', 'የጥርስ ሐኪም'],
  nurse: ['Nurse', 'ነርስ'], midwife: ['Midwife', 'አዋላጅ'], pharmacist: ['Pharmacist', 'ፋርማሲስት'], physio: ['Physiotherapist', 'ፊዚዮቴራፒስት'],
  psych: ['Psychologist', 'ሳይኮሎጂስት'], optometrist: ['Optometrist', 'የዓይን ባለሙያ'], lab: ['Lab professional', 'የላብራቶሪ ባለሙያ'], other: ['Health professional', 'የጤና ባለሙያ'] };
const SUB_AM = { 'Addis Ketema': 'አዲስ ከተማ', 'Akaki Kality': 'አቃቂ ቃሊቲ', Arada: 'አራዳ', Bole: 'ቦሌ', Gulele: 'ጉለሌ', Kirkos: 'ቂርቆስ',
  'Kolfe Keranio': 'ኮልፌ ቀራኒዮ', Lideta: 'ልደታ', 'Nifas Silk-Lafto': 'ንፋስ ስልክ ላፍቶ', Yeka: 'የካ', 'Lemi Kura': 'ለሚ ኩራ' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const kebab = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 109.5);
const tokEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
const uidOk = u => /^[A-Za-z0-9_-]{6,64}$/.test(String(u || ''));
function ethPhone(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^0[79]\d{8}$/.test(d)) d = '+251' + d.slice(1); else if (/^[79]\d{8}$/.test(d)) d = '+251' + d;
  else if (/^251\d{9}$/.test(d)) d = '+' + d; else if (/^0(11|2\d|3\d|4\d|5\d)\d{7}$/.test(d)) d = '+251' + d.slice(1);
  return /^\+251\d{9}$/.test(d) ? d : '';
}
// the map's numbers: landlines only (a mobile in a map tag is somebody's private phone)
const MOBILE_ANY = /(?:\+?251[\s-]?|\b0)[79](?:[\s-]?\d){8}/;
const landlines = raw => String(raw || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
  .filter(s => s.replace(/\D/g, '').length >= 9 && !MOBILE_ANY.test(s) && !/^(?:\+?251|0)?[79]\d{8}$/.test(s.replace(/[^\d+]/g, '')));
const list = s => String(s == null ? '' : Array.isArray(s) ? s.join(',') : s).split(/[,;\n·]+/).map(x => clean(x, 60)).filter(x => x.length > 1).slice(0, 24);

// ---- facilities from the city map ----
const NOT_HEALTH = /\b(hotel|resort|lodge|guest ?house|church|mosque|school|college|university|bank|garment|restaurant|cafe|bar|office)\b/i;
const HEALTH_WORD = /\b(clinic|hospital|dental|dentist|health|medical|medicine|laborator\w*|laburator\w*|pharmacy|diagnostic\w*|maternity|surgery|surgical|eye|care)\b/i;
// The name decides the kind when it says exactly one ("Zoya clinic" was tagged hospital); "dental" always means a dentist.
function kindFromName(s) {
  const n = String(s || '').toLowerCase();
  if (/\b(dental|dentist)\b|ጥርስ/.test(n)) return 'dentist';
  const hosp = /\bhospital\b|ሆስፒታል/.test(n), clin = /\bclinic\b|ክሊኒክ|ክሊንክ|\bhealth cent(er|re)\b|ጤና ጣቢያ/.test(n), lab = /\b(laborator|laburator)\w*|ላቦራቶሪ|ላቡራቶሪ|\bdiagnostic/.test(n);
  if (lab && !hosp && !clin) return 'lab';
  if (hosp && !clin) return 'hospital';
  if (clin && !hosp) return 'clinic';
  return null;
}
const phoneKey = t => { const d = String(t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || '').split(/[;,/]/)[0].replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
function buildFacilities(osm) {
  const els = (osm && osm.elements) || [], bySub = (osm && osm.bySub) || {}, out = [];
  for (const e of els) {
    const t = e.tags || {}, a = t.amenity, h = t.healthcare;
    let kind = a === 'hospital' || h === 'hospital' ? 'hospital' : a === 'dentist' || h === 'dentist' ? 'dentist' : a === 'doctors' || h === 'doctor' ? 'doctors'
      : a === 'clinic' || h === 'clinic' || h === 'centre' ? 'clinic' : h === 'laboratory' ? 'lab' : null;
    if (!kind) continue;
    const ethiopic = /[ሀ-፿]/.test(t.name || '') && !/[a-z]/i.test(t.name || '');
    let name = clean((ethiopic && t['name:en']) || t.name || t['name:en'] || t['name:am'], 90), mixedAm = '';
    // one tag holding both scripts ("Bethezata Hospital ቤተዛታ ሆስፒታል"): English as the name, the Amharic as its subtitle
    if (/[\u1200-\u137F]/.test(name) && /[a-z]{3}/i.test(name)) {
      const am = (name.match(/[\u1200-\u137F][\u1200-\u137F\s.\/()-]*/g) || []).join(' ').replace(/\s+/g, ' ').trim();
      const en = clean(name.replace(/[\u1200-\u137F]+/g, ' ').replace(/^[\s.\/()-]+|[\s.\/(-]+$/g, ''), 90);
      if (en.length >= 3) { name = en; mixedAm = am; }
    }
    if (!name) continue;
    name = name.split(/\s*;\s*/)[0].replace(/[\s|,;:\/-]+$/, '');
    // Map tags are sometimes wrong (a resort tagged hospital, a church tagged dentist; found 30 Sep 2026 reading the first
    // call list). A place whose name says it is something else, and says nothing about health, is not listed as care.
    if (!name || (NOT_HEALTH.test(name) && !HEALTH_WORD.test(name))) continue;
    kind = kindFromName(name + ' ' + (t.name || '') + ' ' + (t['name:am'] || '')) || kind;
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    let nameAm = clean(ethiopic ? t.name : t['name:am'] || mixedAm, 90);
    if (/[\u1200-\u137F]/.test(nameAm)) nameAm = nameAm.replace(/[A-Za-z][A-Za-z .'&-]*/g, ' ').replace(/\s+/g, ' ').trim();
    const sub = bySub[e.type + e.id] || '';
    const web = String(t.website || t['contact:website'] || '').trim().split(/[;\s]/)[0];
    out.push({ ref: e.type + '/' + e.id, slug: (kebab(name) || 'health') + '-' + e.type[0] + e.id, name, nameAm: nameAm && nameAm !== name ? nameAm : '', kind, sub, subAm: SUB_AM[sub] || '',
      lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), phones: landlines(t.phone || t['contact:phone']), website: /^https?:\/\//i.test(web) ? web : null,
      street: clean(t['addr:street'], 60), hours: clean(t.opening_hours, 80), emergency: t.emergency === 'yes', rich: Object.keys(t).length, _pk: phoneKey(t) });
  }
  out.sort((a, b) => b.rich - a.rich);
  const kept = [];
  // one place, one listing: the same name, or the same phone number (a misspelt second node), within 300 m
  for (const p of out) { if (kept.some(k => km(k, p) < 0.3 && (k.name.toLowerCase() === p.name.toLowerCase() || (p._pk && k._pk === p._pk)))) continue; delete p.rich; kept.push(p); }
  kept.forEach(p => { delete p._pk; });
  const order = { hospital: 0, clinic: 1, dentist: 2, doctors: 3, lab: 4 };
  return kept.sort((a, b) => order[a.kind] - order[b.kind] || (b.phones.length - a.phones.length) || a.name.localeCompare(b.name));
}

// A dashboard code: 8 letters without 0/O/1/I/L, read out on the phone. 40 bits, single use, 30 days, and the claim
// route allows 8 tries an hour, so guessing one is not a plan.
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => CODE_ABC[b % CODE_ABC.length]).join('');
const fmtCode = c => String(c || '').slice(0, 4) + '-' + String(c || '').slice(4);
function readStore() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return { entries: [] }; } }
function writeStore(s) { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE + '.part', JSON.stringify(s, null, 1)); fs.renameSync(STORE + '.part', STORE); }
function pendingPhotos(uid) { const dir = path.join(PEND, uid);
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.img')).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs); } catch (e) { return []; } }

async function tellTeam(text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN, chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].filter(Boolean);
  if (!tok || !chats.length) return false;
  let ok = false;
  for (const chat of [...new Set(chats)]) {
    try { const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) }); ok = (await r.json()).ok === true || ok; } catch (e) {}
  }
  return ok;
}

// ---- pages ----
const HEAD = (title, desc, canon, extra) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canon)}"><meta name="theme-color" content="#1D4ED8">
<meta property="og:type" content="website"><meta property="og:site_name" content="BinaSmart Health"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="https://bina.et/static/og-health.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon-32.png"><link rel="stylesheet" href="/static/fonts/fonts.css?v=2"><link rel="stylesheet" href="/static/health.css?v=2"><script>document.documentElement.classList.add('js')</script>${extra || ''}</head><body>`;
const EMBAR = '<div class="em"><div class="w"><span class="dot"></span><span class="tx">🚨 Emergency · ድንገተኛ? Call 907</span><a href="tel:907">📞 907</a></div></div>';
const TOP = '<header class="top"><div class="w"><a class="brand" href="/health"><i>+</i>BinaSmart <small>Health · ጤና</small></a><nav><a href="/health#all">Directory</a><a href="/afiya">Dr Afiya</a><a href="/health/dashboard">Dashboard</a></nav><a class="join" href="/health?join=doctor">Join free</a></div></header>';
const FOOT = '<footer class="foot w">BinaSmart Health · <span class="am">ቢናስማርት ጤና</span><br>Places from the city map (© OpenStreetMap contributors, ODbL); doctors and services from the facilities themselves, checked by our team.<br>Dr Afiya is a guide, not a doctor. Emergency: <a href="tel:907">907</a> · <a href="/">bina.et</a></footer>'
  + '<script src="/static/afiya-widget.js?v=1" data-context="health" defer></script><script src="/static/health.js?v=6" defer></script></body></html>';
const ld = o => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';
const kindChip = k => { const K = KINDS[k] || KINDS.clinic; return K[0] + ' ' + K[1] + ' · <span class="am">' + K[2] + '</span>'; };
const proLabel = p => { const P = PROS[p] || PROS.other; return P[0] + ' · <span class="am">' + P[1] + '</span>'; };

module.exports = function healthDirectory(fastify, { prisma, limiter, tell }, done) {
  const notify = tell || tellTeam;
  const PY = (script, args) => require('child_process').execFileSync('python3', [path.join(ROOT, 'ops', 'places', script)].concat(args), { timeout: 60000, stdio: 'pipe' }).toString().trim();
  const submitRL = limiter(3600000, 6);
  let cache = { mtime: -1, list: [], bySlug: new Map(), byRef: new Map() };
  function facilities() {
    try { const st = fs.statSync(OSM); if (st.mtimeMs !== cache.mtime) { const l = buildFacilities(JSON.parse(fs.readFileSync(OSM, 'utf8')));
      cache = { mtime: st.mtimeMs, list: l, bySlug: new Map(l.map(p => [p.slug, p])), byRef: new Map(l.map(p => [p.ref, p])) }; } } catch (e) { if (fastify.log) fastify.log.error('health directory: ' + e.message); }
    return cache;
  }
  const live = () => readStore().entries.filter(e => e.status === 'live');
  // one facility as every door sees it: map data + what the facility itself sent and the team approved
  function facilityOut(p, L) {
    const stamp = e => e.updatedAt || e.approvedAt || '';
    const mine = L.filter(e => e.type === 'facility' && e.facilityRef === p.ref).sort((a, b) => stamp(b).localeCompare(stamp(a))), docs = L.filter(e => e.type === 'doctor' && e.facilityRef === p.ref);
    const top = mine[0] || {}, services = top.services || [], hours = top.hours || p.hours || '';
    const phones = [...new Set([top.publicPhone].filter(Boolean).concat(p.phones))];
    return Object.assign({}, p, { services, hours, phones, about: top.about || '', confirmed: mine.length > 0, doctors: docs.map(d => ({ slug: d.slug, name: d.name, profession: d.profession, specialty: d.specialty })) });
  }
  function doctorOut(d) {
    return { slug: d.slug, name: d.name, profession: d.profession, professionLabel: (PROS[d.profession] || PROS.other)[0], specialty: d.specialty || null,
      facility: d.facilityRef ? { slug: (facilities().byRef.get(d.facilityRef) || {}).slug || null, name: d.facilityName } : d.facilityName ? { slug: null, name: d.facilityName } : null,
      area: d.area || null, services: d.services || [], languages: d.languages || [], hours: d.hours || null, fee: d.fee || null, about: d.about || '',
      phone: d.showPhone ? d.phone : null, whatsapp: d.showPhone && d.whatsapp ? d.phone : null, photo: d.photos && d.photos[0] || null, checkedAt: (d.approvedAt || '').slice(0, 10) };
  }
  const findable = f => f.phones.length > 0 || f.services.length > 0 || f.doctors.length > 0 || !!f.website || !!f.about;
  module.exports.facilities = facilities; module.exports.facilityOut = facilityOut; module.exports.doctorOut = doctorOut; module.exports.notify = notify;
  module.exports.findableSlugs = () => { const L = live(); return facilities().list.map(p => facilityOut(p, L)).filter(findable).map(f => '/health/' + f.slug)
    .concat(L.filter(e => e.type === 'doctor').map(d => '/doctors/' + d.slug)); };

  // ---- sign-up (Afiya's form) ----
  fastify.post('/api/health/submit', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const b = req.body || {}, ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (b.website_url) return { ok: true };                                    // a bot filled the hidden field
    if (!submitRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const type = b.type === 'facility' ? 'facility' : 'doctor', phone = ethPhone(b.phone), name = clean(b.name, 80);
    if (name.length < 3) return reply.code(400).send({ ok: false, error: 'name' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone' });
    const F = facilities(), fac = b.facilityRef ? F.byRef.get(String(b.facilityRef)) : null;
    const e = { id: crypto.randomBytes(5).toString('hex'), token: crypto.randomBytes(16).toString('hex'), status: 'pending', type, createdAt: new Date().toISOString(),
      name, phone, services: list(b.services), hours: clean(b.hours, 120) || null, facilityRef: fac ? fac.ref : null, facilityName: fac ? fac.name : clean(b.facilityName, 90) || null,
      area: clean(b.area, 60) || (fac ? fac.sub : null), submittedBy: req.authUser && req.authUser.id || null };
    if (type === 'doctor') {
      const profession = PROS[b.profession] ? b.profession : null, licence = clean(b.licence, 60), issuer = clean(b.licenceIssuer, 90);
      if (!profession) return reply.code(400).send({ ok: false, error: 'profession' });
      if (licence.length < 3 || issuer.length < 2) return reply.code(400).send({ ok: false, error: 'licence' });
      Object.assign(e, { profession, specialty: clean(b.specialty, 60) || null, languages: list(b.languages).slice(0, 8), fee: clean(b.fee, 40) || null,
        showPhone: b.showPhone === true, whatsapp: b.whatsapp === true, licence, licenceIssuer: issuer,
        slug: (kebab(name.replace(/^dr\.?\s+/i, '')) || 'doctor') + '-' + crypto.randomBytes(3).toString('hex'), pendingPhotos: uidOk(b.uid) ? pendingPhotos(b.uid).slice(-1) : [] });
    } else {
      const role = ['owner', 'manager', 'staff'].includes(b.role) ? b.role : 'staff', kind = KINDS[b.kind] ? b.kind : (fac ? fac.kind : 'clinic');
      if (!fac && clean(b.facilityName, 90).length < 3) return reply.code(400).send({ ok: false, error: 'facility' });
      Object.assign(e, { role, kind, publicPhone: ethPhone(b.publicPhone) || null });
    }
    const S = readStore();
    if (S.entries.some(x => x.status === 'pending' && x.type === e.type && x.phone === e.phone && x.name.toLowerCase() === e.name.toLowerCase())) return { ok: true, duplicate: true };
    S.entries.push(e); writeStore(S);
    const base = 'https://bina.et/ops/health/' + e.id + '/';
    const who = '👤 ' + esc(name) + '\n📞 ' + esc(phone) + (e.facilityName ? '\n🏥 ' + esc(e.facilityName) + (fac ? ' (on the map)' : ' (NOT on the map yet)') : '') + (e.area ? ' · ' + esc(e.area) : '');
    const body = type === 'doctor'
      ? '👩🏾‍⚕️ <b>New doctor profile via Afiya</b> (not live)\n' + esc((PROS[e.profession] || PROS.other)[0]) + (e.specialty ? ' · ' + esc(e.specialty) : '') + '\n' + who
        + '\n🪪 Licence: <b>' + esc(e.licence) + '</b> · ' + esc(e.licenceIssuer) + '\n🗣 ' + esc(e.languages.join(', ') || '-') + (e.hours ? '\n🕐 ' + esc(e.hours) : '') + (e.fee ? '\n💵 ' + esc(e.fee) : '')
        + (e.services.length ? '\n🧾 ' + esc(e.services.join(', ')) : '') + '\n' + (e.showPhone ? '📣 phone shown on the profile' + (e.whatsapp ? ' + WhatsApp' : '') : '🔒 phone NOT shown')
        + (e.pendingPhotos.length ? '\n📷 <a href="' + base + 'photo?n=0&t=' + e.token + '">photo</a>' : '')
        + '\n\n<b>Check the licence and call before approving.</b>\n<a href="' + base + 'approve?t=' + e.token + '">✅ approve - goes live</a> · <a href="' + base + 'reject?t=' + e.token + '">❌ reject</a>'
      : '🏥 <b>Facility update via Afiya</b> (not live)\n' + esc((KINDS[e.kind] || KINDS.clinic)[1]) + ' · ' + esc(e.facilityName || '') + '\n' + who + ' — ' + esc(e.role)
        + (e.publicPhone ? '\n☎️ public number: ' + esc(e.publicPhone) : '') + (e.hours ? '\n🕐 ' + esc(e.hours) : '') + (e.services.length ? '\n🧾 ' + esc(e.services.join(', ')) : '')
        + '\n\nCall the facility before approving.' + (fac ? '\n<a href="https://bina.et/health/' + fac.slug + '">page</a>' : '') + '\n<a href="' + base + 'approve?t=' + e.token + '">✅ approve - goes live</a> · <a href="' + base + 'reject?t=' + e.token + '">❌ reject</a>';
    await notify(body);
    return { ok: true, id: e.id };
  });

  fastify.get('/ops/health/:id/:action', async (req, reply) => {
    const S = readStore(), E = S.entries.find(e => e.id === String(req.params.id).slice(0, 20)), act = String(req.params.action);
    reply.header('X-Robots-Tag', 'noindex');
    if (!E || !tokEq(req.query.t, E.token)) return reply.code(404).send('not found');
    const page = msg => reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + msg + '</p>');
    if (act === 'photo') { const f = (E.pendingPhotos || [])[0]; if (!f || !f.startsWith(PEND) || !fs.existsSync(f)) return reply.code(404).send('no photo'); return reply.type('image/jpeg').send(fs.readFileSync(f)); }
    if (E.status !== 'pending') return page('Already ' + esc(E.status) + ': ' + esc(E.name));
    if (act === 'reject') { (E.pendingPhotos || []).forEach(f => { try { if (f.startsWith(PEND)) fs.unlinkSync(f); } catch (x) {} });
      Object.assign(E, { status: 'rejected', token: null, pendingPhotos: [], decidedAt: new Date().toISOString() }); writeStore(S); return page('❌ Rejected: ' + esc(E.name)); }
    if (act !== 'approve') return reply.code(400).send('approve, reject or photo');
    const urls = [];
    if (E.type === 'doctor') { fs.mkdirSync(PUB, { recursive: true });
      (E.pendingPhotos || []).forEach(f => { if (!f.startsWith(PEND) || !fs.existsSync(f)) return; const out = path.join(PUB, E.slug + '.webp');
        try { PY('owner-photo.py', [f, out]); urls.push('https://bina.et/static/health/img/' + path.basename(out) + '?v=' + Math.floor(Date.now() / 1000)); fs.unlinkSync(f); } catch (x) {} }); }
    Object.assign(E, { status: 'live', token: null, pendingPhotos: [], photos: urls, approvedAt: new Date().toISOString(),
      ownerUserId: E.submittedBy || null, dashCode: newCode(), dashCodeExpires: new Date(Date.now() + 30 * 864e5).toISOString(), manageToken: crypto.randomBytes(16).toString('hex') });
    writeStore(S);
    const mb = 'https://bina.et/ops/health/' + E.id + '/manage/';
    notify('✅ <b>' + esc(E.name) + '</b> is live.\n🔑 Dashboard code: <b>' + fmtCode(E.dashCode) + '</b> (30 days)\nGive it on the call: they sign in at bina.et/health/dashboard and type it.'
      + (E.ownerUserId ? '\n(They sent it signed in, so their account already manages it.)' : '')
      + '\n<a href="' + mb + 'newcode?t=' + E.manageToken + '">new code</a> · <a href="' + mb + 'hide?t=' + E.manageToken + '">hide page</a>').catch(() => {});
    const where = E.type === 'doctor' ? '/doctors/' + E.slug : E.facilityRef ? '/health/' + (facilities().byRef.get(E.facilityRef) || {}).slug : '/health';
    return page('✅ Live: <a href="' + where + '">' + esc(E.name) + '</a>' + (E.type === 'facility' && !E.facilityRef ? ' (a facility NOT on the map: add it to the map or tell the developer)' : '')
      + '<br><br>🔑 Dashboard code: <b style="font-size:22px;letter-spacing:.08em">' + fmtCode(E.dashCode) + '</b><br>Tell them on the call: sign in at bina.et/health/dashboard and type this code. It works once, for 30 days.');
  });

  fastify.get('/api/health/directory', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    const L = live();
    return { source: 'OpenStreetMap contributors (ODbL) + facilities and doctors themselves', kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v[1]])),
      facilities: facilities().list.map(p => facilityOut(p, L)).map(f => ({ slug: f.slug, name: f.name, nameAm: f.nameAm, kind: f.kind, sub: f.sub, subAm: f.subAm, lat: f.lat, lng: f.lng,
        phone: f.phones[0] || null, services: f.services.slice(0, 12), doctors: f.doctors.length, confirmed: f.confirmed, emergency: f.emergency })),
      doctors: L.filter(e => e.type === 'doctor').map(doctorOut) };
  });

  // ---- search: Bini's search_health, the MCP server, anything that asks (30 Sep 2026) ----
  // kind, area (a sub-city), q (a specialty, a service or part of a name), lat/lng (nearest first). Only what the
  // public pages show: landlines, services and doctors the team approved, page links. Never a licence or a mobile.
  const SPEC = [
    [/child|kid|p(a)?ediatr|ህፃን|ሕፃን|ህጻን|ሕጻን|ልጅ/i, /child|p(a)?ediatr|\bmch\b|ህፃናት|ሕፃናት|ህጻናት|ልጆች|ታዳጊ/i],
    [/gyn|obstet|matern|pregnan|women|ማህፀን|ማሕፀን|ፅንስ|ጽንስ|እርግዝና|እናቶች/i, /gyn|obstet|matern|women|\bmch\b|ማህፀን|ማሕፀን|ፅንስ|ጽንስ|እናቶች/i],
    [/\beyes?\b|ophthalm|optic|vision|አይን|ዓይን/i, /\beyes?\b|ophthalm|optic|vision|አይን|ዓይን/i],
    [/heart|cardi|ልብ/i, /heart|cardi|ልብ/i],
    [/bone|ortho|spine|fractur|አጥንት/i, /bone|ortho|spine|trauma|አጥንት/i],
    [/fertil|\bivf\b|መካን/i, /fertil|\bivf\b|መካን/i],
    [/skin|dermat|ቆዳ/i, /skin|dermat|ቆዳ/i],
    [/mental|psychiatr|psycholog|አእምሮ/i, /mental|psychiatr|psycholog|አእምሮ/i],
    [/internal med|ውስጥ ደዌ/i, /internal|ውስጥ ደዌ/i],
  ];
  const norm = v => String(v || '').toLowerCase().replace(/[^a-z\u1200-\u137f]/g, '');
  function subOf(area) {
    const a = norm(area); if (!a) return null;
    return Object.keys(SUB_AM).find(k => norm(k) === a || norm(SUB_AM[k]) === a || (a.length >= 4 && norm(k).startsWith(a))) || null;
  }
  function searchHealth({ kind, area, q, lat, lng, limit } = {}) {
    const L = live(), K = String(kind || '').toLowerCase(), want = KINDS[K] ? K : null, forDoctors = K === 'doctor' || K === 'doctors';
    const sub = subOf(area), here = isFinite(lat) && isFinite(lng) && lat !== null && lng !== null && lat !== '' ? { lat: +lat, lng: +lng } : null;
    const text = String(q || '').trim().slice(0, 60), spec = text ? (SPEC.find(([k]) => k.test(text)) || [])[1] : null;
    const words = spec ? [] : norm(text) ? text.toLowerCase().split(/\s+/).filter(w => w.length > 1) : [];
    const docs = L.filter(e => e.type === 'doctor').map(d => Object.assign(doctorOut(d), { _fac: d.facilityRef ? facilities().byRef.get(d.facilityRef) : null }));
    const hay = f => (f.name + ' ' + f.nameAm + ' ' + (KINDS[f.kind] || [])[1] + ' ' + f.services.join(' ') + ' ' + docs.filter(d => d._fac && d._fac.ref === f.ref).map(d => d.specialty || '').join(' ')).toLowerCase();
    const textOk = s => (spec ? spec.test(s) : words.every(w => s.includes(w)));
    let F = facilities().list.map(p => facilityOut(p, L)).filter(f => (!want || f.kind === want || (forDoctors && f.kind === 'doctors'))
      && (!sub || f.sub === sub) && (!(spec || words.length) || textOk(hay(f))));
    if (forDoctors) F = F.filter(f => f.doctors.length || f.kind === 'doctors' || spec || words.length);
    let relaxed = false;
    if (!F.length && (spec || words.length) && !forDoctors) {
      relaxed = true;
      F = facilities().list.map(p => facilityOut(p, L)).filter(f => (!want || f.kind === want) && (!sub || f.sub === sub));
    }
    if (here) { F.forEach(f => { f._km = km(here, f); }); F = F.filter(f => f._km <= 8).sort((a, b) => a._km - b._km); }
    else F.sort((a, b) => (b.confirmed - a.confirmed) || (b.doctors.length - a.doctors.length) || (b.phones.length - a.phones.length));
    // A specialty far away is not the only answer for someone near here: the closest places of the same kind come too
    // ("my child has a fever, which hospital near Piassa": the children's hospitals were 6 km off in Bole, 30 Sep 2026).
    let nearest;
    if (here && !relaxed && (spec || words.length) && (!F.length || F[0]._km > 3)) {
      const shown = new Set(F.slice(0, 10).map(f => f.ref));
      nearest = facilities().list.map(p => facilityOut(p, L)).filter(f => (!want || f.kind === want) && !shown.has(f.ref))
        .map(f => Object.assign(f, { _km: km(here, f) })).filter(f => f._km <= 4).sort((a, b) => a._km - b._km).slice(0, 3);
    }
    const n = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 10);
    const D = docs.filter(d => (!sub || (d._fac ? d._fac.sub === sub : d.area === sub)) && (forDoctors || spec || words.length)
      && (!(spec || words.length) || textOk((d.name + ' ' + d.professionLabel + ' ' + (d.specialty || '') + ' ' + d.services.join(' ')).toLowerCase())));
    const label = [want ? KINDS[want][1].toLowerCase() : forDoctors ? 'doctor' : '', text, sub || ''].filter(Boolean).join(' ');
    return {
      total: F.length,
      results: F.slice(0, n).map(f => ({ name: f.name, nameAm: f.nameAm || undefined, kind: (KINDS[f.kind] || KINDS.clinic)[1], area: f.sub || undefined,
        phone: f.phones[0] || null, services: f.services.length ? f.services.slice(0, 8) : undefined, hours: f.hours || undefined,
        doctors: f.doctors.length ? f.doctors.map(d => d.name).slice(0, 5) : undefined, confirmed: f.confirmed || undefined,
        km: f._km != null ? Math.round(f._km * 10) / 10 : undefined, url: 'https://bina.et/health/' + f.slug })),
      nearest: nearest && nearest.length ? nearest.map(f => ({ name: f.name, kind: (KINDS[f.kind] || KINDS.clinic)[1], area: f.sub || undefined, phone: f.phones[0] || null,
        km: Math.round(f._km * 10) / 10, url: 'https://bina.et/health/' + f.slug })) : undefined,
      nearestNote: nearest && nearest.length ? 'The places in results list that specialty but are farther away. These are the closest places of the same kind; they have not listed the specialty on BinaSmart. Offer both.' : undefined,
      doctors: D.slice(0, 5).map(d => ({ name: d.name, profession: d.professionLabel, specialty: d.specialty || undefined, works: d.facility ? d.facility.name : undefined,
        phone: d.phone || undefined, url: 'https://bina.et/doctors/' + d.slug })),
      more: 'https://bina.et/health' + (label ? '?q=' + encodeURIComponent(label) : ''),
      relaxed: relaxed ? 'No place lists "' + text + '" yet; these are the ' + (here ? 'nearest' : 'general') + ' places of that kind. Say so.' : undefined,
    };
  }
  module.exports.searchHealth = searchHealth;
  fastify.get('/api/health/search', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const q = req.query || {};
    return searchHealth({ kind: q.kind, area: q.area, q: q.q, lat: q.lat, lng: q.lng, limit: q.limit });
  });

  // ---- the directory page ----
  // GET /health was already the uptime check (ops/health/check.js reads its JSON), so server.js keeps that route and
  // hands a browser (Accept: text/html) to this function; scripts (Accept: */*) still get the JSON.
  async function hub(req, reply) {
    const L = live(), F = facilities().list.map(p => facilityOut(p, L)), docs = L.filter(e => e.type === 'doctor').map(doctorOut);
    const counts = Object.fromEntries(Object.keys(KINDS).map(k => [k, F.filter(f => f.kind === k).length]));
    const card = f => '<a class="fc rv" href="/health/' + esc(f.slug) + '" data-k="' + f.kind + '" data-q="' + esc((f.name + ' ' + f.nameAm + ' ' + f.sub + ' ' + (KINDS[f.kind] || KINDS.clinic)[1] + ' ' + f.services.join(' ')).toLowerCase()) + '">'
      + '<span class="ki">' + (KINDS[f.kind] || KINDS.clinic)[0] + '</span><span class="tx"><b>' + esc(f.name) + '</b>' + (f.nameAm ? '<small class="am">' + esc(f.nameAm) + '</small>' : '')
      + '<em>' + kindChip(f.kind) + (f.sub ? ' · ' + esc(f.sub) : '') + '</em>' + (f.services.length ? '<i class="sv">' + esc(f.services.slice(0, 3).join(' · ')) + '</i>' : '')
      + '<span class="bd">' + (f.confirmed ? '<u class="ok">✓ Confirmed</u>' : '') + (f.doctors.length ? '<u>👩🏾‍⚕️ ' + f.doctors.length + '</u>' : '') + (f.phones.length ? '<u>☎️ Phone</u>' : '') + (f.emergency ? '<u class="er">🚑 Emergency</u>' : '') + '</span></span></a>';
    const dcard = d => '<a class="dc rv" href="/doctors/' + esc(d.slug) + '" data-k="doctor" data-q="' + esc((d.name + ' ' + (d.specialty || '') + ' ' + d.professionLabel + ' ' + (d.facility ? d.facility.name : '')).toLowerCase()) + '">'
      + (d.photo ? '<img src="' + esc(d.photo) + '" alt="" loading="lazy">' : '<span class="av">' + esc(d.name.replace(/^dr\.?\s+/i, '').charAt(0).toUpperCase()) + '</span>')
      + '<span class="tx"><b>' + esc(d.name) + '</b><em>' + esc(d.professionLabel) + (d.specialty ? ' · ' + esc(d.specialty) : '') + '</em>' + (d.facility ? '<i class="sv">🏥 ' + esc(d.facility.name) + '</i>' : '') + '<span class="bd"><u class="ok">✓ Licence checked</u></span></span></a>';
    const top = F.filter(findable).slice(0, 30).concat(F.filter(f => !findable(f)).slice(0, 18));
    const html = HEAD('Hospitals, clinics, dentists and doctors in Addis Ababa · ጤና | BinaSmart', 'Find a hospital, clinic, dentist, lab or doctor in Addis Ababa: services, doctors, phone and map. Ask Dr Afiya where to go. Facilities and doctors join free.', 'https://bina.et/health',
      ld({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Health facilities in Addis Ababa', itemListElement: top.slice(0, 30).map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: 'https://bina.et/health/' + f.slug, name: f.name })) }))
      + EMBAR + TOP
      + '<section class="hero"><div class="bl b1"></div><div class="bl b2"></div><svg class="ecg" viewBox="0 0 800 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 H250 L270 40 L285 12 L300 62 L318 22 L332 40 H470 L488 40 L500 26 L512 52 L524 40 H800"/></svg>'
      + '<div class="w in"><span class="eb up d1">👩🏾‍⚕️ BinaSmart Health · <span class="am">ጤና</span></span><h1 class="up d2">Find the right care<br><span class="gr">in Addis.</span></h1>'
      + '<div class="am big up d3">ትክክለኛውን ሕክምና በአዲስ አበባ ያግኙ።</div><p class="sub up d4">Hospitals, clinics, dentists, labs and doctors, with their services. Not sure where to go? Ask Dr Afiya.</p>'
      + '<form class="sr up d5" onsubmit="return false"><span>🔎</span><input id="hq" type="search" placeholder="Hospital, clinic, dentist, area or service…" autocomplete="off"></form>'
      + '<div class="stats up d5"><div><b>' + counts.hospital + '</b>hospitals</div><div><b>' + (counts.clinic + counts.doctors) + '</b>clinics</div><div><b>' + counts.dentist + '</b>dentists</div>' + (docs.length ? '<div><b>' + docs.length + '</b>doctors</div>' : '<div><a href="/health?join=doctor" style="color:#fff;text-decoration:none"><b>+</b>Doctors: join free</a></div>') + '</div></div></section>'
      + '<main class="w" id="all"><div class="fl" id="hk"><button class="on" data-k="">All · ሁሉም</button><button data-k="hospital">🏥 Hospitals</button><button data-k="clinic">🩺 Clinics</button><button data-k="dentist">🦷 Dentists</button><button data-k="doctors">👩🏾‍⚕️ Doctors\' clinics</button><button data-k="lab">🔬 Labs</button><button data-k="doctor">🧑🏾‍⚕️ Doctors</button></div>'
      + (docs.length ? '<h2 class="h2 rv">Doctors on BinaSmart<span class="am">ሐኪሞች</span></h2><div class="dg">' + docs.map(dcard).join('') + '</div>' : '')
      + '<h2 class="h2 rv">Hospitals, clinics and dentists<span class="am">ሆስፒታሎች፣ ክሊኒኮችና የጥርስ ክሊኒኮች</span></h2><div class="fg" id="fg">' + top.map(card).join('') + '</div>'
      + '<button class="more" id="more" data-n="' + F.length + '">Show all ' + F.length + ' places · ሁሉንም አሳይ</button><div class="none" id="none" hidden>Nothing matches. Ask Dr Afiya where to go.</div>'
      + '<section class="joinb rv"><div><h2>Are you a hospital, clinic or doctor?<span class="am">ሆስፒታል፣ ክሊኒክ ወይም ሐኪም ነዎት?</span></h2><p>Add your services and doctors free. Dr Afiya asks the questions; our team calls to check, and your profile goes live. Doctors need their licence number.</p><p style="margin-top:8px">Already listed? <a href="/health/dashboard" style="color:#fff;font-weight:700">Open your dashboard →</a></p></div>'
      + '<div class="jb"><a class="btn" href="/health?join=doctor">👩🏾‍⚕️ I am a doctor</a><a class="btn lite" href="/health?join=facility">🏥 Add my hospital or clinic</a></div></section></main>'
      + FOOT;
    reply.header('Cache-Control', 'public, max-age=120').header('Vary', 'Accept');
    return reply.type('text/html; charset=utf-8').send(html);
  }
  module.exports.hub = hub;

  // ---- one facility ----
  fastify.get('/health/:slug', async (req, reply) => {
    const p = facilities().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).type('text/html; charset=utf-8').send(HEAD('Not found | BinaSmart Health', '', 'https://bina.et/health') + EMBAR + TOP + '<main class="w"><div class="none">This place is not in the directory. <a href="/health">All hospitals and clinics</a></div></main>' + FOOT);
    const L = live(), f = facilityOut(p, L), K = KINDS[f.kind] || KINDS.clinic, docs = L.filter(e => e.type === 'doctor' && e.facilityRef === p.ref).map(doctorOut);
    if (!findable(f)) reply.header('X-Robots-Tag', 'noindex, follow');
    const map = 'https://www.openstreetmap.org/' + p.ref + '#map=18/' + p.lat + '/' + p.lng;
    const desc = f.name + ' is a ' + K[1].toLowerCase() + ' in ' + (f.sub ? f.sub + ', ' : '') + 'Addis Ababa' + (f.services.length ? '. Services: ' + f.services.slice(0, 6).join(', ') : '') + '. Phone, map and doctors on BinaSmart Health.';
    const html = HEAD(f.name + ' · ' + K[1] + (f.sub ? ' in ' + f.sub : '') + ', Addis Ababa | BinaSmart Health', desc.slice(0, 158), 'https://bina.et/health/' + f.slug,
      ld({ '@context': 'https://schema.org', '@type': K[3], name: f.name, alternateName: f.nameAm || undefined, url: 'https://bina.et/health/' + f.slug, telephone: f.phones[0] || undefined,
        address: { '@type': 'PostalAddress', streetAddress: f.street || undefined, addressLocality: f.sub || 'Addis Ababa', addressRegion: 'Addis Ababa', addressCountry: 'ET' },
        geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng }, sameAs: f.website ? [f.website] : undefined,
        availableService: f.services.length ? f.services.map(s => ({ '@type': 'MedicalProcedure', name: s })) : undefined,
        member: docs.length ? docs.map(d => ({ '@type': 'Physician', name: d.name, url: 'https://bina.et/doctors/' + d.slug })) : undefined }) + (findable(f) ? '' : '<meta name="robots" content="noindex, follow">'))
      + EMBAR + TOP
      + '<section class="cov"><div class="bl b1"></div><svg class="ecg" viewBox="0 0 800 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 H250 L270 40 L285 12 L300 62 L318 22 L332 40 H470 L488 40 L500 26 L512 52 L524 40 H800"/></svg></section>'
      + '<main class="w"><div class="card rv in"><span class="kb">' + kindChip(f.kind) + '</span><h1>' + esc(f.name) + '</h1>' + (f.nameAm ? '<div class="an am">' + esc(f.nameAm) + '</div>' : '')
      + '<div class="chips">' + (f.sub ? '<span>📍 ' + esc(f.sub) + (f.subAm ? ' · <span class="am">' + esc(f.subAm) + '</span>' : '') + '</span>' : '') + (f.hours ? '<span>🕐 ' + esc(f.hours) + '</span>' : '')
      + (f.confirmed ? '<span class="g">✓ Confirmed by the facility</span>' : '') + (f.emergency ? '<span class="r">🚑 Emergency</span>' : '') + '</div>'
      + '<div class="acts">' + (f.phones[0] ? '<a class="btn" href="tel:' + esc(f.phones[0].replace(/[^\d+]/g, '')) + '">📞 Call · ይደውሉ</a>' : '') + '<a class="btn lite" href="' + esc(map) + '" target="_blank" rel="noopener">🗺 Map</a>'
      + '<a class="btn lite" href="/ride?to=' + encodeURIComponent(f.name) + '&lat=' + f.lat + '&lng=' + f.lng + '">🚕 Ride there</a>' + (f.website ? '<a class="btn lite" href="' + esc(f.website) + '" target="_blank" rel="nofollow noopener">🌐 Website</a>' : '') + '</div></div>'
      + (f.about ? '<p class="about rv">' + esc(f.about).replace(/\n+/g, '<br>') + '</p>' : '')
      + '<h2 class="h2 rv">Services<span class="am">አገልግሎቶች</span></h2>' + (f.services.length ? '<div class="svs">' + f.services.map(s => '<span class="rv">' + esc(s) + '</span>').join('') + '</div>'
        : '<p class="muted rv">This ' + esc(K[1].toLowerCase()) + ' has not added its services yet. Work here? <a href="/health?join=facility&ref=' + encodeURIComponent(p.ref) + '">Add them free</a>.</p>')
      + '<h2 class="h2 rv">Doctors<span class="am">ሐኪሞች</span></h2>' + (docs.length ? '<div class="dg">' + docs.map(d => '<a class="dc rv" href="/doctors/' + esc(d.slug) + '">' + (d.photo ? '<img src="' + esc(d.photo) + '" alt="" loading="lazy">' : '<span class="av">' + esc(d.name.replace(/^dr\.?\s+/i, '').charAt(0).toUpperCase()) + '</span>') + '<span class="tx"><b>' + esc(d.name) + '</b><em>' + esc(d.professionLabel) + (d.specialty ? ' · ' + esc(d.specialty) : '') + '</em><span class="bd"><u class="ok">✓ Licence checked</u></span></span></a>').join('') + '</div>'
        : '<p class="muted rv">No doctor has added a profile here yet. <a href="/health?join=doctor&ref=' + encodeURIComponent(p.ref) + '">A doctor here? Join free</a>.</p>')
      + '<section class="joinb rv"><div><h2>Do you work here?<span class="am">እዚህ ይሠራሉ?</span></h2><p>Add the services, hours and doctors free. Dr Afiya asks the questions; our team calls to confirm before anything shows.</p><p style="margin-top:8px">Already manage this page? <a href="/health/dashboard" style="color:#fff;font-weight:700">Open your dashboard →</a></p></div><div class="jb"><a class="btn" href="/health?join=facility&ref=' + encodeURIComponent(p.ref) + '">🏥 Update this page</a><a class="btn lite" href="/health?join=doctor&ref=' + encodeURIComponent(p.ref) + '">👩🏾‍⚕️ Add a doctor</a></div></section>'
      + '<p class="src">From the city map (© OpenStreetMap contributors, ODbL)' + (f.confirmed ? '; services and doctors from the facility, checked by BinaSmart' : '') + '. Call before you go.</p></main>'
      + FOOT;
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ---- one doctor ----
  fastify.get('/doctors/:slug', async (req, reply) => {
    const E = live().find(e => e.type === 'doctor' && e.slug === String(req.params.slug));
    if (!E) return reply.code(404).type('text/html; charset=utf-8').send(HEAD('Not found | BinaSmart Health', '', 'https://bina.et/health') + EMBAR + TOP + '<main class="w"><div class="none">This doctor is not on BinaSmart. <a href="/health">Find a doctor</a></div></main>' + FOOT);
    const d = doctorOut(E), P = PROS[d.profession] || PROS.other;
    const html = HEAD(d.name + ' · ' + P[0] + (d.specialty ? ', ' + d.specialty : '') + ' in Addis Ababa | BinaSmart Health', (d.name + ', ' + P[0].toLowerCase() + (d.specialty ? ' (' + d.specialty + ')' : '') + (d.facility ? ' at ' + d.facility.name : '') + ' in Addis Ababa. Licence checked by BinaSmart. Services, languages and hours.').slice(0, 158),
      'https://bina.et/doctors/' + d.slug,
      ld({ '@context': 'https://schema.org', '@type': 'Physician', name: d.name, url: 'https://bina.et/doctors/' + d.slug, image: d.photo || undefined, medicalSpecialty: d.specialty || undefined, telephone: d.phone || undefined,
        knowsLanguage: d.languages.length ? d.languages : undefined, availableService: d.services.length ? d.services.map(s => ({ '@type': 'MedicalProcedure', name: s })) : undefined,
        worksFor: d.facility ? { '@type': 'MedicalOrganization', name: d.facility.name, url: d.facility.slug ? 'https://bina.et/health/' + d.facility.slug : undefined } : undefined,
        address: { '@type': 'PostalAddress', addressLocality: d.area || 'Addis Ababa', addressCountry: 'ET' } }))
      + EMBAR + TOP + '<section class="cov"><div class="bl b1"></div><svg class="ecg" viewBox="0 0 800 70" preserveAspectRatio="none" aria-hidden="true"><path d="M0 40 H250 L270 40 L285 12 L300 62 L318 22 L332 40 H470 L488 40 L500 26 L512 52 L524 40 H800"/></svg></section>'
      + '<main class="w"><div class="card doc rv in">' + (d.photo ? '<img class="ph" src="' + esc(d.photo) + '" alt="' + esc(d.name) + '">' : '<span class="ph av">' + esc(d.name.replace(/^dr\.?\s+/i, '').charAt(0).toUpperCase()) + '</span>')
      + '<h1>' + esc(d.name) + '</h1><div class="an">' + proLabel(d.profession) + (d.specialty ? ' · ' + esc(d.specialty) : '') + '</div>'
      + '<div class="chips"><span class="g">✓ Licence checked by BinaSmart' + (d.checkedAt ? ' · ' + esc(d.checkedAt) : '') + '</span>' + (d.area ? '<span>📍 ' + esc(d.area) + '</span>' : '') + (d.hours ? '<span>🕐 ' + esc(d.hours) + '</span>' : '') + (d.fee ? '<span>💵 ' + esc(d.fee) + '</span>' : '') + '</div>'
      + '<div class="acts">' + (d.phone ? '<a class="btn" href="tel:' + esc(d.phone) + '">📞 Call · ይደውሉ</a>' : '') + (d.whatsapp ? '<a class="btn wa" href="https://wa.me/' + esc(d.whatsapp.replace(/\D/g, '')) + '?text=' + encodeURIComponent('Hello Dr, I found you on BinaSmart Health (bina.et). I would like an appointment.') + '" target="_blank" rel="noopener">WhatsApp</a>' : '')
      + (d.facility && d.facility.slug ? '<a class="btn lite" href="/health/' + esc(d.facility.slug) + '">🏥 ' + esc(d.facility.name) + '</a>' : d.facility ? '<span class="btn lite">🏥 ' + esc(d.facility.name) + '</span>' : '') + '</div></div>'
      + (d.about ? '<p class="about rv">' + esc(d.about).replace(/\n+/g, '<br>') + '</p>' : '')
      + (d.services.length ? '<h2 class="h2 rv">Services<span class="am">አገልግሎቶች</span></h2><div class="svs">' + d.services.map(s => '<span class="rv">' + esc(s) + '</span>').join('') + '</div>' : '')
      + (d.languages.length ? '<h2 class="h2 rv">Languages<span class="am">ቋንቋዎች</span></h2><div class="svs">' + d.languages.map(s => '<span class="rv">🗣 ' + esc(s) + '</span>').join('') + '</div>' : '')
      + '<p class="src">The doctor gave this profile and a professional licence number; our team called and checked it before it went live. BinaSmart does not rate or recommend doctors. For an emergency call 907.</p></main>' + FOOT;
    return reply.type('text/html; charset=utf-8').send(html);
  });
  done();
};
module.exports.buildFacilities = buildFacilities;
Object.assign(module.exports, { readStore, writeStore, newCode, fmtCode, clean, esc, list, uidOk, pendingPhotos, tokEq, kebab, PEND, PUB, SUB_AM });
module.exports.ethPhone = ethPhone;
module.exports.landlines = landlines;
module.exports.KINDS = KINDS;
module.exports.PROS = PROS;
