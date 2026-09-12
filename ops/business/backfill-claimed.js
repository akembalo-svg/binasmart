'use strict';
// Backfill Shop.claimedAt from claims that were already verified.
//
// Four places decide whether to publish a shop's phone, index its page, emit LocalBusiness JSON-LD
// and state its opening hours. All four read a consent signal that the claim flow never wrote, so an
// owner could complete a claim - a code sent to the shop's own number and typed back, or Ibrahim
// approving it from ops - load their dashboard, enter a full catalogue, and stay noindex with their
// phone stripped out of every surface.
//
// owners.approve() writes claimedAt now. This gives the same thing to the claims that already
// passed, dated from the claim itself rather than from today, because that is when they proved it.
//
//   node ops/business/backfill-claimed.js --dry     say what would change
//   node ops/business/backfill-claimed.js           do it
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');
const mask = s => (s ? String(s).slice(0, 4) + '…' + String(s).slice(-3) : '(none)');

(async () => {
  const claims = await prisma.ownerClaim.findMany({
    where: { status: 'VERIFIED', NOT: { shopId: null } },
    orderBy: { createdAt: 'asc' },
    include: { shop: true },
  });

  console.log((DRY ? 'DRY RUN — ' : '') + claims.length + ' verified shop claim(s)');
  let would = 0;
  for (const c of claims) {
    if (!c.shop) { console.log('  skip  claim ' + c.id.slice(-6) + ' — the shop is gone'); continue; }
    if (c.shop.claimedAt) { console.log('  have  ' + c.shop.slug + ' already claimed ' + c.shop.claimedAt.toISOString().slice(0, 10)); continue; }
    would++;
    console.log('  set   ' + String(c.shop.slug).padEnd(20) + ' status=' + c.shop.status
      + '  proved by ' + mask(c.phone) + ' on ' + c.createdAt.toISOString().slice(0, 10));
    if (!DRY) await prisma.shop.update({ where: { id: c.shop.id }, data: { claimedAt: c.createdAt } });
  }

  // A shop is only published if it is ALSO live, so say what this actually turns on.
  const now = await prisma.shop.findMany({ where: { status: 'live', OR: [{ NOT: { claimedAt: null } }, { NOT: { tgChatId: null } }] }, select: { slug: true } });
  const unclaimed = (await prisma.shop.findMany({ where: { status: "live", claimedAt: null, tgChatId: null }, select: { phone: true } })).filter(s => s.phone).length;
  console.log('\n' + (DRY ? 'would change ' : 'changed ') + would + ' shop(s)');
  console.log('live + claimed (published): ' + now.length + '  [' + now.map(s => s.slug).join(', ') + ']');
  console.log('live + unclaimed still holding a phone the page will NOT publish: ' + unclaimed);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
