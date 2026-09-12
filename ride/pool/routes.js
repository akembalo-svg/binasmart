'use strict';
// HTTP surface of BinaPool. Rider identity is the same as the solo ride: name + Ethiopian phone, or
// signed Telegram initData (+ signed contact). The driver endpoints authenticate like /api/drive/*.
const tgauth = require('../tgauth');
const { normPhone } = require('../phone');

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

module.exports = function poolRoutes(fastify, { pool, groups, riderBotToken, drive, limiter, clientIp, OWNER_KEY }) {
  const listRL = limiter(60000, 60), joinRL = limiter(600000, 8), pollRL = limiter(60000, 120);

  // ---- daily groups (contract commute) ----
  if (groups) {
    const gwho = (req, reply) => {
      const b = req.body || {};
      let tg = null, contact = null;
      if (b.tg && b.tg.initData) {
        tg = tgauth.verifyInitData(b.tg.initData, riderBotToken);
        if (!tg) { reply.code(401).send({ ok: false, error: 'Telegram sign-in expired — please reopen BinaSmart from the bot' }); return null; }
        if (b.tg.contact) contact = tgauth.verifyContact(b.tg.contact, riderBotToken);
      }
      const name = String(b.riderName || (tg && [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ')) || '').trim().slice(0, 60);
      const phone = normPhone(contact ? contact.phone : b.riderPhone);
      if (!name || !phone) { reply.code(400).send({ ok: false, error: 'riderName and an Ethiopian riderPhone (09…) are required' }); return null; }
      if (!joinRL(phone) || !joinRL('ip:' + clientIp(req))) { reply.code(429).send({ ok: false, error: 'too_many_requests' }); return null; }
      return { name, phone, telegramId: tg ? tg.user.id : null, tg };
    };
    const gpoint = p => { if (!p || typeof p !== 'object') return null; const lat = num(p.lat, 8.5, 9.5), lng = num(p.lng, 38.4, 39.2); if (lat == null || lng == null) return null; return { lat, lng, label: String(p.label || '').slice(0, 120) || (lat.toFixed(5) + ', ' + lng.toFixed(5)) }; };
    const gans = (reply, r, w) => { if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : (/full|women_only|too_many/.test(r.error) ? 409 : 400)).send(r); return { ...r, phone: w && w.tg ? w.phone : undefined }; };
    fastify.post('/api/pool/groups', async (req, reply) => {
      const w = gwho(req, reply); if (!w) return;
      const b = req.body || {};
      const pickup = gpoint(b.pickup), dropoff = gpoint(b.dropoff);
      if (!pickup || !dropoff) return reply.code(400).send({ ok: false, error: 'pickup and dropoff inside Addis required' });
      return gans(reply, await groups.create({ name: b.name, pickup, dropoff, days: b.days, timeMin: b.timeMin, womenOnly: b.womenOnly === true, organizer: w }), w);
    });
    fastify.get('/api/pool/groups/mine', async (req, reply) => {
      if (!pollRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
      const phone = normPhone(req.query.phone);
      // This answers "which commute groups is this person in" from a phone number, so the phone is the
      // dimension that matters: on one address, walking a range of 09… numbers would otherwise be
      // limited only by how fast it can ask. who() already limits both ways for join and create.
      if (phone && !pollRL('ph:' + phone)) return reply.code(429).send({ ok: false, error: 'slow_down' });
      reply.header('Cache-Control', 'no-store');
      if (phone) return { ok: true, groups: await groups.mine(phone) };
      if (req.query.initData) { const tg = tgauth.verifyInitData(String(req.query.initData), riderBotToken); if (!tg) return reply.code(401).send({ ok: false, error: 'telegram_auth_invalid' }); return { ok: true, groups: await groups.mineByTelegram(String(tg.user.id)) }; }
      return { ok: true, groups: [] };
    });
    fastify.get('/api/pool/groups/:id/public', async (req, reply) => {
      if (!pollRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
      const g = await groups.pub(String(req.params.id));
      if (!g) return reply.code(404).send({ ok: false, error: 'not_found' });
      reply.header('Cache-Control', 'no-store');
      return { ok: true, group: g };
    });
    fastify.post('/api/pool/groups/:id/join', async (req, reply) => {
      const w = gwho(req, reply); if (!w) return;
      return gans(reply, await groups.join(String(req.params.id), { name: w.name, phone: w.phone, telegramId: w.telegramId, female: (req.body || {}).female === true }), w);
    });
    fastify.post('/api/pool/groups/:id/leave', async (req, reply) => {
      if (!pollRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
      const r = await groups.leave(String(req.params.id), normPhone((req.body || {}).phone));
      if (!r.ok) return reply.code(404).send(r);
      return r;
    });
  }

  // ---- ops (owner key, same as /api/ride/ops/*) ----
  if (OWNER_KEY) {
    // Header first, then the query — matching server.js and ride/routes.js. A query string is written
    // to the access log and the address bar; the parameter stays because some ops links are plain
    // document navigations, which cannot carry a header.
    const ops = (req, reply) => { if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };
    fastify.get('/api/pool/ops/list', async (req, reply) => { if (!ops(req, reply)) return; return { ok: true, pools: await pool.opsList() }; });
    fastify.get('/api/pool/ops/stats', async (req, reply) => { if (!ops(req, reply)) return; return { ok: true, ...(await pool.opsStats(req.query.days)) }; });
    fastify.post('/api/pool/ops/:id/cancel', async (req, reply) => { if (!ops(req, reply)) return; const r = await pool.opsCancel(String(req.params.id)); if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 409).send(r); return r; });
  }

  fastify.get('/api/pool/corridors', async (req, reply) => {
    if (!listRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const lat = num(req.query.lat, 8.5, 9.5), lng = num(req.query.lng, 38.4, 39.2);
    reply.header('Cache-Control', 'no-store');
    return { ok: true, ...(await pool.list(lat, lng)) };
  });

  // ONE round trip for the Pool screen (slow networks): groups near me + today's corridors together.
  fastify.get('/api/pool/board', async (req, reply) => {
    if (!listRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const lat = num(req.query.lat, 8.5, 9.5), lng = num(req.query.lng, 38.4, 39.2);
    reply.header('Cache-Control', 'no-store');
    const [l, n] = await Promise.all([pool.list(lat, lng), (lat != null && lng != null) ? pool.near(lat, lng) : Promise.resolve({ groups: [], radiusM: 0 })]);
    return { ok: true, ...l, groups: n.groups, located: lat != null && lng != null };
  });

  // The share card behind /pool/<id>: public, no phones.
  fastify.get('/api/pool/:id/public', async (req, reply) => {
    if (!pollRL(req.params.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const g = await pool.pub(String(req.params.id));
    if (!g) return reply.code(404).send({ ok: false, error: 'not_found' });
    reply.header('Cache-Control', 'no-store');
    return { ok: true, group: g };
  });

  // Groups near me: cars still filling whose boarding point is within ~2.5 km.
  fastify.get('/api/pool/near', async (req, reply) => {
    if (!listRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const lat = num(req.query.lat, 8.5, 9.5), lng = num(req.query.lng, 38.4, 39.2);
    if (lat == null || lng == null) return reply.code(400).send({ ok: false, error: 'lat and lng inside Addis required' });
    reply.header('Cache-Control', 'no-store');
    return { ok: true, ...(await pool.near(lat, lng)) };
  });

  // Who is booking: name + Ethiopian phone, or signed Telegram identity. Shared by join / create / join-by-id.
  function who(req, reply) {
    const b = req.body || {};
    let tg = null, contact = null;
    if (b.tg && b.tg.initData) {
      tg = tgauth.verifyInitData(b.tg.initData, riderBotToken);
      if (!tg) { reply.code(401).send({ ok: false, error: 'Telegram sign-in expired — please reopen BinaSmart from the bot' }); return null; }
      if (b.tg.contact) contact = tgauth.verifyContact(b.tg.contact, riderBotToken);
    }
    const name = String(b.riderName || (tg && [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ')) || '').trim().slice(0, 60);
    const phone = normPhone(contact ? contact.phone : b.riderPhone);
    if (!name || !phone) { reply.code(400).send({ ok: false, error: 'riderName and an Ethiopian riderPhone (09…) are required' }); return null; }
    if (!joinRL(phone) || !joinRL('ip:' + clientIp(req))) { reply.code(429).send({ ok: false, error: 'too_many_requests' }); return null; }
    return { name, phone, telegramId: tg ? tg.user.id : null, tg, mode: b.mode === 'now' ? 'now' : 'wait', paymentMethod: b.paymentMethod };
  }
  const point = p => { if (!p || typeof p !== 'object') return null; const lat = num(p.lat, 8.5, 9.5), lng = num(p.lng, 38.4, 39.2); if (lat == null || lng == null) return null; return { lat, lng, label: String(p.label || '').slice(0, 120) || (lat.toFixed(5) + ', ' + lng.toFixed(5)) }; };
  const answer = (reply, r, w) => { if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : (/leaving|full|far|women_only|go_now_only/.test(r.error) ? 409 : 400)).send(r); return { ...r, phone: w.tg ? w.phone : undefined }; };

  fastify.post('/api/pool/join', async (req, reply) => {
    const w = who(req, reply); if (!w) return;
    const b = req.body || {};
    return answer(reply, await pool.join({ corridorKey: String(b.corridorKey || ''), stopId: String(b.stopId || ''), mode: w.mode, name: w.name, phone: w.phone, telegramId: w.telegramId, paymentMethod: w.paymentMethod }), w);
  });

  // Start a group from here to anywhere.
  fastify.post('/api/pool/create', async (req, reply) => {
    const w = who(req, reply); if (!w) return;
    const b = req.body || {};
    const pickup = point(b.pickup), dropoff = point(b.dropoff);
    if (!pickup || !dropoff) return reply.code(400).send({ ok: false, error: 'pickup and dropoff inside Addis required' });
    return answer(reply, await pool.create({ pickup, dropoff, mode: w.mode, name: w.name, phone: w.phone, telegramId: w.telegramId, paymentMethod: w.paymentMethod, womenOnly: b.womenOnly === true }), w);
  });

  // Join one specific car from the "near me" list or a share link.
  fastify.post('/api/pool/:id/join', async (req, reply) => {
    const w = who(req, reply); if (!w) return;
    const b = req.body || {};
    return answer(reply, await pool.joinById(String(req.params.id), { stopId: String(b.stopId || ''), mode: w.mode, name: w.name, phone: w.phone, telegramId: w.telegramId, paymentMethod: w.paymentMethod,
      lat: num(b.lat, 8.5, 9.5), lng: num(b.lng, 38.4, 39.2), female: b.female === true }), w);
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

  // Driver: open a car at a station, leave now, close; tick a rider on / no-show. Same auth as /api/drive.
  if (drive && drive._auth) {
    if (drive.poolOpen) {
      fastify.post('/api/drive/pool/open', drive.poolOpen);
      fastify.post('/api/drive/pool/:poolId/go', drive.poolGo);
      fastify.post('/api/drive/pool/:poolId/close', drive.poolClose);
    }
    fastify.post('/api/drive/pool/:rideId/seat/:seatId', async (req, reply) => {
      const drv = await drive._auth(req, reply);
      if (!drv) return;
      const r = await pool.board(String(req.params.rideId), drv.id, String(req.params.seatId), String((req.body || {}).status || 'boarded'));
      if (!r.ok) return reply.code(r.error === 'not_found' ? 404 : 409).send(r);
      return r;
    });
  }
};
