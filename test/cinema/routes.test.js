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
  const T = { venue: [], hall: [], event: [], show: [], seatHold: [], ticket: [], programme: [] };
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
  const match = (row, where) => Object.entries(where || {}).every(([k, c]) => {
    if (k === 'OR') return c.some(w => match(row, w));
    // Relation filter, as the door uses to scope shows to one venue: { hall: { venueId } }.
    if (k === 'hall' && c && typeof c === 'object' && !(c instanceof Date)) { const h = T.hall.find(x => x.id === row.hallId); return !!h && match(h, c); }
    return cmp(row[k], c);
  });
  const inc = (name, row, include) => {
    if (!row) return null; const r = { ...row }; if (!include) return r;
    if (name === 'show') {
      if (include.event) r.event = T.event.find(e => e.id === r.eventId) || null;
      if (include.hall) { const h = T.hall.find(h => h.id === r.hallId); r.hall = h ? { ...h, venue: include.hall.include && include.hall.include.venue ? T.venue.find(v => v.id === h.venueId) || null : undefined } : null; }
    }
    if (name === 'ticket' && include.show) r.show = inc('show', T.show.find(s => s.id === r.showId), include.show.include || null);
    if (name === 'venue' && include.halls) r.halls = T.hall.filter(h => h.venueId === r.id);
    if (name === 'programme' && include.venue) r.venue = T.venue.find(v => v.id === r.venueId) || null;
    return r;
  };
  const model = name => ({
    create: async ({ data, include }) => { for (const u of UNIQ[name] || []) if (u.every(k => data[k] != null) && T[name].some(r => u.every(k => r[k] === data[k]))) throw p2002(); const row = { id: nid(name[0]), createdAt: new Date(), ...(name === 'venue' || name === 'programme' ? { active: true } : {}), ...data }; T[name].push(row); return inc(name, row, include); },
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

test('the public venue directory lists active venues, with the next show when one is on sale', async () => {
  const { f } = await app();
  const { show } = await seed(f);
  await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Quiet Cinema', address: 'Piassa', phone: '0111565029' } });
  const r = (await f.inject({ method: 'GET', url: '/api/cinema/venues' })).json();
  assert.equal(r.ok, true); assert.equal(r.venues.length, 2);
  const bina = r.venues.find(v => v.slug === 'bina-hall'), quiet = r.venues.find(v => v.slug === 'quiet-cinema');
  assert.equal(bina.halls, 1); assert.equal(new Date(bina.nextShowAt).toISOString(), new Date(show.startsAt).toISOString());
  assert.equal(quiet.halls, 0); assert.equal(quiet.nextShowAt, null); assert.equal(quiet.address, 'Piassa');
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
  for (const u of ['/cinema', '/cinema/abc', '/ticket/BINA-ABCDEF', '/scan', '/ops/cinema', '/for-cinemas']) assert.equal((await f.inject({ method: 'GET', url: u })).statusCode, 200, u);
  await f.close();
});

test('SEO: /cinema carries an ItemList of ScreeningEvents; a show page gets its own title, canonical and Event schema', async () => {
  const { f } = await app();
  const { show } = await seed(f);
  const list = await f.inject({ method: 'GET', url: '/cinema' });
  assert.match(list.headers['content-type'], /text\/html/);
  assert.match(list.body, /"@type":"ItemList"/); assert.match(list.body, /"@type":"ScreeningEvent"/); assert.match(list.body, /"priceCurrency":"ETB"/); assert.match(list.body, /"price":300/);
  const page = await f.inject({ method: 'GET', url: '/cinema/' + show.id });
  assert.match(page.body, new RegExp('<title>ላምብ · .* | BinaSmart Cinema</title>'));
  assert.match(page.body, new RegExp('<link rel="canonical" href="https://bina.et/cinema/' + show.id + '">'));
  assert.match(page.body, /"workPresented":\{"@type":"Movie","name":"Lamb"/); assert.match(page.body, /"availability":"https:\/\/schema.org\/InStock"/);
  assert.match(page.body, /"@type":"MovieTheater","name":"Bina Hall"/);
  const gone = await f.inject({ method: 'GET', url: '/cinema/nope' });
  assert.equal(gone.statusCode, 200); assert.doesNotMatch(gone.body, /ld\+json">\{"@context":"https:\/\/schema.org","@type":"ScreeningEvent"/);
  await f.close();
});

// ---- programme listing ----
test('programme: ops creates entries with a source; public groups by venue; expired entries disappear; delete hides', async () => {
  const { f, db } = await app();
  const v = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Gast Cinema', nameAm: 'ጋስት', phone: '0930113377' } })).json().venue;
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const bad = await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', headers: OPS, payload: { venueId: v.id, title: 'Mutiny', times: '12:00', dateFrom: today } });
  assert.equal(bad.statusCode, 400); assert.match(bad.json().error, /sourceName/);
  const doc = await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', headers: OPS, payload: { venueId: v.id, title: 'Doc Film', times: '12:00', dateFrom: '2026-01-01', sourceName: 'Official stamped programme, Cinema Houses Enterprise' } });
  assert.equal(doc.statusCode, 200, 'a named official document is a valid source without a link'); assert.equal(doc.json().programme.sourceUrl, '');
  const ok = await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', headers: OPS, payload: { venueId: v.id, title: 'Mutiny', hallName: 'Gold 2 2D', times: '12:00, 14:00 12:00 7:00', dateFrom: today, dateTo: today, priceText: '300 ብር', sourceName: 'Gast Cinema Telegram', sourceUrl: 'https://t.me/gastcinema', postedAt: '2026-09-02' } });
  assert.equal(ok.statusCode, 200, ok.body); assert.deepEqual(ok.json().programme.times, ['07:00', '12:00', '14:00']);
  const tr = await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', headers: OPS, payload: { venueId: v.id, title: 'Trailered', times: '18:00', dateFrom: today, sourceName: 'Gast', sourceUrl: 'https://t.me/gastcinema', trailerUrl: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.equal(tr.statusCode, 200, tr.body); assert.equal(tr.json().programme.trailerId, 'dQw4w9WgXcQ'); assert.match(tr.json().programme.posterUrl, /i\.ytimg\.com\/vi\/dQw4w9WgXcQ/, 'trailer thumbnail as poster fallback');
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', headers: OPS, payload: { venueId: v.id, title: 'Bad', times: '18:00', dateFrom: today, sourceName: 'G', sourceUrl: 'https://t.me/g', trailerUrl: 'https://vimeo.com/1' } })).statusCode, 400);
  const page = await f.inject({ method: 'GET', url: '/cinema' });
  assert.match(page.body, /"@type":"VideoObject"/); assert.match(page.body, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', headers: OPS, payload: { venueId: v.id, title: 'Old Film', times: '19:00', dateFrom: '2026-01-01', dateTo: '2026-01-02', sourceName: 'Gast', sourceUrl: 'https://t.me/gastcinema' } });
  const pub = (await f.inject({ method: 'GET', url: '/api/cinema/programme' })).json();
  assert.equal(pub.venues.length, 1); assert.equal(pub.venues[0].venue.nameAm, 'ጋስት'); assert.equal(pub.venues[0].venue.phone, '0930113377');
  assert.deepEqual(pub.venues[0].films.map(x => x.title), ['Mutiny', 'Trailered'], 'expired entry hidden');
  assert.equal(pub.venues[0].films[0].sourceUrl, 'https://t.me/gastcinema');
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/programme/' + ok.json().programme.id + '/delete', headers: OPS, payload: {} })).json().removed, 1);
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/programme' })).json().venues[0].films.length, 1);
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/programme', payload: {} })).statusCode, 401);
  await f.close();
});

// ---- general admission ----
const GA = { kind: 'ga', sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', capacity: 2 }, { name: 'Regular', nameAm: 'መደበኛ', capacity: 20 }] };
async function seedGa(f) {
  const v = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name: 'Ghion Hall' } })).json();
  const h = (await f.inject({ method: 'POST', url: '/api/cinema/ops/halls', headers: OPS, payload: { venueId: v.venue.id, name: 'Main', layout: GA } })).json();
  assert.equal(h.hall.capacity, 22, JSON.stringify(h));
  const e = (await f.inject({ method: 'POST', url: '/api/cinema/ops/events', headers: OPS, payload: { title: 'Jazz Night', titleAm: 'ጃዝ ምሽት', kind: 'CONCERT' } })).json();
  const s = (await f.inject({ method: 'POST', url: '/api/cinema/ops/shows', headers: OPS, payload: { eventId: e.event.id, hallId: h.hall.id, startsAt: inTwoHours(), prices: { VIP: 800, Regular: 300 } } })).json();
  assert.equal(s.ok, true, JSON.stringify(s));
  return { show: s.show, hall: h.hall };
}

test('GA: listing flags ga, the show payload carries tiers, hold by quantity, oversell refused with left', async () => {
  const { f } = await app();
  const { show } = await seedGa(f);
  const list = (await f.inject({ method: 'GET', url: '/api/cinema/shows' })).json();
  assert.equal(list.shows[0].ga, true); assert.equal(list.shows[0].seatsLeft, 22); assert.equal(list.shows[0].event.kind, 'CONCERT');
  const url = '/api/cinema/shows/' + show.id;
  const g = (await f.inject({ method: 'GET', url, headers: H('holder-aaaaaaaa') })).json();
  assert.equal(g.layout.kind, 'ga'); assert.deepEqual(g.tiers.map(t => [t.name, t.price, t.left, t.mine]), [['VIP', 800, 2, 0], ['Regular', 300, 20, 0]]); assert.deepEqual(g.seats, []); assert.equal(g.maxSeats, 10);
  const h1 = await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-aaaaaaaa'), payload: { section: 'VIP', qty: 2 } });
  assert.equal(h1.statusCode, 200, h1.body); assert.deepEqual(h1.json().seats, ['VIP-001', 'VIP-002']);
  const h2 = await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-bbbbbbbb'), payload: { section: 'VIP', qty: 1 } });
  assert.equal(h2.statusCode, 409); assert.equal(h2.json().error, 'sold_out'); assert.equal(h2.json().left, 0);
  assert.equal((await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-bbbbbbbb'), payload: { section: 'Balcony', qty: 1 } })).statusCode, 400);
  const g2 = (await f.inject({ method: 'GET', url, headers: H('holder-aaaaaaaa') })).json();
  assert.deepEqual(g2.tiers[0], { name: 'VIP', nameAm: 'ቪአይፒ', price: 800, capacity: 2, left: 0, mine: 2 }); assert.deepEqual(g2.mine, ['VIP-001', 'VIP-002']);
  const rel = await f.inject({ method: 'POST', url: url + '/release', headers: H('holder-aaaaaaaa'), payload: { section: 'VIP', qty: 1 } });
  assert.equal(rel.json().released, 1);
  await f.close();
});

test('GA: checkout prices per place, ticket and door carry a "VIP x 2" summary', async () => {
  const { f } = await app();
  const { show } = await seedGa(f);
  const url = '/api/cinema/shows/' + show.id;
  await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-aaaaaaaa'), payload: { section: 'VIP', qty: 2 } });
  await f.inject({ method: 'POST', url: url + '/hold', headers: H('holder-aaaaaaaa'), payload: { section: 'Regular', qty: 1 } });
  const r = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: show.id, seats: ['VIP-001', 'VIP-002', 'REGULAR-001'], name: 'Sara', phone: '0911223344', payMethod: 'counter', idemKey: 'ga-1' } })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.ticket.total, 1900);
  assert.deepEqual(r.ticket.summary, [{ section: 'VIP', nameAm: 'ቪአይፒ', count: 2 }, { section: 'Regular', nameAm: 'መደበኛ', count: 1 }]);
  assert.equal(r.ticket.show.ga, true);
  const g = (await f.inject({ method: 'GET', url: '/api/cinema/tickets/' + r.ticket.code })).json();
  assert.equal(g.ticket.summary[0].count, 2);
  await f.inject({ method: 'POST', url: '/api/cinema/ops/tickets/' + r.ticket.code + '/paid', headers: OPS, payload: {} });
  const d = (await f.inject({ method: 'POST', url: '/api/cinema/ops/checkin', headers: OPS, payload: { code: r.ticket.code, showId: show.id } })).json();
  assert.equal(d.ok, true); assert.deepEqual(d.ticket.summary.map(x => x.count), [2, 1]); assert.deepEqual(d.counts, { sold: 3, checkedIn: 3 });
  const list = (await f.inject({ method: 'GET', url: '/api/cinema/shows' })).json();
  assert.equal(list.shows[0].seatsLeft, 19);
  const ops = (await f.inject({ method: 'GET', url: '/api/cinema/ops/shows/' + show.id + '/tickets', headers: OPS })).json();
  assert.deepEqual(ops.tickets[0].summary.map(x => x.count), [2, 1]);
  await f.close();
});

