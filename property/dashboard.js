'use strict';
// bina.et/property/dashboard (1 Oct 2026, Ibrahim chose it): owners of homes listed through Bini keep their own listing
// honest. A Bini listing carries the owner's phone (agencyPhone, +251…), and bina.et sign-in proves a phone (Telegram
// contact or SMS code), so the approved Bini listings with the account's PROVEN phone are that owner's. Live at once: the
// price, "rented" / "sold" (off /property, Bini and the MCP) and "back on the market". Everything else still goes through
// Bini and the team. Every change reaches the team with the one-tap take-down of property/owner-listing.js.
//   GET  /property/dashboard          the page (noindex)
//   GET  /api/property/mine           my listings (401 not signed in; phone:false without a proven phone)
//   POST /api/property/mine/:id       {price} and/or {status: 'closed' | 'open'}

const crypto = require('crypto');
const OL = require('./owner-listing');

module.exports = function propertyDashboard(fastify, { prisma, limiter, tell }, done) {
  const notify = t => Promise.resolve((tell || OL.tellTeam)(t)).catch(() => false);
  const editRL = limiter(3600000, 40);
  const who = req => (req.authUser && req.authUser.id ? req.authUser : null);
  async function provenPhone(uid) {
    try { const u = await prisma.authUser.findUnique({ where: { id: uid }, select: { phone: true, phoneVerifiedAt: true } });
      return u && u.phone && u.phoneVerifiedAt ? OL.ethPhone(u.phone) : null; } catch (e) { return null; }
  }
  const d = L => (L.details && typeof L.details === 'object' ? L.details : {});
  // an owner's own approved Bini listing, live or closed by the owner (a listing the TEAM took down is not theirs to reopen)
  const isMine = (L, phone) => L.agencyPhone === phone && d(L).submittedVia === 'bini' && (d(L).review || {}).status === 'approved'
    && !(d(L).removeRequest || {}).done && (L.active || !!d(L).closed);
  const view = L => ({ id: L.id, slug: L.slug, title: L.title, price: L.price, listingType: L.listingType, location: L.location,
    status: L.active ? 'open' : 'closed', closedAs: (d(L).closed || {}).as || null, url: L.active ? 'https://bina.et/property/' + L.slug : null });

  fastify.get('/property/dashboard', async (req, reply) => { reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store'); return reply.sendFile('property-dashboard.html'); });

  fastify.get('/api/property/mine', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const phone = await provenPhone(u.id);
    if (!phone) return { ok: true, phone: false, listings: [], pending: 0 };
    const rows = await prisma.propertyListing.findMany({ where: { agencyPhone: phone }, take: 100 }).catch(() => []);
    return { ok: true, phone: '…' + phone.slice(-4), listings: rows.filter(L => isMine(L, phone)).map(view),
      pending: rows.filter(L => d(L).submittedVia === 'bini' && (d(L).review || {}).status === 'pending').length };
  });

  fastify.post('/api/property/mine/:id', { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const phone = await provenPhone(u.id);
    if (!phone) return reply.code(403).send({ ok: false, error: 'no_proven_phone' });
    const L = await prisma.propertyListing.findUnique({ where: { id: String(req.params.id).slice(0, 40) } }).catch(() => null);
    if (!L || !isMine(L, phone)) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {}, data = {}, det = Object.assign({}, d(L)), changed = [];
    if (b.status !== undefined) {
      if (!['closed', 'open'].includes(b.status)) return reply.code(400).send({ ok: false, error: 'status' });
      const as = L.listingType === 'rent' ? 'rented' : 'sold';
      if (b.status === 'closed' && L.active) { data.active = false; det.closed = { as, at: new Date().toISOString() }; changed.push('marked ' + as.toUpperCase() + ' (off the site)'); }
      if (b.status === 'open' && !L.active) { data.active = true; delete det.closed; changed.push('back on the market'); }
    }
    if (b.price !== undefined) {
      const v = OL.clean(b.price, 60); if (!v) return reply.code(400).send({ ok: false, error: 'price' });
      if (v !== L.price) { data.price = v; changed.push('price: ' + v); }
    }
    if (!changed.length) return { ok: true, changed: [], listing: view(L) };
    det.updated = new Date().toISOString().slice(0, 10);
    if (!(det.removeRequest && det.removeRequest.token)) det.removeRequest = { token: crypto.randomBytes(16).toString('hex'), name: 'owner edit', phone, at: new Date().toISOString() };
    data.details = det;
    const N = await prisma.propertyListing.update({ where: { id: L.id }, data });
    notify('✏️ <b>Home listing changed by its owner</b> (live now) · ' + OL.esc(L.title) + '\n' + changed.map(c => '• ' + OL.esc(c)).join('\n')
      + '\n<a href="https://bina.et/property/' + L.slug + '">listing</a> · <a href="https://bina.et/ops/listing-requests/' + L.id + '/remove?t=' + det.removeRequest.token + '">take it down</a>');
    return { ok: true, changed, listing: view(N || Object.assign({}, L, data)) };
  });
  done();
};
