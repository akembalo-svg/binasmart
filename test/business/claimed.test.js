'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isClaimed, CLAIM_FIELDS } = require('../../business/claimed');

test('a completed claim is consent; so is pressing the link in the bot', () => {
  assert.equal(isClaimed({ claimedAt: new Date('2026-09-05T00:00:00Z') }), true);
  assert.equal(isClaimed({ tgChatId: '12345' }), true);
  assert.equal(isClaimed({ claimedAt: new Date(), tgChatId: '12345' }), true);
});

// ownerPhone is ops writing down who is ALLOWED to claim. Reading it as consent meant that the
// moment ops noted a number, that person's mobile was published and their page asked to be indexed
// without them doing anything.
test('ops noting who may claim a shop is not the owner claiming it', () => {
  assert.equal(isClaimed({ ownerPhone: '+251911000111' }), false);
  assert.equal(isClaimed({ ownerPhone: '+251911000111', claimedAt: null, tgChatId: null }), false);
});

test('a listing nobody has touched is not published', () => {
  assert.equal(isClaimed({}), false);
  assert.equal(isClaimed({ claimedAt: null, tgChatId: null }), false);
  assert.equal(isClaimed(null), false);
  assert.equal(isClaimed(undefined), false);
});

// A projection that drops a claim column answers "no", which fails safe but hides a shop whose owner
// did claim it — which is the bug this module exists to end. The SQL callers select from this list.
test('the columns a caller must load are named, so a projection cannot quietly drop one', () => {
  assert.deepEqual(CLAIM_FIELDS.slice().sort(), ['claimedAt', 'tgChatId']);
  const row = { claimedAt: new Date(), tgChatId: null };
  for (const f of CLAIM_FIELDS) assert.ok(f in row, 'a caller loading CLAIM_FIELDS has ' + f);
  const dropped = { tgChatId: null };
  assert.equal(isClaimed(dropped), false, 'and dropping one fails closed, never open');
});

// The MCP server is a separate process with its own node_modules and its own module system, so it
// carries a second copy of this rule. Two copies of a consent check is how one of them quietly keeps
// publishing after the other stops - which is what had already happened to open_now.
test('the MCP copy of the rule reads exactly the same fields', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'mcp-server', 'lib', 'claimed.mjs'), 'utf8');
  const named = (src.match(/r\.(\w+)/g) || []).map(m => m.slice(2));
  assert.deepEqual([...new Set(named)].sort(), CLAIM_FIELDS.slice().sort(),
    'mcp-server/lib/claimed.mjs reads ' + [...new Set(named)].join(', ') + ' but business/claimed.js names ' + CLAIM_FIELDS.join(', '));
  assert.equal(/ownerPhone/.test(src.split('export const isClaimed')[1] || ''), false,
    'ownerPhone must not be back in the expression');
});

// Nothing may read the claim columns straight out of a row again; that is how four places ended up
// disagreeing. Any new gate uses isClaimed.
test('no live surface tests the claim fields by hand any more', () => {
  const fs = require('node:fs'), path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  const files = ['business/index.js', 'server.js', 'mcp-server/tools/directory.mjs'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const handRolled = src.match(/\w+\.tgChatId\s*\|\|\s*\w+\.(ownerPhone|claimedAt)|\w+\.claimedAt\s*\|\|\s*\w+\.tgChatId/g) || [];
    assert.deepEqual(handRolled, [], f + ' hand-rolls the claim test: ' + handRolled.join(' / '));
  }
});
