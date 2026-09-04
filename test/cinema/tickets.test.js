'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTickets, makeCode } = require('../../cinema/tickets');
const { makeHolds } = require('../../cinema/holds');

const LAYOUT = { rows: ['A', 'B'], seatsPerRow: 4, sections: [{ name: 'VIP', rows: ['A'] }, { name: 'R', rows: ['B'] }] };

// Fake Prisma with the two unique guards that matter here: SeatHold(showId, seat) and Ticket.idemKey.
function world(opts) {
  const holds = [], tickets = []; let seq = 0;
  const show = { id: 's1', status: 'onsale', startsAt: new Date(2_000_000_000), counterCutoffMin: 30, prices: { VIP: 500, R: 300 },
    hall: { name: 'Hall 1', layout: LAYOUT, venue: { name: 'Bina Hall', phone: '+251911000000' } }, event: { title: 'Film', titleAm: 'ፊልም' }, ...(opts && opts.show) };
  const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' });
  const matchHold = (h, w) => (!w.showId || h.showId === w.showId) && (!w.holderKey || h.holderKey === w.holderKey)
    && (!w.seat || (w.seat.in ? w.seat.in.includes(h.seat) : h.seat === w.seat)) && (!w.expiresAt || h.expiresAt < w.expiresAt.lt);
  const matchTicket = (t, w) => (!w.id || t.id === w.id) && (!w.code || t.code === w.code) && (!w.showId || t.showId === w.showId)
    && (!w.payMethod || t.payMethod === w.payMethod)
    && (!w.status || (w.status.in ? w.status.in.includes(t.status) : t.status === w.status));
  const prisma = { _: { holds, tickets, show },
    $transaction: async fn => fn(prisma),
    show: { findUnique: async () => ({ ...show }) },
    seatHold: {
      create: async ({ data }) => { if (holds.some(h => h.showId === data.showId && h.seat === data.seat)) throw p2002(); const h = { id: 'h' + (++seq), ...data }; holds.push(h); return h; },
      findMany: async ({ where }) => holds.filter(h => matchHold(h, where)),
      deleteMany: async ({ where }) => { let n = 0; for (let i = holds.length - 1; i >= 0; i--) if (matchHold(holds[i], where)) { holds.splice(i, 1); n++; } return { count: n }; },
      count: async ({ where }) => holds.filter(h => matchHold(h, where)).length,
    },
    ticket: {
      findMany: async ({ where }) => tickets.filter(t => matchTicket(t, where)),
      findUnique: async ({ where }) => tickets.find(t => (where.code && t.code === where.code) || (where.idemKey && t.idemKey === where.idemKey) || (where.id && t.id === where.id)) || null,
      create: async ({ data }) => { if (data.idemKey && tickets.some(t => t.idemKey === data.idemKey)) throw p2002(); if (tickets.some(t => t.code === data.code)) throw p2002(); const t = { id: 't' + (++seq), createdAt: new Date(), ...data }; tickets.push(t); return t; },
      updateMany: async ({ where, data }) => { let n = 0; for (const t of tickets) if (matchTicket(t, where)) { Object.assign(t, data); n++; } return { count: n }; },
    },
  };
  const sent = [];
  const now = () => 1_000_000;
  const holdsApi = makeHolds({ prisma, now });
  const tk = makeTickets({ prisma, holds: holdsApi, now, notify: async (t, text) => { sent.push({ t, text }); return true; }, baseUrl: 'https://bina.et' });
  return { prisma, tk, holds: holdsApi, show, sent };
}
const buyer = { name: 'Sara', phone: '0911223344', payMethod: 'counter' };

