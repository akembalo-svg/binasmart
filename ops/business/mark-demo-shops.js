'use strict';
// The shops we seeded for the demo buildings carry real companies' names with invented, sequential
// phone numbers (+2519XX0001NN). They may stay inside the building demo pages, but they must never
// get a public shop page, a sitemap entry or a claim: that would be a fake listing for a real business.
// JJ Darule's 71 tenants are real (real distinct phones, real names) and stay `live`.
//   node ops/business/mark-demo-shops.js [--dry]
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const REAL_BUILDINGS = ['darulle', 'bina-grand-hotel'];
const SEEDED = /^\+2519\d{2}0001\d{2}$/;   // the seed pattern, e.g. +251953000100
(async () => {
  const dry = process.argv.includes('--dry');
  const real = await prisma.building.findMany({ where: { qrSlug: { in: REAL_BUILDINGS } }, select: { id: true, qrSlug: true } });
  const realIds = real.map(b => b.id);
  const shops = await prisma.shop.findMany({ select: { id: true, name: true, phone: true, status: true, tenancy: { select: { unit: { select: { buildingId: true } } } } } });
  let demo = 0, kept = 0, odd = [];
  for (const s of shops) {
    const inReal = realIds.includes(s.tenancy.unit.buildingId);
    const seeded = SEEDED.test(s.phone || '');
    if (inReal) { kept++; if (seeded) odd.push('real building but seeded phone: ' + s.name); continue; }
    if (!seeded) { odd.push('demo building but real-looking phone: ' + s.name + ' ' + s.phone); }
    if (s.status !== 'demo' && !dry) await prisma.shop.update({ where: { id: s.id }, data: { status: 'demo' } });
    demo++;
  }
  console.log((dry ? 'dry: ' : '') + 'marked demo ' + demo + ', kept live ' + kept + ' (' + REAL_BUILDINGS.join(', ') + ')');
  if (odd.length) { console.log('check by hand:'); odd.forEach(x => console.log('  -', x)); }
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
