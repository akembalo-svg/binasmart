'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDispatch } = require('../../ride/dispatch');

function harness({ online }) {
  const rides = { r1: { id: 'r1', status: 'dispatching', concierge: false } };
  const alerts = [];
  const prisma = {
    driver: { count: async () => online },
    ride: {
      updateMany: async ({ where, data }) => { const r = rides[where.id]; if (!r || r.status !== where.status) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
      findUnique: async ({ where }) => rides[where.id]
    }
  };
  const telegram = { conciergeAlert: async r => { alerts.push(r.id); return true; } };
  const settings = { get: async () => ({ conciergeAfterS: 60 }) };
  const timers = [];
  const setTimeoutFn = (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; };
  const clearTimeoutFn = h => { h.cleared = true; };
  const d = makeDispatch({ prisma, telegram, settings, setTimeoutFn, clearTimeoutFn });
  return { d, rides, alerts, timers };
}

test('no drivers online -> concierge immediately', async () => {
  const h = harness({ online: 0 });
  const r = await h.d.start('r1');
  assert.equal(r, true);
  assert.equal(h.rides.r1.concierge, true);
  assert.deepEqual(h.alerts, ['r1']);
});

test('drivers online -> waits the concierge window, then concierge', async () => {
  const h = harness({ online: 2 });
  const r = await h.d.start('r1');
  assert.equal(r, 'waiting');
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, 60000);
  assert.deepEqual(h.alerts, []);
  await h.timers[0].fn();
  assert.equal(h.rides.r1.concierge, true); assert.deepEqual(h.alerts, ['r1']);
});

test('cancel() clears a pending timer; a ride already assigned is not escalated', async () => {
  const h = harness({ online: 1 });
  await h.d.start('r1');
  h.d.cancel('r1');
  assert.equal(h.timers[0].cleared, true);
  h.rides.r1.status = 'assigned';
  const ok = await h.d.toConcierge('r1');
  assert.equal(ok, false); assert.deepEqual(h.alerts, []);
});
