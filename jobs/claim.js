'use strict';
// "Is this your company?" — a company gives its own address and map pin; a person at BinaSmart approves it.
//
//   GET  /employer/:slug/claim                   the form (am/en)
//   POST /api/employer-claims                    { slug, name, role, phone, email?, address, note?, lat?, lng?, mapLink?,
//                                                  publicPhone?, website?, confirm: true }
//   GET  /ops/employer-claims?key=…              the queue
//   GET  /ops/employer-claims/:id/:action?t=…    approve | reject, one tap from the Telegram message
//
// Why this exists (24 September 2026): 957 of 1,780 companies had no location, and prisma/schema.prisma forbids
// guessing one — "an address typed by a recruiter ('around Bole') is not a place". The company itself knows where
// its door is. So the company says, and a person decides; nothing a visitor types reaches a company page until
// the owner taps approve. Approval sets locationChecked, because a person (the company, then BinaSmart) stands
// behind the point, and locationNote says who gave it and when.
//
// Storage: one JSON file per claim under /root/storage/employer-claims (mode 600), not a new table, so the claim
// queue needs no schema migration. The claimant's own name, phone and e-mail are for the follow-up call only:
// they are never shown on the company page. Only the address, the pin, the note and a company phone / website
// the claimant marked for publication are.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.EMPLOYER_CLAIMS_DIR || '/root/storage/employer-claims';
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
// Ethiopia's bounding box, a little generous: a pin outside it is a mistake, not an office.
const inEthiopia = (lat, lng) => lat > 3 && lat < 15.5 && lng > 32.5 && lng < 48.5;

// A pasted Google Maps / OpenStreetMap link, or "9.01, 38.76". Short links are followed once, server-side.
async function pointFrom(link) {
  let s = String(link || '').trim();
  if (!s) return null;
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(s)) {
    try { const r = await fetch(s, { redirect: 'follow', signal: AbortSignal.timeout(8000) }); s = r.url || s; } catch (e) { /* keep the link */ }
  }
  const m = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/.exec(s) || /[?&](?:q|query|ll|destination|mlat)=(-?\d{1,2}\.\d+)(?:,|%2C|&mlon=)(-?\d{1,3}\.\d+)/i.exec(s)
    || /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(s) || /^(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return inEthiopia(lat, lng) ? { lat, lng } : null;
}

function save(c) { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(DIR, c.id + '.json'), JSON.stringify(c, null, 1), { mode: 0o600 }); }
function load(id) { try { return /^[a-f0-9]{16}$/.test(id) ? JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')) : null; } catch (e) { return null; } }
function all() { try { return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => load(f.slice(0, -5))).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at)); } catch (e) { return []; } }

// Sent by @bina_smart_bot (BINA_RIDER_BOT_TOKEN) to the admin chats. Not BINASMART_TG_TOKEN: that is the old
// @gccandconectbot, which the owner never started - getChat on 26 Sep 2026 said "chat not found" for both chats,
// so every alert sent with it was lost. The sending bot and the chat must belong together.
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

