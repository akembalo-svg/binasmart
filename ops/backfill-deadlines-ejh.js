#!/usr/bin/env node
'use strict';
// Put a closing date on the EthioJobsHub vacancies we failed to read one from.
//
//   node --env-file=.env ops/backfill-deadlines-ejh.js            report, write nothing
//   node --env-file=.env ops/backfill-deadlines-ejh.js --apply    write them
//
// The parser in jobs/sites/ethiojobshub.js was widened on 2026-09-26 and now reads four more shapes of
// closing date. Everything harvested before that kept its null, and a null deadline makes a vacancy open
// FOR EVER - the board has been showing adverts that closed months ago. This re-reads the employer's own
// page and fills in the date THEY printed. It is a correction, not a policy: nothing is invented, and a
// row only changes if the page states a date.
//
// Note what --apply does: a recovered date that has already passed CLOSES that advert, so the open count
// drops. That is the point - those vacancies are shut, and saying so is the honest outcome.
const { PrismaClient } = require('@prisma/client');
const { deadlineFrom } = require('../jobs/sites/ethiojobshub');

const APPLY = process.argv.includes('--apply');
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; Ethiopian jobs aggregator; contact https://t.me/Bina_smart)';
const unent = s => String(s).replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '–')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = h => String(h || '').replace(/<(script|style|ins|iframe|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
const tidy = s => unent(s).replace(/[ \t]+/g, ' ').split('\n').map(l => l.trim()).filter(Boolean).join('\n');

(async () => {
  const prisma = new PrismaClient();
  const now = Date.now();
  try {
    const rows = await prisma.job.findMany({
      where: { sourceName: 'EthioJobsHub', deadline: null },
      select: { id: true, slug: true, sourceUrl: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
    });
    // One EthioJobsHub post carries many positions, so the page is fetched once and applied to all of them.
    const byUrl = new Map();
    for (const r of rows) { if (!r.sourceUrl) continue; if (!byUrl.has(r.sourceUrl)) byUrl.set(r.sourceUrl, []); byUrl.get(r.sourceUrl).push(r); }
    console.log(rows.length + ' vacancies with no deadline, across ' + byUrl.size + ' pages' + (APPLY ? '' : '  [report only]'));

    let pages = 0, found = 0, rowsDated = 0, past = 0, future = 0, failed = 0;
    for (const [url, group] of byUrl) {
      pages++;
      let html = '';
      try { const r = await fetch(url, { headers: { 'user-agent': UA } }); html = r.ok ? await r.text() : ''; } catch (e) { html = ''; }
      if (!html) { failed++; continue; }
      const text = tidy(strip(html));
      // Counted from the post's own date, exactly as the harvester does it.
      const d = deadlineFrom(text, new Date(group[0].publishedAt).getTime());
      if (!d) continue;
      found++; rowsDated += group.length;
      if (d.getTime() < now) past += group.length; else future += group.length;
      if (APPLY) await prisma.job.updateMany({ where: { id: { in: group.map(g => g.id) } }, data: { deadline: d } });
      if (found <= 15) console.log('  ' + d.toISOString().slice(0, 10) + (d.getTime() < now ? ' (closed) ' : ' (open)   ') + group.length + '× ' + group[0].slug.slice(0, 50));
      if (pages % 50 === 0) console.log('  … ' + pages + '/' + byUrl.size + ' pages, ' + rowsDated + ' vacancies dated so far');
    }
    console.log('\npages read ' + pages + ' (fetch failed ' + failed + ')');
    console.log('pages with a readable date ' + found);
    console.log('vacancies that would get a date ' + rowsDated + '  — already closed ' + past + ', still open ' + future);
    console.log(APPLY ? 'WRITTEN.' : 'Nothing written. Re-run with --apply to write.');
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
