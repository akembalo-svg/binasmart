'use strict';
// ops/ride/driver-morning.js: online is read from stored pings inside the peak windows. Everything is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const { build, windows } = require('../ops/ride/driver-morning');

const NOW = new Date(Date.UTC(2026, 8, 26, 6, 30));          // 09:30 Addis, 26 September 2026
test('the windows are yesterday 17-20 and today 07-09, Addis time', () => {
  const [eve, morn] = windows(NOW);
  assert.equal(eve.from.toISOString(), '2026-09-25T14:00:00.000Z');
  assert.equal(eve.to.toISOString(), '2026-09-25T17:00:00.000Z');
  assert.equal(morn.from.toISOString(), '2026-09-26T04:00:00.000Z');
  assert.equal(morn.to.toISOString(), '2026-09-26T06:00:00.000Z');
});

test('a driver with pings in the morning window is online from first to last ping; one without is not', async () => {
  const pings = { d1: [new Date('2026-09-26T04:12:00Z'), new Date('2026-09-26T05:40:00Z')], d2: [] };
  const prisma = {
    driver: { findMany: async () => [{ id: 'd1', name: 'Sample One', tier: 'economy' }, { id: 'd2', name: 'Sample Two', tier: 'comfort' }] },
    driverLocation: { findMany: async ({ where }) => (pings[where.driverId] || []).filter(t => t >= where.at.gte && t < where.at.lt).map(at => ({ at })) },
    ride: { findMany: async () => [{ status: 'cancelled', cancelledBy: 'nodriver' }, { status: 'completed' }] },
  };
  const t = await build(prisma, NOW);
  assert.match(t, /ዛሬ ጠዋት[\s\S]*✅ Sample \(economy\) 07:12–08:40/);
  assert.match(t, /⚪ Sample \(comfort\) — አልገባም/);
  assert.match(t, /2 ጉዞ ተጠይቋል · 1 ተጠናቋል · 1 ሹፌር ስላልተገኘ ተሰርዟል/);
  assert.doesNotMatch(t, /Nobody was online/);
});

test('nobody online says so', async () => {
  const prisma = { driver: { findMany: async () => [{ id: 'd1', name: 'Sample', tier: 'bajaj' }] },
    driverLocation: { findMany: async () => [] }, ride: { findMany: async () => [] } };
  assert.match(await build(prisma, NOW), /Nobody was online: the drivers need a call/);
});
