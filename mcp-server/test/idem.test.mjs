import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idemKey } from '../lib/idem.mjs';

const from = { lat: 9.01081, lng: 38.75782 }, to = { lat: 9.03451, lng: 38.75011 };

test('stable inside a 10-minute bucket, different across buckets', () => {
  const t0 = 1_700_000_000_000; // arbitrary epoch ms
  const a = idemKey('+251911244344', from, to, t0);
  const b = idemKey('+251911244344', from, to, t0 + 5 * 60_000);
  const c = idemKey('+251911244344', from, to, t0 + 11 * 60_000);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{40}$/);
});

test('tiny coordinate jitter (<0.00005°) does not change the key; a different phone does', () => {
  const t0 = 1_700_000_000_000;
  const a = idemKey('+251911244344', from, to, t0);
  const b = idemKey('+251911244344', { lat: 9.01083, lng: 38.75784 }, to, t0);
  const c = idemKey('+251911244345', from, to, t0);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
