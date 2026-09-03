'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSettings, DEFAULTS, deepMerge } = require('../../ride/settings');

function fakePrisma(row) {
  const store = { row };
  return {
    rideSetting: {
      findUnique: async () => store.row,
      upsert: async ({ update, create }) => { store.row = store.row ? { ...store.row, ...update } : create; return store.row; }
    },
    _store: store
  };
}

test('deepMerge merges nested objects and overrides scalars', () => {
  const out = deepMerge({ a: 1, t: { x: { base: 1, min: 2 } } }, { a: 2, t: { x: { base: 9 } } });
  assert.deepEqual(out, { a: 2, t: { x: { base: 9, min: 2 } } });
});

test('get() returns defaults when no row exists', async () => {
  const s = makeSettings(fakePrisma(null));
  const v = await s.get();
  assert.equal(v.commissionPct, DEFAULTS.commissionPct);
  assert.equal(v.tiers.economy.min, 150);
});

test('update() persists and merges', async () => {
  const p = fakePrisma(null);
  const s = makeSettings(p);
  const v = await s.update({ commissionPct: 10, tiers: { moto: { min: 70 } } });
  assert.equal(v.commissionPct, 10);
  assert.equal(v.tiers.moto.min, 70);
  assert.equal(v.tiers.moto.base, DEFAULTS.tiers.moto.base);
  assert.equal(JSON.parse(p._store.row.json).commissionPct, 10);
});

test('update() rejects non-numeric or out-of-range knobs and persists nothing', async () => {
  const p = fakePrisma(null);
  const s = makeSettings(p);
  await assert.rejects(() => s.update({ tiers: { economy: { base: '80' } } }), /invalid_settings: tiers\.economy\.base/);
  await assert.rejects(() => s.update({ commissionPct: 150 }), /invalid_settings: commissionPct/);
  await assert.rejects(() => s.update({ radiiKm: [] }), /invalid_settings: radiiKm/);
  assert.equal(p._store.row, null);
  assert.equal((await s.get()).tiers.economy.base, DEFAULTS.tiers.economy.base);
});

test('get() falls back to DEFAULTS when the row is corrupt, and never aliases DEFAULTS', async () => {
  for (const json of ['{not json', 'null', JSON.stringify({ tiers: { economy: { base: 'BAD' } } })]) {
    const s = makeSettings(fakePrisma({ id: 'default', json }));
    const v = await s.get();
    assert.equal(v.tiers.economy.base, DEFAULTS.tiers.economy.base);
    assert.notEqual(v, DEFAULTS);
    assert.notEqual(v.tiers.economy, DEFAULTS.tiers.economy);
  }
  const s2 = makeSettings(fakePrisma(null));
  await assert.rejects(() => s2.update({ tiers: { economy: { seats: 0 } } }), /invalid_settings: tiers\.economy\.seats/);
  await assert.rejects(() => s2.update([1, 2]), /invalid_settings: patch/);
  try { await s2.update({ commissionPct: 150 }); } catch (e) { assert.equal(e.statusCode, 400); }
});

test('offerWindowS defaults to 25 s and the radii stay numeric', async () => {
  const s = await makeSettings(fakePrisma(null)).get();
  assert.equal(s.offerWindowS, 25);
  assert.deepEqual(s.radiiKm, [3, 6, 10]);
  assert.equal(typeof s.radiiKm[0], 'number');
});
