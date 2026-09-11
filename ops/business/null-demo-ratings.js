'use strict';
// Demo shops claimed 59,358 reviews that nobody wrote.
//
// Twenty-five seed scripts filled avgRating and reviewCount with Math.random(), tuned to a flattering
// band — `Math.round((4.0 + Math.random() * 0.9) * 10) / 10` and `25 + Math.floor(Math.random() * 200)`.
// The Review table has 0 rows and no code has ever written one, so not a single one of those ratings
// is backed by anything.
//
// That matters most where the name is real. "Tomoca Heritage Coffee — 4.8 from 236 reviews" is
// invented social proof attached to an Ethiopian company that never agreed to be listed, and it was
// being served in the directory and to every AI agent that called search_places.
//
// The seed scripts no longer invent them. This clears what they already wrote.
//
//   node ops/business/null-demo-ratings.js [--dry]
//
// Only shops whose status is 'demo' are touched. JJ Darule's 71 real tenants carry no rating at all
// (checked: 0 of 71), so there is nothing of theirs to lose.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const dry = process.argv.includes('--dry');

  const reviews = await prisma.review.count();
  if (reviews > 0) {
    // If real reviews ever exist, a blanket reset would destroy them. Stop and let a person decide.
    console.error('The Review table has ' + reviews + ' rows. This script assumes ratings are unbacked '
      + 'and would erase real ones. Recompute from Review instead of running this.');
    process.exit(1);
  }

  const demo = await prisma.shop.findMany({
    where: { status: 'demo', OR: [{ avgRating: { gt: 0 } }, { reviewCount: { gt: 0 } }] },
    select: { id: true, name: true, avgRating: true, reviewCount: true } });

  const claimed = demo.reduce((a, s) => a + s.reviewCount, 0);
  console.log((dry ? 'would clear: ' : 'clearing: ') + demo.length + ' demo shops claiming '
    + claimed.toLocaleString() + ' reviews between them');
  for (const s of demo.slice(0, 8))
    console.log('  ' + s.name.padEnd(30).slice(0, 30) + ' ' + s.avgRating + ' from ' + s.reviewCount);
  if (demo.length > 8) console.log('  ... and ' + (demo.length - 8) + ' more');

  if (!dry && demo.length) {
    const r = await prisma.shop.updateMany({ where: { id: { in: demo.map(s => s.id) } },
      data: { avgRating: 0, reviewCount: 0 } });
    console.log('cleared ' + r.count);
  }

  const left = await prisma.shop.count({ where: { status: 'demo', OR: [{ avgRating: { gt: 0 } }, { reviewCount: { gt: 0 } }] } });
  console.log('demo shops still carrying a rating: ' + left);
  const liveRated = await prisma.shop.count({ where: { status: 'live', OR: [{ avgRating: { gt: 0 } }, { reviewCount: { gt: 0 } }] } });
  console.log('live shops carrying a rating (untouched, and there should be none until reviews are real): ' + liveRated);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
