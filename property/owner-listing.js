'use strict';
// Homes FOR SALE or FOR RENT listed by talking to Bini (29 Sep 2026, Ibrahim: "company and individual and rent also").
// Anyone - a private owner, an agent (delala) or a company - tells Bini about the home; nothing is public until a person on
// the team has called them and tapped approve.
//
//   POST /api/property/photo                    widget, listing mode: one photo, kept PRIVATE in uploads/listing-photos/<uid>/
//   POST /api/property/owner-listing            ONLY from Bini's tool (x-bini-internal key): add | change | remove
//   GET  /ops/listing-requests/:id/:action?t=   one tap from the team's Telegram: approve | reject | photo?n=
//
// add    -> PropertyListing active:false, verified:false, slug owner-<random>, details.review {status:'pending', token};
//           photos stay private; the team gets Telegram with the facts, a photo link each and approve / reject.
// approve-> each photo is re-encoded by ops/places/owner-photo.py (EXIF + GPS stripped) into public/property/img, then the
//           listing goes live on /property with the owner's own phone (+ WhatsApp when they said yes).
// change / remove -> a note to the team with the listing; remove has its own approve link (sets active:false).
// The detail page (property/detail.js) 404s an owner listing whose review is not approved.

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const PEND = path.join(ROOT, 'uploads', 'listing-photos');
const PUB = path.join(ROOT, 'public', 'property', 'img');
const INTERNAL_KEY = crypto.randomBytes(24).toString('hex');   // same process as assistant/tools.js; never leaves the box

const TYPES = { villa: ['Villa', 'ቪላ'], house: ['House', 'ቤት'], apartment: ['Apartment', 'አፓርታማ'], condominium: ['Condominium', 'ኮንዶሚኒየም'],
  g_plus: ['G+ building', 'ጂ+ ሕንጻ'], land: ['Land', 'ቦታ'], shop: ['Shop', 'ሱቅ'], office: ['Office', 'ቢሮ'], warehouse: ['Warehouse', 'መጋዘን'], room: ['Room', 'ክፍል'] };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ethPhone(raw) {                       // 0911..., 911..., +251911... -> +251911...
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^0[79]\d{8}$/.test(d)) d = '+251' + d.slice(1);
  else if (/^[79]\d{8}$/.test(d)) d = '+251' + d;
  else if (/^251[79]\d{8}$/.test(d)) d = '+' + d;
  return /^\+251[79]\d{8}$/.test(d) ? d : (/^\+\d{9,15}$/.test(d) ? d : '');
}
const uidOk = u => /^[A-Za-z0-9_-]{6,64}$/.test(String(u || ''));
const tokEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

