#!/usr/bin/env node
'use strict';
// What line of business is this company in? Read it off their own vacancies.
//
//   node --env-file=.env jobs/employer-sector.js --dry-run
//   node --env-file=.env jobs/employer-sector.js
//   node --env-file=.env jobs/employer-sector.js --min 2     require 2 vacancies before deciding
//
// On 24 September 2026, 2 of 1,780 employers had a sector. The answer was already in the database:
// a company whose vacancies are mostly banking is a banking company. This reads the categories of
// each employer's OWN adverts and takes the commonest.
//
// Rules, not a model, for the same reason jobs/categories.js is: free, instant, the same answer
// tomorrow, and wrong in a way somebody can see and correct.
//
// What it refuses to do:
//   · No vacancy of theirs is categorised (58 companies) — left empty. An empty field is a gap a
//     reader can see; a guessed one is a claim about somebody else's business.
//   · A tie, or a company whose vacancies are spread evenly across many fields, is left empty too:
//     a construction firm that also hires an accountant is not an accounting firm, and if we cannot
//     tell which is which then we do not know.
const DRY = process.argv.includes('--dry-run');
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const MIN = Number(arg('--min')) || 1;

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { label } = require('./categories');
  const prisma = new PrismaClient();
  try {
    const emps = await prisma.employer.findMany({
      select: { id: true, name: true, sector: true, jobs: { select: { category: true } } },
    });
    console.log('[sector] ' + emps.length + ' employers' + (DRY ? '  (dry run)' : ''));

    const counts = {};
    let set = 0, kept = 0, unknown = 0, tied = 0;
    for (const e of emps) {
      const tally = {};
      for (const j of e.jobs) if (j.category) tally[j.category] = (tally[j.category] || 0) + 1;
      const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      if (!ranked.length || ranked[0][1] < MIN) { unknown++; continue; }
      // A clear lead, or nothing. Two fields level-pegging means we cannot tell.
      if (ranked[1] && ranked[1][1] === ranked[0][1]) { tied++; continue; }
      const slug = ranked[0][0];
      const name = label(slug, 'en');
      if (e.sector === name) { kept++; continue; }
      counts[name] = (counts[name] || 0) + 1;
      set++;
      if (!DRY) await prisma.employer.update({ where: { id: e.id }, data: { sector: name } });
    }

    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + String(n).padStart(5) + '  ' + k));
    console.log('[sector] ' + (DRY ? 'would set ' : 'set ') + set + '; already right ' + kept +
      '; left empty — no categorised vacancy ' + unknown + ', too evenly spread ' + tied);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
