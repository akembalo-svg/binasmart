#!/usr/bin/env node
'use strict';
// The companies on BinaSmart's job board, as knowledge Bini answers from: "tell me about company X", "which
// companies are hiring engineers?", "is X hiring now?".
//
//   node --env-file=.env ops/jobs/companies-md.js [--dry-run]
//
// Writes knowledge/places/companies-<field>.md, one document per field companies mostly hire in, one line per
// company: name, city, open vacancies now (count and the newest titles), how many adverts since when, the fields it
// hires in, its own website, a confirmed address, and its bina.et page. Cron daily after the harvest; the nightly
// knowledge ingest indexes what changed.
//
// What it will not say:
//   · A company's line of business. Employer.sector is the field most of its ADVERTS are in (jobs/employer-sector.js)
//     - a construction firm that hires many accountants reads "Accounting". So the line says "mostly hires in".
//   · A phone number or e-mail. Those come from adverts and are often a recruiter's own mobile; the company page
//     and the adverts carry what the company chose to publish.
//   · An address nobody confirmed. Only locationChecked addresses (the company's own claim, approved) appear.
const fs = require('fs');
const path = require('path');
const DRY = process.argv.includes('--dry-run');
const OUT = path.join(__dirname, '..', '..', 'knowledge', 'places');
const MOBILE = /(?:\+?251[\s-]?|\b0)[79](?:[\s-]?\d){8}/;

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const { label } = require('../../jobs/categories');
  const { isClosed } = require('../../tenders/deadline');
  let cleanCity = c => c; try { cleanCity = require('../../jobs/place').cleanCity || cleanCity; } catch (e) { /* optional */ }
  const prisma = new PrismaClient();
  try {
    const now = new Date(), day = now.toISOString().slice(0, 10);
    const emps = await prisma.employer.findMany({ select: { id: true, slug: true, name: true, nameAm: true, city: true, sector: true, website: true,
      address: true, locationChecked: true, verified: true, jobs: { where: { published: true }, select: { title: true, titleAm: true, category: true, deadline: true, publishedAt: true }, orderBy: { publishedAt: 'desc' } } } });
    const groups = {};
    let skipped = 0;
    const month = d => new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    for (const e of emps) {
      if (!e.jobs.length) { skipped++; continue; }
      const open = e.jobs.filter(j => !isClosed(j.deadline, now));
      const cats = {}; for (const j of e.jobs) if (j.category) cats[j.category] = (cats[j.category] || 0) + 1;
      const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => label(c, 'en'));
      const since = e.jobs[e.jobs.length - 1].publishedAt;
      const city = (cleanCity(e.city) || e.city || '').replace(/,\s*Ethiopia$/i, '');
      const titles = open.slice(0, 3).map(j => String(j.title || j.titleAm).replace(/\s+/g, ' ').trim().slice(0, 60));
      const parts = ['- **' + e.name.replace(/\*/g, '') + '**' + (e.nameAm && e.nameAm !== e.name ? ' (' + e.nameAm + ')' : '') + (e.verified ? ' ✓' : '')];
      if (city) parts.push(city);
      parts.push(open.length ? open.length + ' open vacanc' + (open.length === 1 ? 'y' : 'ies') + ' now' + (titles.length ? ' (' + titles.join('; ') + ')' : '') : 'no open vacancy now');
      parts.push(e.jobs.length + ' advert' + (e.jobs.length === 1 ? '' : 's') + ' on BinaSmart since ' + month(since));
      if (top.length) parts.push('mostly hires in ' + top.join(', '));
      if (e.website && /^[\w.-]+\.[a-z]{2,}(\/\S*)?$|^https?:\/\//i.test(e.website.trim())) parts.push('website ' + e.website.trim());
      if (e.address && e.locationChecked) parts.push('address ' + e.address);
      parts.push('https://bina.et/employer/' + e.slug);
      const line = parts.join(' · ');
      if (MOBILE.test(line)) { skipped++; continue; }
      const g = e.sector || 'Other fields';
      (groups[g] ||= []).push({ line, open: open.length, name: e.name });
    }
    const files = {};
    for (const [g, rows] of Object.entries(groups)) {
      rows.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
      const slug = 'companies-' + g.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const n = rows.length, open = rows.filter(r => r.open).length;
      files[slug + '.md'] = ['---', 'title: "Companies on BinaSmart\'s job board that mostly hire in ' + g + '"', 'url: "https://bina.et/employers"', 'lang: "en"',
        'source_name: "BinaSmart job board (bina.et/jobs)"', 'fetched: "' + day + '"', 'count: "' + n + '"', '---', '',
        '# Companies hiring in ' + g + ' · ድርጅቶች', '',
        n + ' companies whose adverts on bina.et are mostly in ' + g + ' (' + open + ' with a vacancy open now), as of ' + day + '. '
        + '"Mostly hires in" is counted from each company\'s own adverts; it is not the company\'s line of business. '
        + 'Vacancies change every day: the company page has the current list. Apply only through the advert, and never pay a fee to get a job.', '',
        ...rows.map(r => r.line), ''].join('\n');
    }
    for (const [f, t] of Object.entries(files)) console.log(f.padEnd(52) + String((t.match(/^- \*\*/gm) || []).length).padStart(5));
    console.log('companies with at least one advert: ' + Object.values(groups).reduce((a, r) => a + r.length, 0) + ' · skipped ' + skipped);
    const leak = Object.values(files).some(t => MOBILE.test(t));
    if (leak) { console.error('MOBILE NUMBER IN OUTPUT - nothing written'); process.exit(1); }
    if (DRY) return;
    for (const f of fs.readdirSync(OUT).filter(f => f.startsWith('companies-') && !files[f])) fs.unlinkSync(path.join(OUT, f));   // a field nobody hires in any more
    for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), t);
    console.log('written to ' + OUT);
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
