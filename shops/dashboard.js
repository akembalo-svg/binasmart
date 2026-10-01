'use strict';
// bina.et/shop/dashboard (1 Oct 2026, Ibrahim chose it): sellers manage their own posts on bina.et/shop. A post belongs to the
// phone number on it, and signing in to bina.et proves a phone (the Telegram-signed contact, or an SMS code), so the posts
// whose number equals the account's PROVEN phone are that seller's: no code and no team step. Live at once: the price, the
// description, "sold" and "back on sale". The title, the category and photos still go through Bini and a person (shop_post
// "change"). Every edit reaches the team with a one-tap "take it down", so a bad edit costs one tap.
//   GET  /shop/dashboard          the page (noindex)
//   GET  /api/shop/mine           my posts (401 not signed in; phone:false when the account has no proven phone)
//   POST /api/shop/mine/:id       {price, description} and/or {status: 'sold' | 'live'}

const crypto = require('crypto');
const SP = require('./posts');
const MINE = ['live', 'sold'];   // pending waits for the team; removed and rejected are gone

module.exports = function shopDashboard(fastify, { prisma, limiter, tell }, done) {
  const notify = t => Promise.resolve((tell || SP.tellTeam)(t)).catch(() => false);
  const editRL = limiter(3600000, 40);
  const who = req => (req.authUser && req.authUser.id ? req.authUser : null);
  async function provenPhone(uid) {
    try { const u = await prisma.authUser.findUnique({ where: { id: uid }, select: { phone: true, phoneVerifiedAt: true } });
      return u && u.phone && u.phoneVerifiedAt ? SP.ethPhone(u.phone) : null; } catch (e) { return null; }
  }
  const view = p => ({ id: p.id, status: p.status, title: p.title, price: p.price, description: p.description || '', category: p.category,
    shop: p.shop.name, area: p.shop.area || '', photos: (p.photos || []).length, url: p.status === 'live' ? 'https://bina.et/shop#p-' + p.id : null,
    updatedAt: String(p.updatedAt || p.approvedAt || '').slice(0, 10) });
  const newest = (a, b) => String(b.updatedAt || b.approvedAt || '').localeCompare(String(a.updatedAt || a.approvedAt || ''));

  fastify.get('/shop/dashboard', async (req, reply) => { reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store'); return reply.sendFile('shop-dashboard.html'); });

  fastify.get('/api/shop/mine', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const phone = await provenPhone(u.id);
    if (!phone) return { ok: true, phone: false, posts: [], pending: 0 };
    const S = SP.readStore();
    return { ok: true, phone: '…' + phone.slice(-4), posts: S.posts.filter(p => MINE.includes(p.status) && p.shop.phone === phone).sort(newest).map(view),
      pending: S.posts.filter(p => p.status === 'pending' && p.shop.phone === phone).length };
  });

  fastify.post('/api/shop/mine/:id', { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const phone = await provenPhone(u.id);
    if (!phone) return reply.code(403).send({ ok: false, error: 'no_proven_phone' });
    const S = SP.readStore(), P = S.posts.find(p => p.id === String(req.params.id).slice(0, 20) && p.shop.phone === phone && MINE.includes(p.status));
    if (!P) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {}, changed = [];
    if (b.status !== undefined) {
      const st = b.status === 'sold' ? 'sold' : b.status === 'live' ? 'live' : null;
      if (!st) return reply.code(400).send({ ok: false, error: 'status' });
      if (st !== P.status) { P.status = st; changed.push(st === 'sold' ? 'marked SOLD (off the page)' : 'back on sale'); }
    }
    if (b.price !== undefined) {
      const v = SP.clean(b.price, 50); if (!v) return reply.code(400).send({ ok: false, error: 'price' });
      if (v !== P.price) { P.price = v; changed.push('price: ' + v); }
    }
    if (b.description !== undefined) {
      const v = SP.clean(b.description, 400) || null;
      if (v !== (P.description || null)) { P.description = v; changed.push('description: ' + (v || '(removed)')); }
    }
    if (!changed.length) return { ok: true, changed: [], post: view(P) };
    P.updatedAt = new Date().toISOString();
    if (!P.removeToken) P.removeToken = crypto.randomBytes(16).toString('hex');
    SP.writeStore(S);
    notify('✏️ <b>Shop post edited by the seller</b> (live now) · ' + SP.esc(P.title) + ' · ' + SP.esc(P.shop.name) + '\n' + changed.map(c => '• ' + SP.esc(c).slice(0, 300)).join('\n')
      + '\n<a href="https://bina.et/shop#p-' + P.id + '">post</a> · <a href="https://bina.et/ops/shop-posts/' + P.id + '/remove?t=' + P.removeToken + '">take it down</a>');
    return { ok: true, changed, post: view(P) };
  });
  done();
};
