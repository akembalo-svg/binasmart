'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeCheckin } = require('../../cinema/checkin');

function world(tickets) {
  const prisma = { ticket: {
    findUnique: async ({ where }) => { const t = tickets.find(x => x.code === where.code); return t ? { ...t } : null; },
    updateMany: async ({ where, data }) => { const t = tickets.find(x => x.code === where.code && x.status === where.status); if (!t) return { count: 0 }; Object.assign(t, data); return { count: 1 }; },
  } };
  return { c: makeCheckin({ prisma, now: () => 1_000_000 }), tickets };
}
const show = { id: 's1', startsAt: new Date(1_000_000 + 3600_000), event: { title: 'Film' }, hall: { name: 'Hall 1' } };
const T = (code, status, showId) => ({ code, status, seats: ['A1'], name: 'Sara', showId: showId || 's1', show });

test('a confirmed ticket checks in once; the second scan is refused with the time of the first', async () => {
  const { c } = world([T('BINA-AAAAAA', 'CONFIRMED')]);
  const a = await c.scan('BINA-AAAAAA', 's1');
  assert.equal(a.ok, true); assert.equal(a.ticket.status, 'CHECKED_IN'); assert.equal(a.ticket.name, 'Sara');
  const b = await c.scan('BINA-AAAAAA', 's1');
  assert.equal(b.ok, false); assert.equal(b.error, 'already_checked_in'); assert.equal(b.at.getTime(), 1_000_000);
});
test('reserved-but-unpaid, cancelled, unknown, and wrong-show tickets are refused with the reason', async () => {
  const { c } = world([T('BINA-RRRRRR', 'RESERVED'), T('BINA-CCCCCC', 'CANCELLED')]);
  assert.equal((await c.scan('BINA-RRRRRR', 's1')).error, 'unpaid');
  assert.equal((await c.scan('BINA-CCCCCC', 's1')).error, 'cancelled');
  assert.equal((await c.scan('BINA-XXXXXX', 's1')).error, 'unknown');
  assert.equal((await c.scan('BINA-RRRRRR', 's2')).error, 'wrong_show');
  assert.equal((await c.scan('', 's1')).error, 'unknown');
});
test('without a show filter any show is accepted (single-door venues)', async () => {
  const { c } = world([T('BINA-AAAAAA', 'CONFIRMED', 's9')]);
  assert.equal((await c.scan('BINA-AAAAAA')).ok, true);
});
test('codes are normalised: lower case, spaces, the URL form, all scan the same ticket', async () => {
  const { c } = world([T('BINA-AAAAAA', 'CONFIRMED')]);
  assert.equal(c.normalise(' bina-aaaaaa '), 'BINA-AAAAAA');
  assert.equal(c.normalise('https://bina.et/ticket/BINA-AAAAAA'), 'BINA-AAAAAA');
  assert.equal(c.normalise('binaaaaaaa'), 'BINA-AAAAAA', 'hyphen optional when typed');
  assert.equal((await c.scan(' bina-aaaaaa ', 's1')).ok, true);
  const w2 = world([T('BINA-AAAAAA', 'CONFIRMED')]);
  assert.equal((await w2.c.scan('https://bina.et/ticket/BINA-AAAAAA', 's1')).ok, true);
});
test('two doors scanning the same code at once: one admits, one is refused', async () => {
  const { c } = world([T('BINA-AAAAAA', 'CONFIRMED')]);
  const [a, b] = await Promise.all([c.scan('BINA-AAAAAA', 's1'), c.scan('BINA-AAAAAA', 's1')]);
  assert.equal([a, b].filter(x => x.ok).length, 1);
  assert.equal([a, b].find(x => !x.ok).error, 'already_checked_in');
});
