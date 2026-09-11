'use strict';
// Numbers the seeds invented, on listings carrying real companies' names.
//
// Two counters, both meant to be earned, both started at a lie by the seed scripts:
//
//   Shop.avgRating / reviewCount   `Math.round((4.0 + Math.random() * 0.9) * 10) / 10` and
//                                  `25 + Math.floor(Math.random() * 200)`. 59,358 reviews claimed.
//   Product.orderCount             `Math.floor(Math.random() * 150)`. 2,413 orders claimed.
//
// Neither is fabricated by design — both are real counters the application increments. They were just
// pre-loaded. What settles it is the tables behind them: Review has 0 rows and no code has ever
// written one, and Order / OrderItem have 0 rows. So every non-zero value is invented.
//
// "Tomoca Heritage Coffee — 4.8 from 236 reviews" is invented social proof attached to an Ethiopian
// company that never agreed to be listed. There were three fake Tomoca branches.
//
//   node ops/business/null-invented-metrics.js [--dry]
//
// Ratings are cleared for demo shops only — a live shop's rating would be real once reviews exist.
// Order counts are cleared everywhere, because 0 is the true count for every product in the database
// and the two live ones (Macchiato and Espresso at Kaldi's Café, 1 each) are residue of an order that
// no longer exists.
//
// Both halves refuse to run if their backing table is non-empty, so the day the numbers are real this
// becomes a stop rather than a silent erasure.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

(async () => {
  const dry = process.argv.includes('--dry');

  // ---- ratings -----------------------------------------------------------------------------------
  const reviews = await prisma.review.count();
  if (reviews > 0) {
    console.error('The Review table has ' + reviews + ' rows. This script assumes ratings are unbacked '
      + 'and would erase real ones. Recompute from Review instead of running this.');
    process.exit(1);
  }
  const rated = await prisma.shop.findMany({
    where: { status: 'demo', OR: [{ avgRating: { gt: 0 } }, { reviewCount: { gt: 0 } }] },
    select: { id: true, name: true, avgRating: true, reviewCount: true } });
  console.log((dry ? 'would clear ' : 'clearing ') + rated.length + ' demo shop ratings claiming '
    + rated.reduce((a, s) => a + s.reviewCount, 0).toLocaleString() + ' reviews');
  for (const s of rated.slice(0, 5)) console.log('  ' + pad(s.name, 30) + ' ' + s.avgRating + ' from ' + s.reviewCount);
  if (rated.length > 5) console.log('  ... and ' + (rated.length - 5) + ' more');
  if (!dry && rated.length)
    console.log('  cleared ' + (await prisma.shop.updateMany({ where: { id: { in: rated.map(s => s.id) } },
      data: { avgRating: 0, reviewCount: 0 } })).count);

  // ---- order counts ------------------------------------------------------------------------------
  const items = await prisma.orderItem.count();
  if (items > 0) {
    console.error('OrderItem has ' + items + ' rows, so some order counts are earned. '
      + 'Recompute per product from OrderItem instead of zeroing.');
    process.exit(1);
  }
  const ordered = await prisma.product.findMany({
    where: { orderCount: { gt: 0 } },
    select: { id: true, name: true, orderCount: true, shop: { select: { name: true, status: true } } },
    orderBy: { orderCount: 'desc' } });
  console.log('');
  console.log((dry ? 'would clear ' : 'clearing ') + ordered.length + ' product order counts claiming '
    + ordered.reduce((a, p) => a + p.orderCount, 0).toLocaleString() + ' orders');
  for (const p of ordered.slice(0, 5))
    console.log('  ' + pad(p.name, 26) + ' ' + pad(p.orderCount, 5) + ' ' + p.shop.name + ' [' + p.shop.status + ']');
  if (ordered.length > 5) console.log('  ... and ' + (ordered.length - 5) + ' more');
  if (!dry && ordered.length)
    console.log('  cleared ' + (await prisma.product.updateMany({ where: { id: { in: ordered.map(p => p.id) } },
      data: { orderCount: 0 } })).count);

  console.log('');
  console.log('left claiming a rating (demo): ' + await prisma.shop.count({ where: { status: 'demo', OR: [{ avgRating: { gt: 0 } }, { reviewCount: { gt: 0 } }] } }));
  console.log('left claiming orders (any):    ' + await prisma.product.count({ where: { orderCount: { gt: 0 } } }));
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
