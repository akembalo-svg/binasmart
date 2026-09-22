// One-off: re-run cleanCity over every job, now that a sentence-long location resolves to the city
// named inside it. Safe to run again - it only writes when the value changes.
const { PrismaClient } = require('@prisma/client');
const { cleanCity } = require('../jobs/publish');
(async () => {
  const p = new PrismaClient();
  const rows = await p.job.findMany({ select: { id: true, city: true } });
  let n = 0;
  for (const j of rows) {
    const c = cleanCity(j.city);
    if (c !== j.city) { await p.job.update({ where: { id: j.id }, data: { city: c } }); n++; }
  }
  console.log('jobs:', rows.length, '| cities tidied:', n);
  const top = await p.job.groupBy({ by: ['city'], _count: { city: true }, orderBy: { _count: { city: 'desc' } }, take: 8 });
  console.log(top.map(t => t.city + ':' + t._count.city).join('  '));
  await p.$disconnect();
})();
