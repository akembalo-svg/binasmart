'use strict';
// BinaSmart Health dashboard (30 Sep 2026, Ibrahim: "any one back dashboard, also Afiya help all doctors, not front, back").
//   GET  /health/dashboard                 the page (public/health-dashboard.html), noindex
//   GET  /api/health/mine                  the signed-in account's checked profiles (doctor and/or facility)
//   POST /api/health/claim {code}          link a profile with the code the team gave on the verification call
//   POST /api/health/mine/:id              edit: services, hours, about, languages, fee, phone visibility, public number
//   POST /api/health/mine/:id/photo {uid}  a new photo (uploaded to /api/property/photo) waits for the team
//   POST /api/health/mine/:id/pause        {paused} the owner hides / shows their own page
//   POST /api/health/mine/:id/request      {text} name, profession, licence or workplace change: goes to the team
//   POST /api/health/assist                Dr Afiya for professionals (agents/afiya-pro), owners only, 40 a day
//   GET  /ops/health/:id/manage/:action?t= the team: newcode | hide | unhide | photo | photook | photono
// Who is who: the account comes from the better-auth session (req.authUser), never from the body. An account manages a
// profile when (1) it sent the profile signed in and the team approved it, (2) it typed the one-time code the team read
// out on the call, or (3) its phone is PROVEN (Telegram-signed contact) and equals the profile's phone.
// What stays with the team: name, profession, licence, workplace (a new licence check), and every photo.
// What the owner changes live: services, hours, about, languages, fee, phone visibility, public number. Each change is
// copied to the team on Telegram with a one-tap "hide page", so a bad edit costs one tap.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const D = require('./directory');
const ROOT = path.join(__dirname, '..');
const DOSE = require('../assistant/afiya').DOSAGE;
const HYPE = require('../agents/afiya-pro/rules').stripHype;

const TASKS = ['about', 'services', 'reply', 'standards', 'chat'];
const redact = s => String(s || '').replace(/(?:\+?251|\b0)[\s-]?[79](?:[\s-]?\d){8}/g, '[phone]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
const aboutText = s => String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 900);
const OWNED = ['live', 'paused', 'hidden'];

