'use strict';
// bina.et/hotels/dashboard (1 Oct 2026, Ibrahim chose it): a hotel whose claim the team approved changes its own room
// prices, live at once. The claim carries the phone the team called; bina.et sign-in proves a phone (Telegram contact or
// SMS code), so the approved claims with the account's PROVEN phone are that hotel's. Prices go through hotels/directory.js
// cleanRooms (real birr / dollar ranges) into the same owner-rooms file the hotel page reads; the number for guests goes into owner-phones and is
// shown first everywhere the hotel's phone is (hotels/directory.js phonesOf). Photos and details still go through Bini and the team. Every change reaches the team with a one-tap "remove these prices".
//   GET  /hotels/dashboard                    the page (noindex)
//   GET  /api/hotels/mine                     my hotels and their current owner prices
//   POST /api/hotels/mine/:claimId            {rooms: [{name, price, currency}]} (an empty list removes the owner prices) and/or
//                                             {phone} (the number shown for guests; '' goes back to the map's landline)
//   GET  /ops/hotel-rooms/:claimId/remove?t=  the team's one tap (prices); /ops/hotel-phone/:claimId/remove?t= (phone)

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const H = require('./directory');
const ethPhone = raw => require('../health/directory').ethPhone(raw);
const OWNER_ROOMS = () => process.env.HOTEL_OWNER_ROOMS_FILE || '/root/storage/hotels/owner-rooms.json';
const OWNER_PHONES = () => process.env.HOTEL_OWNER_PHONES_FILE || '/root/storage/hotels/owner-phones.json';
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } };
function writeJ(f, m) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.part', JSON.stringify(m, null, 1)); fs.renameSync(f + '.part', f); }
const readRooms = () => readJ(OWNER_ROOMS()), writeRooms = m => writeJ(OWNER_ROOMS(), m);
const readPhones = () => readJ(OWNER_PHONES()), writePhones = m => writeJ(OWNER_PHONES(), m);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tokEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

