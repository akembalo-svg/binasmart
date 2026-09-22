#!/usr/bin/env node
'use strict';
// Vacancies from ethiojobs.net, read the way the site publishes them.
//
//   node --env-file=.env jobs/harvest-ethiojobs.js --dry-run [--limit 5]   parse and print, write nothing
//   node --env-file=.env jobs/harvest-ethiojobs.js [--limit 50]            publish what is new
//
// Why this is reading rather than scraping: ethiojobs.net's robots.txt is `Allow: /` for every agent and
// names GPTBot and OAI-SearchBot explicitly, it publishes a sitemap of its job URLs, and every job page
// carries a schema.org JobPosting block - the format made for aggregators, which is how Google Jobs
// reads it too. We take the structured data, keep their link on every listing, and go slowly.
//
// Three rules this file exists to keep:
//   1. Every listing carries sourceUrl + sourceName. A vacancy without its origin is a vacancy nobody
//      can check, and the whole platform is built on being checkable.
//   2. One employer, however the advert spells it. jobs/routes.js owns that matching; this file calls it
//      rather than inventing a second one, or we get 2,000 companies a day instead of a register.
//   3. Never republish a vacancy we already hold. The dedupe is on the source url first (exact) and then
//      on employer + title + deadline, because the same job is often re-advertised with a new id.
const PACE_MS = 2500;          // a page every 2.5s: ~24 minutes for 1,000, and no strain on their server
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; Ethiopian jobs aggregator; contact https://t.me/Bina_smart)';
const SITEMAP = 'https://ethiojobs.net/sitemap-jobs.xml';
const SOURCE = 'Ethiojobs';

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TYPE_MAP = { FULL_TIME: 'full-time', PART_TIME: 'part-time', CONTRACTOR: 'contract', TEMPORARY: 'temporary', INTERN: 'internship', OTHER: null };

async function get(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml' } });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// The advert's own words, as text. Their description is HTML written by the employer; we keep the
// structure (lists and headings carry requirements) and drop everything else.
function cleanHtml(html) {
  return String(html || '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/<(?!\/?(p|ul|ol|li|strong|b|em|i|u|br|h[2-6])\b)[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}
const textOf = html => cleanHtml(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parseJob(html, url) {
  const blocks = [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let d;
    try { d = JSON.parse(b[1]); } catch (e) { continue; }
    d = Array.isArray(d) ? d.find(x => x && x['@type'] === 'JobPosting') : d;
    if (!d || d['@type'] !== 'JobPosting') continue;
    const org = d.hiringOrganization || {};
    const place = (d.jobLocation && d.jobLocation.address) || {};
    // The Amharic title is often carried in brackets after the English one: keep both, split nothing
    // that is not clearly a pair, because a bracket can also hold "(re-advertised)".
    const raw = String(d.title || '').trim();
    const m = /^(.*?)\s*[\(（]\s*([ሀ-፿][^)）]*)[\)）]\s*$/.exec(raw);
    const title = (m ? m[1] : raw).trim();
    const titleAm = m ? m[2].trim() : null;
    const body = cleanHtml(d.description);
    if (!title || !org.name) return null;
    return {
      title, titleAm,
      employer: String(org.name).trim(),
      website: typeof org.sameAs === 'string' ? org.sameAs : null,
      city: String(place.addressLocality || 'Addis Ababa').trim(),   // normalised at write time, below
      jobType: TYPE_MAP[String(d.employmentType || '').toUpperCase()] || null,
      summary: (textOf(d.description).slice(0, 280) || title),
      bodyHtml: body || null,
      deadline: d.validThrough ? new Date(d.validThrough) : null,
      publishedAt: d.datePosted ? new Date(d.datePosted) : new Date(),
      sourceUrl: url, sourceName: SOURCE,
    };
  }
  return null;
}

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { findOrCreateEmployer, uniqueJobSlug } = require('./publish')({ prisma });
  const { cleanCity } = require('./publish');

  const xml = await get(SITEMAP);
  if (!xml) { console.error('[ethiojobs] could not read the sitemap'); process.exit(1); }
  let urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => /\/job\//.test(u));
  console.log('[ethiojobs] sitemap lists ' + urls.length + ' job urls');

  // Skip what we already hold before fetching anything: the cheapest request is the one not made.
  const have = new Set((await prisma.job.findMany({ where: { sourceName: SOURCE }, select: { sourceUrl: true } })).map(j => j.sourceUrl));
  urls = urls.filter(u => !have.has(u));
  if (LIMIT) urls = urls.slice(0, LIMIT);
  console.log('[ethiojobs] ' + urls.length + ' not seen before' + (LIMIT ? ' (limited to ' + LIMIT + ')' : ''));

  let made = 0, skipped = 0, failed = 0;
  for (const url of urls) {
    const html = await get(url);
    await sleep(PACE_MS);
    if (!html) { failed++; console.log('  !! could not fetch ' + url); continue; }
    const j = parseJob(html, url);
    if (!j) { failed++; console.log('  !! no JobPosting data in ' + url); continue; }

    if (DRY) {
      console.log('\n--- ' + j.title + (j.titleAm ? ' · ' + j.titleAm : ''));
      console.log('    employer : ' + j.employer);
      console.log('    city/type: ' + j.city + (j.jobType ? ' · ' + j.jobType : ''));
      console.log('    deadline : ' + (j.deadline ? j.deadline.toISOString().slice(0, 10) : '(none stated)'));
      console.log('    summary  : ' + j.summary.slice(0, 120));
      console.log('    source   : ' + j.sourceUrl);
      made++;
      continue;
    }

    try {
      j.city = cleanCity(j.city);
      const emp = await findOrCreateEmployer(j.employer, { city: j.city, website: j.website });
      // The same vacancy is often re-advertised under a new id; employer + title + deadline catches it.
      const twin = await prisma.job.findFirst({ where: { employerId: emp.id, title: j.title, deadline: j.deadline } });
      if (twin) { skipped++; continue; }
      const slug = await uniqueJobSlug(j.title + '-' + j.employer);
      await prisma.job.create({ data: {
        slug, title: j.title, titleAm: j.titleAm, employerId: emp.id, city: j.city, jobType: j.jobType,
        summary: j.summary, bodyHtml: j.bodyHtml, deadline: j.deadline, publishedAt: j.publishedAt,
        sourceUrl: j.sourceUrl, sourceName: j.sourceName,
      } });
      made++;
      if (made % 25 === 0) console.log('  published ' + made);
    } catch (e) { failed++; console.log('  !! ' + j.title + ': ' + String(e.message).slice(0, 120)); }
  }
  console.log('\n[ethiojobs] ' + (DRY ? 'would publish ' : 'published ') + made + ', already held ' + skipped + ', failed ' + failed);
  await prisma.$disconnect();
})().catch(e => { console.error('[ethiojobs] failed: ' + e.message); process.exit(1); });
