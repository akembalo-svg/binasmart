#!/usr/bin/env node
'use strict';
// One company, one row — merging employers that six boards spelled six ways.
//
//   node --env-file=.env jobs/merge-employers.js --dry-run
//   node --env-file=.env jobs/merge-employers.js
//
// Why. Every board writes a company name its own way: "Coca Cola" and "Coca-Cola", "Hagbes PLC" and
// "Hagbes Private Limited Company", "National Election Board of Ethiopia(NEBE)" and the same without
// the brackets. Two of the pairs on 23 September 2026 differed only by a NON-BREAKING HYPHEN (U+2011),
// which no one will ever spot by eye.
//
// Three things break when one company is two rows:
//   · the logo sits on one of them, so half the company's vacancies show a monogram (NEBE: 34 without,
//     17 with);
//   · the company page is split, and neither half shows what the company actually hires for;
//   · jobs/dedupe.js groups by (employerId, title), so the SAME advert arriving from two boards is not
//     a duplicate to it — 60 open vacancies were on the board twice because of this.
//
// This is a rule, not a model. Normalising a company name is exactly the kind of work a rule does well:
// free, instant, the same answer tomorrow, and auditable when it is wrong. Run dedupe after this.
//
// What it does NOT do: merge two names that merely look similar. Only an exact match after normalising
// counts. "Ethio Telecom" and "Ethiopian Telecommunication" stay separate — they may be one company, but
// deciding that is a person's job, and a wrong merge puts one company's vacancies under another's name.
const DRY = process.argv.includes('--dry-run');

// Case, punctuation, and the legal-form words a board may or may not print. Nothing clever: the moment
// this starts stripping real words it will merge two companies that are not the same.
const norm = s => String(s || '')
  .toLowerCase()
  .replace(/[‐-―−]/g, '-')        // non-breaking and typographic hyphens -> plain
  .replace(/[.,]/g, ' ')
  .replace(/\b(plc|p l c|s c|share company|private limited company|pvt|ltd|limited|inc|co)\b/g, ' ')
  .replace(/[^a-z0-9ሀ-፿]+/g, ' ')
  .trim();

// Fields worth carrying over from a twin when the survivor has none. Researched facts, not guesses.
const FILL = ['nameAm', 'sector', 'about', 'website', 'phone', 'email', 'logoUrl',
  'address', 'lat', 'lng', 'locationNote', 'locationChecked', 'buildingId'];

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const emps = await prisma.employer.findMany({ include: { _count: { select: { jobs: true } } } });
    const byKey = new Map();
    for (const e of emps) {
      const k = norm(e.name);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
    const groups = [...byKey.values()].filter(v => v.length > 1);
    console.log('[merge] employers: ' + emps.length + ', duplicate groups: ' + groups.length +
      ', rows that would go: ' + groups.reduce((n, v) => n + v.length - 1, 0) + (DRY ? '  (dry run)' : ''));

    let movedJobs = 0, movedCands = 0, filled = 0, deleted = 0;
    for (const group of groups) {
      // Keep the row a reader is best served by: one with a logo first, then the one carrying the most
      // vacancies, then the oldest — so the id that has been linked to longest tends to survive.
      const survivor = group.slice().sort((a, b) =>
        (b.logoUrl ? 1 : 0) - (a.logoUrl ? 1 : 0) ||
        b._count.jobs - a._count.jobs ||
        new Date(a.createdAt) - new Date(b.createdAt))[0];
      const twins = group.filter(e => e.id !== survivor.id);

      console.log('  keep "' + survivor.name + '" (' + survivor._count.jobs + (survivor.logoUrl ? ', logo' : '') + ')' +
        '  <-  ' + twins.map(t => '"' + t.name + '" (' + t._count.jobs + (t.logoUrl ? ', logo' : '') + ')').join(', '));

      // The row we keep is chosen for its logo and its links; the NAME a reader sees should be the best
      // one in the group. A board that typed "strong non basic chemical manufacturing plc" should not
      // decide how the company is printed on its own page.
      const score = n => (/[a-z]/.test(n) && /[A-Z]/.test(n) ? 2 : 0) + Math.min(n.length, 60) / 100;
      const bestName = group.slice().sort((a, b) => score(b.name) - score(a.name))[0].name;

      const patch = {};
      if (bestName !== survivor.name) { patch.name = bestName; console.log('       name  -> "' + bestName + '"'); }
      for (const f of FILL) {
        if (survivor[f] != null && survivor[f] !== '') continue;
        const donor = twins.find(t => t[f] != null && t[f] !== '');
        if (donor) patch[f] = donor[f];
      }
      if (twins.some(t => t.verified) && !survivor.verified) patch.verified = true;
      if (Object.keys(patch).length) {
        console.log('       fills: ' + Object.keys(patch).join(', '));
        filled++;
      }

      const ids = twins.map(t => t.id);
      if (DRY) {
        deleted += twins.length;
        movedJobs += twins.reduce((n, t) => n + t._count.jobs, 0);
        continue;
      }

      const j = await prisma.job.updateMany({ where: { employerId: { in: ids } }, data: { employerId: survivor.id } });
      movedJobs += j.count;
      // A CV is tied to the employer it was sent to; that consent follows the company, not the row.
      const c = await prisma.candidate.updateMany({ where: { employerId: { in: ids } }, data: { employerId: survivor.id } });
      movedCands += c.count;
      if (Object.keys(patch).length) await prisma.employer.update({ where: { id: survivor.id }, data: patch });
      const d = await prisma.employer.deleteMany({ where: { id: { in: ids } } });
      deleted += d.count;
    }

    console.log('[merge] ' + (DRY ? 'would move' : 'moved') + ' ' + movedJobs + ' vacancies, ' + movedCands +
      ' CV rows; filled ' + filled + ' survivors; ' + (DRY ? 'would delete' : 'deleted') + ' ' + deleted + ' employer rows');
    if (DRY) console.log('[merge] nothing written. Run without --dry-run, then jobs/dedupe.js.');
    else console.log('[merge] now run: node --env-file=.env jobs/dedupe.js --dry-run');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