module.exports = function hotelDashboard(fastify, { prisma, limiter, tell }, done) {
  const notify = t => Promise.resolve((tell || H.tellOwner)(t)).catch(() => false);
  const editRL = limiter(3600000, 30);
  const who = req => (req.authUser && req.authUser.id ? req.authUser : null);
  async function provenPhone(uid) {
    try { const u = await prisma.authUser.findUnique({ where: { id: uid }, select: { phone: true, phoneVerifiedAt: true } });
      return u && u.phone && u.phoneVerifiedAt ? ethPhone(u.phone) : null; } catch (e) { return null; }
  }
  // approved claims on hotels that are on the map (a "new:" hotel has no page yet; company claims share the table)
  async function myClaims(phone) {
    const rows = await prisma.hotelClaim.findMany({ where: { status: 'approved' } }).catch(() => []);
    return rows.filter(c => !/^(new:|company)/.test(String(c.placeRef)) && ethPhone(c.phone) === phone);
  }
  const view = (c, m, ph) => { const r = m[c.placeRef], o = (ph || readPhones())[c.placeRef]; return { claimId: c.id, name: c.placeName, url: c.slug ? 'https://bina.et/hotels/' + c.slug : null, phone: o ? o.phone : '',
    rooms: r && Array.isArray(r.rooms) ? r.rooms.map(x => ({ name: x.name, price: x.n || null, currency: x.cur || 'ETB' })) : [], updated: r ? r.date : null, byOwner: !!(r && r.by === 'owner') }; };

  fastify.get('/hotels/dashboard', async (req, reply) => { reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store'); return reply.sendFile('hotel-dashboard.html'); });

  fastify.get('/api/hotels/mine', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const phone = await provenPhone(u.id);
    if (!phone) return { ok: true, phone: false, hotels: [] };
    const m = readRooms();
    return { ok: true, phone: '…' + phone.slice(-4), hotels: (await myClaims(phone)).map(c => view(c, m)) };
  });

  fastify.post('/api/hotels/mine/:claimId', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const phone = await provenPhone(u.id);
    if (!phone) return reply.code(403).send({ ok: false, error: 'no_proven_phone' });
    const c = (await myClaims(phone)).find(x => x.id === String(req.params.claimId).slice(0, 40));
    if (!c) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {}, asked = b.rooms === undefined ? null : Array.isArray(b.rooms) ? b.rooms : false;
    if (asked === false || (asked === null && b.phone === undefined)) return reply.code(400).send({ ok: false, error: 'rooms' });
    let guestPhone;
    if (b.phone !== undefined) {   // an Ethiopian mobile or landline the hotel chose for guests; '' goes back to the map's landline
      const raw = String(b.phone || '').trim(); guestPhone = raw ? ethPhone(raw) : '';
      if (raw && !guestPhone) return reply.code(400).send({ ok: false, error: 'phone' });
    }
    const rooms = asked ? H.cleanRooms(asked) : null;
    if (asked && asked.length && !rooms.length) return reply.code(400).send({ ok: false, error: 'prices' });   // all were dropped as unreal
    const m = readRooms(), ph = readPhones(), lines = [], links = [];
    if (rooms) {
      const token = crypto.randomBytes(16).toString('hex');
      if (rooms.length) m[c.placeRef] = { rooms, date: new Date().toISOString().slice(0, 10), claimId: c.id, by: 'owner', removeToken: token };
      else delete m[c.placeRef];
      writeRooms(m);
      lines.push(rooms.length ? rooms.map(r => '• ' + esc(r.name) + ': ' + esc(r.price)).join('\n') : '• removed all owner prices');
      if (rooms.length) links.push('<a href="https://bina.et/ops/hotel-rooms/' + c.id + '/remove?t=' + token + '">remove these prices</a>');
    }
    if (guestPhone !== undefined && guestPhone !== ((ph[c.placeRef] || {}).phone || '')) {
      const token = crypto.randomBytes(16).toString('hex');
      if (guestPhone) ph[c.placeRef] = { phone: guestPhone, date: new Date().toISOString().slice(0, 10), claimId: c.id, by: 'owner', removeToken: token };
      else delete ph[c.placeRef];
      writePhones(ph);
      lines.push(guestPhone ? '• phone for guests: ' + esc(guestPhone) : '• phone for guests: back to the map\'s number');
      if (guestPhone) links.push('<a href="https://bina.et/ops/hotel-phone/' + c.id + '/remove?t=' + token + '">remove this phone</a>');
    }
    if (lines.length) notify('🛏 <b>' + (rooms ? 'Room prices' : 'Phone') + (rooms && lines.length > 1 ? ' and phone' : '') + ' changed by the hotel</b> (live now) · ' + esc(c.placeName) + '\n' + lines.join('\n')
      + (c.slug ? '\n<a href="https://bina.et/hotels/' + c.slug + '">page</a>' : '') + (links.length ? ' · ' + links.join(' · ') : ''));
    return { ok: true, kept: rooms ? rooms.length : undefined, dropped: rooms ? asked.length - rooms.length : undefined, phone: guestPhone !== undefined ? guestPhone : undefined, hotel: view(c, m, ph) };
  });

  fastify.get('/ops/hotel-rooms/:claimId/remove', async (req, reply) => {
    reply.header('X-Robots-Tag', 'noindex');
    const m = readRooms(), ref = Object.keys(m).find(k => m[k] && m[k].claimId === String(req.params.claimId) && m[k].removeToken);
    if (!ref || !tokEq(req.query.t, m[ref].removeToken)) return reply.code(404).send('not found');
    delete m[ref]; writeRooms(m);
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">🗑 Owner room prices removed. The page shows the prices from the hotel\'s website again, if any.</p>');
  });
  fastify.get('/ops/hotel-phone/:claimId/remove', async (req, reply) => {
    reply.header('X-Robots-Tag', 'noindex');
    const ph = readPhones(), ref = Object.keys(ph).find(k => ph[k] && ph[k].claimId === String(req.params.claimId) && ph[k].removeToken);
    if (!ref || !tokEq(req.query.t, ph[ref].removeToken)) return reply.code(404).send('not found');
    delete ph[ref]; writePhones(ph);
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">🗑 The hotel\'s own phone was removed. The page shows the map\'s landline again, if any.</p>');
  });
  done();
};
