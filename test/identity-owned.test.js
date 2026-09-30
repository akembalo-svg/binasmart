'use strict';
// /api/me `owned`: the businesses THIS account runs, each with its dashboard and how it lets the owner in.
// Only the account's own rows, only names, types and public slugs: no keys, tokens, phones or passwords.
// Invented people and businesses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeIdentity } = require('../auth/identity');

function db() {
  const t = {
    authUser: [
      { id: 'u1', name: 'Owner One', email: 'o1@example.test', role: 'user', buildingSlug: 'sample-hotel', phone: '+251100000001' },
      { id: 'u2', name: 'Owner Two', email: 'o2@example.test', role: 'user', buildingSlug: 'sample-tower' },
      { id: 'u3', name: 'Rider', email: 'r@example.test', role: 'user' }
    ],
    membership: [
      { id: 'm1', userId: 'u1', kind: 'shop', shopId: 's1', role: 'owner', status: 'active' },
      { id: 'm2', userId: 'u1', kind: 'venue', venueId: 'v1', role: 'staff', status: 'active' },
      { id: 'm3', userId: 'u1', kind: 'building', buildingSlug: 'sample-tower', role: 'owner', status: 'active' },
      { id: 'm4', userId: 'u1', kind: 'shop', shopId: 's2', role: 'owner', status: 'suspended' },
      { id: 'm5', userId: 'u1', kind: 'shop', shopId: 's3', role: 'owner', status: 'active' },
      { id: 'm6', userId: 'u2', kind: 'shop', shopId: 's4', role: 'owner', status: 'active' }
    ],
    building: [
      { qrSlug: 'sample-hotel', name: 'Sample Hotel', nameAm: 'ናሙና ሆቴል', buildingType: 'HOTEL', ownerKey: 'SECRET-KEY', phone: '+251100000009' },
      { qrSlug: 'sample-tower', name: 'Sample Tower', nameAm: 'ናሙና ታወር', buildingType: 'COMMERCIAL', ownerKey: 'SECRET-KEY' }
    ],
    shop: [
      { id: 's1', name: 'Sample Cafe', nameAm: 'ናሙና ካፌ', category: 'CAFE', status: 'active', phone: '+251100000002', tgChatId: '42' },
      { id: 's2', name: 'Suspended Shop', category: 'RETAIL', status: 'active', phone: '+251100000003' },
      { id: 's3', name: 'Hidden Shop', category: 'RETAIL', status: 'hidden', phone: '+251100000004' },
      { id: 's4', name: 'Somebody Else', category: 'CLINIC', status: 'active', phone: '+251100000005' }
    ],
    venue: [{ id: 'v1', name: 'Sample Cinema', nameAm: 'ናሙና ሲኒማ', active: true, phone: '+251100000006', scanKeyHash: 'HASH' }]
  };
  const queries = [];
  // Honours `select`, like Prisma: a field that is not selected is not returned.
  const pick = (row, select) => select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, row[k]])) : row;
  const many = name => ({ findMany: async ({ where, select }) => {
    queries.push({ name, where, select });
    const [[k, cond]] = Object.entries(where);
    return t[name].filter(r => cond.in.includes(r[k])).map(r => pick(r, select));
  } });
  return {
    queries,
    authUser: { findUnique: async ({ where }) => {
      const u = t.authUser.find(x => x.id === where.id); if (!u) return null;
      return { ...u, rider: null, driver: null, memberships: t.membership.filter(m => m.userId === u.id && m.status === 'active'), accounts: [] };
    } },
    building: many('building'), shop: many('shop'), venue: many('venue')
  };
}

test('owned lists the account building, its memberships, with type, dashboard and access', async () => {
  const p = db();
  const me = await makeIdentity({ prisma: p }).me('u1');
  const byId = Object.fromEntries(me.owned.map(b => [b.id, b]));
  assert.deepEqual(Object.keys(byId).sort(), ['building:sample-hotel', 'building:sample-tower', 'shop:s1', 'venue:v1']);
  assert.deepEqual(byId['building:sample-hotel'], { id: 'building:sample-hotel', type: 'hotel', name: 'Sample Hotel', nameAm: 'ናሙና ሆቴል', role: 'owner', url: '/owner/sample-hotel', access: 'account' });
  assert.equal(byId['building:sample-tower'].access, 'account', 'an active OWNER building membership opens directly (building/memberAccess.js)');
  assert.equal(byId['building:sample-tower'].type, 'building');
  assert.deepEqual(byId['shop:s1'], { id: 'shop:s1', type: 'cafe', name: 'Sample Cafe', nameAm: 'ናሙና ካፌ', role: 'owner', url: '/business?open=s1', access: 'account' });
  assert.equal(byId['venue:v1'].access, 'business_sign_in', 'a STAFF venue membership keeps the phone sign-in');
  assert.equal(byId['venue:v1'].url, '/business');
  assert.equal(byId['venue:v1'].type, 'venue');
  assert.equal(byId['venue:v1'].role, 'staff');
  // the old fields are still there for account.html and login.html
  assert.equal(me.buildingSlug, 'sample-hotel');
  assert.ok(Array.isArray(me.businesses));
  assert.ok(me.roles.includes('building_owner') && me.roles.includes('business'));
});

test('suspended memberships, hidden shops and other people\'s businesses never appear', async () => {
  const p = db();
  const one = await makeIdentity({ prisma: p }).me('u1');
  const ids = one.owned.map(b => b.id);
  assert.ok(!ids.includes('shop:s2'), 'suspended membership');
  assert.ok(!ids.includes('shop:s3'), 'hidden shop');
  assert.ok(!ids.includes('shop:s4'), 'another account\'s shop');
  for (const q of p.queries) {
    const want = { building: ['sample-hotel', 'sample-tower'], shop: ['s1', 's3'], venue: ['v1'] }[q.name];
    assert.deepEqual([...q.where[Object.keys(q.where)[0]].in].sort(), want.sort(), q.name + ' asks only for this account\'s rows');
  }
  const two = await makeIdentity({ prisma: db() }).me('u2');

  assert.deepEqual(two.owned.map(b => b.id).sort(), ['building:sample-tower', 'shop:s4']);
  assert.equal(two.owned.find(b => b.id === 'shop:s4').type, 'clinic');
  assert.deepEqual((await makeIdentity({ prisma: db() }).me('u3')).owned, []);
});

test('no secret, phone or chat id reaches the response', async () => {
  const me = await makeIdentity({ prisma: db() }).me('u1');
  const text = JSON.stringify(me.owned);
  for (const bad of ['SECRET', 'HASH', '+2511', 'tgChatId', 'ownerKey', 'scanKey', 'phone', 'token', 'password'])
    assert.ok(!text.includes(bad), 'owned carries no ' + bad);
  for (const b of me.owned) assert.deepEqual(Object.keys(b).sort(), ['access', 'id', 'name', 'nameAm', 'role', 'type', 'url']);
});
