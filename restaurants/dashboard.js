'use strict';
// The restaurant owner's dashboard (1 Oct 2026, step 2 of bina.et/restaurants; the health dashboard's pattern). When the
// team approves a claim it reads an 8-letter code to the owner on the call. Signed in to bina.et (Telegram or phone
// code), the owner types it once; from then on they edit the number to show, opening hours, a line about the place and
// the dishes with prices themselves, live at once. A phone the owner proved at sign-in that matches the number the team
// called links the page without a code. The team gets a note of every change with a one-tap "hide page".
//   GET  /restaurants/dashboard                       the page (noindex)
//   GET  /api/restaurants/mine                        my restaurants (401 when not signed in)
//   POST /api/restaurants/code                        {code}: link a restaurant to my account
//   POST /api/restaurants/mine/:id                    {publicPhone, hours, about, dishes}
//   GET  /ops/restaurants/:id/manage/:action?t=       newcode | hide | unhide

const crypto = require('crypto');
const H = require('../health/directory');
const R = require('./directory');
const OWNED = ['live', 'hidden'];

module.exports = function restaurantDashboard(fastify, { prisma, limiter, tell }, done) {
  const notify = tell || R.tellTeam;
  const codeRL = limiter(3600000, 8), editRL = limiter(3600000, 40);
  const who = req => (req.authUser && req.authUser.id ? req.authUser : null);
  const ipOf = req => String(req.headers['x-real-ip'] || req.ip || '');
  const mb = E => 'https://bina.et/ops/restaurants/' + E.id + '/manage/';
  const hideLink = E => E.manageToken ? ' · <a href="' + mb(E) + 'hide?t=' + E.manageToken + '">hide page</a>' : '';
  const placeOf = E => (E.ref ? R.places().byRef.get(E.ref) : null);
  function view(E) {
    const p = placeOf(E);
    return { id: E.id, status: E.status, restaurant: E.restaurant, url: p ? '/restaurants/' + p.slug : null, sub: p ? p.sub : null,
      publicPhone: E.publicPhone || '', hours: E.hours || '', about: E.about || '', dishes: E.dishes || [], updatedAt: String(E.updatedAt || E.approvedAt || '').slice(0, 10) };
  }
  async function provenPhone(uid) {
    try { const u = await prisma.authUser.findUnique({ where: { id: uid }, select: { phone: true, phoneVerifiedAt: true } }); return u && u.phone && u.phoneVerifiedAt ? H.ethPhone(u.phone) : null; } catch (e) { return null; }
  }
  const ownedBy = (S, id, uid) => S.entries.find(e => e.id === String(id || '').slice(0, 20) && e.ownerUserId === uid && OWNED.includes(e.status));

  fastify.get('/restaurants/dashboard', async (req, reply) => { reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store'); return reply.sendFile('restaurant-dashboard.html'); });

  fastify.get('/api/restaurants/mine', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const S = R.readStore(), phone = await provenPhone(u.id);
    // the number the team called, proven at sign-in, links the page without a code
    const found = phone ? S.entries.filter(e => OWNED.includes(e.status) && !e.ownerUserId && e.phone === phone) : [];
    if (found.length) {
      found.forEach(e => Object.assign(e, { ownerUserId: u.id, dashCode: null, dashCodeExpires: null, linkedAt: new Date().toISOString(), linkedBy: 'proven_phone' }));
      R.writeStore(S);
      found.forEach(e => notify('🔗 <b>' + H.esc(e.restaurant) + '</b>: dashboard linked by the proven phone (…' + H.esc(String(phone).slice(-4)) + ').' + hideLink(e)).catch(() => {}));
    }
    return { ok: true, name: u.name || '', restaurants: S.entries.filter(e => e.ownerUserId === u.id && OWNED.includes(e.status)).map(view) };
  });

  fastify.post('/api/restaurants/code', async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!codeRL('u:' + u.id) || !codeRL('ip:' + ipOf(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const code = String((req.body || {}).code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const S = R.readStore(), now = Date.now();
    // one answer for every failure: unknown, used, expired and mistyped all read the same from outside
    const E = code.length === 8 ? S.entries.find(e => e.dashCode && H.tokEq(e.dashCode, code)) : null;
    if (!E || !OWNED.includes(E.status) || !(Date.parse(E.dashCodeExpires) > now)) return reply.code(400).send({ ok: false, error: 'bad_code' });
    Object.assign(E, { ownerUserId: u.id, dashCode: null, dashCodeExpires: null, linkedAt: new Date().toISOString(), linkedBy: 'code' });
    R.writeStore(S);
    notify('🔗 <b>' + H.esc(E.restaurant) + '</b>: the owner linked the dashboard with the code.' + hideLink(E)).catch(() => {});
    return { ok: true, restaurant: view(E) };
  });

  fastify.post('/api/restaurants/mine/:id', { bodyLimit: 32 * 1024 }, async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const S = R.readStore(), E = ownedBy(S, req.params.id, u.id), b = req.body || {};
    if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    const next = {};
    if (b.publicPhone !== undefined) {
      const p = String(b.publicPhone || '').trim();
      next.publicPhone = p ? H.ethPhone(p) : null;
      if (p && !next.publicPhone) return reply.code(400).send({ ok: false, error: 'phone' });
    }
    if (b.hours !== undefined) next.hours = H.clean(b.hours, 120) || null;
    if (b.about !== undefined) next.about = H.clean(b.about, 400) || null;
    if (b.dishes !== undefined) next.dishes = (Array.isArray(b.dishes) ? b.dishes : []).map(d => ({ name: H.clean(d && d.name, 60), price: H.clean(d && d.price, 30) })).filter(d => d.name.length > 1).slice(0, 40);
    Object.assign(E, next, { updatedAt: new Date().toISOString() });
    R.writeStore(S);
    notify('✏️ <b>' + H.esc(E.restaurant) + '</b> changed its page' + (next.dishes ? ' (' + next.dishes.length + ' dishes)' : '') + (next.publicPhone ? ' · number ' + H.esc(next.publicPhone) : '') + (next.hours ? ' · ' + H.esc(next.hours) : '')
      + (placeOf(E) ? ' · <a href="https://bina.et/restaurants/' + placeOf(E).slug + '">page</a>' : '') + hideLink(E)).catch(() => {});
    return { ok: true, restaurant: view(E) };
  });

  fastify.get('/ops/restaurants/:id/manage/:action', async (req, reply) => {
    const S = R.readStore(), E = S.entries.find(e => e.id === String(req.params.id).slice(0, 20)), act = String(req.params.action);
    reply.header('X-Robots-Tag', 'noindex');
    if (!E || !E.manageToken || !H.tokEq(req.query.t, E.manageToken)) return reply.code(404).send('not found');
    const page = msg => reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + msg + '</p>');
    if (act === 'hide') { E.status = 'hidden'; R.writeStore(S); return page('🙈 Hidden: ' + H.esc(E.restaurant) + '. The page shows the map data only. <a href="' + mb(E) + 'unhide?t=' + E.manageToken + '">Show it again</a>'); }
    if (act === 'unhide') { if (E.status === 'hidden') E.status = 'live'; R.writeStore(S); return page('👀 Shown again: ' + H.esc(E.restaurant)); }
    if (act === 'newcode') {
      Object.assign(E, { dashCode: H.newCode(), dashCodeExpires: new Date(Date.now() + 30 * 864e5).toISOString() }); R.writeStore(S);
      return page('🔑 New dashboard code for ' + H.esc(E.restaurant) + ': <b style="font-size:22px;letter-spacing:.08em">' + H.fmtCode(E.dashCode) + '</b> (30 days, works once).');
    }
    return reply.code(400).send('newcode, hide or unhide');
  });
  done();
};
