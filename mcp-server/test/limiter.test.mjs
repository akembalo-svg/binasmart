import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLimiter } from '../lib/limiter.mjs';

test('allows max hits inside the window, then blocks, then resets', () => {
  let now = 1_000_000;
  const rl = makeLimiter(60_000, 3, () => now);
  assert.equal(rl('a'), true);
  assert.equal(rl('a'), true);
  assert.equal(rl('a'), true);
  assert.equal(rl('a'), false);
  assert.equal(rl('b'), true, 'other keys are independent');
  now += 60_001;
  assert.equal(rl('a'), true, 'window expired');
});
