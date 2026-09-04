'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const registerCinema = require('../../cinema');
const { sign } = require('../../ride/tgauth');

const TOKEN = '111:RIDERTOKEN', KEY = 'owner-secret';

// In-memory Prisma with the guards that matter: unique (showId, seat), unique ticket code/idemKey,
// unique slugs; `in`/`gte`/`lt` filters; the includes the routes ask for.
function fakeDb() {
  const T = { venue: [], hall: [], event: [], show: [], seatHold: [], ticket: [] };
  let seq = 0; const nid = p => p + (++seq);
  const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' });
  const UNIQ = { seatHold: [['showId', 'seat']], ticket: [['code'], ['idemKey']], venue: [['slug']], event: [['slug']] };
  const cmp = (v, c) => {
    if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) {
      if ('in' in c && !c.in.includes(v)) return false;
      if ('gte' in c && !(v >= c.gte)) return false; if ('gt' in c && !(v > c.gt)) return false;
      if ('lte' in c && !(v <= c.lte)) return false; if ('lt' in c && !(v < c.lt)) return false;
      if ('not' in c && v === c.not) return false;
      return true;
    }
    return v === c;
  };
  const match = (row, where) => Object.entries(where || {}).every(([k, c]) => k === 'OR' ? c.some(w => match(row, w)) : cmp(row[k], c));
  const inc = (name, row, include) => {
    if (!row) return null; const r = { ...row }; if (!include) return r;
    if (name === 'show') {
      if (include.event) r.event = T.event.find(e => e.id === r.eventId) || null;
      if (include.hall) { const h = T.hall.find(h => h.id === r.hallId); r.hall = h ? { ...h, venue: include.hall.include && include.hall.include.venue ? T.venue.find(v => v.id === h.venueId) || null : undefined } : null; }
    }
    if (name === 'ticket' && include.show) r.show = inc('show', T.show.find(s => s.id === r.showId), include.show.include || null);
    if (name === 'venue' && include.halls) r.halls = T.hall.filter(h => h.venueId === r.id);
    return r;
  };
  const model = name => ({
    create: async ({ data, include }) => { for (const u of UNIQ[name] || []) if (u.every(k => data[k] != null) && T[name].some(r => u.every(k => r[k] === data[k]))) throw p2002(); const row = { id: nid(name[0]), createdAt: new Date(), ...data }; T[name].push(row); return inc(name, row, include); },
    findUnique: async ({ where, include }) => inc(name, T[name].find(r => match(r, where)) || null, include),
    findFirst: async ({ where, include }) => inc(name, T[name].find(r => match(r, where)) || null, include),
    findMany: async ({ where, include, orderBy, take } = {}) => { let rows = T[name].filter(r => match(r, where)); if (orderBy) { const [[k, d]] = Object.entries(orderBy); rows = rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (d === 'desc' ? -1 : 1)); } if (take) rows = rows.slice(0, take); return rows.map(r => inc(name, r, include)); },
    count: async ({ where } = {}) => T[name].filter(r => match(r, where)).length,
    update: async ({ where, data, include }) => { const r = T[name].find(r => match(r, where)); Object.assign(r, data); return inc(name, r, include); },
    updateMany: async ({ where, data }) => { let n = 0; for (const r of T[name]) if (match(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    deleteMany: async ({ where }) => { let n = 0; for (let i = T[name].length - 1; i >= 0; i--) if (match(T[name][i], where)) { T[name].splice(i, 1); n++; } return { count: n }; },
  });
  const db = { _: T, $transaction: async fn => fn(db) };
  for (const n of Object.keys(T)) db[n] = model(n);
  return db;
}

const LAYOUT = { rows: ['A', 'B'], seatsPerRow: 4, aisles: [2], sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', rows: ['A'] }, { name: 'Regular', nameAm: 'መደበኛ', rows: ['B'] }] };
const sent = [];
const tgApi = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { ok: true }; } };
const chapaCalls = [];
let chapaPaid = false;
const chapa = { enabled: true, mode: 'test', init: async p => { chapaCalls.push(p); return 'https://checkout.chapa.co/x/' + p.ref; }, verify: async () => chapaPaid };