module.exports = function healthDashboard(fastify, { prisma, limiter, runAgent, agent, tell, isEval }, done) {
  const notify = t => Promise.resolve((tell || D.notify || (async () => false))(t)).catch(() => false);
  const claimRL = limiter(3600000, 8), editRL = limiter(3600000, 40), assistRL = limiter(86400000, 40), askRL = limiter(86400000, 5);
  const who = req => (req.authUser && req.authUser.id ? req.authUser : null);
  const ipOf = req => String(req.headers['x-real-ip'] || req.ip || '');
  const facs = () => (D.facilities ? D.facilities() : { byRef: new Map() });
  const mb = E => 'https://bina.et/ops/health/' + E.id + '/manage/';
  const hideLink = E => E.manageToken ? ' · <a href="' + mb(E) + 'hide?t=' + E.manageToken + '">hide page</a>' : '';
  const pub = E => E.type === 'doctor' ? '/doctors/' + E.slug : (facs().byRef.get(E.facilityRef) ? '/health/' + facs().byRef.get(E.facilityRef).slug : '/health');

  function view(E, S) {
    const fac = E.facilityRef ? facs().byRef.get(E.facilityRef) : null;
    const v = { id: E.id, type: E.type, status: E.status, name: E.name, services: E.services || [], hours: E.hours || '', about: E.about || '', url: pub(E),
      approvedAt: (E.approvedAt || '').slice(0, 10), updatedAt: (E.updatedAt || '').slice(0, 10), photoPending: !!(E.pendingPhotos || []).length,
      facility: fac ? { name: fac.name, slug: fac.slug, sub: fac.sub, ref: fac.ref } : E.facilityName ? { name: E.facilityName, slug: null, ref: null } : null };
    if (E.type === 'doctor') Object.assign(v, { profession: E.profession, professionLabel: (D.PROS[E.profession] || D.PROS.other)[0], specialty: E.specialty || '',
      languages: E.languages || [], fee: E.fee || '', showPhone: !!E.showPhone, whatsapp: !!E.whatsapp, phone: E.phone, area: E.area || '',
      licence: E.licence ? '••••' + String(E.licence).slice(-3) : '', licenceIssuer: E.licenceIssuer || '', photo: (E.photos || [])[0] || null });
    else Object.assign(v, { kind: E.kind, kindLabel: (D.KINDS[E.kind] || D.KINDS.clinic)[1], role: E.role, publicPhone: E.publicPhone || '',
      doctors: S.entries.filter(d => d.type === 'doctor' && d.status === 'live' && E.facilityRef && d.facilityRef === E.facilityRef).map(d => ({ name: d.name, slug: d.slug, profession: (D.PROS[d.profession] || D.PROS.other)[0] })) });
    return v;
  }
  async function provenPhone(uid) {
    try { const u = await prisma.authUser.findUnique({ where: { id: uid }, select: { phone: true, phoneVerifiedAt: true } }); return u && u.phone && u.phoneVerifiedAt ? u.phone : null; } catch (e) { return null; }
  }
  function ownedBy(S, id, uid) { return S.entries.find(e => e.id === String(id || '').slice(0, 20) && e.ownerUserId === uid && OWNED.includes(e.status)); }

  fastify.get('/health/dashboard', async (req, reply) => { reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store'); return reply.sendFile('health-dashboard.html'); });

  fastify.get('/api/health/mine', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const S = D.readStore(), phone = await provenPhone(u.id);
    // A proven phone that matches an unowned checked profile links it: the same number the team called.
    const found = phone ? S.entries.filter(e => OWNED.includes(e.status) && !e.ownerUserId && e.phone === phone) : [];
    if (found.length) {
      found.forEach(e => Object.assign(e, { ownerUserId: u.id, dashCode: null, dashCodeExpires: null, claimedAt: new Date().toISOString(), claimedBy: 'proven_phone' }));
      D.writeStore(S);
      found.forEach(e => notify('🔗 <b>' + D.esc(e.name) + '</b>: dashboard linked by the proven phone (…' + D.esc(String(phone).slice(-4)) + ').' + hideLink(e)));
    }
    return { ok: true, name: u.name || '', entries: S.entries.filter(e => e.ownerUserId === u.id && OWNED.includes(e.status)).map(e => view(e, S)) };
  });

  fastify.post('/api/health/claim', async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!claimRL('u:' + u.id) || !claimRL('ip:' + ipOf(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const code = String((req.body || {}).code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const S = D.readStore(), now = Date.now();
    // One answer for every failure: unknown, used, expired and mistyped all read the same from outside.
    const E = code.length === 8 ? S.entries.find(e => e.dashCode && D.tokEq(e.dashCode, code)) : null;
    if (!E || !OWNED.includes(E.status) || !(Date.parse(E.dashCodeExpires) > now)) return reply.code(400).send({ ok: false, error: 'bad_code' });
    const was = E.ownerUserId;
    Object.assign(E, { ownerUserId: u.id, dashCode: null, dashCodeExpires: null, claimedAt: new Date().toISOString(), claimedBy: 'code' });
    D.writeStore(S);
    notify('🔑 <b>' + D.esc(E.name) + '</b>: the dashboard code was used' + (was && was !== u.id ? ' (moved from the account that sent it)' : '') + '.' + hideLink(E));
    return { ok: true, id: E.id };
  });

  fastify.post('/api/health/mine/:id', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const S = D.readStore(), E = ownedBy(S, req.params.id, u.id), b = req.body || {};
    if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    const next = {};
    if (b.services !== undefined) next.services = D.list(b.services);
    if (b.hours !== undefined) next.hours = D.clean(b.hours, 120) || null;
    if (b.about !== undefined) next.about = aboutText(b.about);
    if (next.about && DOSE.test(next.about)) return reply.code(400).send({ ok: false, error: 'about_dose' });
    if (E.type === 'doctor') {
      if (b.specialty !== undefined) next.specialty = D.clean(b.specialty, 60) || null;
      if (b.languages !== undefined) next.languages = D.list(b.languages).slice(0, 8);
      if (b.fee !== undefined) next.fee = D.clean(b.fee, 40) || null;
      if (b.showPhone !== undefined) next.showPhone = b.showPhone === true;
      if (b.whatsapp !== undefined) next.whatsapp = b.whatsapp === true && (b.showPhone === true || (b.showPhone === undefined && E.showPhone));
    } else if (b.publicPhone !== undefined) {
      const p = String(b.publicPhone || '').trim();
      next.publicPhone = p ? D.ethPhone(p) : null;
      if (p && !next.publicPhone) return reply.code(400).send({ ok: false, error: 'phone' });
    }
    const changed = Object.keys(next).filter(k => JSON.stringify(next[k] || null) !== JSON.stringify(E[k] || null));
    if (!changed.length) return { ok: true, changed: [] };
    changed.forEach(k => { E[k] = next[k]; });
    E.updatedAt = new Date().toISOString();
    D.writeStore(S);
    const show = k => { const v = E[k]; return Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : (v || '—'); };
    const flag = next.about && HYPE(next.about).removed ? '\n⚠️ The About text makes a promise ("best", "guaranteed", "cure"…): check it.' : '';
    notify('✏️ <b>' + D.esc(E.name) + '</b> edited the page (live now)\n' + changed.map(k => '• ' + k + ': ' + D.esc(show(k)).slice(0, 300)).join('\n') + flag
      + '\n<a href="https://bina.et' + pub(E) + '">page</a>' + hideLink(E));
    return { ok: true, changed, entry: view(E, S) };
  });

  fastify.post('/api/health/mine/:id/photo', async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const S = D.readStore(), E = ownedBy(S, req.params.id, u.id), uid = (req.body || {}).uid;
    if (!E || E.type !== 'doctor') return reply.code(404).send({ ok: false, error: 'not_found' });
    const files = D.uidOk(uid) ? D.pendingPhotos(uid).slice(-1) : [];
    if (!files.length) return reply.code(400).send({ ok: false, error: 'no_photo' });
    (E.pendingPhotos || []).forEach(f => { try { if (f.startsWith(D.PEND) && !files.includes(f)) fs.unlinkSync(f); } catch (x) {} });
    E.pendingPhotos = files; D.writeStore(S);
    notify('📷 <b>' + D.esc(E.name) + '</b> sent a new profile photo (not live).\n<a href="' + mb(E) + 'photo?t=' + E.manageToken + '">see it</a> · <a href="' + mb(E) + 'photook?t=' + E.manageToken + '">✅ use it</a> · <a href="' + mb(E) + 'photono?t=' + E.manageToken + '">❌ refuse</a>');
    return { ok: true, pending: true };
  });

  fastify.post('/api/health/mine/:id/pause', async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const S = D.readStore(), E = ownedBy(S, req.params.id, u.id);
    if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (E.status === 'hidden') return reply.code(403).send({ ok: false, error: 'hidden_by_team' });
    E.status = (req.body || {}).paused === true ? 'paused' : 'live'; E.updatedAt = new Date().toISOString(); D.writeStore(S);
    notify((E.status === 'paused' ? '⏸ ' : '▶️ ') + '<b>' + D.esc(E.name) + '</b> ' + (E.status === 'paused' ? 'paused' : 'showed again') + ' their page.');
    return { ok: true, status: E.status };
  });

  fastify.post('/api/health/mine/:id/request', { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!askRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const S = D.readStore(), E = ownedBy(S, req.params.id, u.id), text = D.clean((req.body || {}).text, 600);
    if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (text.length < 5) return reply.code(400).send({ ok: false, error: 'text' });
    await notify('📝 <b>Change request</b> from ' + D.esc(E.name) + ' (' + D.esc(E.type) + ')\n📞 ' + D.esc(E.phone) + '\n"' + D.esc(text) + '"\nName, profession, licence or workplace: call and check before changing it.');
    return { ok: true };
  });

  fastify.get('/ops/health/:id/manage/:action', async (req, reply) => {
    reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store');
    const S = D.readStore(), E = S.entries.find(e => e.id === String(req.params.id).slice(0, 20)), act = String(req.params.action);
    if (!E || !E.manageToken || !D.tokEq(req.query.t, E.manageToken)) return reply.code(404).send('not found');
    const page = m => reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px;font-size:18px">' + m + '</p>');
    const f = (E.pendingPhotos || [])[0];
    if (act === 'photo') { if (!f || !f.startsWith(D.PEND) || !fs.existsSync(f)) return reply.code(404).send('no photo'); return reply.type('image/jpeg').send(fs.readFileSync(f)); }
    if (act === 'photono') { try { if (f && f.startsWith(D.PEND)) fs.unlinkSync(f); } catch (x) {} E.pendingPhotos = []; D.writeStore(S); return page('❌ Photo refused: ' + D.esc(E.name)); }
    if (act === 'photook') {
      if (!f || !f.startsWith(D.PEND) || !fs.existsSync(f)) return page('No photo waiting.');
      fs.mkdirSync(D.PUB, { recursive: true });
      const out = path.join(D.PUB, E.slug + '.webp');
      try { require('child_process').execFileSync('python3', [path.join(ROOT, 'ops', 'places', 'owner-photo.py'), f, out], { timeout: 60000, stdio: 'pipe' }); fs.unlinkSync(f); }
      catch (x) { return page('The photo could not be processed: ' + D.esc(String(x.message || x).slice(0, 120))); }
      Object.assign(E, { pendingPhotos: [], photos: ['https://bina.et/static/health/img/' + path.basename(out) + '?v=' + Math.floor(Date.now() / 1000)], updatedAt: new Date().toISOString() });
      D.writeStore(S); return page('✅ Photo live: <a href="' + pub(E) + '">' + D.esc(E.name) + '</a>');
    }
    if (act === 'newcode') {
      Object.assign(E, { dashCode: D.newCode(), dashCodeExpires: new Date(Date.now() + 30 * 864e5).toISOString() }); D.writeStore(S);
      return page('🔑 New dashboard code for ' + D.esc(E.name) + ': <b style="font-size:24px;letter-spacing:.08em">' + D.fmtCode(E.dashCode) + '</b><br>Works once, for 30 days. The old one no longer works.');
    }
    if (act === 'hide') { if (E.status !== 'pending' && E.status !== 'rejected') { E.status = 'hidden'; D.writeStore(S); }
      return page('🙈 Hidden: ' + D.esc(E.name) + ' · <a href="' + mb(E) + 'unhide?t=' + E.manageToken + '">show it again</a>'); }
    if (act === 'unhide') { if (E.status === 'hidden') { E.status = 'live'; D.writeStore(S); } return page('👁 Live again: <a href="' + pub(E) + '">' + D.esc(E.name) + '</a>'); }
    return reply.code(400).send('newcode, hide, unhide, photo, photook or photono');
  });

  // ---- Dr Afiya for professionals ----
  fastify.post('/api/health/assist', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const u = who(req), b = req.body || {};
    // The evaluation door (loopback or the owner key, api/evalGate.js): a made-up profile, no account, no store.
    if (!u && isEval && isEval(req) && b.evalProfile && typeof b.evalProfile === 'object') {
      const p = b.evalProfile, task = TASKS.includes(b.task) ? b.task : 'chat';
      const profile = { kind: D.clean(p.kind, 60), name: D.clean(p.name, 80), profession: D.clean(p.profession, 60) || null, specialty: D.clean(p.specialty, 60) || null,
        facility: D.clean(p.facility, 90) || null, area: D.clean(p.area, 60) || null, services: D.list(p.services), languages: D.list(p.languages), hours: D.clean(p.hours, 120) || null, fee: D.clean(p.fee, 40) || null, about: null };
      return runAgent(agent, { body: { message: redact(b.message).slice(0, 2000), user: { uid: 'hp-eval' } }, headers: req.headers, ip: req.ip, log: req.log }, reply, { scope: { task, profile } });
    }
    if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const S = D.readStore(), E = ownedBy(S, b.entryId, u.id);
    if (!E) return reply.code(403).send({ ok: false, error: 'not_yours' });
    const task = TASKS.includes(b.task) ? b.task : 'chat';
    const message = redact(b.message).trim().slice(0, 2000);
    if (!message) return reply.code(400).send({ ok: false, error: 'message required' });
    const fac = E.facilityRef ? facs().byRef.get(E.facilityRef) : null;
    const profile = { kind: E.type === 'doctor' ? 'Individual health professional' : (D.KINDS[E.kind] || D.KINDS.clinic)[1], name: E.name,
      profession: E.type === 'doctor' ? (D.PROS[E.profession] || D.PROS.other)[0] : null, specialty: E.specialty || null,
      facility: E.type === 'doctor' ? (fac ? fac.name : E.facilityName || 'own practice') : null, area: (fac && fac.sub) || E.area || null,
      services: E.services || [], languages: E.languages || [], hours: E.hours || null, fee: E.fee || null, about: E.about || null };
    const inner = { body: { message, user: { uid: 'hp-' + String(u.id).slice(0, 40) } }, headers: req.headers, ip: req.ip, log: req.log };
    return runAgent(agent, inner, reply, { scope: { task, profile }, limit: () => assistRL('u:' + u.id) });
  });

  done();
};
module.exports.redact = redact;
module.exports.aboutText = aboutText;
