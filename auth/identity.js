'use strict';
// One account, everything else hangs off it.
//
// bina.et grew four ways of knowing who somebody is: an AuthUser (Telegram/Google/email), a Rider
// keyed by phone, a Driver keyed by phone, and a shop owner holding a claim cookie. This module makes
// AuthUser the person and attaches the rest to it.
//
// 🔑 The join key is a PROVEN phone, never a typed one. A rider types a number to book a car, and
// nothing stops them typing somebody else's. If we linked on that, anyone could type a stranger's
// number, sign in, and inherit their ride history — and a driver's earnings. So a link is only ever
// made from a number Telegram itself signed (a shared contact), an owner claim code that was
// delivered to that number, or SMS once that exists. `phoneVerifiedAt` records that it happened.
const { normPhone } = require('../ride/phone');

const PROOF = ['telegram_contact', 'owner_claim', 'sms', 'manual'];

function makeIdentity({ prisma, now }) {
  const clock = now || (() => new Date());

  // Attach every profile that carries this exact proven number and is not already spoken for.
  async function attachProfiles(userId, phone, at) {
    const linked = { rider: false, driver: false };
    const rider = await prisma.rider.findUnique({ where: { phone } });
    if (rider && !rider.authUserId) {
      await prisma.rider.update({ where: { id: rider.id }, data: { authUserId: userId, phoneVerifiedAt: rider.phoneVerifiedAt || at } });
      linked.rider = true;
    }
    const driver = await prisma.driver.findUnique({ where: { phone } });
    if (driver && !driver.authUserId) {
      await prisma.driver.update({ where: { id: driver.id }, data: { authUserId: userId } });
      linked.driver = true;
    }
    return linked;
  }

  // Give an account a proven phone. Refuses to move a number that another account already holds —
  // that would silently hand one person's history to another.
  async function setVerifiedPhone(userId, rawPhone, proof) {
    const phone = normPhone(rawPhone);
    if (!phone) return { ok: false, error: 'bad_phone' };
    if (!PROOF.includes(proof)) return { ok: false, error: 'bad_proof' };
    const holder = await prisma.authUser.findUnique({ where: { phone } });
    if (holder && holder.id !== userId) return { ok: false, error: 'phone_taken' };
    const at = clock();
    await prisma.authUser.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: at } });
    const linked = await attachProfiles(userId, phone, at);
    return { ok: true, phone, linked, proof };
  }

  // Signing in with Telegram proves the Telegram id, not a phone. If a Rider row already carries that
  // id AND a phone we proved earlier, we can carry the link across; otherwise we wait for a contact.
  async function linkFromTelegram(userId, telegramId) {
    const tgId = String(telegramId || '');
    if (!/^\d+$/.test(tgId)) return { ok: false, error: 'bad_telegram_id' };
    const other = await prisma.authUser.findUnique({ where: { telegramId: tgId } });
    if (other && other.id !== userId) return { ok: false, error: 'telegram_taken' };
    await prisma.authUser.update({ where: { id: userId }, data: { telegramId: tgId } });
    const me = await prisma.authUser.findUnique({ where: { id: userId } });
    if (me && me.phone) return { ok: true, already: true };
    const rider = await prisma.rider.findFirst({ where: { telegramId: tgId, phoneVerifiedAt: { not: null } } });
    if (rider) return setVerifiedPhone(userId, rider.phone, 'telegram_contact');
    return { ok: true, pendingPhone: true };
  }

  async function grantMembership(userId, m) {
    const kind = String(m.kind || '');
    if (!['shop', 'venue', 'building'].includes(kind)) return { ok: false, error: 'bad_kind' };
    const where = { userId, kind, shopId: m.shopId || null, venueId: m.venueId || null, buildingSlug: m.buildingSlug || null };
    const existing = await prisma.membership.findFirst({ where });
    if (existing) {
      if (existing.status !== 'active') await prisma.membership.update({ where: { id: existing.id }, data: { status: 'active' } });
      return { ok: true, id: existing.id, already: true };
    }
    const row = await prisma.membership.create({ data: { ...where, role: m.role || 'owner', status: 'active' } });
    return { ok: true, id: row.id };
  }

  // Everything the site knows about the person behind this session, in one shape.
  async function me(userId) {
    const u = await prisma.authUser.findUnique({
      where: { id: userId },
      include: { rider: true, driver: true, memberships: { where: { status: 'active' } }, accounts: { select: { providerId: true } } }
    });
    if (!u) return null;
    const roles = ['user'];
    if (u.role === 'admin') roles.push('admin');
    if (u.rider) roles.push('rider');
    if (u.driver) roles.push(u.driver.status === 'approved' ? 'driver' : 'driver_pending');
    if (u.memberships.length) roles.push('business');
    if (u.buildingSlug) roles.push('building_owner');
    return {
      id: u.id,
      name: u.name,
      email: /@telegram\.bina\.et$/.test(u.email) ? null : u.email,   // a placeholder is not an address
      image: u.image || null,
      phone: u.phone || null,
      phoneVerified: !!u.phoneVerifiedAt,
      telegramId: u.telegramId || null,
      signedInWith: [...new Set(u.accounts.map(a => a.providerId))],
      roles,
      rider: u.rider ? { id: u.rider.id, name: u.rider.name, rating: u.rider.rating } : null,
      driver: u.driver ? { id: u.driver.id, status: u.driver.status, tier: u.driver.tier, plate: u.driver.plate, rating: u.driver.rating } : null,
      businesses: u.memberships.map(x => ({ id: x.id, kind: x.kind, shopId: x.shopId, venueId: x.venueId, buildingSlug: x.buildingSlug, role: x.role })),
      buildingSlug: u.buildingSlug || null
    };
  }

  return { setVerifiedPhone, linkFromTelegram, grantMembership, me, attachProfiles, normPhone, PROOF };
}

module.exports = { makeIdentity, PROOF };
