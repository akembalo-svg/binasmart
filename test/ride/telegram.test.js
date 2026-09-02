'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTelegram } = require('../../ride/telegram');

const RIDE = { id: 'r1', tier: 'economy', fareEtb: 255, paymentMethod: 'cash', estimate: false,
  pickup: { lat: 9.0108, lng: 38.7578, label: 'Bole' }, dropoff: { lat: 8.9806, lng: 38.79, label: 'Meskel' },
  distanceM: 5400, durationS: 612, riderName: 'Test Rider', riderPhone: '+251911000000' };

test('conciergeAlert sends one formatted message to the owner chat', async () => {
  const sent = [];
  const t = makeTelegram({ sendTg: async (chat, text) => { sent.push({ chat, text }); return true; }, ownerChat: '42', baseUrl: 'https://bina.et', ownerKey: 'K' });
  const prev = process.env.RIDE_TG_SILENT; delete process.env.RIDE_TG_SILENT;
  try {
    assert.equal(await t.conciergeAlert(RIDE), true);
  } finally { if (prev !== undefined) process.env.RIDE_TG_SILENT = prev; }
  assert.equal(sent.length, 1); assert.equal(sent[0].chat, '42');
  const txt = sent[0].text;
  for (const s of ['ECONOMY', '255 ETB', 'cash', 'Bole', 'Meskel', '5.4 km', '~10 min', 'Test Rider', '+251911000000', 'mlat=9.0108', '/ride-ops?key=K&ride=r1']) assert.ok(txt.includes(s), 'missing ' + s);
  assert.ok(!txt.includes('(estimate)'));
});

test('silent mode logs instead of sending', async () => {
  let called = 0; const logs = [];
  const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  const t = makeTelegram({ sendTg: async () => { called++; return true; }, ownerChat: '42', baseUrl: 'https://bina.et', ownerKey: 'K' });
  process.env.RIDE_TG_SILENT = '1';
  try {
    assert.equal(await t.conciergeAlert({ ...RIDE, estimate: true }), true);
    assert.equal(await t.ownerNote('hello'), true);
  } finally { delete process.env.RIDE_TG_SILENT; console.log = orig; }
  assert.equal(called, 0);
  assert.ok(logs.some(l => l.includes('TG SILENT') && l.includes('(estimate)')));
  assert.ok(logs.some(l => l.includes('hello')));
});
