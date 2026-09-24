#!/usr/bin/env node
'use strict';
// Give a redirect to vacancy addresses that now answer 404 because jobs/dedupe.js deleted them without one.
//
//   node --env-file=.env ops/jobs/alias-404s.js            report, write nothing
//   node --env-file=.env ops/jobs/alias-404s.js --apply    write the aliases
//
// The addresses come from the nginx logs (every /jobs/<slug> that answered 404). An alias is written only when
// the deleted address differs from EXACTLY ONE published vacancy by its "-N" suffix - "driver-prominent-
// engineering-solutions" -> "driver-prominent-engineering-solutions-2" - which is the shape dedupe's twins have.
// No match, or two, and the address stays a 404: a redirect to the wrong vacancy is worse than none.
const fs = require('fs');
const zlib = require('zlib');
const APPLY = process.argv.includes('--apply');
const LOGS = '/var/log/nginx';

const slugs = new Set();
for (const f of fs.readdirSync(LOGS).filter(f => /^bina\.access\.log/.test(f))) {
  let t = fs.readFileSync(LOGS + '/' + f);
  if (f.endsWith('.gz')) t = zlib.gunzipSync(t);
  for (const m of t.toString('utf8').matchAll(/"GET \/jobs\/([a-z0-9-]{8,200})(?:\?[^ "]*)? HTTP[^"]*" 404 /g)) slugs.add(m[1]);
}

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const base = s => s.replace(/-\d+$/, '');
  let wrote = 0, none = 0, many = 0, already = 0;
  for (const s of [...slugs].sort()) {
    if (await prisma.job.findUnique({ where: { slug: s }, select: { id: true } })) { already++; continue; }   // exists again
    if (await prisma.jobAlias.findUnique({ where: { slug: s } })) { already++; continue; }
    const b = base(s);
    const live = (await prisma.job.findMany({ where: { published: true, slug: { startsWith: b } }, select: { id: true, slug: true } }))
      .filter(j => j.slug === b || new RegExp('^' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d+$').test(j.slug));
    if (live.length !== 1) { live.length ? many++ : none++; continue; }
    console.log('  ' + s.slice(0, 70) + '  ->  ' + live[0].slug.slice(0, 70));
    if (APPLY) await prisma.jobAlias.create({ data: { slug: s, jobId: live[0].id } });
    wrote++;
  }
  console.log('404 addresses in the logs: ' + slugs.size + '; ' + (APPLY ? 'aliased ' : 'would alias ') + wrote
    + '; no single match (left 404): ' + (none + many) + ' (none ' + none + ', several ' + many + '); already fine: ' + already);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
