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