async function app(opts) {
  const f = Fastify({ logger: false });
  f.decorateReply('sendFile', function (name) { this.type('text/html').send('<!-- ' + name + ' -->'); });
  const db = fakeDb();
  const cinema = registerCinema(f, { prisma: db, OWNER_KEY: KEY, BASE_URL: 'https://bina.et', riderBotToken: TOKEN, tgApi, chapa: opts && 'chapa' in opts ? opts.chapa : chapa, force: !(opts && opts.disabled), noTimers: true });
  await f.ready();
  return { f, db, cinema };
}
const H = (holder, extra) => ({ 'x-holder': holder, 'content-type': 'application/json', ...extra });
const OPS = { 'x-owner-key': KEY, 'content-type': 'application/json' };
const inTwoHours = () => new Date(Date.now() + 2 * 3600000).toISOString();

// Builds venue → hall → event → show through the ops API, exactly as the ops page will.
async function seed(f, startsAt) {
  const v = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Bina Hall', nameAm: 'ቢና አዳራሽ', phone: '0911000000' } })).json();
  const h = (await f.inject({ method: 'POST', url: '/api/cinema/ops/halls', headers: OPS, payload: { venueId: v.venue.id, name: 'Hall 1', layout: LAYOUT } })).json();
  const e = (await f.inject({ method: 'POST', url: '/api/cinema/ops/events', headers: OPS, payload: { title: 'Lamb', titleAm: 'ላምብ', kind: 'FILM', runtimeMin: 94 } })).json();
  const s = (await f.inject({ method: 'POST', url: '/api/cinema/ops/shows', headers: OPS, payload: { eventId: e.event.id, hallId: h.hall.id, startsAt: startsAt || inTwoHours(), prices: { VIP: 500, Regular: 300 } } })).json();
  assert.equal(s.ok, true, JSON.stringify(s));
  return { venue: v.venue, hall: h.hall, event: e.event, show: s.show };
}

test('disabled by default: no cinema routes when CINEMA_ENABLED is not 1', async () => {
  const { f, cinema } = await app({ disabled: true });
  assert.equal(cinema, null);
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/shows' })).statusCode, 404);
  await f.close();
});

test('ops endpoints need the owner key, and validate what they are given', async () => {
  const { f } = await app();
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', payload: { name: 'x' } })).statusCode, 401);
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/ops/overview' })).statusCode, 401);
  const v = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Bina Hall' } })).json();
  assert.equal(v.venue.slug, 'bina-hall');
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Bina Hall' } })).statusCode, 409, 'duplicate slug');
  const bad = await f.inject({ method: 'POST', url: '/api/cinema/ops/halls', headers: OPS, payload: { venueId: v.venue.id, name: 'H', layout: { ...LAYOUT, sections: [{ name: 'VIP', rows: ['A'] }] } } });
  assert.equal(bad.statusCode, 400); assert.match(bad.json().error, /row B has no section/);
  const h = (await f.inject({ method: 'POST', url: '/api/cinema/ops/halls', headers: OPS, payload: { venueId: v.venue.id, name: 'H', layout: LAYOUT } })).json();
  assert.equal(h.hall.capacity, 8);
  const e = (await f.inject({ method: 'POST', url: '/api/cinema/ops/events', headers: OPS, payload: { title: 'Lamb' } })).json();
  assert.match(e.event.slug, /^lamb-[0-9a-f]{4}$/); assert.equal(e.event.type, 'CINEMA'); assert.deepEqual(e.event.tiers, {});
  const noPrice = await f.inject({ method: 'POST', url: '/api/cinema/ops/shows', headers: OPS, payload: { eventId: e.event.id, hallId: h.hall.id, startsAt: inTwoHours(), prices: { VIP: 500 } } });
  assert.equal(noPrice.statusCode, 400); assert.match(noPrice.json().error, /Regular/);
  const badDate = await f.inject({ method: 'POST', url: '/api/cinema/ops/shows', headers: OPS, payload: { eventId: e.event.id, hallId: h.hall.id, startsAt: 'tomorrow', prices: { VIP: 500, Regular: 300 } } });
  assert.equal(badDate.statusCode, 400);
  await f.close();
});

