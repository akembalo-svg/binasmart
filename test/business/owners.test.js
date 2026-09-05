'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeOwners, MAX_TRIES, CLAIM_MS } = require('../../business/owners');

function fakeDb() {
  const T = { shop: [], venue: [], ownerClaim: [], ownerSession: [] }; let seq = 0;
  const cmp = (v, c) => { if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) { if ('not' in c) return v !== c.not; if ('lt' in c) return v < c.lt; if ('in' in c) return c.in.includes(v); return true; } return v === c; };
  const match = (r, w) => Object.entries(w || {}).every(([k, c]) => k === 'OR' ? c.some(x => match(r, x)) : cmp(r[k], c));
  const model = n => ({
    create: async ({ data }) => { const row = { id: n[0] + (++seq), createdAt: new Date(), lastSeen: new Date(), tries: 0, status: n === 'ownerClaim' ? 'PENDING' : undefined, ...data }; T[n].push(row); return { ...row }; },
    findUnique: async ({ where }) => T[n].find(r => match(r, where)) || null,
    findFirst: async ({ where }) => T[n].find(r => match(r, where)) || null,
    findMany: async ({ where } = {}) => T[n].filter(r => match(r, where)),
    update: async ({ where, data }) => { const r = T[n].find(x => match(x, where)); for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] || 0) + v.increment : v; return { ...r }; },
    updateMany: async ({ where, data }) => { let c = 0; for (const r of T[n]) if (match(r, where)) { Object.assign(r, data); c++; } return { count: c }; },
    deleteMany: async ({ where }) => { let c = 0; for (let i = T[n].length - 1; i >= 0; i--) if (match(T[n][i], where)) { T[n].splice(i, 1); c++; } return { count: c }; },
  });
  const db = { _: T }; for (const k of Object.keys(T)) db[k] = model(k); return db;
}
function world(t) {
  const prisma = fakeDb();
  prisma._.shop.push({ id: 's1', name: 'Tower Cafe', nameAm: 'ታወር ካፌ', phone: '+251911223344', telegram: '777', status: 'live' });
  prisma._.shop.push({ id: 's2', name: 'Other Shop', phone: '+251911555666', status: 'live' });
  prisma._.venue.push({ id: 'v1', name: 'Gast Cinema', phone: '+251930113377', active: true });
  const sent = [];
  const o = makeOwners({ prisma, now: () => t || 1_000_000, notify: async x => { sent.push(x); return true; } });
  return { prisma, o, sent };
}

