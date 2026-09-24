'use strict';
// The Google Play reviewer's account (Bina Partner asks for a login before it shows anything).
//
//   node ops/play-reviewer.js            show what is there
//   node ops/play-reviewer.js --apply    make or refresh it
//
// The account holds the number in AUTH_REVIEW_PHONE (an unrouted +2519000000NN test number, never a
// real one) as a proven phone, so the reviewer door in auth/phone-code-flow.js can open it with
// AUTH_REVIEW_CODE. It owns the demo hotel and nothing else: Bina Grand Hotel is BinaSmart's own demo,
// with no tenants, so nothing the reviewer presses can message a real person. No Driver row: an
// approved driver would be sent real ride offers.
const { PrismaClient } = require('@prisma/client');
const { normPhone } = require('../ride/phone');
const pc = require('../auth/phone-code');

const DEMO_BUILDING = 'bina-grand-hotel';
const NAME = 'Google Play reviewer';

async function main() {
  const apply = process.argv.includes('--apply');
  const phone = normPhone(process.env.AUTH_REVIEW_PHONE || '');
  if (!phone || !/^\+2519000000\d\d$/.test(phone)) throw new Error('AUTH_REVIEW_PHONE must be a +2519000000NN test number');
  const prisma = new PrismaClient();
  try {
    const b = await prisma.building.findFirst({ where: { qrSlug: DEMO_BUILDING }, select: { id: true, _count: { select: { units: true } } } });
    if (!b) throw new Error('demo building ' + DEMO_BUILDING + ' is missing');
    const holder = await prisma.authUser.findFirst({ where: { phone }, select: { id: true, name: true, role: true, buildingSlug: true } });
    if (holder && holder.name !== NAME) throw new Error('that number already belongs to another account; pick another test number');
    const drivers = await prisma.driver.count({ where: { phone } });
    if (drivers) throw new Error('a Driver row carries that number; the reviewer must not be a driver');
    console.log('reviewer account:', holder ? 'present (' + holder.role + ', ' + holder.buildingSlug + ')' : 'absent');
    if (!apply) return;
    const data = { name: NAME, phone, phoneVerifiedAt: new Date(), role: 'owner', buildingSlug: DEMO_BUILDING };
    const u = holder
      ? await prisma.authUser.update({ where: { id: holder.id }, data })
      : await prisma.authUser.create({ data: Object.assign({ id: require('crypto').randomBytes(16).toString('hex'), email: pc.phonePlaceholderEmail(phone), emailVerified: false }, data) });
    console.log('reviewer account ready:', u.id, u.role, u.buildingSlug);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
