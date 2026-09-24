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
  // Grouped on a NORMALISED title, not the exact one. Boards type the same post differently -
  // "IT Technician" / "IT technician", "F&B Director" / "F&B DIRECTOR", "General   Accounts Head" with
  // three spaces - and an exact GROUP BY reads those as different vacancies. On 23 September 2026 that
  // left 60 adverts on the board twice, every one of them a case or whitespace difference.
  const groups = await prisma.$queryRawUnsafe(
    `SELECT "employerId", lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) AS norm, count(*)::int AS c
       FROM "Job" GROUP BY 1,2 HAVING count(*) > 1 ORDER BY c DESC`);
  console.log('[dedupe] duplicate groups: ' + groups.length);

  let removed = 0, kept = 0;
  for (const g of groups) {
    const rows = (await prisma.job.findMany({
      where: { employerId: g.employerId },
      orderBy: [{ deadline: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }],
    })).filter(r => r.title.trim().replace(/\s+/g, ' ').toLowerCase() === g.norm);
    if (rows.length < 2) continue;
    const [keep, ...rest] = rows;
    // The survivor should not be poorer than the copies we are deleting.
    const patch = {};
    for (const f of ['howToApply', 'imageUrl', 'bodyHtml', 'salary', 'experience', 'education', 'jobType']) {
      if (!keep[f]) { const donor = rest.find(r => r[f]); if (donor) patch[f] = donor[f]; }
    }
    // Keep the best-written title in the group: a board that shouted "F&B DIRECTOR" should not decide
    // how the post is printed, and neither should one that left three spaces in the middle.
    const tidy = t => t.trim().replace(/\s+/g, ' ');
    const caseScore = t => (/[a-z]/.test(t) && /[A-Z]/.test(t) ? 1 : 0);
    const bestTitle = tidy(rows.slice().sort((a, b) => caseScore(b.title) - caseScore(a.title))[0].title);
    if (bestTitle !== keep.title) patch.title = bestTitle;

    kept++;
    console.log('  · ' + bestTitle.slice(0, 60) + '  ×' + rows.length
      + (Object.keys(patch).length ? '  (+' + Object.keys(patch).join(',') + ')' : ''));
    if (DRY) { removed += rest.length; continue; }
    if (Object.keys(patch).length) await prisma.job.update({ where: { id: keep.id }, data: patch });
    // Every address we delete keeps working: it becomes an alias of the survivor, which /jobs/:slug answers
    // with a 301. Until 25 September 2026 this step deleted without one, and Googlebot - which had the twins'
    // addresses from the sitemap - met 404s on pages it was just starting to index.
    for (const r of rest) {
      await prisma.jobAlias.upsert({ where: { slug: r.slug }, update: { jobId: keep.id, path: null }, create: { slug: r.slug, jobId: keep.id } });
    }
    const del = await prisma.job.deleteMany({ where: { id: { in: rest.map(r => r.id) } } });
    removed += del.count;
  }

  console.log('\n[dedupe] ' + (DRY ? 'would keep ' : 'kept ') + kept + ' entries and '
    + (DRY ? 'remove ' : 'removed ') + removed + ' duplicates');
  await prisma.$disconnect();
})().catch(e => { console.error('[dedupe] failed: ' + e.message); process.exit(1); });
