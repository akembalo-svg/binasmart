'use strict';
// Unifying accounts is where a mistake gives one person another person's history. These tests pin
// the refusals, not just the happy path.
const test = require('node:test');
const assert = require('node:assert');
const { makeIdentity } = require('../auth/identity');

// A tiny in-memory stand-in for the tables this module touches.
function db(seed = {}) {
  const t = { authUser: [], rider: [], driver: [], membership: [], ...seed };
  // `{ not: null }` is Postgres IS NOT NULL, so a column that was never set must NOT match —
  // the loose compare is deliberate, an absent field is null in the database.
  const match = (val, cond) => (cond && typeof cond === 'object' && 'not' in cond)
    ? (cond.not === null ? val != null : val !== cond.not)
    : val === cond;
  const find = (rows, where) => rows.find(r => Object.entries(where).every(([k, v]) => match(r[k], v)));
  const api = (name) => ({
    findUnique: async ({ where }) => find(t[name], where) || null,
    findFirst: async ({ where }) => find(t[name], where) || null,
    update: async ({ where, data }) => { const r = find(t[name], where); Object.assign(r, data); return r; },
    create: async ({ data }) => { const r = { id: name[0] + (t[name].length + 1), ...data }; t[name].push(r); return r; }
  });
  return {
    _t: t,
    authUser: Object.assign(api('authUser'), {
      findUnique: async ({ where, include }) => {
        const u = find(t.authUser, where); if (!u) return null;
        if (!include) return u;
        return { ...u, rider: t.rider.find(r => r.authUserId === u.id) || null, driver: t.driver.find(d => d.authUserId === u.id) || null,
          memberships: t.membership.filter(m => m.userId === u.id && m.status === 'active'), accounts: (u._accounts || []).map(p => ({ providerId: p })) };
      }
    }),
    rider: api('rider'), driver: api('driver'), membership: api('membership')
  };
}

const NOW = new Date('2026-09-09T12:00:00Z');
const mk = (seed) => { const p = db(seed); return { p, id: makeIdentity({ prisma: p, now: () => NOW }) }; };

test('a proven phone attaches the rider and driver rows that carry it', async () => {
  const { p, id } = mk({
    authUser: [{ id: 'u1', name: 'Ibrahim', email: 'a@b.c', role: 'user' }],
    rider: [{ id: 'r1', phone: '+251911223344', name: 'Ibrahim' }],
    driver: [{ id: 'd1', phone: '+251911223344', name: 'Ibrahim', status: 'approved' }]
  });
  const r = await id.setVerifiedPhone('u1', '0911223344', 'telegram_contact');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.phone, '+251911223344');
  assert.deepStrictEqual(r.linked, { rider: true, driver: true });
  assert.strictEqual(p._t.rider[0].authUserId, 'u1');
  assert.strictEqual(p._t.driver[0].authUserId, 'u1');
  assert.strictEqual(p._t.authUser[0].phoneVerifiedAt, NOW);
});

test('a phone already held by another account is refused', async () => {
  const { p, id } = mk({
    authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }, { id: 'u2', name: 'B', email: 'b@b.c', phone: '+251911223344' }],
    rider: [{ id: 'r1', phone: '+251911223344', name: 'B', authUserId: 'u2' }]
  });
  const r = await id.setVerifiedPhone('u1', '+251911223344', 'telegram_contact');
  assert.deepStrictEqual(r, { ok: false, error: 'phone_taken' });
  assert.strictEqual(p._t.rider[0].authUserId, 'u2', 'the other account keeps its rider');
});

test('a rider already linked to someone else is never re-pointed', async () => {
  const { p, id } = mk({
    authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }],
    rider: [{ id: 'r1', phone: '+251911223344', name: 'B', authUserId: 'u9' }]
  });
  const r = await id.setVerifiedPhone('u1', '+251911223344', 'telegram_contact');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.linked.rider, false, 'not stolen');
  assert.strictEqual(p._t.rider[0].authUserId, 'u9');
});