// ---------------------------------------------------------------------------------------------
// 2026-09-12. Per-venue door keys. Before this, /api/cinema/ops/checkin was gated by the global
// OWNER_KEY, so putting a cinema's door staff on the scanner meant handing them the key to every
// owner route on the platform - building, ride, watch, payments. 24 venues, 0 with a key.
// ---------------------------------------------------------------------------------------------

// A second cinema, so "scoped to this venue" can be tested against something rather than asserted.
async function seedTwo(f) {
  const mk = async (name) => {
    const v = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues', headers: OPS, payload: { name } })).json();
    const h = (await f.inject({ method: 'POST', url: '/api/cinema/ops/halls', headers: OPS, payload: { venueId: v.venue.id, name: 'Hall 1', layout: LAYOUT } })).json();
    const e = (await f.inject({ method: 'POST', url: '/api/cinema/ops/events', headers: OPS, payload: { title: name + ' Film' } })).json();
    const sh = (await f.inject({ method: 'POST', url: '/api/cinema/ops/shows', headers: OPS, payload: { eventId: e.event.id, hallId: h.hall.id, startsAt: inTwoHours(), prices: { VIP: 500, Regular: 300 } } })).json();
    assert.equal(sh.ok, true, JSON.stringify(sh));
    return { venue: v.venue, hall: h.hall, show: sh.show };
  };
  return { a: await mk('Alem Cinema'), b: await mk('Edna Mall') };
}

