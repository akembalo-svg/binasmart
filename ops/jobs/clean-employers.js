#!/usr/bin/env node
'use strict';
// Company clean-up, second pass: the duplicates jobs/merge-employers.js is too strict to see, and names that are
// advert text. It proposes; a person approves; then it merges and every old company address keeps working.
//
//   node --env-file=.env ops/jobs/clean-employers.js                 write the proposal (/root/storage/employer-merge-plan.json + .txt)
//   node --env-file=.env ops/jobs/clean-employers.js --apply <plan>  merge exactly the groups in an approved plan
//
// The key (25 September 2026): lower case, legal forms out (PLC, S.C., Share Company, Ltd), a trailing acronym in
// brackets out ("(NLMC)"), advert words at the end out ("Vacancies", "Call For Written Exam", "for fresh
// graduates", "Is"), and a trailing "Ethiopia" (or the harvested typo "eEthiopia") out. Two companies merge only
// when that whole key is equal - never on "looks similar", never on the first words alone: Addis Ababa University
// and Addis Ababa City Bus Service share two words and nothing else.
//
// --apply, per approved group: keep the row with a logo, then the most adverts; move every vacancy to it; fill
// its empty fields from the twins; write an EmployerAlias for every twin's address (/employer/<old> answers 301
// to the survivor); delete the twins. A group changed since the plan was written is skipped, not guessed at.
const fs = require('fs');
const APPLY = process.argv.indexOf('--apply');
const PLAN = '/root/storage/employer-merge-plan.json';

// The advert words must stand alone after a space or a dash: "Healthcare" ends in "are" and "Share" in "are" too.
const ADVERT_TAIL = /(?:\s+|\s*[-–—:|]\s*)(?:job\s+)?(?:vacanc(?:y|ies)(?:\s+(?:announcement|notice))?|call\s+for(?:\s+written\s+exam)?|written\s+exam|is\s+hiring|invites?(?:\s+applicants?)?|for\s+fresh\s+graduates|announces?|is|are|hiring|recruitment)\s*$/i;
const key = name => {
  let s = String(name || '').toLowerCase().replace(/[‐-―−–—]/g, '-');
  for (let i = 0; i < 3; i++) s = s.replace(ADVERT_TAIL, '');
  s = s.replace(/\(([^)]{2,12})\)\s*$/, ' ')                                  // trailing "(NLMC)"
    .replace(/\b(p\.?\s?l\.?\s?c|s\.?\s?c|share\s+company|private\s+limited\s+company|pvt|ltd|limited|inc)\b\.?/g, ' ')
    .replace(/\(([^)]{2,12})\)/g, ' ')
    .replace(/[^a-z0-9ሀ-፿]+/g, ' ').trim()
    .replace(/\s+(?:in\s+)?e?ethiopia$/, '').trim();
  return s;
};
const cleanName = name => { let s = String(name || '').trim(); for (let i = 0; i < 3; i++) s = s.replace(ADVERT_TAIL, '').trim(); return s.replace(/\s*[-–—:|]\s*$/, '').trim(); };
const FILL = ['nameAm', 'sector', 'about', 'website', 'logoUrl', 'address', 'lat', 'lng', 'locationNote', 'locationChecked', 'buildingId', 'verified'];

