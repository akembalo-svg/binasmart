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

  // What this account runs, one row per business, with the page that manages it (Bina Partner, 23 Sep
  // 2026). Only this account's own rows (AuthUser.buildingSlug and its active memberships), and only
  // names, public slugs and types: never a key, token, phone or password.
  //   access 'account'          the dashboard admits this signed-in account (server.js authBuildingFail)
  //   access 'business_sign_in' /business needs its own phone sign-in (business/index.js, bsown cookie)
  //   access 'owner_key'        a building dashboard reached only with its owner key or password (/owner)
  const BUILDING_TYPE = { HOTEL: 'hotel', HOSPITAL: 'hospital', TRAVEL: 'travel' };
  const SHOP_TYPE = { RESTAURANT: 'restaurant', CAFE: 'cafe', CLINIC: 'clinic', PHARMACY: 'pharmacy' };
  async function ownedBy(u) {
    const ms = u.memberships || [];
    const uniq = a => [...new Set(a.filter(Boolean))];
    const slugs = uniq([u.buildingSlug].concat(ms.filter(m => m.kind === 'building').map(m => m.buildingSlug)));
    const shopIds = uniq(ms.filter(m => m.kind === 'shop').map(m => m.shopId));
    const venueIds = uniq(ms.filter(m => m.kind === 'venue').map(m => m.venueId));
    // A table this deployment (or a test) does not have is "unknown", not "none": keep the row, unnamed.
    const rows = async (d, ids, q) => {
      if (!ids.length) return new Map();
      if (!d || typeof d.findMany !== 'function') return null;
      try { return new Map((await d.findMany(q)).map(r => [r.qrSlug || r.id, r])); } catch (e) { return new Map(); }   // a failed lookup hides rows, never shows them unchecked
    };
    const [bs, ss, vs] = await Promise.all([
      rows(prisma.building, slugs, { where: { qrSlug: { in: slugs } }, select: { qrSlug: true, name: true, nameAm: true, buildingType: true } }),
      rows(prisma.shop, shopIds, { where: { id: { in: shopIds } }, select: { id: true, name: true, nameAm: true, category: true, status: true } }),
      rows(prisma.venue, venueIds, { where: { id: { in: venueIds } }, select: { id: true, name: true, nameAm: true, active: true } })
    ]);
    const out = [];
    for (const slug of slugs) {
      const b = bs ? bs.get(slug) : { qrSlug: slug, name: slug };
      if (!b) continue;                                     // no such building: nothing to open
      const mine = slug === u.buildingSlug;
      const m = ms.find(x => x.kind === 'building' && x.buildingSlug === slug);
      out.push({ id: 'building:' + slug, type: BUILDING_TYPE[b.buildingType] || 'building', name: b.name || slug, nameAm: b.nameAm || null,
        role: mine ? 'owner' : (m && m.role) || 'owner', url: '/owner/' + encodeURIComponent(slug), access: mine ? 'account' : 'owner_key' });
    }
    for (const id of shopIds) {
      const s = ss ? ss.get(id) : { id };
      if (!s || s.status === 'hidden') continue;             // /business refuses a hidden shop too
      const m = ms.find(x => x.kind === 'shop' && x.shopId === id);
      out.push({ id: 'shop:' + id, type: SHOP_TYPE[s.category] || 'shop', name: s.name || null, nameAm: s.nameAm || null,
        role: (m && m.role) || 'owner', url: '/business', access: 'business_sign_in' });
    }
    for (const id of venueIds) {
      const v = vs ? vs.get(id) : { id, active: true };
      if (!v || v.active === false) continue;
      const m = ms.find(x => x.kind === 'venue' && x.venueId === id);
      out.push({ id: 'venue:' + id, type: 'venue', name: v.name || null, nameAm: v.nameAm || null,
        role: (m && m.role) || 'owner', url: '/business', access: 'business_sign_in' });
    }
    return out;
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
      email: /@telegram\.bina\.et$|@phone\.bina\.et$/.test(u.email) ? null : u.email,   // a placeholder is not an address
      image: u.image || null,
      phone: u.phone || null,
      phoneVerified: !!u.phoneVerifiedAt,
      telegramId: u.telegramId || null,
      signedInWith: [...new Set(u.accounts.map(a => a.providerId))],
      roles,
      rider: u.rider ? { id: u.rider.id, name: u.rider.name, rating: u.rider.rating } : null,
      driver: u.driver ? { id: u.driver.id, status: u.driver.status, tier: u.driver.tier, plate: u.driver.plate, rating: u.driver.rating } : null,
      businesses: u.memberships.map(x => ({ id: x.id, kind: x.kind, shopId: x.shopId, venueId: x.venueId, buildingSlug: x.buildingSlug, role: x.role })),
      buildingSlug: u.buildingSlug || null,
      owned: await ownedBy(u)
    };
  }

  return { setVerifiedPhone, linkFromTelegram, grantMembership, me, attachProfiles, normPhone, PROOF };
}

module.exports = { makeIdentity, PROOF };
