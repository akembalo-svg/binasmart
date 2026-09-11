'use strict';
// The shops we seeded for the demo buildings carry real companies' names with invented, sequential
// phone numbers (+2519XX0001NN). They may stay inside the building demo pages, but they must never
// get a public shop page, a sitemap entry or a claim: that would be a fake listing for a real business.
// JJ Darule's 71 tenants are real (real distinct phones, real names) and stay `live`.
//   node ops/business/mark-demo-shops.js [--dry]
const { PrismaClient } = require('@prisma/client');
const { isDemo } = require('../../hotels/rules');
const prisma = new PrismaClient();
// Default-deny on purpose: everything NOT on this list is a demonstration. Do not try to derive
// this from isDemo() — that answers a different question (does the building SAY it is a demo?) and
// the 26 seeded buildings modelled on CBE Tower, Bole Airport and Edna Mall do not say so, so
// deriving it would publish fake listings under real companies' names.
// 2026-09-12: bina-grand-hotel was on this list while isDemo() called it a demonstration. Its one
// shop stayed `live`, which is the field server.js:306, assistant/tools.js and ride/index.js read.
const REAL_BUILDINGS = ['darulle'];
const SEEDED = /^\+2519\d{2}0001\d{2}$/;   // the seed pattern, e.g. +251953000100
(async () => {
  const dry = process.argv.includes('--dry');
  const real = await prisma.building.findMany({ where: { qrSlug: { in: REAL_BUILDINGS } }, select: { id: true, qrSlug: true, name: true, subCity: true } });
  // The invariant that was broken: a building cannot be on the real list AND announce itself as a
  // demonstration. Refuse to run rather than write a status derived from a contradiction.
  const contradictory = real.filter(isDemo).map(b => b.qrSlug);
  if (contradictory.length) {
    console.error('REAL_BUILDINGS lists ' + contradictory.join(', ') + ', but isDemo() says ' +
      (contradictory.length === 1 ? 'it announces itself' : 'they announce themselves') +
      ' as a demonstration. Fix one of the two before running.');
    process.exit(1);
  }
  const missing = REAL_BUILDINGS.filter(sl => !real.some(b => b.qrSlug === sl));
  if (missing.length) { console.error('REAL_BUILDINGS names buildings that do not exist: ' + missing.join(', ')); process.exit(1); }
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
