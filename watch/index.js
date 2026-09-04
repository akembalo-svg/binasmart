'use strict';
// BinaSmart Watch: licensed films whose video lives elsewhere (YouTube, or an mp4/HLS link on
// another server). Free films play at once; paid films are rented per film for film.rentHours via
// Chapa. The source URL of a paid film is only ever returned by the play call after the rental check.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tgauth = require('../ride/tgauth');
const { normPhone } = require('../ride/phone');
const { makeTgApi } = require('../ride/tgApi');
const { isPublic, canPlay, embedFor } = require('./rules');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => { const b = crypto.randomBytes(6); let s = ''; for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % 32]; return 'BW-' + s; };
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200) || null;
const intOr = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
const KINDS = ['youtube', 'mp4', 'hls'];
const escAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function limiter(windowMs, max) { const m = new Map(); return key => { const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs); if (hits.length >= max) return false; hits.push(now); m.set(key, hits); return true; }; }
const clientIp = req => String(req.headers['x-real-ip'] || req.ip);

function pubFilm(f, extra) {
  return { slug: f.slug, title: f.title, titleAm: f.titleAm, year: f.year, runtimeMin: f.runtimeMin, rating: f.rating, language: f.language, genre: f.genre, descr: f.descr, posterUrl: f.posterUrl,
    priceEtb: f.priceEtb, rentHours: f.rentHours, free: !f.priceEtb, kind: f.sourceKind, views: f.views, createdAt: f.createdAt, ...(extra || {}) };
}
const pubRental = r => ({ code: r.code, status: r.status, priceEtb: r.priceEtb, startsAt: r.startsAt, expiresAt: r.expiresAt, film: r.film ? pubFilm(r.film) : undefined });

