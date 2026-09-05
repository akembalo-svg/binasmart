'use strict';
// Who is allowed to manage which page. A claim proves the caller holds the phone that is already on
// the shop (or venue) record; verifying it issues a session token. Every dashboard call resolves the
// shop from that token — the client never names the shop it wants to edit.
const crypto = require('crypto');
const { normPhone } = require('../ride/phone');

const CLAIM_MS = 15 * 60 * 1000;      // a code is good for 15 minutes
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_TRIES = 5;
const CODE = () => String(crypto.randomInt(100000, 1000000));
const TOKEN = () => crypto.randomBytes(32).toString('base64url');

function makeOwners({ prisma, now, notify }) {
  const clock = now || Date.now;

  // Everything this phone may claim. A tenant who rents several offices holds several shops, so the
  // claim carries the list and the owner picks one (JJ Darule has four such phones).
  async function findTargets(phone) {
    const shops = await prisma.shop.findMany({ where: { OR: [{ ownerPhone: phone }, { phone }], status: 'live' } });
    if (shops.length) return { kind: 'shop', shops };
    const venues = await prisma.venue.findMany({ where: { phone, active: true } });
    if (venues.length) return { kind: 'venue', venues };
    return null;
  }
  async function findTarget(phone) {
    const t = await findTargets(phone);
    if (!t) return null;
    return t.kind === 'shop' ? { kind: 'shop', shop: t.shops[0] } : { kind: 'venue', venue: t.venues[0] };
  }

  // Step 1: someone says "this is my shop".
  async function startClaim(rawPhone, name) {
    const phone = normPhone(rawPhone);
    if (!phone) return { ok: false, error: 'phone' };
    const all = await findTargets(phone);
    if (!all) return { ok: false, error: 'no_match', phone };   // -> registration form
    const list = all.kind === 'shop' ? all.shops : all.venues;
    const target = list[0];
    const code = CODE();
    const telegramId = all.kind === 'shop' ? (target.telegram && /^\d+$/.test(target.telegram) ? target.telegram : null) : null;
    await prisma.ownerClaim.updateMany({ where: { phone, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    const claim = await prisma.ownerClaim.create({ data: { kind: all.kind, shopId: all.kind === 'shop' ? target.id : null, venueId: all.kind === 'venue' ? target.id : null,
      phone, name: name || null, code, telegramId, expiresAt: new Date(clock() + CLAIM_MS) } });
    let sent = false;
    if (notify) sent = await notify({ claim, target, code, phone });
    return { ok: true, claimId: claim.id, kind: all.kind, name: target.nameAm || target.name, sent,
      others: list.slice(1).map(x => ({ id: x.id, name: x.nameAm || x.name })) };
  }

  // Step 2: they type the code (or Ibrahim approves the claim from ops).
  async function verify(claimId, code) {
    const c = await prisma.ownerClaim.findUnique({ where: { id: String(claimId || '') } });
    if (!c) return { ok: false, error: 'unknown' };
    if (c.status !== 'PENDING') return { ok: false, error: c.status === 'VERIFIED' ? 'used' : 'expired' };
    if (c.expiresAt.getTime() <= clock()) { await prisma.ownerClaim.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'EXPIRED' } }); return { ok: false, error: 'expired' }; }
    if (c.tries >= MAX_TRIES) { await prisma.ownerClaim.updateMany({ where: { id: c.id, status: 'PENDING' }, data: { status: 'EXPIRED' } }); return { ok: false, error: 'too_many' }; }
    if (String(code || '').trim() !== c.code) {
      const u = await prisma.ownerClaim.update({ where: { id: c.id }, data: { tries: { increment: 1 } } });
      return { ok: false, error: 'bad_code', left: Math.max(0, MAX_TRIES - u.tries) };
    }
    return approve(c);
  }

  // Shared by code-verify and ops approval: mark the claim used and open a session.
  async function approve(claim) {
    const done = await prisma.ownerClaim.updateMany({ where: { id: claim.id, status: 'PENDING' }, data: { status: 'VERIFIED' } });
    if (!done.count) return { ok: false, error: 'used' };
    const session = await prisma.ownerSession.create({ data: { token: TOKEN(), kind: claim.kind, shopId: claim.shopId, venueId: claim.venueId, phone: claim.phone, expiresAt: new Date(clock() + SESSION_MS) } });
    return { ok: true, token: session.token, kind: claim.kind, shopId: claim.shopId, venueId: claim.venueId };
  }

  async function approveById(claimId) {
    const c = await prisma.ownerClaim.findUnique({ where: { id: String(claimId || '') } });
    if (!c) return { ok: false, error: 'unknown' };
    if (c.status !== 'PENDING') return { ok: false, error: 'used' };
    return approve(c);
  }

  // Step 3: every dashboard request. Returns the owner's own row, or null.
  async function session(token) {
    if (!token || typeof token !== 'string' || token.length < 20) return null;
    const s = await prisma.ownerSession.findUnique({ where: { token } });
    if (!s || s.expiresAt.getTime() <= clock()) return null;
    const t = clock();
    if (t - s.lastSeen.getTime() > 3600000) prisma.ownerSession.updateMany({ where: { id: s.id }, data: { lastSeen: new Date(t) } }).catch(() => {});
    if (s.kind === 'shop') {
      const shop = await prisma.shop.findUnique({ where: { id: s.shopId } });
      return shop && shop.status !== 'hidden' ? { kind: 'shop', shop, session: s } : null;
    }
    const venue = await prisma.venue.findUnique({ where: { id: s.venueId } });
    return venue && venue.active ? { kind: 'venue', venue, session: s } : null;
  }

  // Every page this session's phone may manage, so the dashboard can offer a switcher.
  async function pagesFor(session) {
    const t = await findTargets(session.phone);
    if (!t) return [];
    return (t.kind === 'shop' ? t.shops : t.venues).map(x => ({ id: x.id, kind: t.kind, name: x.nameAm || x.name, current: x.id === (session.shopId || session.venueId) }));
  }

  // Switch the session to another page the same phone owns. Never trusts the id alone.
  async function switchTo(token, id) {
    const s = await prisma.ownerSession.findUnique({ where: { token } });
    if (!s || s.expiresAt.getTime() <= clock()) return { ok: false, error: 'expired' };
    const t = await findTargets(s.phone);
    const found = t && (t.kind === 'shop' ? t.shops : t.venues).find(x => x.id === String(id || ''));
    if (!found) return { ok: false, error: 'not_yours' };
    await prisma.ownerSession.update({ where: { id: s.id }, data: t.kind === 'shop' ? { kind: 'shop', shopId: found.id, venueId: null } : { kind: 'venue', venueId: found.id, shopId: null } });
    return { ok: true, kind: t.kind, id: found.id, name: found.nameAm || found.name };
  }

  async function signOut(token) {
    if (!token) return 0;
    return (await prisma.ownerSession.deleteMany({ where: { token } })).count;
  }

  async function sweep() {
    const n1 = (await prisma.ownerSession.deleteMany({ where: { expiresAt: { lt: new Date(clock()) } } })).count;
    const n2 = (await prisma.ownerClaim.updateMany({ where: { status: 'PENDING', expiresAt: { lt: new Date(clock()) } }, data: { status: 'EXPIRED' } })).count;
    return { sessions: n1, claims: n2 };
  }

  return { startClaim, verify, approveById, session, signOut, sweep, findTarget, findTargets, pagesFor, switchTo };
}

module.exports = { makeOwners, CLAIM_MS, SESSION_MS, MAX_TRIES };