test('checkout turns my holds into a ticket priced from the show, and deletes the holds', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'me'); await w.holds.hold(w.show, 'B2', 'me');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1', 'B2'], ...buyer, idemKey: 'k1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.ticket.total, 800); assert.equal(r.ticket.status, 'RESERVED'); assert.equal(r.ticket.payMethod, 'counter');
  assert.match(r.ticket.code, /^BINA-[A-HJ-NP-Z2-9]{6}$/); assert.deepEqual(r.ticket.seats, ['A1', 'B2']);
  assert.equal(w.prisma._.holds.length, 0, 'holds consumed');
  assert.equal(r.ticket.phone, '+251911223344');
  assert.equal(w.sent.length, 1, 'the buyer is messaged once');
  assert.match(w.sent[0].text, /BINA-/); assert.match(w.sent[0].text, /A1, B2/); assert.match(w.sent[0].text, /800/);
});
test('you cannot buy a seat you are not holding, or that someone else holds', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'you');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'k2' });
  assert.equal(r.ok, false); assert.equal(r.error, 'hold_expired'); assert.deepEqual(r.seats, ['A1']);
  assert.equal(w.prisma._.tickets.length, 0); assert.equal(w.sent.length, 0);
});
test('a seat that was sold underneath a hold is refused as sold, not silently double-booked', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'me');
  w.prisma._.tickets.push({ id: 'tx', code: 'BINA-ZZZZZZ', showId: 's1', seats: ['A1'], status: 'CONFIRMED', payMethod: 'counter' });
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'k2b' });
  assert.equal(r.error, 'sold'); assert.deepEqual(r.seats, ['A1']);
});
test('a double-tapped checkout returns the same ticket, not two', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'me');
  const a = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'same' });
  const b = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'same' });
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(b.duplicate, true);
  assert.equal(a.ticket.code, b.ticket.code); assert.equal(w.prisma._.tickets.length, 1); assert.equal(w.sent.length, 1);
});
test('a non-Ethiopian phone is refused unless booking for someone else with an Ethiopian number', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'me');
  assert.equal((await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'S', phone: '+971501234567', payMethod: 'counter', idemKey: 'k3' })).error, 'phone');
  assert.equal((await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: '', phone: '0911223344', payMethod: 'counter', idemKey: 'k3b' })).error, 'name');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], name: 'Ibrahim', phone: '+971501234567', guest: { name: 'Sara', phone: '0911223344' }, payMethod: 'counter', idemKey: 'k4' });
  assert.equal(r.ok, true); assert.equal(r.ticket.name, 'Sara'); assert.equal(r.ticket.phone, '+251911223344');
});
test('closed shows, empty or bogus seat lists, and unknown pay methods are handled', async () => {
  const w = world({ show: { status: 'cancelled' } });
  assert.equal((await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'k5' })).error, 'show_closed');
  const w2 = world();
  assert.equal((await w2.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['Z9'], ...buyer, idemKey: 'k6' })).error, 'no_seats');
  await w2.holds.hold(w2.show, 'A1', 'me');
  const r = await w2.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1', 'A1'], ...buyer, payMethod: 'bitcoin', idemKey: 'k7' });
  assert.equal(r.ok, true); assert.deepEqual(r.ticket.seats, ['A1'], 'de-duplicated'); assert.equal(r.ticket.payMethod, 'counter', 'unknown method falls back to counter');
});
test('counter reservations are released at the cutoff, paid ones are not, and the buyer is told', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'me'); await w.holds.hold(w.show, 'A2', 'me2');
  await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'k8' });
  const paid = await w.tk.checkout({ showId: 's1', holderKey: 'me2', seats: ['A2'], name: 'T', phone: '0911223355', payMethod: 'counter', idemKey: 'k9' });
  assert.equal(await w.tk.markPaid(paid.ticket.code, 'counter'), true);
  assert.equal(await w.tk.markPaid(paid.ticket.code, 'counter'), false, 'already paid');
  const before = w.show.startsAt.getTime() - 30 * 60000 - 1;
  const tkEarly = makeTickets({ prisma: w.prisma, holds: w.holds, now: () => before, notify: async () => true });
  assert.equal(await tkEarly.releaseUnpaid([w.show]), 0, 'nothing before the cutoff');
  const sentLate = [];
  const tkLate = makeTickets({ prisma: w.prisma, holds: w.holds, now: () => before + 2, notify: async (t, text) => { sentLate.push(text); return true; } });
  assert.equal(await tkLate.releaseUnpaid([w.show]), 1);
  assert.equal(w.prisma._.tickets[0].status, 'CANCELLED'); assert.equal(w.prisma._.tickets[1].status, 'CONFIRMED');
  assert.equal(sentLate.length, 1); assert.match(sentLate[0], /A1/);
  assert.equal((await w.holds.availability(w.show, 'x')).find(s => s.id === 'A1').state, 'free', 'seat is back on the map');
});
test('cancel works once on a live ticket and never on a checked-in one', async () => {
  const w = world();
  await w.holds.hold(w.show, 'A1', 'me');
  const r = await w.tk.checkout({ showId: 's1', holderKey: 'me', seats: ['A1'], ...buyer, idemKey: 'k10' });
  assert.equal(await w.tk.cancel(r.ticket.code), true);
  assert.equal(await w.tk.cancel(r.ticket.code), false);
  w.prisma._.tickets[0].status = 'CHECKED_IN';
  assert.equal(await w.tk.cancel(r.ticket.code), false);
});
test('QR is an SVG that encodes the ticket page URL', async () => {
  const w = world();
  const svg = await w.tk.qrSvg('BINA-ABC234');
  assert.match(svg, /^<svg/); assert.ok(svg.length > 500);
  assert.equal(w.tk.ticketUrl('BINA-ABC234'), 'https://bina.et/ticket/BINA-ABC234');
});
test('makeCode never produces confusable characters', () => {
  for (let i = 0; i < 300; i++) assert.match(makeCode(), /^BINA-[A-HJ-NP-Z2-9]{6}$/);
});