test('listing shows upcoming onsale shows with seats left and the lowest price', async () => {
  const { f } = await app();
  const { show } = await seed(f);
  const r = (await f.inject({ method: 'GET', url: '/api/cinema/shows' })).json();
  assert.equal(r.shows.length, 1); assert.equal(r.shows[0].id, show.id); assert.equal(r.shows[0].seatsLeft, 8); assert.equal(r.shows[0].from, 300);
  assert.equal(r.shows[0].event.titleAm, 'ላምብ'); assert.equal(r.shows[0].venue.name, 'Bina Hall'); assert.equal(r.chapa.mode, 'test');
  await f.close();
});

test('the seat map endpoint returns layout + live states; unknown show is 404', async () => {
  const { f } = await app();
  const { show } = await seed(f);
  const r = await f.inject({ method: 'GET', url: '/api/cinema/shows/' + show.id, headers: H('holder-aaaaaaaa') });
  assert.equal(r.statusCode, 200);
  const j = r.json();
  assert.equal(j.layout.seatsPerRow, 4); assert.equal(j.seats.length, 8); assert.equal(j.seats[0].state, 'free'); assert.equal(j.holdMs, 600000); assert.equal(j.maxSeats, 8);
  assert.deepEqual(j.mine, []); assert.equal(j.holdExpiresAt, null);
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/shows/nope' })).statusCode, 404);
  await f.close();
});

test('holds: need a holder key; first wins, second is 409 taken; my own re-hold is fine; release frees it', async () => {
  const { f, db } = await app();
  const { show } = await seed(f);
  const url = '/api/cinema/shows/' + show.id + '/hold';
  assert.equal((await f.inject({ method: 'POST', url, payload: { seat: 'A1' } })).statusCode, 400, 'no holder');
  const a = await f.inject({ method: 'POST', url, headers: H('holder-aaaaaaaa'), payload: { seat: 'A1' } });
  assert.equal(a.statusCode, 200); assert.ok(a.json().expiresAt);
  const b = await f.inject({ method: 'POST', url, headers: H('holder-bbbbbbbb'), payload: { seat: 'A1' } });
  assert.equal(b.statusCode, 409); assert.equal(b.json().error, 'taken');
  const again = await f.inject({ method: 'POST', url, headers: H('holder-aaaaaaaa'), payload: { seat: 'A1' } });
  assert.equal(again.statusCode, 200); assert.equal(again.json().already, true);
  assert.equal((await f.inject({ method: 'POST', url, headers: H('holder-aaaaaaaa'), payload: { seat: 'Q9' } })).statusCode, 400);
  const map = (await f.inject({ method: 'GET', url: '/api/cinema/shows/' + show.id, headers: H('holder-bbbbbbbb') })).json();
  assert.equal(map.seats.find(s => s.id === 'A1').state, 'held');
  const mine = (await f.inject({ method: 'GET', url: '/api/cinema/shows/' + show.id, headers: H('holder-aaaaaaaa') })).json();
  assert.deepEqual(mine.mine, ['A1']); assert.ok(mine.holdExpiresAt);
  const rel = await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/release', headers: H('holder-aaaaaaaa'), payload: {} });
  assert.equal(rel.json().released, 1); assert.equal(db._.seatHold.length, 0);
  await f.close();
});

test('race over HTTP: two holders, same seat, same instant -> exactly one 200 and one 409', async () => {
  const { f } = await app();
  const { show } = await seed(f);
  const url = '/api/cinema/shows/' + show.id + '/hold';
  const rs = await Promise.all([f.inject({ method: 'POST', url, headers: H('holder-aaaaaaaa'), payload: { seat: 'B3' } }), f.inject({ method: 'POST', url, headers: H('holder-bbbbbbbb'), payload: { seat: 'B3' } })]);
  assert.deepEqual(rs.map(r => r.statusCode).sort(), [200, 409]);
  await f.close();
});

