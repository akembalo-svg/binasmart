'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOwnerKeys, mintKey, hashKey, KEEP } = require('../../building/ownerKeys');

function world(start = 1_700_000_000_000) {
  let t = start, seq = 0;
  const buildings = [{ id: 'b1', qrSlug: 'darulle' }, { id: 'b2', qrSlug: 'cbe-tower' }];
  const rows = [];
  const building = id => buildings.find(b => b.id === id);
  const prisma = { ownerKey: {
    create: async ({ data }) => {
      if (rows.some(r => r.keyHash === data.keyHash)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      const r = { id: 'k' + (++seq), lastUsedAt: null, ...data }; rows.push(r); return { ...r };
    },
    findUnique: async ({ where }) => { const r = rows.find(x => x.keyHash === where.keyHash); return r ? { ...r, building: building(r.buildingId) } : null; },
    findMany: async ({ where }) => rows.filter(r => r.buildingId === where.buildingId).map(r => ({ ...r })),
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    deleteMany: async ({ where }) => { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (where.id.in.includes(rows[i].id)) { rows.splice(i, 1); n++; } return { count: n }; },
  } };
  return { k: makeOwnerKeys({ prisma, now: () => t }), rows, tick: ms => { t += ms; } };
}

test('what is stored is the hash, never the key', async () => {
  const w = world();
  const key = await w.k.issue('b1', 'darulle', 'login');
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].keyHash, hashKey(key));
  assert.equal(JSON.stringify(w.rows).includes(key), false, 'the key appears nowhere in storage');
  assert.equal(JSON.stringify(w.rows).includes(key.split('-')[1]), false);
});

test('a key opens its own building and no other', async () => {
  const w = world();
  const key = await w.k.issue('b1', 'darulle', 'login');
  assert.equal(await w.k.check('darulle', key), true);
  assert.equal(await w.k.check('cbe-tower', key), false, 'a key for one building is no key for another');
  assert.equal(await w.k.check('darulle', key + 'x'), false);
  assert.equal(await w.k.check('darulle', ''), false);
  assert.equal(await w.k.check('darulle', null), false);
  assert.equal(await w.k.check('darulle', 'x'.repeat(201)), false, 'an oversized value never reaches the database');
});

// The reason this is a table and not a hashed column: signing in on a laptop must not sign the owner out
// of their phone, which is what "mint a new key on each login" would have done.
test('logging in on a second device does not log the first one out', async () => {
  const w = world();
  const phone = await w.k.issue('b1', 'darulle', 'login');
  w.tick(60_000);
  const laptop = await w.k.issue('b1', 'darulle', 'login');
  assert.notEqual(phone, laptop);
  assert.equal(await w.k.check('darulle', phone), true, 'the phone still works');
  assert.equal(await w.k.check('darulle', laptop), true);
});

// Darulle's key existed before this change. The migration stores its hash, so the owner's saved key keeps
// working without them doing anything.
test('a key minted in the old format keeps working once its hash is migrated', async () => {
  const w = world();
  const legacy = 'DAR-1A2B3C4D5E';
  w.rows.push({ id: 'legacy', buildingId: 'b1', keyHash: hashKey(legacy), label: 'migrated', createdAt: new Date(0), lastUsedAt: null });
  assert.equal(await w.k.check('darulle', legacy), true);
  assert.equal(await w.k.check('cbe-tower', legacy), false);
});

test('only the most recent keys are kept, and a fresh key is never the one pruned', async () => {
  const w = world();
  const keys = [];
  for (let i = 0; i < KEEP + 4; i++) { keys.push(await w.k.issue('b1', 'darulle', 'login')); w.tick(1000); }
  assert.equal(w.rows.filter(r => r.buildingId === 'b1').length, KEEP);
  assert.equal(await w.k.check('darulle', keys[keys.length - 1]), true, 'the newest key survives');
  assert.equal(await w.k.check('darulle', keys[0]), false, 'the oldest was pruned');
});

// A key someone actually uses outranks newer keys nobody has touched. Postgres would put never-used
// (NULL lastUsedAt) keys FIRST in a descending sort; the prune sorts in JavaScript to avoid that.
test('a key in daily use survives pruning even when it is the oldest', async () => {
  const w = world();
  const daily = await w.k.issue('b1', 'darulle', 'login');
  for (let i = 0; i < KEEP + 3; i++) {
    w.tick(2 * 3600_000);
    await w.k.check('darulle', daily);          // the owner keeps using it
    await w.k.issue('b1', 'darulle', 'login');  // while other devices sign in once and vanish
  }
  assert.equal(await w.k.check('darulle', daily), true, 'the key the owner actually uses is still valid');
});

test('lastUsedAt is written at most hourly, not on every request', async () => {
  const w = world();
  const key = await w.k.issue('b1', 'darulle', 'login');
  const row = () => w.rows[0];
  await w.k.check('darulle', key);
  const first = row().lastUsedAt;
  assert.ok(first, 'the first use is recorded');
  w.tick(10 * 60_000);
  await w.k.check('darulle', key);
  assert.equal(row().lastUsedAt, first, 'ten minutes later: no write');
  w.tick(61 * 60_000);
  await w.k.check('darulle', key);
  assert.notEqual(row().lastUsedAt, first, 'an hour later: written again');
});

// owner-login.html drops the key into an onclick string and the dashboard puts it in a ?key= link; neither
// escapes it. So the alphabet itself has to be safe in both.
test('a new key is 192 bits in an alphabet safe inside a URL and a quoted JS string', () => {
  const k = mintKey('darulle');
  assert.match(k, /^DAR-[A-Za-z0-9_-]{32}$/);
  assert.equal(encodeURIComponent(k), k, 'nothing to encode in a query string');
  assert.equal(/['"\\<>&\s]/.test(k), false, 'nothing that ends a JS string or an attribute');
  assert.match(mintKey(''), /^XXX-/);
  assert.match(mintKey('b'), /^BXX-/);
  const many = new Set(); for (let i = 0; i < 300; i++) many.add(mintKey('darulle'));
  assert.equal(many.size, 300);
});

// The wiring. A module that hashes is no use if a route goes back to comparing plain text, or a new
// route mints a key and stores it on the building the way add-building used to.
test('server.js keeps owner keys as hashes — plain text cannot come back quietly', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.equal(/\.ownerKey\b/.test(code), false, 'something reads or writes a building ownerKey field again');
  assert.equal(/ownerKey:\s/.test(code), false, 'something sets ownerKey on a record again');
  const auth = src.slice(src.indexOf('async function authBuildingFail'), src.indexOf('async function authBuildingFail') + 700);
  assert.match(auth, /ownerKeys\.check\(slug, key\)/, 'authBuildingFail must check through the hash');
  for (const route of ["fastify.post('/api/owner/login'", "fastify.post('/api/owner/:slug/add-building'"]) {
    const at = src.indexOf(route);
    assert.ok(at > 0, route + ' not found');
    assert.match(src.slice(at, at + 2200), /ownerKeys\.issue\(/, route + ' must issue a hashed key');
  }
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
  const building = schema.slice(schema.indexOf('model Building {'), schema.indexOf('}', schema.indexOf('model Building {')));
  assert.equal(/^\s+ownerKey\s/m.test(building), false, 'Building has a plain-text ownerKey column again');
});
