'use strict';
// HTTP surface of the cinema module. Public: shows, seat map, holds, checkout, ticket, QR, Chapa
// verify. Ops (owner key): venues, halls, events, shows, tickets, check-in. The client is never
// trusted for seats or prices: holds live in the DB, prices come from the Show.
const crypto = require('crypto');
const tgauth = require('../ride/tgauth');
const { validateLayout, capacityOf } = require('./seatmap');
const { HOLD_MS, MAX_SEATS, SOLD_STATES } = require('./holds');

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
    hall: { id: h.id, name: h.name, capacity: h.capacity, sections: (h.layout && h.layout.sections) || [] } };
}
function pubTicket(t) {
  return { code: t.code, status: t.status, seats: t.seats, name: t.name, phone: t.phone, total: t.total, payMethod: t.payMethod,
    chapaPending: t.payMethod === 'chapa' && t.status === 'RESERVED', createdAt: t.createdAt, checkedInAt: t.checkedInAt, show: t.show ? pubShow(t.show) : null };
}
const ERR_CODE = { taken: 409, sold: 409, hold_expired: 409, already_checked_in: 409, unpaid: 409, cancelled: 409, wrong_show: 409,
  show_closed: 410, no_show: 404, unknown: 404, no_such_seat: 400, too_many: 400, no_seats: 400, phone: 400, name: 400, holder: 400 };
const fail = (reply, r) => reply.code(ERR_CODE[r.error] || 400).send({ ok: false, ...r });

module.exports = function cinemaRoutes(fastify, { prisma, holds, tickets, checkin, OWNER_KEY, riderBotToken, chapa, BASE_URL, notify }) {
  const base = (BASE_URL || 'https://bina.et').replace(/\/$/, '');
  const holdRL = limiter(60000, 60), buyRL = limiter(600000, 5), lookupRL = limiter(60000, 120), ipRL = limiter(60000, 300);
  const chapaOn = !!(chapa && chapa.enabled);
  const ops = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };
  const holderOf = req => { const h = String(req.headers['x-holder'] || (req.query && req.query.holder) || ''); return HOLDER_RE.test(h) ? h : null; };
  const loadShow = id => prisma.show.findUnique({ where: { id: String(id) }, include: SHOW_INCLUDE });
  const tell = async (ticket, text) => { if (!notify) return false; try { return await notify(ticket, text); } catch (e) { console.error('[cinema] notify: ' + e.message); return false; } };

  // ---------- pages ----------
  for (const [p, f] of [['/cinema', 'cinema.html'], ['/cinema/:showId', 'cinema.html'], ['/ticket/:code', 'ticket.html'], ['/scan', 'scan.html'], ['/ops/cinema', 'ops-cinema.html']]) {
    fastify.get(p, async (req, reply) => reply.sendFile(f));
  }

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

  fastify.get('/api/cinema/shows/:id', async (req, reply) => {
    if (!ipRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const show = await loadShow(req.params.id);
    if (!show || !show.hall || !show.event) return fail(reply, { error: 'no_show' });
    const holder = holderOf(req);
    const seats = await holds.availability(show, holder);
    const mine = holder ? await holds.mine(show.id, holder) : [];
    return { ok: true, show: pubShow(show), layout: show.hall.layout, seats, holdMs: HOLD_MS, maxSeats: MAX_SEATS,
      mine: mine.map(h => h.seat), holdExpiresAt: mine.length ? new Date(Math.min(...mine.map(h => h.expiresAt.getTime()))) : null,
      chapa: { enabled: chapaOn, mode: chapaOn ? chapa.mode : null } };
  });

  fastify.post('/api/cinema/shows/:id/hold', async (req, reply) => {
    const holder = holderOf(req); if (!holder) return fail(reply, { error: 'holder' });
    if (!holdRL(holder) || !ipRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const show = await loadShow(req.params.id);
    if (!show || !show.hall) return fail(reply, { error: 'no_show' });
    const r = await holds.hold(show, String((req.body || {}).seat || ''), holder);
    return r.ok ? r : fail(reply, r);
  });

  fastify.post('/api/cinema/shows/:id/release', async (req, reply) => {
    const holder = holderOf(req); if (!holder) return fail(reply, { error: 'holder' });
    const seats = Array.isArray((req.body || {}).seats) ? req.body.seats.map(String).slice(0, MAX_SEATS) : null;
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
    if (!buyRL(holder) || !buyRL(ipKey)) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
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
    const clean = { rows: layout.rows, seatsPerRow: layout.seatsPerRow, aisles: (layout.aisles || []).map(Number).filter(Number.isInteger), blocked: (layout.blocked || []).map(String),
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
    return { ok: true, show: pubShow(show), tickets: ts.map(t => ({ ...pubTicket(t), telegram: !!t.telegramId, chapaRef: t.chapaRef })), holds: hs.filter(h => h.expiresAt.getTime() > now).map(h => ({ seat: h.seat, expiresAt: h.expiresAt })) };
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
