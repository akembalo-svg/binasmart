const { PrismaClient } = require('@prisma/client');
const { categorise } = require('../jobs/categories');
(async () => {
  const p = new PrismaClient();
  const rows = await p.job.findMany({ select: { id: true, title: true, summary: true, category: true } });
  const counts = {}; let set = 0;
  for (const j of rows) {
    const c = categorise(j.title, j.summary);
    counts[c || 'other'] = (counts[c || 'other'] || 0) + 1;
    if (c !== j.category) { await p.job.update({ where: { id: j.id }, data: { category: c } }); set++; }
  }
  console.log('jobs:', rows.length, '| updated:', set);
  console.log(Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+':'+v).join('  '));
  await p.$disconnect();
})();