test('checkout: counter ticket priced server-side, holds consumed, ticket + QR readable, not-held seat refused', async () => {
  const { f, db } = await app();
  const { show } = await seed(f);
  const hold = seat => f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-aaaaaaaa'), payload: { seat } });
  await hold('A1'); await hold('B2');
  const r = await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: show.id, seats: ['A1', 'B2'], name: 'Sara', phone: '0911223344', payMethod: 'counter', idemKey: 'k-1' } });
  assert.equal(r.statusCode, 200, r.body);
  const t = r.json().ticket;
  assert.equal(t.total, 800); assert.equal(t.status, 'RESERVED'); assert.equal(t.payMethod, 'counter'); assert.equal(t.show.event.title, 'Lamb'); assert.equal(t.show.venue.name, 'Bina Hall');
  assert.equal(db._.seatHold.length, 0);
  const g = (await f.inject({ method: 'GET', url: '/api/cinema/tickets/' + t.code })).json();
  assert.equal(g.ticket.code, t.code); assert.deepEqual(g.ticket.seats, ['A1', 'B2']); assert.equal(g.ticket.show.hall.name, 'Hall 1');
  const q = await f.inject({ method: 'GET', url: '/api/cinema/tickets/' + t.code + '/qr.svg' });
  assert.equal(q.statusCode, 200); assert.match(q.headers['content-type'], /svg/); assert.match(q.body, /^<svg/);
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/tickets/BINA-NOPE99' })).statusCode, 404);
  const map = (await f.inject({ method: 'GET', url: '/api/cinema/shows/' + show.id })).json();
  assert.equal(map.seats.find(s => s.id === 'A1').state, 'sold');
  const bad = await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-cccccccc'), payload: { showId: show.id, seats: ['A3'], name: 'X', phone: '0911223355', payMethod: 'counter', idemKey: 'k-2' } });
  assert.equal(bad.statusCode, 409); assert.equal(bad.json().error, 'hold_expired'); assert.deepEqual(bad.json().seats, ['A3']);
  assert.equal(sent.length, 0, 'web buyer: nothing sent to Telegram');
  await f.close();
});

test('checkout inside Telegram: signed initData attaches the buyer and the ticket is delivered; a bad signature is 401', async () => {
  sent.length = 0;
  const { f } = await app();
  const { show } = await seed(f);
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-tgtgtgtg'), payload: { seat: 'A2' } });
  const initData = sign({ user: JSON.stringify({ id: 777, first_name: 'Abel' }), auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
  const r = await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-tgtgtgtg'), payload: { showId: show.id, seats: ['A2'], phone: '0911223344', payMethod: 'counter', idemKey: 'k-tg', tg: { initData } } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().ticket.name, 'Abel');
  assert.equal(sent.length, 1); assert.equal(sent[0].chat, '777'); assert.match(sent[0].text, /A2/); assert.match(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, /\/ticket\/BINA-/);
  const forged = await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-tgtgtgtg'), payload: { showId: show.id, seats: ['A2'], phone: '0911223344', payMethod: 'counter', idemKey: 'k-tg2', tg: { initData: initData.replace(/hash=\w+/, 'hash=0000') } } });
  assert.equal(forged.statusCode, 401);
  await f.close();
});

test('Chapa: gated server-side when off; when on, a checkout URL comes back and verify confirms the ticket', async () => {
  const off = await app({ chapa: { enabled: false } });
  const s1 = await seed(off.f);
  await off.f.inject({ method: 'POST', url: '/api/cinema/shows/' + s1.show.id + '/hold', headers: H('holder-aaaaaaaa'), payload: { seat: 'A1' } });
  const r1 = (await off.f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: s1.show.id, seats: ['A1'], name: 'S', phone: '0911223344', payMethod: 'chapa', idemKey: 'c-1' } })).json();
  assert.equal(r1.ticket.payMethod, 'counter'); assert.equal(r1.checkoutUrl, undefined);
  await off.f.close();

  chapaCalls.length = 0; chapaPaid = false;
  const { f, db } = await app();
  const { show } = await seed(f);
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-aaaaaaaa'), payload: { seat: 'A1' } });
  const r = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: show.id, seats: ['A1'], name: 'S', phone: '0911223344', payMethod: 'chapa', idemKey: 'c-2' } })).json();
  assert.equal(r.ticket.payMethod, 'chapa'); assert.equal(r.ticket.chapaPending, true); assert.match(r.checkoutUrl, /^https:\/\/checkout\.chapa\.co\//);
  assert.equal(chapaCalls[0].amount, 500); assert.match(chapaCalls[0].ref, /^bina-cin-/); assert.match(chapaCalls[0].returnUrl, /\/ticket\/BINA-.*paid=1/);
  assert.equal(db._.ticket[0].chapaRef, chapaCalls[0].ref);
  const notYet = await f.inject({ method: 'POST', url: '/api/cinema/tickets/' + r.ticket.code + '/verify-chapa' });
  assert.equal(notYet.statusCode, 402); assert.equal(notYet.json().error, 'unpaid');
  chapaPaid = true;
  const ok = (await f.inject({ method: 'POST', url: '/api/cinema/tickets/' + r.ticket.code + '/verify-chapa' })).json();
  assert.equal(ok.status, 'CONFIRMED');
  assert.equal(db._.ticket[0].status, 'CONFIRMED');
  const again = (await f.inject({ method: 'POST', url: '/api/cinema/tickets/' + r.ticket.code + '/verify-chapa' })).json();
  assert.equal(again.status, 'CONFIRMED');
  await f.close();
});

