// False-hold check for the Jev job gate: runs the gate on the REAL adverts most likely to be held wrongly -
// every advert the 26 Sep audit flagged plus the 5 "normal" ones Jev was least sure of. None should HOLD.
//   node --env-file=.env ops/jev-gate-falsehold.js
const fs = require('fs'); const g = require('../jobs/jev-gate'); const { PrismaClient } = require('@prisma/client');
(async () => {
  const a = JSON.parse(fs.readFileSync('/root/storage/jev/bina-jobs-scam-audit.json', 'utf8'));
  const pick = [...a.filter(x => x.flag), ...a.filter(x => !x.flag).sort((x, y) => x.conf - y.conf).slice(0, 5)];
  const p = new PrismaClient(); let holds = 0, n = 0;
  for (const x of pick) {
    const j = await p.job.findUnique({ where: { slug: x.slug }, include: { employer: { select: { name: true } } } });
    if (!j) continue;
    const r = await g.check({ ...j, employer: j.employer.name }); n++;
    if (r.hold) holds++;
    console.log((r.hold ? 'HOLD' : 'pass').padEnd(5) + ' pScam ' + String(r.conf ?? '-').padEnd(6) + ' ' + String(r.top || r.skipped || r.error).padEnd(21) + ' ' + j.title.slice(0, 60));
  }
  console.log('\n' + n + ' real adverts, held ' + holds);
  await p.$disconnect();
})();