test('an unusable phone or an unknown proof is refused', async () => {
  const { id } = mk({ authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }] });
  assert.strictEqual((await id.setVerifiedPhone('u1', '12345', 'telegram_contact')).error, 'bad_phone');
  assert.strictEqual((await id.setVerifiedPhone('u1', '+971558785151', 'telegram_contact')).error, 'bad_phone', 'non-Ethiopian');
  assert.strictEqual((await id.setVerifiedPhone('u1', '0911223344', 'typed')).error, 'bad_proof');
});

test('Telegram sign-in only inherits a phone that was proven', async () => {
  const unproven = mk({
    authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }],
    rider: [{ id: 'r1', phone: '+251911223344', name: 'A', telegramId: '777' }]     // typed, never proven
  });
  const a = await unproven.id.linkFromTelegram('u1', '777');
  assert.strictEqual(a.pendingPhone, true, 'a typed number does not link');
  assert.strictEqual(unproven.p._t.rider[0].authUserId, undefined);

  const proven = mk({
    authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }],
    rider: [{ id: 'r1', phone: '+251911223344', name: 'A', telegramId: '777', phoneVerifiedAt: new Date('2026-09-01') }]
  });
  const b = await proven.id.linkFromTelegram('u1', '777');
  assert.strictEqual(b.ok, true);
  assert.strictEqual(proven.p._t.rider[0].authUserId, 'u1');
  assert.strictEqual(proven.p._t.authUser[0].phone, '+251911223344');
});

test('a Telegram id belonging to another account is refused', async () => {
  const { id } = mk({ authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }, { id: 'u2', name: 'B', email: 'b@b.c', telegramId: '777' }] });
  assert.strictEqual((await id.linkFromTelegram('u1', '777')).error, 'telegram_taken');
});

test('memberships are granted once and reactivated rather than duplicated', async () => {
  const { p, id } = mk({ authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }] });
  const a = await id.grantMembership('u1', { kind: 'shop', shopId: 's1' });
  const b = await id.grantMembership('u1', { kind: 'shop', shopId: 's1' });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.already, true);
  assert.strictEqual(p._t.membership.length, 1);
  assert.strictEqual((await id.grantMembership('u1', { kind: 'nonsense' })).error, 'bad_kind');
});

test('me() reports every role the person actually holds', async () => {
  const { p, id } = mk({
    authUser: [{ id: 'u1', name: 'Ibrahim', email: 'tg123@telegram.bina.et', role: 'user', phone: '+251911223344', phoneVerifiedAt: NOW, telegramId: '123', _accounts: ['telegram', 'google'] }],
    rider: [{ id: 'r1', phone: '+251911223344', name: 'Ibrahim', authUserId: 'u1', rating: 5 }],
    driver: [{ id: 'd1', phone: '+251911223344', name: 'Ibrahim', authUserId: 'u1', status: 'pending', tier: 'economy', plate: 'A12345', rating: 5 }],
    membership: [{ id: 'm1', userId: 'u1', kind: 'shop', shopId: 's1', role: 'owner', status: 'active' }]
  });
  const me = await id.me('u1');
  assert.deepStrictEqual(me.roles.sort(), ['business', 'driver_pending', 'rider', 'user']);
  assert.strictEqual(me.email, null, 'a Telegram placeholder is not shown as an email');
  assert.strictEqual(me.phoneVerified, true);
  assert.deepStrictEqual(me.signedInWith.sort(), ['google', 'telegram']);
  assert.strictEqual(me.businesses.length, 1);
});

test('an approved driver reads as a driver, a pending one does not', async () => {
  const { id } = mk({
    authUser: [{ id: 'u1', name: 'A', email: 'a@b.c' }],
    driver: [{ id: 'd1', phone: '+251911223344', name: 'A', authUserId: 'u1', status: 'approved', tier: 'economy', plate: 'X', rating: 5 }]
  });
  assert.ok((await id.me('u1')).roles.includes('driver'));
});