test('door: unpaid is refused, paid admits once, second scan refused; counts returned', async () => {
  const { f } = await app();
  const { show } = await seed(f);
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-aaaaaaaa'), payload: { seat: 'B1' } });
  const t = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: show.id, seats: ['B1'], name: 'S', phone: '0911223344', payMethod: 'counter', idemKey: 'd-1' } })).json().ticket;
  const scan = () => f.inject({ method: 'POST', url: '/api/cinema/ops/checkin', headers: OPS, payload: { code: t.code, showId: show.id } });
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/checkin', payload: { code: t.code } })).statusCode, 401);
  const u = await scan(); assert.equal(u.statusCode, 409); assert.equal(u.json().error, 'unpaid');
  const paid = (await f.inject({ method: 'POST', url: '/api/cinema/ops/tickets/' + t.code + '/paid', headers: OPS, payload: {} })).json();
  assert.equal(paid.status, 'CONFIRMED');
  const a = await scan(); assert.equal(a.statusCode, 200); assert.equal(a.json().ticket.status, 'CHECKED_IN'); assert.deepEqual(a.json().counts, { sold: 1, checkedIn: 1 });
  const b = await scan(); assert.equal(b.statusCode, 409); assert.equal(b.json().error, 'already_checked_in');
  const list = (await f.inject({ method: 'GET', url: '/api/cinema/ops/shows/' + show.id + '/tickets', headers: OPS })).json();
  assert.equal(list.tickets.length, 1); assert.equal(list.tickets[0].status, 'CHECKED_IN');
  await f.close();
});

test('cancelling a show cancels live tickets, frees holds, tells Telegram buyers, and refuses new holds', async () => {
  sent.length = 0;
  const { f, db } = await app();
  const { show } = await seed(f);
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-tgtgtgtg'), payload: { seat: 'A1' } });
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-zzzzzzzz'), payload: { seat: 'A4' } });
  const initData = sign({ user: JSON.stringify({ id: 778, first_name: 'Beti' }), auth_date: String(Math.floor(Date.now() / 1000)) }, TOKEN);
  await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-tgtgtgtg'), payload: { showId: show.id, seats: ['A1'], phone: '0911223344', payMethod: 'counter', idemKey: 'x-1', tg: { initData } } });
  assert.equal(sent.length, 1);
  const r = (await f.inject({ method: 'POST', url: '/api/cinema/ops/shows/' + show.id + '/status', headers: OPS, payload: { status: 'cancelled' } })).json();
  assert.equal(r.cancelled, 1);
  assert.equal(db._.ticket[0].status, 'CANCELLED'); assert.equal(db._.seatHold.length, 0, 'stray hold freed');
  assert.equal(sent.length, 2); assert.match(sent[1].text, /ተሰርዟል/);
  const h = await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H('holder-aaaaaaaa'), payload: { seat: 'A2' } });
  assert.equal(h.statusCode, 410); assert.equal(h.json().error, 'show_closed');
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/shows' })).json().shows.length, 0, 'cancelled show is not listed');
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/shows/' + show.id + '/status', headers: OPS, payload: { status: 'bogus' } })).statusCode, 400);
  await f.close();
});

test('pages are served', async () => {
  const { f } = await app();
  for (const u of ['/cinema', '/cinema/abc', '/ticket/BINA-ABCDEF', '/scan', '/ops/cinema']) assert.equal((await f.inject({ method: 'GET', url: u })).statusCode, 200, u);
  await f.close();
});
