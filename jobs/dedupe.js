#!/usr/bin/env node
'use strict';
// One vacancy, one entry — tidying what earlier runs left behind.
//
//   node --env-file=.env jobs/dedupe.js --dry-run
//   node --env-file=.env jobs/dedupe.js
//
// Two jobs, in this order:
//
//   1. Date the undated announcements. Posts whose positions are inside a poster were all published as
//      "Vacancy announcement", so a company that posts every fortnight looked like it was repeating
//      itself - and step 2 would have merged real, separate notices. Each gets the day it was published.
//   2. Merge the true duplicates: the same employer advertising the same title twice, which happens
//      whenever a vacancy is re-advertised with a later closing date, or the same advert reaches us
//      from two boards. We keep ONE row - the one with the latest deadline - fill in anything the
//      survivor is missing from its twins, and delete the rest.
//
// Deleting rows is not reversible, so the dry run prints exactly what it would do and writes nothing.
const DRY = process.argv.includes('--dry-run');

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  // ---- 1. date the undated announcements ----
  const undated = await prisma.job.findMany({
    where: { title: 'Vacancy announcement' },
    select: { id: true, publishedAt: true, employerId: true },
  });
  console.log('[dedupe] undated announcements: ' + undated.length);
  for (const j of undated) {
    const title = 'Vacancy announcement — ' + new Date(j.publishedAt)
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (DRY) continue;
    await prisma.job.update({ where: { id: j.id }, data: { title } });
  }

  // ---- 2. merge the duplicates ----
  const groups = await prisma.$queryRawUnsafe(
    `SELECT "employerId", title, count(*)::int AS c FROM "Job" GROUP BY 1,2 HAVING count(*) > 1 ORDER BY c DESC`);
  console.log('[dedupe] duplicate groups: ' + groups.length);

  let removed = 0, kept = 0;
  for (const g of groups) {
    const rows = await prisma.job.findMany({
      where: { employerId: g.employerId, title: g.title },
      orderBy: [{ deadline: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
    });
    const [keep, ...rest] = rows;
    // The survivor should not be poorer than the copies we are deleting.
    const patch = {};
    for (const f of ['howToApply', 'imageUrl', 'bodyHtml', 'salary', 'experience', 'education', 'jobType']) {
      if (!keep[f]) { const donor = rest.find(r => r[f]); if (donor) patch[f] = donor[f]; }
    }
    kept++;
    console.log('  · ' + g.title.slice(0, 60) + '  ×' + rows.length
      + (Object.keys(patch).length ? '  (+' + Object.keys(patch).join(',') + ')' : ''));
    if (DRY) { removed += rest.length; continue; }
    if (Object.keys(patch).length) await prisma.job.update({ where: { id: keep.id }, data: patch });
    const del = await prisma.job.deleteMany({ where: { id: { in: rest.map(r => r.id) } } });
    removed += del.count;
  }

  console.log('\n[dedupe] ' + (DRY ? 'would keep ' : 'kept ') + kept + ' entries and '
    + (DRY ? 'remove ' : 'removed ') + removed + ' duplicates');
  await prisma.$disconnect();
})().catch(e => { console.error('[dedupe] failed: ' + e.message); process.exit(1); });