const mintKey = async (f, venueId) => (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues/' + venueId + '/scankey', headers: OPS, payload: {} })).json();

// Sells one seat and pays for it at the counter, so there is a ticket a door can actually admit.
async function soldTicket(f, show, seat, holder) {
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + show.id + '/hold', headers: H(holder), payload: { seat } });
  const t = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H(holder), payload: { showId: show.id, seats: [seat], name: 'Sara', phone: '0911223344', payMethod: 'counter', idemKey: holder } })).json().ticket;
  await f.inject({ method: 'POST', url: '/api/cinema/ops/tickets/' + t.code + '/paid', headers: OPS, payload: {} });
  return t;
}

test('minting a door key: shown once, only its hash is stored, and it is not the owner key', async () => {
  const { f, db } = await app();
  const { a } = await seedTwo(f);
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/venues/' + a.venue.id + '/scankey', payload: {} })).statusCode, 401, 'minting is the owner\u2019s');
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/ops/venues/nope/scankey', headers: OPS, payload: {} })).statusCode, 404);

  const m = await mintKey(f, a.venue.id);
  assert.match(m.key, /^BSCAN-[A-Za-z0-9_-]{32}$/);
  assert.notEqual(m.key, KEY, 'a door key is not the platform key');
  assert.equal(m.link, 'https://bina.et/scan?scan=' + encodeURIComponent(m.key));
  assert.equal(m.venue.hasScanKey, true);
  assert.ok(m.venue.scanKeyAt);

  const row = db._.venue.find(v => v.id === a.venue.id);
  assert.equal(row.scanKey, undefined, 'the column that used to hold a key in the clear is gone');
  assert.equal(row.scanKeyHash.length, 64);
  assert.equal(row.scanKeyHash.includes(m.key.slice(6)), false, 'what is stored is not the key');
  await f.close();
});