async function tellTeam(text) {                // same bot and chats as company / hotel claims
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

function pendingPhotos(uid) {                  // newest last
  const dir = path.join(PEND, uid);
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.img')).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs); }
  catch (e) { return []; }
}

function titleOf(b) {
  const t = TYPES[b.propertyType] || ['Home', 'ቤት'];
  return t[0] + (b.listingType === 'rent' ? ' for rent' : ' for sale') + (b.location ? ' · ' + b.location : '');
}

module.exports = function ownerListing(fastify, { prisma, limiter, tell }, done) {
  const notify = tell || tellTeam;
  const PY = (script, args) => require('child_process').execFileSync('python3', [path.join(ROOT, 'ops', 'places', script)].concat(args), { timeout: 60000, stdio: 'pipe' }).toString().trim();
  const photoRL = limiter(3600000, 20), listRL = limiter(3600000, 6);

  // ---- photos from the widget (listing mode) ----
  fastify.post('/api/property/photo', { bodyLimit: 9 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body || {}, ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!uidOk(b.uid)) return reply.code(400).send({ ok: false, error: 'uid' });
    if (!photoRL(ip) || !photoRL('u:' + b.uid)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const buf = Buffer.from(String(b.image || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length < 15000) return reply.code(400).send({ ok: false, error: 'too_small' });
    if (buf.length > 7 * 1024 * 1024) return reply.code(413).send({ ok: false, error: 'too_large' });
    const dir = path.join(PEND, b.uid); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, crypto.randomBytes(8).toString('hex') + '.img');
    fs.writeFileSync(file, buf);
    let w = 0, h = 0;
    try { [w, h] = PY('img-size.py', [file]).split(/\s+/).map(Number); } catch (e) { w = 0; }
    if (!(w >= 600 && h >= 400)) { try { fs.unlinkSync(file); } catch (e) {} return reply.code(400).send({ ok: false, error: w ? 'too_small' : 'not_image' }); }
    const all = pendingPhotos(b.uid);
    while (all.length > 8) { try { fs.unlinkSync(all.shift()); } catch (e) { all.shift(); } }   // keep the newest 8
    return { ok: true, count: Math.min(all.length, 8) };
  });

  // ---- the Bini tool: add / change / remove ----
  fastify.post('/api/property/owner-listing', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    if (!tokEq(req.headers['x-bini-internal'], INTERNAL_KEY)) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {}, ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!listRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const action = ['add', 'change', 'remove'].includes(b.action) ? b.action : 'add';
    const name = clean(b.name, 80), phone = ethPhone(b.phone), role = ['owner', 'agent', 'company'].includes(b.role) ? b.role : 'owner';
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone' });
    const company = clean(b.company, 120);
    const who = '👤 ' + esc(name) + ' — ' + role + (company ? ' · ' + esc(company) : '') + '\n📞 ' + esc(phone);

    if (action !== 'add') {                     // change / remove: a person on the team does it after a call
      const ref = clean(b.listing, 120);
      const L = ref ? await prisma.propertyListing.findFirst({ where: { OR: [{ slug: ref.replace(/^.*\/property\//, '').replace(/[#?].*$/, '') }, { title: ref }] } }) : null;
      const what = clean(b.request, 500);
      // Only the number on the listing gets the one-tap take-down (as shop posts); anyone else's request reaches the team
      // as an ordinary note (1 Oct 2026 rehearsal: a stranger naming the listing got the take-down link sent to the team).
      if (action === 'remove' && L && L.agencyPhone === phone) {
        const token = crypto.randomBytes(16).toString('hex');
        const d = Object.assign({}, L.details || {}, { removeRequest: { token, name, phone, at: new Date().toISOString() } });
        await prisma.propertyListing.update({ where: { id: L.id }, data: { details: d } });
        await notify('🗑 <b>Remove request via Bini</b> · ' + esc(L.title) + '\n' + who + (what ? '\n📝 ' + esc(what) : '')
          + '\n\nCall first: is this person really the owner/agent?\n<a href="https://bina.et/property/' + L.slug + '">listing</a> · <a href="https://bina.et/ops/listing-requests/' + L.id + '/remove?t=' + token + '">✅ take it down</a>');
      } else {
        await notify((action === 'remove' ? (L ? '🗑 <b>Remove request via Bini</b> from a number that is NOT on the listing: call the listing\'s own number first' : '🗑 <b>Remove request via Bini</b> (listing not matched)') : '✏️ <b>Change request via Bini</b>') + (L ? ' · ' + esc(L.title) : ref ? ' · ' + esc(ref) : '')
          + '\n' + who + (what ? '\n📝 ' + esc(what) : '') + '\n\nCall first, then edit by hand.' + (L ? '\n<a href="https://bina.et/property/' + L.slug + '">listing</a>' : ''));
      }
      return { ok: true, matched: !!L && (action !== 'remove' || L.agencyPhone === phone) };
    }

    const listingType = b.listingType === 'rent' ? 'rent' : 'sale';
    const propertyType = TYPES[b.propertyType] ? b.propertyType : null;
    const location = clean(b.location, 80), price = clean(b.price, 60);
    if (location.length < 2) return reply.code(400).send({ ok: false, error: 'location' });
    if (!propertyType) return reply.code(400).send({ ok: false, error: 'type' });
    if (price.length < 1) return reply.code(400).send({ ok: false, error: 'price' });
    const dup = await prisma.propertyListing.findFirst({ where: { agencyPhone: phone, location, listingType, active: false, createdAt: { gt: new Date(Date.now() - 6 * 3600000) } } });
    if (dup) return { ok: true, duplicate: true };

    const photos = uidOk(b.uid) ? pendingPhotos(b.uid).slice(-8) : [];
    const slug = 'owner-' + crypto.randomBytes(5).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    const body = { listingType, propertyType, location };
    const row = await prisma.propertyListing.create({ data: {
      slug, title: titleOf(body), listingType, propertyType, location, city: 'Addis Ababa',
      price: listingType === 'rent' && !/month|ወር/i.test(price) ? price + ' / month' : price,
      beds: clean(b.beds, 10) || null, baths: clean(b.baths, 10) || null, area: clean(b.size, 30) || null,
      agency: role === 'company' && company ? company : role === 'agent' ? name + ' · agent' : 'Private owner · ግለሰብ',
      agencyPhone: phone, agencyWhatsapp: b.whatsapp === false ? null : phone,
      verified: false, active: false,
      details: { description: clean(b.description, 1200), owner: { name, role, company: company || undefined },
        submittedVia: 'bini', pendingPhotos: photos, review: { status: 'pending', token, at: new Date().toISOString() } } } });
    const base = 'https://bina.et/ops/listing-requests/' + row.id + '/';
    const T = TYPES[propertyType];
    await notify('🏠 <b>New ' + (listingType === 'rent' ? 'RENT' : 'SALE') + ' listing via Bini</b> (not live)\n' + T[0] + ' · ' + T[1] + ' · ' + esc(location)
      + '\n💰 ' + esc(row.price) + (row.beds ? ' · 🛏 ' + esc(row.beds) : '') + (row.baths ? ' · 🛁 ' + esc(row.baths) : '') + (row.area ? ' · 📐 ' + esc(row.area) : '')
      + (row.details.description ? '\n📝 ' + esc(row.details.description.slice(0, 300)) : '') + '\n' + who + (row.agencyWhatsapp ? ' (WhatsApp ok)' : '')
      + '\n📷 ' + photos.length + ' photo(s)' + (photos.length ? ': ' + photos.map((_, i) => '<a href="' + base + 'photo?n=' + i + '&t=' + token + '">' + (i + 1) + '</a>').join(' ') : '')
      + '\n\nCall the owner before approving (right person? real home?).\n<a href="' + base + 'approve?t=' + token + '">✅ approve - goes live</a> · <a href="' + base + 'reject?t=' + token + '">❌ reject</a>');
    return { ok: true, slug, photos: photos.length };
  });

  // ---- one tap from Telegram ----
  fastify.get('/ops/listing-requests/:id/:action', async (req, reply) => {
    const L = await prisma.propertyListing.findUnique({ where: { id: String(req.params.id).slice(0, 40) } }).catch(() => null);
    const d = (L && L.details) || {}, act = String(req.params.action);
    const want = act === 'remove' ? (d.removeRequest || {}).token : (d.review || {}).token;
    reply.header('X-Robots-Tag', 'noindex');
    if (!L || !tokEq(req.query.t, want)) return reply.code(404).send('not found');
    const page = msg => reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + msg + '</p>');
    if (act === 'photo') {
      const f = (d.pendingPhotos || [])[Number(req.query.n) || 0];
      if (!f || !f.startsWith(PEND) || !fs.existsSync(f)) return reply.code(404).send('no photo');
      return reply.type('image/jpeg').send(fs.readFileSync(f));
    }
    if (act === 'remove') {
      await prisma.propertyListing.update({ where: { id: L.id }, data: { active: false, details: Object.assign({}, d, { removeRequest: Object.assign({}, d.removeRequest, { token: null, done: new Date().toISOString() }) }) } });
      return page('🗑 Taken down: ' + esc(L.title));
    }
    if (d.review && d.review.status !== 'pending') return page('Already ' + esc(d.review.status) + ': ' + esc(L.title));
    if (act === 'reject') {
      (d.pendingPhotos || []).forEach(f => { try { if (f.startsWith(PEND)) fs.unlinkSync(f); } catch (e) {} });
      await prisma.propertyListing.update({ where: { id: L.id }, data: { details: Object.assign({}, d, { pendingPhotos: [], review: { status: 'rejected', at: new Date().toISOString() } }) } });
      return page('❌ Rejected: ' + esc(L.title));
    }
    if (act !== 'approve') return reply.code(400).send('approve, reject, photo or remove');
    fs.mkdirSync(PUB, { recursive: true });
    const v = Math.floor(Date.now() / 1000), urls = [];
    (d.pendingPhotos || []).forEach((f, i) => {
      if (!f.startsWith(PEND) || !fs.existsSync(f)) return;
      const out = path.join(PUB, L.slug + '-g' + urls.length + '.webp');
      try { PY('owner-photo.py', [f, out]); urls.push('https://bina.et/static/property/img/' + path.basename(out) + '?v=' + v); fs.unlinkSync(f); } catch (e) { /* skip a broken file */ }
    });
    await prisma.propertyListing.update({ where: { id: L.id }, data: { active: true, verified: true, imageUrl: urls[0] || null,
      details: Object.assign({}, d, { photos: urls, pendingPhotos: [], updated: new Date().toISOString().slice(0, 10), review: { status: 'approved', at: new Date().toISOString() } }) } });
    return page('✅ Live: <a href="/property/' + L.slug + '">' + esc(L.title) + '</a> (' + urls.length + ' photo' + (urls.length === 1 ? '' : 's') + ')');
  });
  done();
};
module.exports.INTERNAL_KEY = INTERNAL_KEY;
module.exports.ethPhone = ethPhone;
module.exports.TYPES = TYPES;
// for property/dashboard.js (owners mark their own homes rented / sold, 1 Oct 2026)
Object.assign(module.exports, { clean, esc, tellTeam });