// registerWatch(fastify, { prisma, OWNER_KEY, BASE_URL, chapa?, tgApi?, riderBotToken?, force?, now? })
module.exports = function registerWatch(fastify, deps) {
  if (process.env.CINEMA_ENABLED !== '1' && !deps.force) { console.log('[watch] disabled (CINEMA_ENABLED != 1)'); return null; }
  const prisma = deps.prisma, base = (deps.BASE_URL || 'https://bina.et').replace(/\/$/, '');
  const clock = deps.now || Date.now;
  const chapa = deps.chapa || null, chapaOn = !!(chapa && chapa.enabled);
  const riderBotToken = deps.riderBotToken != null ? deps.riderBotToken : (process.env.BINA_RIDER_BOT_TOKEN || '');
  const api = deps.tgApi || (riderBotToken ? makeTgApi({ token: riderBotToken }) : null);
  const ops = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== deps.OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };
  const rentRL = limiter(600000, 10), playRL = limiter(60000, 60);
  const shellPath = path.join(__dirname, '..', 'public', 'watch.html');

  const publicWhere = () => ({ status: 'public', NOT: { rights: null }, OR: [{ rightsUntil: null }, { rightsUntil: { gt: new Date(clock()) } }] });
  const loadFilm = slug => prisma.film.findUnique({ where: { slug: String(slug || '') } });
  const loadRental = code => prisma.rental.findUnique({ where: { code: String(code || '').toUpperCase() }, include: { film: true } });
  async function expireIfDue(r) {
    if (r && r.status === 'ACTIVE' && r.expiresAt && new Date(r.expiresAt).getTime() <= clock()) { await prisma.rental.updateMany({ where: { id: r.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } }); r.status = 'EXPIRED'; }
    return r;
  }
  async function tell(r, text) {
    if (!r.telegramId || !api) return false;
    try { await api.sendMessage(String(r.telegramId), text, { reply_markup: { inline_keyboard: [[{ text: '▶️ ይመልከቱ · Watch', web_app: { url: base + '/watch/' + r.film.slug + '?rental=' + r.code } }]] } }); return true; }
    catch (e) { console.error('[watch] telegram: ' + e.message); return false; }
  }

  // ---------- pages ----------
  fastify.get('/ops/watch', async (req, reply) => reply.sendFile('ops-watch.html'));
  async function page(slug) {
    let html = fs.readFileSync(shellPath, 'utf8');
    if (!slug) return html;
    const f = await loadFilm(slug);
    if (!f || !isPublic(f, clock())) return html;
    const title = (f.titleAm || f.title) + (f.titleAm && f.title !== f.titleAm ? ' (' + f.title + ')' : '') + (f.year ? ' · ' + f.year : '') + ' | BinaSmart Watch';
    const desc = (f.descr || (f.titleAm || f.title) + ' — ' + (f.priceEtb ? f.priceEtb + ' ብር ለ' + f.rentHours + ' ሰዓት' : 'ነፃ · free') + ' በBinaSmart Watch።').slice(0, 300);
    const ld = { '@context': 'https://schema.org', '@type': 'Movie', name: f.titleAm || f.title, alternateName: f.title !== f.titleAm ? f.title : undefined, description: f.descr || undefined, image: f.posterUrl || undefined, inLanguage: f.language,
      duration: f.runtimeMin ? 'PT' + f.runtimeMin + 'M' : undefined, contentRating: f.rating || undefined, url: base + '/watch/' + f.slug,
      offers: { '@type': 'Offer', price: f.priceEtb, priceCurrency: 'ETB', url: base + '/watch/' + f.slug, category: f.priceEtb ? 'rental' : 'free' } };
    html = html.replace(/<title>[^<]*<\/title>/, '<title>' + escAttr(title) + '</title>')
      .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escAttr(desc) + '">')
      .replace('<link rel="canonical" href="https://bina.et/watch">', '<link rel="canonical" href="' + base + '/watch/' + f.slug + '">')
      .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + escAttr(f.titleAm || f.title) + '">')
      .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + escAttr(desc) + '">')
      .replace('<meta property="og:url" content="https://bina.et/watch">', '<meta property="og:url" content="' + base + '/watch/' + f.slug + '">');
    if (f.posterUrl) html = html.replace(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + escAttr(f.posterUrl) + '">');
    return html.replace('</head>', '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>\n</head>');
  }
  fastify.get('/watch', async (req, reply) => { try { return reply.type('text/html; charset=utf-8').send(await page(null)); } catch (e) { return reply.sendFile('watch.html'); } });
  fastify.get('/watch/:slug', async (req, reply) => { try { return reply.type('text/html; charset=utf-8').send(await page(req.params.slug)); } catch (e) { return reply.sendFile('watch.html'); } });

  // ---------- public API ----------
  fastify.get('/api/watch/films', async () => {
    const films = await prisma.film.findMany({ where: publicWhere(), orderBy: { createdAt: 'desc' }, take: 200 });
    return { ok: true, chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null }, films: films.filter(f => isPublic(f, clock())).map(f => pubFilm(f)) };
  });
  fastify.get('/api/watch/films/:slug', async (req, reply) => {
    const f = await loadFilm(req.params.slug);
    if (!f || !isPublic(f, clock())) return reply.code(404).send({ ok: false, error: 'unavailable' });
    let rental = null;
    if (req.query.rental) { rental = await expireIfDue(await loadRental(req.query.rental)); if (rental && rental.filmId !== f.id) rental = null; }
    return { ok: true, film: pubFilm(f), rental: rental ? pubRental(rental) : null, chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null } };
  });
  // The only place a source URL leaves the server.
  fastify.post('/api/watch/films/:slug/play', async (req, reply) => {
    if (!playRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const f = await loadFilm(req.params.slug);
    if (!f) return reply.code(404).send({ ok: false, error: 'unavailable' });
    const code = (req.body || {}).rental;
    const rental = code ? await expireIfDue(await loadRental(code)) : null;
    const r = canPlay(f, rental, clock());
    if (!r.ok) return reply.code(r.error === 'unavailable' ? 404 : 402).send({ ok: false, error: r.error, priceEtb: f.priceEtb, rentHours: f.rentHours, chapa: chapaOn });
    const src = embedFor(f);
    if (!src) return reply.code(500).send({ ok: false, error: 'bad_source' });
    await prisma.film.updateMany({ where: { id: f.id }, data: { views: { increment: 1 } } });
    return { ok: true, source: src, free: r.free, expiresAt: r.expiresAt || null };
  });

  // ---------- rent ----------
  fastify.post('/api/watch/rent', async (req, reply) => {
    const b = req.body || {};
    const f = await loadFilm(b.slug);
    if (!f || !isPublic(f, clock())) return reply.code(404).send({ ok: false, error: 'unavailable' });
    if (!f.priceEtb) return reply.code(400).send({ ok: false, error: 'free' });
    if (!chapaOn) return reply.code(409).send({ ok: false, error: 'chapa_off' });
    let tg = null, contact = null;
    if (b.tg && b.tg.initData) { tg = tgauth.verifyInitData(b.tg.initData, riderBotToken); if (!tg) return reply.code(401).send({ ok: false, error: 'tg_expired' }); if (b.tg.contact) contact = tgauth.verifyContact(b.tg.contact, riderBotToken); }
    const name = str(b.name, 60) || (tg ? [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ') : null);
    const phone = normPhone(contact ? contact.phone : b.phone);
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone' });
    if (!name) return reply.code(400).send({ ok: false, error: 'name' });
    if (!rentRL(phone) || !rentRL('ip:' + clientIp(req))) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const ref = 'bina-w-' + crypto.randomBytes(5).toString('hex');
    let rental;
    for (let i = 0; i < 3 && !rental; i++) { try { rental = await prisma.rental.create({ data: { code: makeCode(), filmId: f.id, name, phone, telegramId: tg ? String(tg.user.id) : null, priceEtb: f.priceEtb, chapaRef: ref, status: 'PENDING' } }); } catch (e) { if (e.code !== 'P2002') throw e; } }
    if (!rental) return reply.code(500).send({ ok: false, error: 'code_collision' });
    let checkoutUrl = null;
    try { checkoutUrl = await chapa.init({ amount: f.priceEtb, ref, name, phone, returnUrl: base + '/watch/' + f.slug + '?rental=' + rental.code + '&paid=1', title: f.titleAm || f.title }); } catch (e) { console.error('[watch] chapa init: ' + e.message); }
    if (!checkoutUrl) return reply.code(502).send({ ok: false, error: 'chapa_failed', rental: pubRental(rental) });
    return { ok: true, rental: pubRental(rental), checkoutUrl };
  });
  async function activate(r) {
    const startsAt = new Date(clock()), expiresAt = new Date(startsAt.getTime() + (r.film.rentHours || 48) * 3600000);
    const u = await prisma.rental.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'ACTIVE', startsAt, expiresAt } });
    if (u.count) { r.status = 'ACTIVE'; r.startsAt = startsAt; r.expiresAt = expiresAt; tell(r, '✅ ' + (r.film.titleAm || r.film.title) + ' — ተከፍሏል። እስከ ' + expiresAt.toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' ድረስ ይመልከቱ · rented for ' + (r.film.rentHours || 48) + ' hours.\n' + base + '/watch/' + r.film.slug + '?rental=' + r.code); }
    return r;
  }
  async function confirmChapa(ref) {
    const r = await prisma.rental.findFirst({ where: { chapaRef: String(ref) }, include: { film: true } });
    if (!r) return { ok: false, error: 'unknown' };
    if (r.status !== 'PENDING') return { ok: true, status: r.status, already: true };
    if (!chapaOn || !(await chapa.verify(r.chapaRef))) return { ok: false, error: 'unpaid', status: r.status };
    await activate(r);
    return { ok: true, status: 'ACTIVE', rental: pubRental(r) };
  }
  fastify.get('/api/watch/rentals/:code', async (req, reply) => {
    const r = await expireIfDue(await loadRental(req.params.code));
    return r ? { ok: true, rental: pubRental(r) } : reply.code(404).send({ ok: false, error: 'unknown' });
  });
  fastify.post('/api/watch/rentals/:code/verify', async (req, reply) => {
    const r = await loadRental(req.params.code);
    if (!r) return reply.code(404).send({ ok: false, error: 'unknown' });
    if (r.status !== 'PENDING') return { ok: true, status: r.status, rental: pubRental(await expireIfDue(r)) };
    const c = await confirmChapa(r.chapaRef);
    return c.ok ? c : reply.code(402).send(c);
  });

  // ---------- ops ----------
  const filmData = (b, existing) => {
    const kind = KINDS.includes(b.sourceKind) ? b.sourceKind : (existing ? existing.sourceKind : 'youtube');
    const d = { title: str(b.title, 120), titleAm: str(b.titleAm, 120), year: b.year ? intOr(b.year, null) : null, runtimeMin: b.runtimeMin ? intOr(b.runtimeMin, null) : null, rating: str(b.rating, 12), language: str(b.language, 40) || 'Amharic', genre: str(b.genre, 60),
      descr: str(b.descr, 3000), posterUrl: str(b.posterUrl, 400), sourceKind: kind, sourceUrl: str(b.sourceUrl, 600), priceEtb: Math.max(0, intOr(b.priceEtb, 0)), rentHours: Math.min(720, Math.max(1, intOr(b.rentHours, 48))),
      rights: str(b.rights, 600), rightsUntil: b.rightsUntil && !isNaN(Date.parse(b.rightsUntil)) ? new Date(b.rightsUntil) : null, status: b.status === 'public' ? 'public' : 'draft' };
    return d;
  };
  const validate = d => { if (!d.title) return 'title required'; if (!d.sourceUrl) return 'sourceUrl required'; if (!embedFor(d)) return 'sourceUrl is not a valid ' + d.sourceKind + ' link (https, or a YouTube URL/id)'; if (d.status === 'public' && !d.rights) return 'a rights note is required before a film can be public'; return null; };
  fastify.get('/api/watch/ops/films', async (req, reply) => {
    if (!ops(req, reply)) return;
    const films = await prisma.film.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return { ok: true, chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null }, films: films.map(f => ({ ...pubFilm(f), sourceUrl: f.sourceUrl, rights: f.rights, rightsUntil: f.rightsUntil, status: f.status, public: isPublic(f, clock()) })) };
  });
  fastify.post('/api/watch/ops/films', async (req, reply) => {
    if (!ops(req, reply)) return;
    const d = filmData(req.body || {}); const err = validate(d); if (err) return reply.code(400).send({ ok: false, error: err });
    const slug = (slugify((req.body || {}).slug || d.title) || 'film') + (await prisma.film.findUnique({ where: { slug: slugify((req.body || {}).slug || d.title) || 'film' } }) ? '-' + crypto.randomBytes(2).toString('hex') : '');
    const f = await prisma.film.create({ data: { slug, ...d } });
    return { ok: true, film: { ...pubFilm(f), status: f.status, rights: f.rights } };
  });
  fastify.post('/api/watch/ops/films/:slug', async (req, reply) => {
    if (!ops(req, reply)) return;
    const f = await loadFilm(req.params.slug); if (!f) return reply.code(404).send({ ok: false, error: 'unknown' });
    const d = filmData({ ...f, ...(req.body || {}) }, f); const err = validate(d); if (err) return reply.code(400).send({ ok: false, error: err });
    const u = await prisma.film.update({ where: { id: f.id }, data: d });
    return { ok: true, film: { ...pubFilm(u), status: u.status, rights: u.rights, public: isPublic(u, clock()) } };
  });
  fastify.get('/api/watch/ops/rentals', async (req, reply) => {
    if (!ops(req, reply)) return;
    const rs = await prisma.rental.findMany({ orderBy: { createdAt: 'desc' }, take: 300, include: { film: true } });
    return { ok: true, rentals: rs.map(r => ({ ...pubRental(r), name: r.name, phone: r.phone, telegram: !!r.telegramId, chapaRef: r.chapaRef, createdAt: r.createdAt })) };
  });

  console.log('[watch] mounted' + (chapaOn ? ' chapa=' + chapa.mode : ' chapa=off (rentals disabled)'));
  return { confirmChapa };
};
