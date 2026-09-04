'use strict';
// HTTP surface of the cinema module. Public: shows, seat map, holds, checkout, ticket, QR, Chapa
// verify. Ops (owner key): venues, halls, events, shows, tickets, check-in. The client is never
// trusted for seats or prices: holds live in the DB, prices come from the Show.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tgauth = require('../ride/tgauth');
const { validateLayout, capacityOf, isGa, summarise } = require('./seatmap');
const { HOLD_MS, MAX_SEATS, MAX_GA, SOLD_STATES } = require('./holds');
const { makePosters } = require('./posters');
const { youtubeId } = require('../watch/rules');
const trailerOf = url => { const id = youtubeId(url); return id ? { trailerId: id, trailerEmbed: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1', trailerThumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' } : {}; };

function limiter(windowMs, max) {
  const m = new Map();
  return key => {
    const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now); m.set(key, hits);
    if (m.size > 5000) for (const [k, v] of m) { if (!v.length || now - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}
function clientIp(req) { return String(req.headers['x-real-ip'] || req.ip); }
const HOLDER_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SHOW_STATUS = ['onsale', 'soldout', 'cancelled', 'closed'];
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200) || null;
const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const SHOW_INCLUDE = { event: true, hall: { include: { venue: true } } };

function pubShow(s) {
  const e = s.event || {}, h = s.hall || {}, v = h.venue || {};
  return { id: s.id, startsAt: s.startsAt, status: s.status, prices: s.prices, counterCutoffMin: s.counterCutoffMin,
    event: { id: e.id, slug: e.slug, title: e.title, titleAm: e.titleAm, kind: e.kind, posterUrl: e.posterUrl, runtimeMin: e.runtimeMin, rating: e.rating, language: e.language, descr: e.descr, emoji: e.emoji },
    venue: { id: v.id, slug: v.slug, name: v.name, nameAm: v.nameAm, address: v.address, phone: v.phone, lat: v.lat, lng: v.lng },
    hall: { id: h.id, name: h.name, capacity: h.capacity, sections: (h.layout && h.layout.sections) || [] }, ga: isGa(h.layout || {}) };
}
function pubTicket(t, show) {
  const sh = t.show || show || null;
  const L = sh && sh.hall && sh.hall.layout;
  return { code: t.code, status: t.status, seats: t.seats, summary: L ? summarise(L, t.seats) : null, name: t.name, phone: t.phone, total: t.total, payMethod: t.payMethod,
    chapaPending: t.payMethod === 'chapa' && t.status === 'RESERVED', createdAt: t.createdAt, checkedInAt: t.checkedInAt, show: sh ? pubShow(sh) : null };
}
const ERR_CODE = { taken: 409, sold: 409, sold_out: 409, no_such_section: 400, not_ga: 400, bad_qty: 400, hold_expired: 409, already_checked_in: 409, unpaid: 409, cancelled: 409, wrong_show: 409,
  show_closed: 410, no_show: 404, unknown: 404, no_such_seat: 400, too_many: 400, no_seats: 400, phone: 400, name: 400, holder: 400 };
const fail = (reply, r) => reply.code(ERR_CODE[r.error] || 400).send({ ok: false, ...r });

module.exports = function cinemaRoutes(fastify, { prisma, holds, tickets, checkin, OWNER_KEY, riderBotToken, chapa, BASE_URL, notify }) {
  const base = (BASE_URL || 'https://bina.et').replace(/\/$/, '');
  // Per-holder limits are tight; per-IP limits are loose on purpose: Ethio telecom puts whole
  // neighbourhoods behind one address, so an IP is a crowd, not a person.
  const holdRL = limiter(60000, 60), buyRL = limiter(600000, 5), buyIpRL = limiter(600000, 80), lookupRL = limiter(60000, 120), ipRL = limiter(60000, 600);
  const chapaOn = !!(chapa && chapa.enabled);
  const posters = makePosters({});   // TMDB when TMDB_API_KEY is set; otherwise a no-op
  const ops = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };
  const holderOf = req => { const h = String(req.headers['x-holder'] || (req.query && req.query.holder) || ''); return HOLDER_RE.test(h) ? h : null; };
  const loadShow = id => prisma.show.findUnique({ where: { id: String(id) }, include: SHOW_INCLUDE });
  const tell = async (ticket, text) => { if (!notify) return false; try { return await notify(ticket, text); } catch (e) { console.error('[cinema] notify: ' + e.message); return false; } };

  // ---------- pages ----------
  for (const [p, f] of [['/ticket/:code', 'ticket.html'], ['/scan', 'scan.html'], ['/ops/cinema', 'ops-cinema.html'], ['/for-cinemas', 'for-cinemas.html']]) {
    fastify.get(p, async (req, reply) => reply.sendFile(f));
  }
  // /cinema and /cinema/<id> are the static shell with Event schema (Google rich results) and, for a
  // single show, its own title/description/canonical injected server-side. Any failure falls back to
  // the plain file, so SEO can never take the page down.
  const shellPath = path.join(__dirname, '..', 'public', 'cinema.html');
  const ldFor = (s, seatsLeft) => {
    const e = s.event || {}, h = s.hall || {}, v = h.venue || {};
    const prices = Object.values(s.prices || {}).map(Number).filter(Number.isFinite);
    const url = base + '/cinema/' + s.id;
    const o = { '@type': e.kind === 'FILM' ? 'ScreeningEvent' : 'Event', '@id': url + '#event', name: e.titleAm || e.title, alternateName: e.titleAm && e.title !== e.titleAm ? e.title : undefined,
      description: e.descr || undefined, image: e.posterUrl || undefined, url, startDate: new Date(s.startsAt).toISOString(), eventStatus: 'https://schema.org/' + (s.status === 'cancelled' ? 'EventCancelled' : 'EventScheduled'),
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', inLanguage: e.language || 'am',
      location: { '@type': e.kind === 'FILM' ? 'MovieTheater' : 'Place', name: v.name, alternateName: v.nameAm || undefined, telephone: v.phone || undefined,
        address: { '@type': 'PostalAddress', streetAddress: v.address || undefined, addressLocality: 'Addis Ababa', addressCountry: 'ET' },
        geo: v.lat && v.lng ? { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lng } : undefined },
      organizer: { '@type': 'Organization', name: 'BinaSmart', url: base },
      offers: prices.length ? { '@type': 'Offer', url, price: Math.min(...prices), priceCurrency: 'ETB', availability: 'https://schema.org/' + (seatsLeft > 0 ? 'InStock' : 'SoldOut'), validFrom: new Date(s.createdAt || Date.now()).toISOString() } : undefined };
    if (e.kind === 'FILM') o.workPresented = { '@type': 'Movie', name: e.title, alternateName: e.titleAm || undefined, duration: e.runtimeMin ? 'PT' + e.runtimeMin + 'M' : undefined, contentRating: e.rating || undefined };
    return o;
  };
  const escAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  async function cinemaPage(showId) {
    let html = fs.readFileSync(shellPath, 'utf8');
    let ld;
    if (showId) {
      const s = await loadShow(showId);
      if (!s || !s.hall || !s.event) return html;
      const sold = (await prisma.ticket.findMany({ where: { showId: s.id, status: { in: SOLD_STATES } } })).reduce((n, t) => n + (t.seats || []).length, 0);
      ld = ldFor(s, (s.hall.capacity || 0) - sold);
      const v = s.hall.venue || {}, e = s.event;
      const when = new Date(s.startsAt).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const title = (e.titleAm || e.title) + ' · ' + when + ' · ' + (v.nameAm || v.name || '') + ' | BinaSmart Cinema';
      const desc = (e.titleAm || e.title) + (e.title !== e.titleAm && e.titleAm ? ' (' + e.title + ')' : '') + ' — ' + when + ' በ' + (v.name || '') + '። ወንበርዎን ይምረጡ፣ ከ' + Math.min(...Object.values(s.prices || {}).map(Number)) + ' ብር። Pick your seat online, QR ticket, pay on Chapa or at the counter.';
      html = html.replace(/<title>[^<]*<\/title>/, '<title>' + escAttr(title) + '</title>')
        .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escAttr(desc) + '">')
        .replace('<link rel="canonical" href="https://bina.et/cinema">', '<link rel="canonical" href="' + base + '/cinema/' + s.id + '">')
        .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + escAttr((e.titleAm || e.title) + ' · ' + when) + '">')
        .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + escAttr(desc) + '">')
        .replace('<meta property="og:url" content="https://bina.et/cinema">', '<meta property="og:url" content="' + base + '/cinema/' + s.id + '">');
      if (e.posterUrl) html = html.replace(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + escAttr(e.posterUrl) + '">');
    } else {
      const shows = await prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: new Date(Date.now() - 3600000) } }, include: SHOW_INCLUDE, orderBy: { startsAt: 'asc' }, take: 50 });
      const ids = shows.map(s => s.id);
      const sold = ids.length ? await prisma.ticket.findMany({ where: { showId: { in: ids }, status: { in: SOLD_STATES } } }) : [];
      const taken = {}; for (const t of sold) taken[t.showId] = (taken[t.showId] || 0) + (t.seats || []).length;
      const items = shows.filter(s => s.hall && s.event).map(s => ldFor(s, (s.hall.capacity || 0) - (taken[s.id] || 0)));
      // Programme trailers as VideoObjects (Google video rich results); one per distinct trailer.
      const progs = await prisma.programme.findMany({ where: { active: true, dateTo: { gte: TZ_DAY() }, NOT: { trailerUrl: null } }, include: { venue: true }, take: 100 });
      const seen = new Set(); const videos = [];
      for (const p of progs) { const t = trailerOf(p.trailerUrl); if (!t.trailerId || seen.has(t.trailerId)) continue; seen.add(t.trailerId);
        videos.push({ '@type': 'VideoObject', '@id': base + '/cinema#trailer-' + t.trailerId, name: (p.titleAm || p.title) + ' — trailer', description: (p.titleAm || p.title) + (p.venue ? ' · ' + p.venue.name + ' · ' + p.times.join(', ') : ''), thumbnailUrl: [t.trailerThumb], uploadDate: new Date(p.postedAt || p.createdAt).toISOString(), embedUrl: t.trailerEmbed, contentUrl: 'https://www.youtube.com/watch?v=' + t.trailerId, url: base + '/cinema#whatson' }); }
      const graph = []; if (items.length) graph.push({ '@type': 'ItemList', '@id': base + '/cinema#shows', name: 'Shows on sale · BinaSmart Cinema', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, item: it })) });
      ld = graph.length || videos.length ? { '@graph': [...graph, ...videos] } : null;
    }
    if (ld) html = html.replace('</head>', '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', ...ld }).replace(/</g, '\\u003c') + '</script>\n</head>');
    return html;
  }
  fastify.get('/cinema', async (req, reply) => { try { return reply.type('text/html; charset=utf-8').send(await cinemaPage(null)); } catch (e) { console.error('[cinema] page: ' + e.message); return reply.sendFile('cinema.html'); } });
  fastify.get('/cinema/:showId', async (req, reply) => { try { return reply.type('text/html; charset=utf-8').send(await cinemaPage(String(req.params.showId))); } catch (e) { console.error('[cinema] show page: ' + e.message); return reply.sendFile('cinema.html'); } });

  // ---------- public ----------
  fastify.get('/api/cinema/shows', async () => {
    const since = new Date(Date.now() - 3600000);
    const shows = await prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: since } }, include: SHOW_INCLUDE, orderBy: { startsAt: 'asc' }, take: 200 });
    const ids = shows.map(s => s.id);
    const sold = ids.length ? await prisma.ticket.findMany({ where: { showId: { in: ids }, status: { in: SOLD_STATES } } }) : [];
    const taken = {}; for (const t of sold) taken[t.showId] = (taken[t.showId] || 0) + (t.seats || []).length;
    return { ok: true, chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null },
      shows: shows.filter(s => s.event && s.hall).map(s => ({ ...pubShow(s), seatsLeft: Math.max(0, (s.hall.capacity || 0) - (taken[s.id] || 0)),
        from: Math.min(...Object.values(s.prices || {}).map(Number).filter(Number.isFinite)) })) };
  });

  // Public directory of venues (all active cinemas, with or without shows on sale).
  fastify.get('/api/cinema/venues', async () => {
    const venues = await prisma.venue.findMany({ where: { active: true }, include: { halls: true }, orderBy: { name: 'asc' } });
    const shows = await prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: new Date(Date.now() - 3600000) } }, include: { hall: true } });
    const next = {}; for (const s of shows) { const v = s.hall && s.hall.venueId; if (v && (!next[v] || s.startsAt < next[v])) next[v] = s.startsAt; }
    return { ok: true, venues: venues.map(v => ({ id: v.id, slug: v.slug, name: v.name, nameAm: v.nameAm, address: v.address, phone: v.phone, website: v.website, notes: v.notes, lat: v.lat, lng: v.lng,
      halls: v.halls.length, nextShowAt: next[v.id] || null })) };
  });

  // ---------- programme listing (information only; tickets at the cinema) ----------
  const TZ_DAY = () => { const d = new Date(Date.now() + 3 * 3600000); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 3 * 3600000); }; // 00:00 Addis today, in UTC
  const pubProg = p => ({ id: p.id, title: p.title, titleAm: p.titleAm, hallName: p.hallName, times: p.times, dateFrom: p.dateFrom, dateTo: p.dateTo, priceText: p.priceText, posterUrl: p.posterUrl, trailerUrl: p.trailerUrl, ...trailerOf(p.trailerUrl), notes: p.notes, sourceName: p.sourceName, sourceUrl: p.sourceUrl, postedAt: p.postedAt,
    venue: p.venue ? { id: p.venue.id, slug: p.venue.slug, name: p.venue.name, nameAm: p.venue.nameAm, address: p.venue.address, phone: p.venue.phone } : undefined });
  fastify.get('/api/cinema/programme', async () => {
    const rows = await prisma.programme.findMany({ where: { active: true, dateTo: { gte: TZ_DAY() } }, include: { venue: true }, orderBy: { dateFrom: 'asc' }, take: 500 });
    const byVenue = {};
    for (const p of rows) { const v = p.venue; if (!v || !v.active) continue; (byVenue[v.id] = byVenue[v.id] || { venue: pubProg(p).venue, films: [] }).films.push(pubProg({ ...p, venue: null })); }
    return { ok: true, today: TZ_DAY(), tmdb: posters.enabled, venues: Object.values(byVenue).sort((a, b) => a.venue.name.localeCompare(b.venue.name)) };
  });
  fastify.post('/api/cinema/ops/programme', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {};
    const venue = b.venueId ? await prisma.venue.findUnique({ where: { id: String(b.venueId) } }) : null;
    if (!venue) return reply.code(400).send({ ok: false, error: 'venueId required' });
    const title = str(b.title, 120); if (!title) return reply.code(400).send({ ok: false, error: 'title required' });
    const times = [...new Set((Array.isArray(b.times) ? b.times : String(b.times || '').split(/[,\s]+/)).map(t => String(t).trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t)).map(t => t.padStart(5, '0')))].sort();
    if (!times.length) return reply.code(400).send({ ok: false, error: 'at least one showtime (HH:MM)' });
    const day = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s))) ? new Date(s + 'T00:00:00+03:00') : null;
    const dateFrom = day(b.dateFrom), dateTo = day(b.dateTo || b.dateFrom);
    if (!dateFrom || !dateTo || dateTo < dateFrom) return reply.code(400).send({ ok: false, error: 'dateFrom/dateTo (YYYY-MM-DD) required' });
    const sourceUrl = str(b.sourceUrl, 400), sourceName = str(b.sourceName, 80);
    if (!sourceUrl || !/^https?:\/\//.test(sourceUrl) || !sourceName) return reply.code(400).send({ ok: false, error: 'sourceName and a sourceUrl (the cinema\'s own post) are required' });
    const postedAt = b.postedAt && !isNaN(Date.parse(b.postedAt)) ? new Date(b.postedAt) : new Date();
    let posterUrl = str(b.posterUrl, 400);
    if (!posterUrl && posters.enabled) { const hit = await posters.search(title, b.year ? Number(b.year) : undefined); if (hit) posterUrl = hit.posterUrl; }
    const trailerUrl = b.trailerUrl && youtubeId(b.trailerUrl) ? 'https://www.youtube.com/watch?v=' + youtubeId(b.trailerUrl) : null;
    if (b.trailerUrl && !trailerUrl) return reply.code(400).send({ ok: false, error: 'trailerUrl must be a YouTube link' });
    if (!posterUrl && trailerUrl) posterUrl = 'https://i.ytimg.com/vi/' + youtubeId(trailerUrl) + '/hqdefault.jpg';
    const p = await prisma.programme.create({ data: { venueId: venue.id, title, titleAm: str(b.titleAm, 120), hallName: str(b.hallName, 40), times, dateFrom, dateTo: new Date(dateTo.getTime() + 86400000 - 1), priceText: str(b.priceText, 40), posterUrl, trailerUrl, notes: str(b.notes, 200), sourceName, sourceUrl, postedAt }, include: { venue: true } });
    return { ok: true, programme: pubProg(p) };
  });
  fastify.get('/api/cinema/ops/programme', async (req, reply) => {
    if (!ops(req, reply)) return;
    const rows = await prisma.programme.findMany({ where: { active: true }, include: { venue: true }, orderBy: { dateFrom: 'desc' }, take: 500 });
    return { ok: true, programme: rows.map(pubProg) };
  });
  fastify.post('/api/cinema/ops/programme/:id/delete', async (req, reply) => {
    if (!ops(req, reply)) return;
    const r = await prisma.programme.updateMany({ where: { id: String(req.params.id), active: true }, data: { active: false } });
    return { ok: true, removed: r.count };
  });

  fastify.get('/api/cinema/shows/:id', async (req, reply) => {
    if (!ipRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const show = await loadShow(req.params.id);
    if (!show || !show.hall || !show.event) return fail(reply, { error: 'no_show' });
    const holder = holderOf(req);
    const ga = isGa(show.hall.layout);
    const seats = ga ? [] : await holds.availability(show, holder);
    const tiers = ga ? (await holds.tiers(show, holder)).map(t => ({ ...t, price: Number((show.prices || {})[t.name]) })) : null;
    const mine = holder ? await holds.mine(show.id, holder) : [];
    return { ok: true, show: pubShow(show), layout: show.hall.layout, seats, tiers, holdMs: HOLD_MS, maxSeats: ga ? MAX_GA : MAX_SEATS,
      mine: mine.map(h => h.seat), holdExpiresAt: mine.length ? new Date(Math.min(...mine.map(h => h.expiresAt.getTime()))) : null,
      chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null } };
  });

  fastify.post('/api/cinema/shows/:id/hold', async (req, reply) => {
    const holder = holderOf(req); if (!holder) return fail(reply, { error: 'holder' });
    if (!holdRL(holder) || !ipRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const show = await loadShow(req.params.id);
    if (!show || !show.hall) return fail(reply, { error: 'no_show' });
    const b = req.body || {};
    const r = b.section != null ? await holds.holdMany(show, String(b.section), b.qty, holder) : await holds.hold(show, String(b.seat || ''), holder);
    return r.ok ? r : fail(reply, r);
  });

  fastify.post('/api/cinema/shows/:id/release', async (req, reply) => {
    const holder = holderOf(req); if (!holder) return fail(reply, { error: 'holder' });
    const b = req.body || {};
    if (b.section != null) return { ok: true, released: await holds.releaseSome(String(req.params.id), holder, String(b.section), b.qty) };
    const seats = Array.isArray(b.seats) ? b.seats.map(String).slice(0, MAX_GA) : null;
    return { ok: true, released: await holds.release(String(req.params.id), holder, seats) };
  });

  fastify.post('/api/cinema/tickets', async (req, reply) => {
    const b = req.body || {};
    const holder = holderOf(req); if (!holder) return fail(reply, { error: 'holder' });
    let tg = null, contact = null;
    if (b.tg && b.tg.initData) {
      tg = tgauth.verifyInitData(b.tg.initData, riderBotToken);
      if (!tg) return reply.code(401).send({ ok: false, error: 'tg_expired' });
      if (b.tg.contact) contact = tgauth.verifyContact(b.tg.contact, riderBotToken);
    }
    const name = str(b.name, 60) || (tg ? [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ') : '');
    const phone = contact ? contact.phone : b.phone;
    const ipKey = 'ip:' + clientIp(req);
    if (!buyRL(holder) || !buyIpRL(ipKey)) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const method = b.payMethod === 'chapa' && chapaOn ? 'chapa' : 'counter';   // server-side gate, as Ride does
    const r = await tickets.checkout({ showId: String(b.showId || ''), holderKey: holder, seats: b.seats, name, phone, guest: b.guest, payMethod: method,
      telegramId: tg ? tg.user.id : null, idemKey: str(b.idemKey, 80) });
    if (!r.ok) return fail(reply, r);
    const out = { ok: true, ticket: pubTicket({ ...r.ticket, show: r.show || null }), duplicate: !!r.duplicate };
    if (method === 'chapa' && r.ticket.status === 'RESERVED') {
      const ref = r.ticket.chapaRef || ('bina-cin-' + r.ticket.code.slice(5) + '-' + crypto.randomBytes(3).toString('hex'));
      try {
        if (!r.ticket.chapaRef) await prisma.ticket.updateMany({ where: { id: r.ticket.id }, data: { chapaRef: ref } });
        const title = r.show ? (r.show.event.titleAm || r.show.event.title) : 'Ticket';
        out.checkoutUrl = await chapa.init({ amount: r.ticket.total, ref, name: r.ticket.name, phone: r.ticket.phone, returnUrl: base + '/ticket/' + r.ticket.code + '?paid=1', title });
        if (!out.checkoutUrl) throw new Error('no checkout url');
      } catch (e) {
        console.error('[cinema] chapa init failed for ' + r.ticket.code + ': ' + e.message);
        out.chapaError = true;   // ticket stays RESERVED/chapa; ops sees it flagged, buyer can still pay at the counter
      }
    }
    return out;
  });

  const loadTicket = code => prisma.ticket.findUnique({ where: { code: String(code || '').toUpperCase() }, include: { show: { include: SHOW_INCLUDE } } });

  fastify.get('/api/cinema/tickets/:code', async (req, reply) => {
    if (!lookupRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const t = await loadTicket(req.params.code);
    return t ? { ok: true, ticket: pubTicket(t) } : fail(reply, { error: 'unknown' });
  });

  fastify.get('/api/cinema/tickets/:code/qr.svg', async (req, reply) => {
    if (!lookupRL(clientIp(req))) return reply.code(429).send('');
    const t = await loadTicket(req.params.code);
    if (!t) return reply.code(404).send('');
    return reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400').send(await tickets.qrSvg(t.code));
  });

  async function confirmChapa(ref) {
    const t = await prisma.ticket.findFirst({ where: { chapaRef: String(ref) } });
    if (!t) return { ok: false, error: 'unknown' };
    if (t.status !== 'RESERVED') return { ok: true, status: t.status, already: true };
    if (!chapaOn) return { ok: false, error: 'chapa_off' };
    const paid = await chapa.verify(t.chapaRef);
    if (!paid) return { ok: false, error: 'unpaid', status: t.status };
    await tickets.markPaid(t.code, 'chapa', t.chapaRef);
    tell(t, '✅ ' + t.code + ' ተከፍሏል · paid. ' + t.seats.join(', ') + '\n' + base + '/ticket/' + t.code);
    return { ok: true, status: 'CONFIRMED' };
  }

  fastify.post('/api/cinema/tickets/:code/verify-chapa', async (req, reply) => {
    if (!lookupRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const t = await loadTicket(req.params.code);
    if (!t) return fail(reply, { error: 'unknown' });
    if (t.status !== 'RESERVED') return { ok: true, status: t.status };
    if (!t.chapaRef) return { ok: false, error: 'no_payment', status: t.status };
    const r = await confirmChapa(t.chapaRef);
    return r.ok ? r : reply.code(402).send(r);
  });

  // ---------- ops ----------
  fastify.get('/api/cinema/ops/overview', async (req, reply) => {
    if (!ops(req, reply)) return;
    const [venues, events, shows] = await Promise.all([
      prisma.venue.findMany({ include: { halls: true }, orderBy: { name: 'asc' } }),
      prisma.event.findMany({ where: { active: true }, orderBy: { startsAt: 'desc' }, take: 100 }),
      prisma.show.findMany({ where: { startsAt: { gte: new Date(Date.now() - 7 * 86400000) } }, include: SHOW_INCLUDE, orderBy: { startsAt: 'asc' }, take: 300 }),
    ]);
    const ids = shows.map(s => s.id);
    const ts = ids.length ? await prisma.ticket.findMany({ where: { showId: { in: ids } } }) : [];
    const stat = {}; for (const t of ts) { const s = stat[t.showId] = stat[t.showId] || { RESERVED: 0, CONFIRMED: 0, CHECKED_IN: 0, CANCELLED: 0, seats: 0, revenue: 0 }; s[t.status] = (s[t.status] || 0) + 1; if (SOLD_STATES.includes(t.status)) { s.seats += t.seats.length; s.revenue += t.total; } }
    return { ok: true, chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null },
      venues: venues.map(v => ({ ...v, halls: v.halls.map(h => ({ id: h.id, name: h.name, capacity: h.capacity, layout: h.layout })) })),
      events: events.map(e => ({ id: e.id, slug: e.slug, title: e.title, titleAm: e.titleAm, kind: e.kind, posterUrl: e.posterUrl, runtimeMin: e.runtimeMin, rating: e.rating, language: e.language })),
      shows: shows.filter(s => s.event && s.hall).map(s => ({ ...pubShow(s), stats: stat[s.id] || { RESERVED: 0, CONFIRMED: 0, CHECKED_IN: 0, CANCELLED: 0, seats: 0, revenue: 0 } })) };
  });

  fastify.post('/api/cinema/ops/venues', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {};
    const name = str(b.name, 80); if (!name) return reply.code(400).send({ ok: false, error: 'name required' });
    const slug = slugify(b.slug || name) || 'venue-' + Date.now().toString(36);
    try {
      const v = await prisma.venue.create({ data: { slug, name, nameAm: str(b.nameAm, 80), address: str(b.address, 200), phone: str(b.phone, 30), lat: numOr(b.lat, null), lng: numOr(b.lng, null) } });
      return { ok: true, venue: v };
    } catch (e) { if (e.code === 'P2002') return reply.code(409).send({ ok: false, error: 'slug exists' }); throw e; }
  });

  fastify.post('/api/cinema/ops/halls', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {};
    const venue = b.venueId ? await prisma.venue.findUnique({ where: { id: String(b.venueId) } }) : null;
    if (!venue) return reply.code(400).send({ ok: false, error: 'venueId required' });
    const name = str(b.name, 60); if (!name) return reply.code(400).send({ ok: false, error: 'name required' });
    const layout = b.layout;
    const v = validateLayout(layout); if (!v.ok) return reply.code(400).send({ ok: false, error: 'layout: ' + v.error });
    const clean = isGa(layout)
      ? { kind: 'ga', sections: layout.sections.map(s => ({ name: String(s.name).slice(0, 30), nameAm: s.nameAm ? String(s.nameAm).slice(0, 30) : null, capacity: s.capacity })) }
      : { kind: 'seats', rows: layout.rows, seatsPerRow: layout.seatsPerRow, aisles: (layout.aisles || []).map(Number).filter(Number.isInteger), blocked: (layout.blocked || []).map(String),
        wheelchair: (layout.wheelchair || []).map(String), sections: layout.sections.map(s => ({ name: String(s.name).slice(0, 30), nameAm: s.nameAm ? String(s.nameAm).slice(0, 30) : null, rows: s.rows })) };
    const hall = await prisma.hall.create({ data: { venueId: venue.id, name, layout: clean, capacity: capacityOf(clean) } });
    return { ok: true, hall };
  });

  fastify.post('/api/cinema/ops/events', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {};
    const title = str(b.title, 120); if (!title) return reply.code(400).send({ ok: false, error: 'title required' });
    const kind = ['FILM', 'CONCERT', 'THEATER', 'MEETUP', 'OTHER'].includes(b.kind) ? b.kind : 'FILM';
    const slug = (slugify(b.slug || title) || 'event') + '-' + crypto.randomBytes(2).toString('hex');
    const startsAt = b.startsAt && !isNaN(Date.parse(b.startsAt)) ? new Date(b.startsAt) : new Date();
    const ev = await prisma.event.create({ data: { slug, title, titleAm: str(b.titleAm, 120), type: 'CINEMA', kind, venue: str(b.venue, 80) || 'BinaSmart', descr: str(b.descr, 2000), emoji: str(b.emoji, 8),
      posterUrl: str(b.posterUrl, 300), runtimeMin: b.runtimeMin ? Math.round(numOr(b.runtimeMin, 0)) || null : null, rating: str(b.rating, 12), language: str(b.language, 60), startsAt, durationMin: Math.round(numOr(b.runtimeMin, 120)) || 120, tiers: {} } });
    return { ok: true, event: ev };
  });

  fastify.post('/api/cinema/ops/shows', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {};
    const [event, hall] = await Promise.all([b.eventId ? prisma.event.findUnique({ where: { id: String(b.eventId) } }) : null, b.hallId ? prisma.hall.findUnique({ where: { id: String(b.hallId) } }) : null]);
    if (!event) return reply.code(400).send({ ok: false, error: 'eventId required' });
    if (!hall) return reply.code(400).send({ ok: false, error: 'hallId required' });
    if (!b.startsAt || isNaN(Date.parse(b.startsAt))) return reply.code(400).send({ ok: false, error: 'startsAt required (ISO)' });
    const prices = {}; const sections = (hall.layout && hall.layout.sections) || [];
    for (const s of sections) { const p = Number(b.prices && b.prices[s.name]); if (!Number.isFinite(p) || p < 0) return reply.code(400).send({ ok: false, error: 'price for section ' + s.name + ' required' }); prices[s.name] = Math.round(p); }
    const cutoff = Math.max(0, Math.min(24 * 60, Math.round(numOr(b.counterCutoffMin, 30))));
    const show = await prisma.show.create({ data: { eventId: event.id, hallId: hall.id, startsAt: new Date(b.startsAt), prices, counterCutoffMin: cutoff, status: 'onsale' }, include: SHOW_INCLUDE });
    return { ok: true, show: pubShow(show) };
  });

  fastify.post('/api/cinema/ops/shows/:id/status', async (req, reply) => {
    if (!ops(req, reply)) return;
    const status = String((req.body || {}).status || '');
    if (!SHOW_STATUS.includes(status)) return reply.code(400).send({ ok: false, error: 'status must be one of ' + SHOW_STATUS.join('|') });
    const show = await loadShow(req.params.id);
    if (!show) return fail(reply, { error: 'no_show' });
    await prisma.show.update({ where: { id: show.id }, data: { status } });
    let cancelled = 0;
    if (status === 'cancelled') {
      await prisma.seatHold.deleteMany({ where: { showId: show.id } });
      const live = await prisma.ticket.findMany({ where: { showId: show.id, status: { in: ['RESERVED', 'CONFIRMED'] } } });
      for (const t of live) {
        if (await tickets.cancel(t.code)) { cancelled++; tell(t, '❌ ' + (show.event.titleAm || show.event.title) + ' ተሰርዟል። ትኬት ' + t.code + ' (' + t.seats.join(', ') + ') ተሰርዟል። · Show cancelled, ticket cancelled.' + (t.status === 'CONFIRMED' ? ' ለተመላሽ ገንዘብ ' + (show.hall.venue && show.hall.venue.phone ? show.hall.venue.phone : 'ቦታውን') + ' ያነጋግሩ · contact the venue for a refund.' : '')); }
      }
    }
    return { ok: true, status, cancelled };
  });

  fastify.get('/api/cinema/ops/shows/:id/tickets', async (req, reply) => {
    if (!ops(req, reply)) return;
    const show = await loadShow(req.params.id);
    if (!show) return fail(reply, { error: 'no_show' });
    const [ts, hs] = await Promise.all([prisma.ticket.findMany({ where: { showId: show.id }, orderBy: { createdAt: 'desc' } }), prisma.seatHold.findMany({ where: { showId: show.id } })]);
    const now = Date.now();
    return { ok: true, show: pubShow(show), tickets: ts.map(t => ({ ...pubTicket(t, show), telegram: !!t.telegramId, chapaRef: t.chapaRef })), holds: hs.filter(h => h.expiresAt.getTime() > now).map(h => ({ seat: h.seat, expiresAt: h.expiresAt })) };
  });

  fastify.post('/api/cinema/ops/tickets/:code/paid', async (req, reply) => {
    if (!ops(req, reply)) return;
    const t = await loadTicket(req.params.code);
    if (!t) return fail(reply, { error: 'unknown' });
    const changed = await tickets.markPaid(t.code, 'counter');
    if (changed) tell(t, '✅ ' + t.code + ' ተከፍሏል · paid at the counter. ' + t.seats.join(', ') + '\n' + base + '/ticket/' + t.code);
    return { ok: true, changed, status: changed ? 'CONFIRMED' : t.status };
  });

  fastify.post('/api/cinema/ops/tickets/:code/cancel', async (req, reply) => {
    if (!ops(req, reply)) return;
    const t = await loadTicket(req.params.code);
    if (!t) return fail(reply, { error: 'unknown' });
    const changed = await tickets.cancel(t.code);
    if (changed) tell(t, '❌ ' + t.code + ' ተሰርዟል · cancelled. ' + t.seats.join(', '));
    return { ok: true, changed, status: changed ? 'CANCELLED' : t.status };
  });

  fastify.post('/api/cinema/ops/checkin', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {};
    const r = await checkin.scan(b.code, b.showId ? String(b.showId) : null);
    const showId = (r.ticket && r.ticket.showId) || (b.showId ? String(b.showId) : null);
    let counts = null;
    if (showId) {
      const ts = await prisma.ticket.findMany({ where: { showId, status: { in: SOLD_STATES } } });
      counts = { sold: ts.reduce((n, t) => n + t.seats.length, 0), checkedIn: ts.filter(t => t.status === 'CHECKED_IN').reduce((n, t) => n + t.seats.length, 0) };
    }
    const body = { ...r, ticket: r.ticket ? pubTicket(r.ticket) : null, counts };
    return r.ok ? body : reply.code(ERR_CODE[r.error] || 400).send(body);
  });

  return { confirmChapa };
};