test('a phone on a shop record can claim it; a code is sent; verifying opens a session for that shop only', async () => {
  const w = world();
  const s = await w.o.startClaim('0911223344', 'Abebe');
  assert.equal(s.ok, true); assert.equal(s.kind, 'shop'); assert.equal(s.name, 'ታወር ካፌ'); assert.equal(s.sent, true);
  assert.equal(w.sent[0].code.length, 6); assert.equal(w.sent[0].claim.telegramId, '777');
  assert.equal(s.code, undefined, 'the code is never returned to the caller');
  const v = await w.o.verify(s.claimId, w.sent[0].code);
  assert.equal(v.ok, true); assert.equal(v.shopId, 's1'); assert.ok(v.token.length > 30);
  const me = await w.o.session(v.token);
  assert.equal(me.kind, 'shop'); assert.equal(me.shop.id, 's1');
  assert.equal(await w.o.session('nope'), null);
  assert.equal(await w.o.session(''), null);
});
test('a venue phone claims the venue; an unknown phone gets no_match (registration path)', async () => {
  const w = world();
  const v = await w.o.startClaim('0930113377');
  assert.equal(v.kind, 'venue'); assert.equal(v.name, 'Gast Cinema');
  const ok = await w.o.verify(v.claimId, w.sent[0].code);
  assert.equal((await w.o.session(ok.token)).venue.id, 'v1');
  assert.deepEqual(await w.o.startClaim('0911000000'), { ok: false, error: 'no_match', phone: '+251911000000' });
  assert.deepEqual(await w.o.startClaim('+971501234567'), { ok: false, error: 'phone' });
});
test('a wrong code is counted; after MAX_TRIES the claim is dead; a used claim cannot be verified twice', async () => {
  const w = world();
  const s = await w.o.startClaim('0911223344');
  for (let i = 1; i <= MAX_TRIES; i++) {
    const r = await w.o.verify(s.claimId, '000000');
    assert.equal(r.error, 'bad_code'); assert.equal(r.left, MAX_TRIES - i);
  }
  assert.equal((await w.o.verify(s.claimId, w.sent[0].code)).error, 'too_many');
  const s2 = await w.o.startClaim('0911223344');
  const good = w.sent[1].code;
  assert.equal((await w.o.verify(s2.claimId, good)).ok, true);
  assert.equal((await w.o.verify(s2.claimId, good)).error, 'used');
});
test('claims expire after 15 minutes and starting a new claim kills the old one', async () => {
  let t = 1_000_000; const w = world(t);
  const o = makeOwners({ prisma: w.prisma, now: () => t, notify: async x => { w.sent.push(x); return true; } });
  const a = await o.startClaim('0911223344');
  const b = await o.startClaim('0911223344');
  assert.equal((await o.verify(a.claimId, w.sent[0].code)).error, 'expired', 'the first claim was replaced');
  t += CLAIM_MS + 1;
  assert.equal((await o.verify(b.claimId, w.sent[1].code)).error, 'expired');
  // A claim nobody ever tried stays PENDING until the sweep retires it.
  const c = await o.startClaim('0911223344');
  t += CLAIM_MS + 1;
  assert.equal((await o.sweep()).claims, 1);
  assert.equal((await o.verify(c.claimId, w.sent[2].code)).error, 'expired');
});
test('ops can approve a pending claim without the code; sessions expire and can be signed out', async () => {
  let t = 1_000_000;
  const w = world(t);
  const o = makeOwners({ prisma: w.prisma, now: () => t, notify: async x => { w.sent.push(x); return true; } });
  const s = await o.startClaim('0911223344');
  const v = await o.approveById(s.claimId);
  assert.equal(v.ok, true); assert.equal(v.shopId, 's1');
  assert.equal((await o.approveById(s.claimId)).error, 'used');
  assert.equal(await o.signOut(v.token), 1);
  assert.equal(await o.session(v.token), null);
  const s2 = await o.startClaim('0911223344'); const v2 = await o.approveById(s2.claimId);
  t += 31 * 24 * 3600 * 1000;
  assert.equal(await o.session(v2.token), null, 'expired session');
  assert.equal((await o.sweep()).sessions, 1);
});
test('one phone renting several offices: the claim lists them all and the owner can switch between them', async () => {
  const w = world();
  w.prisma._.shop.push({ id: 's3', name: 'Office B-020', phone: '+251911223344', status: 'live' });
  w.prisma._.shop.push({ id: 's4', name: 'Office 103', phone: '+251911223344', status: 'live' });
  const s = await w.o.startClaim('0911223344');
  assert.equal(s.name, 'ታወር ካፌ');
  assert.deepEqual(s.others.map(x => x.name), ['Office B-020', 'Office 103']);
  const v = await w.o.verify(s.claimId, w.sent[0].code);
  const pages = await w.o.pagesFor((await w.o.session(v.token)).session);
  assert.deepEqual(pages.map(p => [p.name, p.current]), [['ታወር ካፌ', true], ['Office B-020', false], ['Office 103', false]]);
  const sw = await w.o.switchTo(v.token, 's4');
  assert.equal(sw.ok, true); assert.equal((await w.o.session(v.token)).shop.id, 's4');
  assert.equal((await w.o.switchTo(v.token, 's2')).error, 'not_yours', 'another owner\'s shop is refused');
});

test('a hidden shop cannot be claimed and its live session stops working', async () => {
  const w = world();
  const s = await w.o.startClaim('0911223344');
  const v = await w.o.verify(s.claimId, w.sent[0].code);
  w.prisma._.shop[0].status = 'hidden';
  assert.equal(await w.o.session(v.token), null);
  assert.equal((await w.o.startClaim('0911223344')).error, 'no_match');
});