test('a door key opens its own cinema, by header or by link, and nothing without one', async () => {
  const { f } = await app();
  const { a } = await seedTwo(f);
  const key = (await mintKey(f, a.venue.id)).key;

  for (const bad of [{}, { headers: { 'x-scan-key': 'BSCAN-' + 'x'.repeat(32) } }, { headers: { 'x-scan-key': KEY } }, { url: '/api/cinema/scan/session?scan=nonsense' }]) {
    const r = await f.inject({ method: 'GET', url: bad.url || '/api/cinema/scan/session', headers: bad.headers });
    assert.equal(r.statusCode, 401, JSON.stringify(bad) + ' must not open a door');
  }
  // The owner key is not a door key and a door key is not the owner key: neither substitutes.
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/ops/overview', headers: { 'x-owner-key': key } })).statusCode, 401);

  const byHeader = await f.inject({ method: 'GET', url: '/api/cinema/scan/session', headers: { 'x-scan-key': key } });
  assert.equal(byHeader.statusCode, 200);
  assert.equal(byHeader.json().venue.name, 'Alem Cinema');
  // The parameter stays because the scanner is opened by navigating to a printed or texted link.
  const byLink = await f.inject({ method: 'GET', url: '/api/cinema/scan/session?scan=' + encodeURIComponent(key) });
  assert.equal(byLink.statusCode, 200);
  await f.close();
});