const L = {
  am: { h1: 'ይህ የእርስዎ ድርጅት ነው?', lede: 'የድርጅትዎን ትክክለኛ አድራሻና የካርታ ቦታ ይላኩ። ሥራ ፈላጊዎች ወደ ትክክለኛው በር እንዲደርሱ ይረዳል። ቢናስማርት ከደወለ በኋላ ያጸድቀዋል — ነጻ ነው።',
    you: 'ሙሉ ስምዎ', role: 'በድርጅቱ ያለዎት ኃላፊነት', phone: 'ስልክዎ (ለማረጋገጫ ጥሪ ብቻ፤ አይታተምም)', email: 'ኢሜይል (አማራጭ፤ አይታተምም)',
    address: 'አድራሻ (ሕንፃ፣ ፎቅ፣ መንገድ፣ ክፍለ ከተማ)', note: 'ለሹፌር የሚረዳ ምልክት (አማራጭ፣ ለምሳሌ «ከቶታል ነዳጅ ማደያ ጀርባ»)',
    pin: 'የካርታ ቦታ', here: '📍 አሁን ቢሮ ውስጥ ነኝ — ቦታዬን ተጠቀም', orLink: 'ወይም የGoogle Maps ሊንክ ይለጥፉ', pinSet: 'ቦታው ተመዝግቧል ✓', pinFail: 'ቦታዎን ማግኘት አልተቻለም — ሊንክ ይለጥፉ',
    pubPhone: 'በገጹ ላይ የሚታይ የድርጅቱ ስልክ (አማራጭ)', site: 'ድረ ገጽ (አማራጭ)', confirm: 'በዚህ ድርጅት እሠራለሁ፤ መረጃው ትክክል ነው።',
    send: 'ላክ', sending: 'በመላክ ላይ…', ok: 'እናመሰግናለን! መረጃው ለቢናስማርት ተልኳል። ከደወልንልዎ በኋላ ገጹ ላይ ይወጣል።',
    err: { name_required: 'ስምዎን ያስገቡ።', phone_required: 'ስልክ ቁጥርዎን ያስገቡ።', address_required: 'አድራሻውን ያስገቡ።', confirm_required: 'ማረጋገጫውን ይምረጡ።', bad_pin: 'የካርታው ቦታ ኢትዮጵያ ውስጥ አይደለም ወይም ሊንኩ አልተነበበም።', slow_down: 'ብዙ ጊዜ ተልኳል፤ ቆይተው ይሞክሩ።', other: 'አልተላከም፤ እንደገና ይሞክሩ።' },
    privacy: 'የእርስዎ ስም፣ ስልክና ኢሜይል ለማረጋገጫ ብቻ ነው፤ በገጹ ላይ አይወጡም። የሚታተሙት አድራሻው፣ የካርታ ቦታው፣ ምልክቱ እና እርስዎ ለህዝብ የመረጡት ስልክና ድረ ገጽ ብቻ ናቸው።', back: '← ወደ ድርጅቱ ገጽ' },
  en: { h1: 'Is this your company?', lede: 'Send your company\'s exact address and map pin, so job seekers reach the right door. BinaSmart calls to confirm, then publishes it — free.',
    you: 'Your full name', role: 'Your role at the company', phone: 'Your phone (for our confirmation call only; not published)', email: 'E-mail (optional; not published)',
    address: 'Address (building, floor, street, sub-city)', note: 'A landmark for the driver (optional, e.g. "behind the Total station")',
    pin: 'Map pin', here: '📍 I am at the office now — use my location', orLink: 'or paste a Google Maps link', pinSet: 'Location recorded ✓', pinFail: 'Could not get your location — paste a link instead',
    pubPhone: 'Company phone to show on the page (optional)', site: 'Website (optional)', confirm: 'I work for this company and these details are correct.',
    send: 'Send', sending: 'Sending…', ok: 'Thank you! Sent to BinaSmart. It goes on the page after we have called you to confirm.',
    err: { name_required: 'Please enter your name.', phone_required: 'Please enter your phone number.', address_required: 'Please enter the address.', confirm_required: 'Please tick the confirmation.', bad_pin: 'The map pin is not in Ethiopia, or the link could not be read.', slow_down: 'Too many sends — try again later.', other: 'Not sent — please try again.' },
    privacy: 'Your name, phone and e-mail are for confirmation only and are never shown. Only the address, the pin, the landmark and the phone and website you choose to publish appear on the page.', back: '← Back to the company page' },
};

