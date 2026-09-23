#!/usr/bin/env node
'use strict';
// Re-apply the category rules to vacancies already on the board.
//
//   node --env-file=.env jobs/recategorise.js --dry-run
//   node --env-file=.env jobs/recategorise.js
//   node --env-file=.env jobs/recategorise.js --all      closed vacancies too
//
// A category is written once, when the advert arrives. So when a rule is corrected, every vacancy
// already on the board keeps the old answer — the fix only reaches adverts that have not happened yet.
// This carries a rule fix backwards over what is already published.
//
// Two things it will not do:
//   · It never blanks a category. Where the rules now say nothing but a category exists, the existing
//     one stays. Some of those were set deliberately — 271 came from the 23 September audit, where a
//     decision model filed what the rules could not read — and a rule returning null is not evidence
//     that a human-checked answer is wrong.
//   · It does not touch anything else. One column, deterministic, and running it twice changes nothing
//     the second time.
const DRY = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { categorise } = require('./categories');
  const { openSince, isClosed } = require('../tenders/deadline');
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const where = ALL ? {} : { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] };
    const rows = (await prisma.job.findMany({
      where, select: { id: true, title: true, summary: true, category: true, deadline: true },
    })).filter(j => ALL || !isClosed(j.deadline, now));

    const moves = {};
    let changed = 0, keptNull = 0, same = 0;
    for (const j of rows) {
      const now2 = categorise(j.title, j.summary);
      if (!now2) { if (j.category) keptNull++; continue; }
      if (now2 === j.category) { same++; continue; }
      const k = (j.category || '(none)') + ' -> ' + now2;
      moves[k] = (moves[k] || 0) + 1;
      changed++;
      if (!DRY) await prisma.job.update({ where: { id: j.id }, data: { category: now2 } });
    }

    console.log('[recategorise] ' + rows.length + ' vacancies' + (ALL ? ' (all)' : ' (open only)') +
      (DRY ? '  — dry run, nothing written' : ''));
    Object.entries(moves).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + String(n).padStart(5) + '  ' + k));
    console.log('[recategorise] ' + (DRY ? 'would change ' : 'changed ') + changed +
      '; unchanged ' + same + '; kept an existing category the rules no longer produce: ' + keptNull);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