if (require.main === module) (async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (APPLY < 0) {
      const emps = await prisma.employer.findMany({ select: { id: true, slug: true, name: true, logoUrl: true, city: true, _count: { select: { jobs: true } } } });
      const by = new Map();
      for (const e of emps) { const k = key(e.name); if (k.length >= 3) (by.get(k) || by.set(k, []).get(k)).push(e); }
      const groups = [...by.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => {
        v.sort((a, b) => (!!b.logoUrl - !!a.logoUrl) || (b._count.jobs - a._count.jobs) || a.name.length - b.name.length);
        return { key: k, keep: { id: v[0].id, slug: v[0].slug, name: v[0].name, cleanName: cleanName(v[0].name), jobs: v[0]._count.jobs },
          merge: v.slice(1).map(e => ({ id: e.id, slug: e.slug, name: e.name, jobs: e._count.jobs })) };
      }).sort((a, b) => b.merge.length - a.merge.length || a.key.localeCompare(b.key));
      // Names that are advert text but have no twin: renamed only.
      const renames = emps.filter(e => cleanName(e.name) !== e.name.trim() && !groups.some(g => g.keep.id === e.id || g.merge.some(m => m.id === e.id)))
        .map(e => ({ id: e.id, slug: e.slug, from: e.name, to: cleanName(e.name) }));
      const plan = { at: new Date().toISOString(), groups, renames };
      fs.writeFileSync(PLAN, JSON.stringify(plan, null, 1));
      const txt = ['COMPANY MERGE PLAN ' + plan.at.slice(0, 16) + ' - ' + groups.length + ' groups, ' + groups.reduce((a, g) => a + g.merge.length, 0) + ' rows to merge; ' + renames.length + ' renames', ''];
      for (const g of groups) txt.push('KEEP  ' + g.keep.name + '  (' + g.keep.jobs + ' ads)' + (g.keep.cleanName !== g.keep.name ? '  -> renamed "' + g.keep.cleanName + '"' : ''), ...g.merge.map(m => '  + ' + m.name + '  (' + m.jobs + ' ads)'), '');
      if (renames.length) txt.push('RENAME ONLY', ...renames.map(r => '  "' + r.from + '"  ->  "' + r.to + '"'));
      fs.writeFileSync(PLAN.replace('.json', '.txt'), txt.join('\n'));
      console.log(txt.slice(0, 1).join('\n') + '\nplan: ' + PLAN + ' and .txt');
      return;
    }
    // ---- apply an approved plan ----
    const plan = JSON.parse(fs.readFileSync(process.argv[APPLY + 1] || PLAN, 'utf8'));
    let merged = 0, moved = 0, skipped = 0, renamed = 0;
    for (const g of plan.groups) {
      const keep = await prisma.employer.findUnique({ where: { id: g.keep.id } });
      const twins = keep ? await prisma.employer.findMany({ where: { id: { in: g.merge.map(m => m.id) } } }) : [];
      if (!keep || twins.length !== g.merge.length || twins.some(t => key(t.name) !== g.key) || key(keep.name) !== g.key) { skipped++; continue; }
      const fill = {};
      for (const f of FILL) if (keep[f] == null || keep[f] === false) { const d = twins.find(t => t[f] != null && t[f] !== false); if (d) fill[f] = d[f]; }
      if (g.keep.cleanName && g.keep.cleanName !== keep.name) fill.name = g.keep.cleanName;
      await prisma.$transaction(async tx => {
        for (const t of twins) {
          const r = await tx.job.updateMany({ where: { employerId: t.id }, data: { employerId: keep.id } }); moved += r.count;
          // CVs: the company a CV was sent for, and the list of companies it was already forwarded to - so a merged
          // company never receives the same CV twice.
          await tx.candidate.updateMany({ where: { employerId: t.id }, data: { employerId: keep.id } });
          for (const c of await tx.candidate.findMany({ where: { sentTo: { has: t.id } }, select: { id: true, sentTo: true } })) {
            await tx.candidate.update({ where: { id: c.id }, data: { sentTo: [...new Set(c.sentTo.map(x => (x === t.id ? keep.id : x)))] } });
          }
          await tx.employerAlias.upsert({ where: { slug: t.slug }, update: { employerId: keep.id }, create: { slug: t.slug, employerId: keep.id } });
          await tx.employerAlias.updateMany({ where: { employerId: t.id }, data: { employerId: keep.id } });   // aliases that pointed at a twin
        }
        if (Object.keys(fill).length) await tx.employer.update({ where: { id: keep.id }, data: fill });
        await tx.employer.deleteMany({ where: { id: { in: twins.map(t => t.id) } } });
      });
      merged += twins.length;
    }
    for (const r of plan.renames || []) {
      const e = await prisma.employer.findUnique({ where: { id: r.id } });
      if (!e || e.name !== r.from) { skipped++; continue; }
      await prisma.employer.update({ where: { id: r.id }, data: { name: r.to } }); renamed++;
    }
    console.log('merged ' + merged + ' rows into their companies · vacancies moved ' + moved + ' · renamed ' + renamed + ' · skipped (changed since the plan) ' + skipped);
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { key, cleanName };
