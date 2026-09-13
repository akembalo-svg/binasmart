'use strict';
// ops/owner/access.js argument handling, without a database: what each command line means, and what it refuses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, USAGE } = require('../../ops/owner/access');

test('add reads a local number as +251 and keeps the label', () => {
  assert.deepEqual(parseArgs(['add', 'demo', '0900000001', 'staff', 'front', 'desk']),
    { cmd: 'add', slug: 'demo', phoneE164: '+251900000001', phoneKey: 'ph:900000001', role: 'staff', label: 'front desk' });
});

test('add accepts a foreign number in full and leaves the label empty when none is given', () => {
  const a = parseArgs(['add', 'demo', '+1 202 555 0100', 'owner']);
  assert.equal(a.phoneE164, '+12025550100');
  assert.equal(a.phoneKey, 'ph:025550100');
  assert.equal(a.label, null);
  assert.equal(parseArgs(['add', 'demo', '0012025550100', 'owner']).phoneE164, '+12025550100');
});

test('add refuses what is not a phone number, and a role other than owner or staff', () => {
  assert.match(parseArgs(['add', 'demo', 'not a phone', 'staff']).error, /^not a phone number/);
  assert.match(parseArgs(['add', 'demo', '12345', 'staff']).error, /^not a phone number/);
  assert.match(parseArgs(['add', 'demo', '0900000001', 'admin']).error, /^role must be owner or staff/);
  assert.equal(parseArgs(['add', 'demo', '0900000001']).error, USAGE);
});

test('revoke needs an id; list, enable and disable need only the building', () => {
  assert.deepEqual(parseArgs(['revoke', 'demo', 'abc']), { cmd: 'revoke', slug: 'demo', accessId: 'abc' });
  assert.equal(parseArgs(['revoke', 'demo']).error, USAGE);
  for (const cmd of ['list', 'enable', 'disable']) assert.deepEqual(parseArgs([cmd, 'demo']), { cmd, slug: 'demo' });
});

test('an unknown command or a missing building is the usage message', () => {
  assert.equal(parseArgs([]).error, USAGE);
  assert.equal(parseArgs(['list']).error, USAGE);
  assert.equal(parseArgs(['delete', 'demo']).error, USAGE);
});
