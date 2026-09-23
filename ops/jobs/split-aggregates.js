#!/usr/bin/env node
'use strict';
// One page advertising eight posts is eight vacancies, not one.
//
//   node --env-file=.env ops/jobs/split-aggregates.js --dry        read and report, write nothing
//   node --env-file=.env ops/jobs/split-aggregates.js              split them
//   node --env-file=.env ops/jobs/split-aggregates.js --limit 20   a few, to look at first
//
// ETCareers publishes one page per employer per round: "Ethiopian Engineering Corporation Vacancy 2026
// – 8 Positions", and inside it every post with its experience, its qualification, its salary and its
// location. We stored the page and threw away the structure - 195 such rows on the board, holding about
// 978 real vacancies that nobody can search for, because the only title we show names a count.
//
// The salaries matter most. "Junior Electrical Engineer, Addis Ababa, ETB 20,979" is the page a person
// actually searches for, and it is sitting in our own database unread.
//
// Nothing is invented here: every field is copied out of the text of the page we already fetched. The
// aggregate row is unpublished rather than deleted, and its old address redirects to the employer's
// page, where all of its posts are now listed - so a link in Google keeps working and lands somewhere
// that answers the question it was asked.
const { PrismaClient } = require('@prisma/client');
const { categorise } = require('../../jobs/categories');
const { cleanPositionTitle } = require('../../jobs/sites/ethiojobshub');
const { slugify } = require('../../jobs/publish');

const DRY = process.argv.includes('--dry');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) || 0 : 0; })();

// "1. Junior Electrical Engineer (Cost Engineer)" — the numbered heading of one post.
const HEAD = /^\s*(\d{1,2})[.)]\s+(.{4,90})$/gm;
// The labelled lines under it, as ETCareers prints them.
const FIELD = {
  vacancies: /^\s*number of (?:positions|vacancies)\s*:?\s*(.+)$/im,
  experience: /^\s*experience\s*:?\s*(.+)$/im,
  education: /^\s*(?:qualification|education|required qualification)\s*:?\s*(.+)$/im,
  salary: /^\s*salary\s*:?\s*(.+)$/im,
  city: /^\s*(?:location|work place|place of work)\s*:?\s*(.+)$/im,
  jobType: /^\s*(?:employment type|type of employment)\s*:?\s*(.+)$/im,
};
// A heading that is really a section of the article, not a post.
const NOT_A_POST = /^(number|experience|qualification|salary|location|employment|deadline|how to|about|available positions|requirements?|benefits?|note)\b/i;
const TYPES = { 'full time': 'full-time', 'full-time': 'full-time', permanent: 'full-time', contract: 'contract',
  'part time': 'part-time', 'part-time': 'part-time', internship: 'internship', temporary: 'temporary', 'fixed term': 'contract' };

const text = html => String(html || '').replace(/<[^>]*>/g, '\n').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\n{2,}/g, '\n');
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// The posts inside one aggregated page, each with the block of text that belongs to it.
function positions(body) {
  const t = text(body);
  const marks = [];
  let m;
  HEAD.lastIndex = 0;
  while ((m = HEAD.exec(t))) {
    const title = clean(m[2], 90).replace(/[:\-–\s]+$/, '');
    if (NOT_A_POST.test(title)) continue;
    if (!cleanPositionTitle(title)) continue;            // the junk-title guard, same one the board uses
    marks.push({ n: Number(m[1]), title, at: m.index, end: HEAD.lastIndex });
  }
  // The numbers have to actually count: 1, 2, 3. A page whose "3." is a paragraph number is not a list.
  const seq = marks.filter((mk, i) => i === 0 || mk.n === marks[i - 1].n + 1);
  if (seq.length < 2) return [];
  return seq.map((mk, i) => {
    const block = t.slice(mk.end, i + 1 < seq.length ? seq[i + 1].at : Math.min(t.length, mk.end + 1200));
    const f = {};
    for (const [k, re] of Object.entries(FIELD)) { const x = re.exec(block); if (x) f[k] = clean(x[1], 160); }
    return { title: mk.title, block: clean(block, 600), f };
  });
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.job.findMany({
      where: { sourceName: 'ETCareers', published: true },
      include: { employer: { select: { id: true, slug: true, name: true } } },
      orderBy: { publishedAt: 'desc' },
    });

    let pages = 0, made = 0, already = 0, skipped = 0;
    for (const j of rows) {
      const posts = positions(j.bodyHtml);
      if (posts.length < 2) { skipped++; continue; }
      pages++;
      if (LIMIT && pages > LIMIT) break;

      const kids = [];
      for (const p of posts) {
        const title = p.title;
        const twin = await prisma.job.findFirst({ where: { employerId: j.employerId, title, sourceUrl: j.sourceUrl } });
        if (twin) { already++; kids.push(twin); continue; }
        const n = Number(String(p.f.vacancies || '').replace(/[^\d]/g, '')) || null;
        const type = TYPES[String(p.f.jobType || '').toLowerCase().trim()] || null;
        const city = clean(p.f.city, 60) || j.city;
        const summary = clean([p.f.education, p.f.experience ? p.f.experience + ' experience' : '', p.f.salary]
          .filter(Boolean).join(' · ') || p.block, 280);
        if (DRY) { console.log('   + ' + title + (p.f.salary ? '  [' + p.f.salary + ']' : '') + (p.f.experience ? '  (' + p.f.experience + ')' : '')); made++; continue; }

        const base = slugify(title + ' ' + j.employer.name);
        let slug = base, k = 1;
        while (await prisma.job.findUnique({ where: { slug } }) || await prisma.jobAlias.findUnique({ where: { slug } })) slug = base + '-' + (++k);
        const kid = await prisma.job.create({ data: {
          slug, title, employerId: j.employerId,
          city, jobType: type,
          experience: clean(p.f.experience, 120) || null,
          education: clean(p.f.education, 160) || null,
          salary: clean(p.f.salary, 80) || null,
          vacancies: n && n < 500 ? n : null,
          summary, bodyHtml: '<p>' + summary + '</p>',
          howToApply: j.howToApply, deadline: j.deadline,
          category: categorise(title, summary),
          sourceUrl: j.sourceUrl, sourceName: j.sourceName,
          published: true, publishedAt: j.publishedAt,
        } });
        kids.push(kid); made++;
      }

      if (DRY) { console.log('  ' + j.title + '  → ' + posts.length + ' posts'); continue; }
      // The list page is not a vacancy. It stops being one, and its address now leads to the employer,
      // where everything it advertised is listed.
      if (kids.length >= 2) {
        await prisma.job.update({ where: { id: j.id }, data: { published: false } });
        await prisma.jobAlias.upsert({
          where: { slug: j.slug },
          update: { path: '/employer/' + j.employer.slug, jobId: null },
          create: { slug: j.slug, path: '/employer/' + j.employer.slug },
        });
      }
    }
    console.log('\n' + pages + ' aggregated pages · ' + made + (DRY ? ' vacancies would be created' : ' vacancies created')
      + ' · ' + already + ' already there · ' + skipped + ' pages were a single vacancy and left alone');
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[split] ' + e.message); process.exit(1); });
