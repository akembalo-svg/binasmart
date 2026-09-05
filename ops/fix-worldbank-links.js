'use strict';
// The World Bank moved its procurement notices: /procurement/notice/<id> now 404s and the page lives
// at /procurement-detail/<id>. Our tender pages cite the old path. Rewrite them, verifying each new
// URL answers 200 before saving, so a wrong guess can never replace a link.
//   node ops/fix-worldbank-links.js [--dry]
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const head = async url => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
  try { const r = await fetch(url, { headers: { 'user-agent': UA }, signal: c.signal }); return r.status; }
  catch (e) { return 0; } finally { clearTimeout(t); }
};
(async () => {
  const dry = process.argv.includes('--dry');
  const rows = await prisma.tender.findMany({ where: { sourceUrl: { contains: '/procurement/notice/' } }, select: { id: true, slug: true, sourceUrl: true } });
  console.log('tenders with the old World Bank path: ' + rows.length);
  let fixed = 0, skipped = 0;
  for (const t of rows) {
    const to = t.sourceUrl.replace('/procurement/notice/', '/procurement-detail/');
    const st = await head(to);
    if (st !== 200) { console.log('  skip (new URL answered ' + st + '): ' + t.slug); skipped++; continue; }
    if (!dry) await prisma.tender.update({ where: { id: t.id }, data: { sourceUrl: to } });
    console.log('  ok ' + t.slug.slice(0, 46) + ' -> …/procurement-detail/' + to.split('/').pop());
    fixed++;
  }
  console.log((dry ? 'dry: ' : '') + 'fixed ' + fixed + ', left alone ' + skipped);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
