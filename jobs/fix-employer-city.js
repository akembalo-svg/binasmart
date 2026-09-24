#!/usr/bin/env node
'use strict';
// An employer whose city is not a city — repaired from the employer's own adverts.
//
//   node --env-file=.env jobs/fix-employer-city.js --dry-run
//   node --env-file=.env jobs/fix-employer-city.js
//
// Boards put the working arrangement in the city column, and the harvester copied it onto the employer:
// "Project Based", "On-Site (Project-Based)", "Ethiopia". A company's city is then a non-place, which
// shows on its page and leaves jobLocation.address without an addressLocality - the warning Search
// Console raised on 24 September 2026.
//
// The repair uses only what the employer told us themselves: the city named most often across that
// employer's OWN adverts. If none of their adverts names a real place, the row is left alone. We do not
// write "Addis Ababa" because most Ethiopian companies are there - a guessed office is how a job seeker
// ends up at the wrong gate, and a plausible wrong answer is worse than an admitted gap.
const DRY = process.argv.includes('--dry-run');

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { cleanCity } = require('./place');
  const prisma = new PrismaClient();
  try {
    const emps = await prisma.employer.findMany({ select: { id: true, name: true, city: true } });
    const junk = emps.filter(e => !cleanCity(e.city));
    console.log('[city] employers whose city is not a place: ' + junk.length + (DRY ? '  (dry run)' : ''));

    let fixed = 0, left = 0;
    for (const e of junk) {
      const jobs = await prisma.job.findMany({ where: { employerId: e.id }, select: { city: true } });
      const tally = {};
      for (const j of jobs) {
        const c = cleanCity(j.city);
        if (c) tally[c] = (tally[c] || 0) + 1;
      }
      const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (!best) {
        left++;
        console.log('  · ' + e.name + '  (' + JSON.stringify(e.city) + ') — no advert of theirs names a place, left alone');
        continue;
      }
      fixed++;
      console.log('  ✓ ' + e.name + '  ' + JSON.stringify(e.city) + ' -> ' + best[0] + '  (from ' + best[1] + ' of their adverts)');
      if (!DRY) await prisma.employer.update({ where: { id: e.id }, data: { city: best[0] } });
    }
    console.log('[city] ' + (DRY ? 'would fix ' : 'fixed ') + fixed + ', left alone ' + left);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
