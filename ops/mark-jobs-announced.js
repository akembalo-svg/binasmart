// One-off before the channel announcer goes live.
//
// Every vacancy already on the board would otherwise queue up as "new" and be posted to the channel
// over the coming weeks - thousands of adverts, most of them weeks old, announced as if they had just
// arrived. "New" has to mean new, so everything we already hold is marked as announced, and the channel
// starts from the next vacancy that actually arrives.
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const r = await p.job.updateMany({ where: { announcedAt: null }, data: { announcedAt: new Date() } });
  console.log('marked as already announced:', r.count);
  await p.$disconnect();
})();