test('the session lists this cinema and not the one next door', async () => {
  const { f } = await app();
  const { a, b } = await seedTwo(f);
  const ka = (await mintKey(f, a.venue.id)).key, kb = (await mintKey(f, b.venue.id)).key;
  const sa = (await f.inject({ method: 'GET', url: '/api/cinema/scan/session', headers: { 'x-scan-key': ka } })).json();
  const sb = (await f.inject({ method: 'GET', url: '/api/cinema/scan/session', headers: { 'x-scan-key': kb } })).json();
  assert.deepEqual(sa.shows.map(s => s.id), [a.show.id]);
  assert.deepEqual(sb.shows.map(s => s.id), [b.show.id]);
  assert.equal(sa.venue.id, a.venue.id);
  assert.deepEqual(Object.keys(sa.venue).sort(), ['id', 'name', 'nameAm', 'slug']);
  await f.close();
});

// The shape behind five IDORs fixed earlier today: the ACTOR is authenticated, then the row is acted
// on by id. Here the actor is a venue and the row is a ticket that may belong to another cinema.
test('a door admits its own cinema\u2019s ticket and refuses the one next door by name', async () => {
  const { f } = await app();
  const { a, b } = await seedTwo(f);
  const ka = (await mintKey(f, a.venue.id)).key, kb = (await mintKey(f, b.venue.id)).key;
  const tb = await soldTicket(f, b.show, 'A1', 'holder-bbbbbbbb');

  const wrong = await f.inject({ method: 'POST', url: '/api/cinema/scan/checkin', headers: { 'x-scan-key': ka, 'content-type': 'application/json' }, payload: { code: tb.code } });
  assert.equal(wrong.statusCode, 409);
  assert.equal(wrong.json().error, 'wrong_venue');
  assert.equal(wrong.json().counts, null, 'and it learns nothing about that show');

  const right = await f.inject({ method: 'POST', url: '/api/cinema/scan/checkin', headers: { 'x-scan-key': kb, 'content-type': 'application/json' }, payload: { code: tb.code } });
  assert.equal(right.statusCode, 200, 'the refusal at the wrong door did not burn the ticket');
  assert.equal(right.json().ticket.status, 'CHECKED_IN');
  assert.deepEqual(right.json().counts, { sold: 1, checkedIn: 1 });

  // Naming another cinema's show in the body does not move the door there either.
  const cross = await f.inject({ method: 'POST', url: '/api/cinema/scan/checkin', headers: { 'x-scan-key': ka, 'content-type': 'application/json' }, payload: { code: 'BINA-ZZZZZZ', showId: b.show.id } });
  assert.equal(cross.json().counts, null, 'counts come from a show this venue owns, or not at all');
  await f.close();
});

test('door staff are told who and which seats - not the buyer\u2019s phone number or what they paid', async () => {
  const { f } = await app();
  const { a } = await seedTwo(f);
  const key = (await mintKey(f, a.venue.id)).key;
  const t = await soldTicket(f, a.show, 'A1', 'holder-aaaaaaaa');
  const r = (await f.inject({ method: 'POST', url: '/api/cinema/scan/checkin', headers: { 'x-scan-key': key, 'content-type': 'application/json' }, payload: { code: t.code } })).json();
  assert.equal(r.ok, true);
  assert.equal(r.ticket.name, 'Sara');
  assert.deepEqual(r.ticket.seats, ['A1']);
  assert.equal(r.ticket.phone, undefined, 'a doorkeeper does not need the buyer\u2019s phone number');
  assert.equal(r.ticket.total, undefined);
  assert.equal(r.ticket.payMethod, undefined);
  assert.equal(JSON.stringify(r).includes('0911223344'), false);
  await f.close();
});

