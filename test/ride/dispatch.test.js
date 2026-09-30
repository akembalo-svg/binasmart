'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDispatch } = require('../../ride/dispatch');

const T = 1_700_000_000_000;
function harness({ online, rides, conciergeAfterS = 60 }) {
  rides = rides || { r1: { id: 'r1', status: 'dispatching', concierge: false, requestedAt: new Date(T - 90_000) } };
  const alerts = [];
  const prisma = {
    driver: { count: async () => online },
    ride: {
      updateMany: async ({ where, data }) => { const r = rides[where.id]; if (!r || r.status !== where.status || (where.concierge !== undefined && r.concierge !== where.concierge)) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
      findUnique: async ({ where }) => rides[where.id],
      findMany: async ({ where }) => Object.values(rides).filter(r => r.status === where.status && r.concierge === where.concierge && r.requestedAt < where.requestedAt.lt).map(r => ({ id: r.id }))
    }
  };
  const telegram = { conciergeAlert: async r => { alerts.push(r.id); return true; } };
  const settings = { get: async () => ({ conciergeAfterS }) };
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

test('toConcierge is idempotent: second call returns false and does not re-alert', async () => {
  const h = harness({ online: 0 });
  assert.equal(await h.d.toConcierge('r1'), true);
  assert.equal(await h.d.toConcierge('r1'), false);
  assert.deepEqual(h.alerts, ['r1']);
});

test('sweepStale escalates only stale, un-escalated, still-dispatching rides; conciergeAfterS 0 escalates immediately', async () => {
  const h = harness({ online: 2, rides: {
    fresh: { id: 'fresh', status: 'dispatching', concierge: false, requestedAt: new Date(T - 10_000) },
    stale: { id: 'stale', status: 'dispatching', concierge: false, requestedAt: new Date(T - 90_000) },
    done:  { id: 'done',  status: 'dispatching', concierge: true,  requestedAt: new Date(T - 90_000) },
    taken: { id: 'taken', status: 'assigned',    concierge: false, requestedAt: new Date(T - 90_000) }
  }});
  assert.equal(await h.d.sweepStale(T), 1);
  assert.deepEqual(h.alerts, ['stale']);
  assert.equal(await h.d.sweepStale(T), 0);
  assert.deepEqual(h.alerts, ['stale']);
  const z = harness({ online: 2, conciergeAfterS: 0 });
  assert.equal(await z.d.start('r1'), true);
  assert.equal(z.timers.length, 0);
});

test('with online drivers, start() opens offers; only when none can be offered does it fall back to concierge', async () => {
  const prisma = { driver: { count: async () => 2 }, ride: { updateMany: async () => ({ count: 1 }), findUnique: async () => ({ id: 'r1' }) } };
  const settings = { get: async () => ({ conciergeAfterS: 60 }) };
  const mk = (offers, alerts) => makeDispatch({ prisma, settings, offers,
    telegram: { conciergeAlert: async r => { alerts.push(r.id); return true; } },
    setTimeoutFn: () => ({}), clearTimeoutFn: () => {} });

  const opened = [], alertsA = [];
  assert.equal(await mk({ open: async id => { opened.push(id); return 3; } }, alertsA).start('r1'), 'waiting');
  assert.deepEqual(opened, ['r1'], 'the auction was opened');
  assert.deepEqual(alertsA, [], 'no owner alert while drivers are considering');

  const alertsB = [];
  assert.equal(await mk({ open: async () => 0 }, alertsB).start('r1'), true, 'nobody offerable → concierge now');
  assert.deepEqual(alertsB, ['r1']);
});

// A driver who closes the Mini App mid-trip froze the ride and himself for ever (2026-09-19: 'ontrip'
// for three and a half hours, rider locked out of cancelling, driver excluded from every offer).
function abandonHarness({ lastSeenAt, status = 'ontrip', onRideId = 'r9' }) {
  const driver = { id: 'd1', name: 'Fetiya', lastSeenAt, onRideId };
  const ride = { id: 'r9', status, driverId: 'd1', driver, riderName: 'Ameran', riderPhone: '+251911',
    startedAt: new Date(T - 3 * 3600_000), requestedAt: new Date(T - 3 * 3600_000) };
  const notes = [];
  const prisma = {
    driver: {
      count: async () => 0,
      updateMany: async ({ where, data }) => {
        if (driver.id !== where.id || driver.onRideId !== where.onRideId) return { count: 0 };
        Object.assign(driver, data); return { count: 1 };
      },
    },
    // The real query filters on the driver's silence; the fake must too, or the "leave a live trip
    // alone" case passes for the wrong reason.
    ride: {
      findMany: async ({ where }) => {
        const cutoff = where.OR[0].driver.lastSeenAt.lt;
        const quiet = driver.lastSeenAt === null || driver.lastSeenAt === undefined || new Date(driver.lastSeenAt) < cutoff;
        return (where.status.in.includes(ride.status) && quiet) ? [ride] : [];
      },
      updateMany: async () => ({ count: 1 }), findUnique: async () => ride,
    },
  };
  const telegram = { conciergeAlert: async () => true, ownerNote: async t => { notes.push(t); return true; } };
  const d = makeDispatch({ prisma, telegram, settings: { get: async () => ({ conciergeAfterS: 60 }) } });
  return { d, driver, notes };
}

test('an abandoned trip frees the driver and tells the owner, exactly once', async () => {
  const h = abandonHarness({ lastSeenAt: new Date(T - 45 * 60_000) });   // silent 45 minutes
  assert.equal(await h.d.sweepAbandoned(T), 1);
  assert.equal(h.driver.onRideId, null, 'the driver is released, or he receives no offer ever again');
  assert.match(h.notes[0], /ABANDONED TRIP/);
  assert.match(h.notes[0], /45 minutes/);
  // Second pass: already freed, so nothing to say.
  assert.equal(await h.d.sweepAbandoned(T), 0, 'idempotent without a new column');
  assert.equal(h.notes.length, 1, 'the owner is not told twice about the same ride');
});

test('a trip whose driver reported recently is left alone, however long it has run', async () => {
  const h = abandonHarness({ lastSeenAt: new Date(T - 60_000) });        // silent 1 minute
  assert.equal(await h.d.sweepAbandoned(T), 0);
  assert.equal(h.driver.onRideId, 'r9', 'a slow trip across Addis is still a trip');
  assert.equal(h.notes.length, 0);
});

test('a driver who never sent a single fix counts as abandoned', async () => {
  const h = abandonHarness({ lastSeenAt: null });
  assert.equal(await h.d.sweepAbandoned(T), 1);
  assert.match(h.notes[0], /the whole trip/);
});
