'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mintFrameToken, verifyFrameToken, TTL_MS } = require('../../gov/token');

const secret = 'x'.repeat(40);
const t0 = 1_760_000_000_000;

test('a token minted for an office verifies for that office only', () => {
  const tok = mintFrameToken('mols', { secret, now: () => t0 });
  assert.match(tok, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyFrameToken(tok, 'mols', { secret, now: () => t0 + 1000 }), true);
  assert.equal(verifyFrameToken(tok, 'other', { secret, now: () => t0 + 1000 }), false);
});

test('it expires after two hours', () => {
  const tok = mintFrameToken('mols', { secret, now: () => t0 });
  assert.equal(TTL_MS, 2 * 3600 * 1000);
  assert.equal(verifyFrameToken(tok, 'mols', { secret, now: () => t0 + TTL_MS - 1 }), true);
  assert.equal(verifyFrameToken(tok, 'mols', { secret, now: () => t0 + TTL_MS + 1 }), false);
});

test('a changed payload or another secret fails', () => {
  const tok = mintFrameToken('mols', { secret, now: () => t0 });
  const [body, sig] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ o: 'mols', e: t0 + 10 * TTL_MS, n: 'aaaaaaaa' })).toString('base64url') + '.' + sig;
  assert.equal(verifyFrameToken(forged, 'mols', { secret, now: () => t0 }), false);
  assert.equal(verifyFrameToken(body + '.' + sig, 'mols', { secret: 'y'.repeat(40), now: () => t0 }), false);
});

test('no secret, or a short one, means no token and no verification', () => {
  assert.equal(mintFrameToken('mols', { secret: 'short', now: () => t0 }), null);
  const tok = mintFrameToken('mols', { secret, now: () => t0 });
  assert.equal(verifyFrameToken(tok, 'mols', { secret: '', now: () => t0 }), false);
});

test('garbage is false, never a throw', () => {
  for (const g of [undefined, null, '', 'a.b', '....', 'x'.repeat(5000), { toString: () => 'a.b' }])
    assert.equal(verifyFrameToken(g, 'mols', { secret, now: () => t0 }), false);
});
