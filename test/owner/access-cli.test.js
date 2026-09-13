'use strict';
// ops/owner/access.js argument handling, without a database: what each command line means, and what it refuses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, run, USAGE } = require('../../ops/owner/access');

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

test('add-account-owner needs only the building, and is in the usage message', () => {
  assert.deepEqual(parseArgs(['add-account-owner', 'demo']), { cmd: 'add-account-owner', slug: 'demo' });
  assert.equal(parseArgs(['add-account-owner']).error, USAGE);
  assert.match(USAGE, /add-account-owner <slug>/);
});

// A stand-in for the few Prisma calls add-account-owner makes; the owner account phone is whatever the test sets.
function fakePrisma(ownerPhone, existing = null) {
  const calls = { created: [], audits: [] };
  const prisma = {
    building: { findUnique: async ({ select }) => ({ id: 'b1', name: 'Demo', ...(select.owner ? { owner: { phone: ownerPhone } } : {}) }) },
    ownerAccess: {
      findFirst: async ({ where }) => (existing && existing.phoneE164 === where.phoneE164 ? existing : null),
      create: async ({ data }) => { calls.created.push(data); return { id: 'acc1', ...data }; },
    },
    auditLog: { create: async ({ data }) => { calls.audits.push(data); return data; } },
  };
  return { prisma, calls };
}

test('add-account-owner approves the owner account number as owner, printing and logging only the last four digits', async () => {
  const { prisma, calls } = fakePrisma('0900000001');
  const lines = [];
  assert.deepEqual(await run({ cmd: 'add-account-owner', slug: 'demo' }, { prisma, out: l => lines.push(l) }), { ok: true });
  assert.deepEqual(lines, ['added acc1 · owner · …0001']);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].phoneE164, '+251900000001');
  assert.equal(calls.created[0].phoneKey, 'ph:900000001');
  assert.equal(calls.created[0].role, 'owner');
  assert.equal(calls.created[0].label, 'account owner');
  assert.equal(calls.audits.length, 1);
  assert.doesNotMatch(calls.audits[0].detail, /900000001/);
});

test('add-account-owner prints the existing approval instead of adding a second one', async () => {
  const { prisma, calls } = fakePrisma('0900000001', { id: 'old1', role: 'staff', phoneE164: '+251900000001' });
  const lines = [];
  await run({ cmd: 'add-account-owner', slug: 'demo' }, { prisma, out: l => lines.push(l) });
  assert.deepEqual(lines, ['already approved: old1 · staff · …0001']);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.audits.length, 0);
});

test('add-account-owner refuses when the owner account has no usable phone number', async () => {
  for (const phone of [null, '', '12345']) {
    const { prisma, calls } = fakePrisma(phone);
    const res = await run({ cmd: 'add-account-owner', slug: 'demo' }, { prisma, out: () => {} });
    assert.equal(res.error, 'the owner account has no usable phone number');
    assert.equal(calls.created.length, 0);
  }
});