module.exports = function claimRoutes(fastify, { prisma, shell, escH, OWNER_KEY }) {
  const hits = new Map();   // ip -> [times]; 5 claims an hour is plenty for a real company
  const allowed = ip => { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 3600000); a.push(now); hits.set(ip, a); return a.length <= 5; };

  fastify.get('/employer/:slug/claim', async (req, reply) => {
    const lang = String(req.query.lang || '').toLowerCase() === 'en' ? 'en' : 'am';
    const t = L[lang];
    const e = await prisma.employer.findUnique({ where: { slug: String(req.params.slug) }, select: { slug: true, name: true } });
    if (!e) return reply.code(404).type('text/html').send(shell({ title: 'አልተገኘም', desc: '', canonical: 'https://bina.et/employers', body: '<main><h1>አልተገኘም</h1></main>', active: 'jobs' }));
    const body = `<main>
      <a class="sans" href="${lang === 'en' ? '?lang=am' : '?lang=en'}" style="float:right;font-size:13px;font-weight:700;border:1.5px solid var(--line);border-radius:999px;padding:5px 14px">${lang === 'en' ? 'አማርኛ' : 'English'}</a>
      <p class="sans" style="margin:6px 0 0"><a href="/employer/${escH(e.slug)}${lang === 'en' ? '?lang=en' : ''}">${t.back}</a></p>
      <h1 style="margin:14px 0 4px">${t.h1}</h1>
      <div class="sans" style="font-weight:800;font-size:17px">${escH(e.name)}</div>
      <p class="sans" style="color:var(--mut);font-size:14px;line-height:1.6">${t.lede}</p>
      <form id="cf" class="sans cf">
        <input type="hidden" name="slug" value="${escH(e.slug)}">
        <input name="fax" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
        <div class="row"><label>${t.you}<input name="name" required maxlength="90" autocomplete="name"></label>
          <label>${t.role}<input name="role" maxlength="80"></label></div>
        <div class="row"><label>${t.phone}<input name="phone" required maxlength="30" inputmode="tel" autocomplete="tel"></label>
          <label>${t.email}<input name="email" type="email" maxlength="120" autocomplete="email"></label></div>
        <label>${t.address}<input name="address" required maxlength="200"></label>
        <label>${t.note}<input name="note" maxlength="160"></label>
        <fieldset><legend>${t.pin}</legend>
          <button type="button" id="here" class="sec">${t.here}</button>
          <div id="pinmsg" style="font-size:13px;margin:6px 0"></div>
          <label>${t.orLink}<input name="mapLink" maxlength="400" inputmode="url" placeholder="https://maps.app.goo.gl/…"></label>
          <input type="hidden" name="lat"><input type="hidden" name="lng">
        </fieldset>
        <div class="row"><label>${t.pubPhone}<input name="publicPhone" maxlength="30" inputmode="tel"></label>
          <label>${t.site}<input name="website" maxlength="120" inputmode="url"></label></div>
        <label class="ck"><input type="checkbox" name="confirm" required> ${t.confirm}</label>
        <button type="submit">${t.send}</button>
        <div id="cmsg" role="status"></div>
        <p class="note">🔒 ${t.privacy}</p>
      </form>
    </main>
    <style>
      .cf{display:grid;gap:12px;max-width:640px;margin:14px 0 40px}
      .cf label{display:block;font-size:13px;font-weight:700;color:var(--mut)}
      .cf input:not([type=checkbox]){display:block;width:100%;margin-top:5px;border:1.5px solid var(--line);border-radius:11px;padding:12px 13px;font-size:15px;font-family:inherit;background:#fff;color:var(--ink)}
      .cf .row{display:flex;gap:12px;flex-wrap:wrap}.cf .row>label{flex:1;min-width:180px}
      .cf fieldset{border:1.5px solid var(--line);border-radius:14px;padding:12px 14px;margin:0}
      .cf legend{font-weight:800;font-size:13px;padding:0 6px}
      .cf .ck{display:flex;gap:8px;align-items:flex-start;color:var(--ink);font-weight:600}
      .cf button{border-radius:999px;padding:12px 26px;font-weight:800;font-size:15px;font-family:inherit;cursor:pointer;justify-self:start;border:0;background:#064e3b;color:#fff}
      .cf button.sec{background:#fff;color:var(--ink);border:1.5px solid var(--line);font-size:14px;padding:10px 18px}
      .cf button[disabled]{opacity:.6}.cf .note{color:var(--mut);font-size:12.5px;line-height:1.6;margin:0}
      #cmsg{font-size:14px;line-height:1.55}
    </style>
    <script>
    (function(){
      var f=document.getElementById('cf'), msg=document.getElementById('cmsg'), pm=document.getElementById('pinmsg');
      var T=${JSON.stringify({ send: t.send, sending: t.sending, ok: t.ok, err: t.err, pinSet: t.pinSet, pinFail: t.pinFail })};
      document.getElementById('here').addEventListener('click', function(){
        if(!navigator.geolocation){ pm.textContent=T.pinFail; return; }
        navigator.geolocation.getCurrentPosition(function(p){
          f.elements.lat.value=p.coords.latitude.toFixed(6); f.elements.lng.value=p.coords.longitude.toFixed(6);
          pm.style.color='#047857'; pm.textContent=T.pinSet+' ('+p.coords.latitude.toFixed(5)+', '+p.coords.longitude.toFixed(5)+')';
        }, function(){ pm.style.color='#b45309'; pm.textContent=T.pinFail; }, { enableHighAccuracy:true, timeout:15000 });
      });
      f.addEventListener('submit', function(ev){
        ev.preventDefault();
        var E=f.elements, btn=f.querySelector('button[type=submit]');
        btn.disabled=true; btn.textContent=T.sending; msg.textContent='';
        var d={confirm:E.confirm.checked};
        ['slug','fax','name','role','phone','email','address','note','mapLink','lat','lng','publicPhone','website'].forEach(function(k){ if(E[k]&&E[k].value) d[k]=E[k].value; });
        fetch('/api/employer-claims',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)})
          .then(function(r){ return r.json().catch(function(){return {ok:false};}); })
          .then(function(r){
            if(r&&r.ok){ f.querySelectorAll('input,button').forEach(function(x){x.disabled=true;}); msg.style.color='#047857'; msg.textContent=T.ok; }
            else { msg.style.color='#b91c1c'; msg.textContent=T.err[(r&&r.error)||'other']||T.err.other; btn.disabled=false; btn.textContent=T.send; }
          }).catch(function(){ msg.style.color='#b91c1c'; msg.textContent=T.err.other; btn.disabled=false; btn.textContent=T.send; });
      });
    })();
    </script>`;
    reply.header('x-robots-tag', 'noindex').type('text/html').send(shell({
      title: (lang === 'en' ? 'Add your address · ' : 'አድራሻዎን ያክሉ · ') + e.name,
      desc: lang === 'en' ? 'Companies: add your exact address and map pin to your BinaSmart page, free.' : 'ድርጅቶች፦ ትክክለኛ አድራሻችሁንና የካርታ ቦታችሁን በቢናስማርት ገጻችሁ ላይ በነጻ ያክሉ።',
      canonical: 'https://bina.et/employer/' + e.slug, body, active: 'jobs' }));
  });

  fastify.post('/api/employer-claims', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (b.fax) return { ok: true, status: 'pending' };                     // the hidden field: a bot filled it
    if (!allowed(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const e = await prisma.employer.findUnique({ where: { slug: clean(b.slug, 200) }, select: { id: true, slug: true, name: true, address: true, lat: true, lng: true } });
    if (!e) return reply.code(404).send({ ok: false, error: 'not_found' });
    const name = clean(b.name, 90), phone = clean(b.phone, 30), address = clean(b.address, 200);
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name_required' });
    if (phone.replace(/\D/g, '').length < 9) return reply.code(400).send({ ok: false, error: 'phone_required' });
    if (address.length < 4) return reply.code(400).send({ ok: false, error: 'address_required' });
    if (b.confirm !== true) return reply.code(400).send({ ok: false, error: 'confirm_required' });
    let point = null;
    if (b.lat != null && b.lng != null && b.lat !== '' && b.lng !== '') {
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!inEthiopia(lat, lng)) return reply.code(400).send({ ok: false, error: 'bad_pin' });
      point = { lat, lng, how: 'device location' };
    } else if (b.mapLink) {
      const p = await pointFrom(b.mapLink);
      if (!p) return reply.code(400).send({ ok: false, error: 'bad_pin' });
      point = { ...p, how: 'map link' };
    }
    const c = { id: crypto.randomBytes(8).toString('hex'), token: crypto.randomBytes(16).toString('base64url'), at: new Date().toISOString(), status: 'pending',
      employerId: e.id, slug: e.slug, employerName: e.name, had: { address: e.address, lat: e.lat, lng: e.lng },
      claimant: { name, role: clean(b.role, 80), phone, email: clean(b.email, 120), ip },
      proposed: { address, note: clean(b.note, 160), point, publicPhone: clean(b.publicPhone, 30), website: clean(b.website, 120) } };
    save(c);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]));
    const base = 'https://bina.et/ops/employer-claims/' + c.id;
    tellOwner(['🏢 <b>Company address claim</b>', '', '<b>' + esc(e.name) + '</b>  bina.et/employer/' + esc(e.slug),
      'From: ' + esc(name) + (c.claimant.role ? ', ' + esc(c.claimant.role) : '') + ' · ' + esc(phone),
      'Address: ' + esc(address) + (c.proposed.note ? '\nLandmark: ' + esc(c.proposed.note) : ''),
      point ? 'Pin (' + point.how + '): https://www.openstreetmap.org/?mlat=' + point.lat + '&mlon=' + point.lng + '#map=18/' + point.lat + '/' + point.lng : 'No map pin',
      e.address || e.lat != null ? '⚠️ replaces what the page shows now' : '',
      '', 'Call the number, then:', '<a href="' + base + '/approve?t=' + c.token + '">✅ APPROVE</a>   ·   <a href="' + base + '/reject?t=' + c.token + '">❌ REJECT</a>'].filter(Boolean).join('\n')).catch(() => {});
    return { ok: true, id: c.id, status: 'pending' };
  });

  fastify.get('/ops/employer-claims/:id/:action', async (req, reply) => {
    const page = (title, html) => reply.header('cache-control', 'no-store').type('text/html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escH(title)}</title><body style="font-family:system-ui,'Noto Sans Ethiopic',sans-serif;background:#f5f6f8;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e6ec;border-radius:16px;padding:20px"><h2 style="margin:0 0 10px">${escH(title)}</h2>${html}</div></body>`);
    const c = load(String(req.params.id));
    if (!c || !req.query.t || c.token !== String(req.query.t)) return reply.code(404).type('text/html').send('<h2>Not found</h2>');
    if (c.status !== 'pending') return page('Already ' + c.status, '<p>' + escH(c.employerName) + ' — ' + escH(c.status) + ' on ' + escH(String(c.reviewedAt).slice(0, 16)) + '.</p>');
    const action = String(req.params.action);
    if (action === 'reject') { c.status = 'rejected'; c.reviewedAt = new Date().toISOString(); save(c); return page('❌ Rejected', '<p>' + escH(c.employerName) + ': nothing on the page changed.</p>'); }
    if (action !== 'approve') return reply.code(404).type('text/html').send('<h2>Not found</h2>');
    const p = c.proposed, day = new Date().toISOString().slice(0, 10);
    await prisma.employer.update({ where: { id: c.employerId }, data: {
      address: p.address,
      ...(p.point ? { lat: p.point.lat, lng: p.point.lng, locationChecked: new Date() } : {}),
      locationNote: [p.note, 'Given by the company (' + (c.claimant.role || 'staff') + ') and confirmed by BinaSmart on ' + day + '.'].filter(Boolean).join(' · '),
      ...(p.publicPhone ? { phone: p.publicPhone } : {}),
      ...(p.website ? { website: p.website } : {}),
    } });
    c.status = 'approved'; c.reviewedAt = new Date().toISOString(); save(c);
    return page('✅ Approved', '<p><b>' + escH(c.employerName) + '</b> now shows the address' + (p.point ? ' and the map pin (ride button on)' : '') + '.</p><p><a href="https://bina.et/employer/' + escH(c.slug) + '">Open the page →</a></p>');
  });

  fastify.get('/ops/employer-claims', async (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) return reply.code(401).type('text/html').send('<h2>Unauthorized</h2>');
    const rows = all().slice(0, 100);
    const card = c => `<div style="background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:12px 14px;margin:10px 0">
      <div style="display:flex;justify-content:space-between"><b>${escH(c.employerName)}</b><span style="color:#667;font-size:12.5px">${escH(c.status)} · ${escH(c.at.slice(0, 16).replace('T', ' '))}</span></div>
      <div>${escH(c.proposed.address)}${c.proposed.note ? ' · ' + escH(c.proposed.note) : ''}</div>
      <div style="color:#667;font-size:13px">${escH(c.claimant.name)}${c.claimant.role ? ', ' + escH(c.claimant.role) : ''} · ${escH(c.claimant.phone)}${c.proposed.point ? ' · pin by ' + escH(c.proposed.point.how) + ' <a href="https://www.openstreetmap.org/?mlat=' + c.proposed.point.lat + '&mlon=' + c.proposed.point.lng + '#map=18/' + c.proposed.point.lat + '/' + c.proposed.point.lng + '">map</a>' : ' · no pin'}</div>
      ${c.status === 'pending' ? `<div style="margin-top:8px;display:flex;gap:8px"><a href="/ops/employer-claims/${c.id}/approve?t=${escH(c.token)}">✅ Approve</a><a href="/ops/employer-claims/${c.id}/reject?t=${escH(c.token)}">❌ Reject</a></div>` : ''}</div>`;
    reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'private, no-store').type('text/html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Company address claims</title><body style="font-family:system-ui,'Noto Sans Ethiopic',sans-serif;background:#f5f6f8;padding:16px"><h1 style="font-size:19px">Company address claims</h1><div style="color:#667">${rows.filter(r => r.status === 'pending').length} waiting</div><div style="max-width:720px">${rows.map(card).join('') || '<p>None yet.</p>'}</div></body>`);
  });
};
module.exports.pointFrom = pointFrom;
module.exports.inEthiopia = inEthiopia;