// Unpaid at the door means "go to the counter". Without this the venue would still need the platform
// key to finish that, which is the thing the door key exists to stop.
test('the counter is the same staff: a venue key can mark its own ticket paid, never another cinema\u2019s', async () => {
  const { f } = await app();
  const { a, b } = await seedTwo(f);
  const ka = (await mintKey(f, a.venue.id)).key;
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + a.show.id + '/hold', headers: H('holder-aaaaaaaa'), payload: { seat: 'A1' } });
  const ta = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-aaaaaaaa'), payload: { showId: a.show.id, seats: ['A1'], name: 'Sara', phone: '0911223344', payMethod: 'counter', idemKey: 'p-a' } })).json().ticket;
  await f.inject({ method: 'POST', url: '/api/cinema/shows/' + b.show.id + '/hold', headers: H('holder-bbbbbbbb'), payload: { seat: 'A1' } });
  const tb = (await f.inject({ method: 'POST', url: '/api/cinema/tickets', headers: H('holder-bbbbbbbb'), payload: { showId: b.show.id, seats: ['A1'], name: 'Dawit', phone: '0911223355', payMethod: 'counter', idemKey: 'p-b' } })).json().ticket;

  const own = await f.inject({ method: 'POST', url: '/api/cinema/scan/tickets/' + ta.code + '/paid', headers: { 'x-scan-key': ka, 'content-type': 'application/json' }, payload: {} });
  assert.equal(own.json().status, 'CONFIRMED');
  const theirs = await f.inject({ method: 'POST', url: '/api/cinema/scan/tickets/' + tb.code + '/paid', headers: { 'x-scan-key': ka, 'content-type': 'application/json' }, payload: {} });
  assert.equal(theirs.statusCode, 409);
  assert.equal(theirs.json().error, 'wrong_venue');
  // Cancelling is a refund decision and stays with the owner: there is no door route for it.
  assert.equal((await f.inject({ method: 'POST', url: '/api/cinema/scan/tickets/' + ta.code + '/cancel', headers: { 'x-scan-key': ka, 'content-type': 'application/json' }, payload: {} })).statusCode, 404);
  await f.close();
});

test('minting again retires the old key, and revoking closes the door', async () => {
  const { f } = await app();
  const { a } = await seedTwo(f);
  const first = (await mintKey(f, a.venue.id)).key;
  const open = () => f.inject({ method: 'GET', url: '/api/cinema/scan/session', headers: { 'x-scan-key': first } });
  assert.equal((await open()).statusCode, 200);

  const second = (await mintKey(f, a.venue.id)).key;
  assert.notEqual(second, first);
  assert.equal((await open()).statusCode, 401, 'a key that is lost is retired by minting another');
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/scan/session', headers: { 'x-scan-key': second } })).statusCode, 200);

  const rev = (await f.inject({ method: 'POST', url: '/api/cinema/ops/venues/' + a.venue.id + '/scankey/revoke', headers: OPS, payload: {} })).json();
  assert.equal(rev.venue.hasScanKey, false);
  assert.equal((await f.inject({ method: 'GET', url: '/api/cinema/scan/session', headers: { 'x-scan-key': second } })).statusCode, 401);
  await f.close();
});

test('ops is told a venue has a key and when - never the key, never its hash', async () => {
  const { f } = await app();
  const { a } = await seedTwo(f);
  const m = await mintKey(f, a.venue.id);
  const ov = await f.inject({ method: 'GET', url: '/api/cinema/ops/overview', headers: OPS });
  assert.equal(ov.statusCode, 200);
  assert.equal(ov.body.includes(m.key), false, 'the key is shown once, at mint, and never again');
  assert.equal(ov.body.includes('scanKeyHash'), false);
  const v = ov.json().venues.find(x => x.id === a.venue.id);
  assert.equal(v.hasScanKey, true);
  assert.ok(v.scanKeyAt);
  assert.equal(ov.json().venues.find(x => x.name === 'Edna Mall').hasScanKey, false);
  await f.close();
});
