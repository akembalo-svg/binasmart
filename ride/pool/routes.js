'use strict';
// HTTP surface of BinaPool. Rider identity is the same as the solo ride: name + Ethiopian phone, or
// signed Telegram initData (+ signed contact). The driver endpoints authenticate like /api/drive/*.
const tgauth = require('../tgauth');
const { normPhone } = require('../phone');

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

module.exports = function poolRoutes(fastify, { pool, riderBotToken, drive, limiter, clientIp }) {
  const listRL = limiter(60000, 60), joinRL = limiter(600000, 8), pollRL = limiter(60000, 120);

  fastify.get('/api/pool/corridors', async (req, reply) => {
    if (!listRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const lat = num(req.query.lat, 8.5, 9.5), lng = num(req.query.lng, 38.4, 39.2);
    reply.header('Cache-Control', 'no-store');
    return { ok: true, ...(await pool.list(lat, lng)) };
  });

  fastify.post('/api/pool/join', async (req, reply) => {
    const b = req.body || {};
    let tg = null, contact = null;
    if (b.tg && b.tg.initData) {
      tg = tgauth.verifyInitData(b.tg.initData, riderBotToken);
      if (!tg) return reply.code(401).send({ ok: false, error: 'Telegram sign-in expired — please reopen BinaSmart from the bot' });
      if (b.tg.contact) contact = tgauth.verifyContact(b.tg.contact, riderBotToken);
    }
    const name = String(b.riderName || (tg && [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ')) || '').trim().slice(0, 60);
    const phone = normPhone(contact ? contact.phone : b.riderPhone);
    if (!name || !phone) return reply.code(400).send({ ok: false, error: 'riderName and an Ethiopian riderPhone (09…) are required' });
    if (!joinRL(phone) || !joinRL('ip:' + clientIp(req))) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const r = await pool.join({ corridorKey: String(b.corridorKey || ''), stopId: String(b.stopId || ''), mode: b.mode === 'now' ? 'now' : 'wait',
      name, phone, telegramId: tg ? tg.user.id : null, paymentMethod: b.paymentMethod });
    if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 400).send(r);
    return { ...r, phone: tg ? phone : undefined };
  });

  fastify.get('/api/pool/:id', async (req, reply) => {
    if (!pollRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const r = await pool.view(String(req.params.id), normPhone(req.query.phone));
    if (!r.ok) return reply.code(404).send(r);
    reply.header('Cache-Control', 'no-store');
    return r;
  });

  fastify.post('/api/pool/:id/leave', async (req, reply) => {
    if (!pollRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const r = await pool.leave(String(req.params.id), normPhone((req.body || {}).phone));
    if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 409).send(r);
    return r;
  });

  // Telegram: resume my open pool (any seat still held/boarded on a live pool).
  fastify.get('/api/pool/mine', async (req, reply) => {
    const tg = tgauth.verifyInitData(String(req.query.initData || ''), riderBotToken);
    if (!tg) return reply.code(401).send({ ok: false, error: 'telegram_auth_invalid' });
    return { ok: true, ...(await pool.mine(String(tg.user.id))) };
  });

  // Driver: tick a rider on / no-show. Same auth as the rest of /api/drive.
  if (drive && drive._auth) {
    fastify.post('/api/drive/pool/:rideId/seat/:seatId', async (req, reply) => {
      const drv = await drive._auth(req, reply);
      if (!drv) return;
      const r = await pool.board(String(req.params.rideId), drv.id, String(req.params.seatId), String((req.body || {}).status || 'boarded'));
      if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 409).send(r);
      return r;
    });
  }
};
