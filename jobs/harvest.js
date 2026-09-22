#!/usr/bin/env node
'use strict';
// One harvester for every job site we read.
//
//   node --env-file=.env jobs/harvest.js <site> --dry-run [--limit 5]
//   node --env-file=.env jobs/harvest.js <site> [--limit 200]
//   node --env-file=.env jobs/harvest.js --all
//
// Adding a site is a row in SITES below, not a new program. That was the whole reason for pulling this
// out of harvest-ethiojobs.js: the owner will keep sending sources, and a copy of the parsing, pacing,
// dedupe and employer-matching per source is how two of them quietly start disagreeing about what
// "Awash Bank" is called.
//
// What every site gets, whether its config asks or not:
//   · robots.txt is read first and obeyed. If the path we want is disallowed for our agent, we stop and
//     say so. A site that does not want to be read is a site we do not read.
//   · one page every PACE_MS, in one process. We are a guest on their server.
//   · every listing stores sourceUrl + sourceName. The url is never published as a link (owner's call);
//     it is how a claim is checked and how we know we already hold this vacancy.
//   · the employer is matched through jobs/publish.js, so one company stays one company across sites.
//
// Cross-site duplicates: a vacancy already held is skipped no matter which site it came from - the twin
// check is employer + title + deadline and does not look at sourceName. The same advert on two boards
// stays one entry here, under the source that reached us first.
const PACE_MS = 2500;
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; Ethiopian jobs aggregator; contact https://t.me/Bina_smart)';

// ---- the sites -------------------------------------------------------------------------------------
// sitemap   : an xml sitemap listing job pages (cheapest and kindest way in)
// list      : or a list page to read links from, when there is no sitemap
// jobPath   : which urls from those are job pages
// parse     : omitted = schema.org JobPosting (what Google Jobs reads); a site without it needs its own
const SITES = {
  ethiojobs: {
    name: 'Ethiojobs',
    sitemap: 'https://ethiojobs.net/sitemap-jobs.xml',
    jobPath: /\/job\//,
  },
  // The Ethiopian Reporter's jobs board (WP JobSearch). Proper JobPosting data, and - unusually - a
  // street address on most adverts, which is exactly what the employer profiles need.
  reporterjobs: {
    name: 'Ethiopian Reporter Jobs',
    sitemaps: [1, 2, 3, 4, 5].map(n => 'https://www.ethiopianreporterjobs.com/job-sitemap' + n + '.xml'),
    jobPath: /ethiopianreporterjobs\.com\/jobs\/\d+/i,
    maxAgeDays: 120,
  },
  // hahu.jobs: no readable pages at all - read through the public GraphQL endpoint their own app uses.
  // jobs/sites/hahu.js explains what that means and what it does not touch.
  hahu: {
    name: 'HaHu Jobs',
    apiFetch: require('./sites/hahu'),
    maxAgeDays: 120,
  },
  // Owner sent these on 2026-09-22. All three publish schema.org JobPosting, so they need no reader of
  // their own - only the quirks below.
  etcareers: {
    name: 'ETCareers',
    sitemaps: ['https://etcareers.com/sitemap.xml'],
    jobPath: /etcareers\.com\/jobs\/[a-z0-9-]+$/i,
    maxAgeDays: 120,
  },
  geezjobs: {
    name: 'GeezJobs',
    sitemaps: ['https://geezjobs.com/sitemap-detail'],
    jobPath: /geezjobs\.com\/job-detail\//i,
    maxAgeDays: 120,
    stripTitle: /\s*via\s+GeezJobs\s*$/i,   // their own byline, not part of the job title
    dropSalary: true,                       // every advert carries the same 5,000-100,000 slider range
  },
  harmeejobs: {
    name: 'HarmeeJobs',
    sitemaps: ['https://harmeejobs.com/wp-sitemap-posts-job_listing-1.xml'],
    jobPath: /harmeejobs\.com\/job\//i,
    maxAgeDays: 120,
  },
  // NOT harvested, on purpose: unjobs.org publishes "User-agent: * / Disallow: /" - it permits only
  // named search engines. The owner sent the link; the site's answer is no, so we do not read it.
  //
  // hahu.jobs and afriworket.com are single-page apps: the advert is fetched by the browser from a
  // private API and the page source holds no job data at all. Nothing to read without reverse
  // engineering their app, which is a different decision from reading published structured data.

  // A WordPress board: one post is one company's whole announcement, and the positions are inside a
  // photographed notice. jobs/sites/ethiojobshub.js explains what we take and what we refuse to guess.
  ethiojobshub: {
    name: 'EthioJobsHub',
    sitemaps: ['https://ethiojobshub.com/post-sitemap.xml', 'https://ethiojobshub.com/post-sitemap2.xml',
      'https://ethiojobshub.com/post-sitemap3.xml'],
    jobPath: /ethiojobshub\.com\/[a-z0-9-]+\/$/i,
    parse: require('./sites/ethiojobshub'),
    maxAgeDays: 120,        // an advert older than four months is closed; the archive is not our job

  },
};

const TYPE_MAP = { FULL_TIME: 'full-time', PART_TIME: 'part-time', CONTRACTOR: 'contract', TEMPORARY: 'temporary', INTERN: 'internship', OTHER: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, timeout = 25000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml' } });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// A small, strict reading of robots.txt: the most specific matching group wins, and a disallowed prefix
// stops us. It errs towards not fetching - if we cannot read or understand the file, we do not harvest.
async function robotsAllows(sampleUrl) {
  const u = new URL(sampleUrl);
  const txt = await get(u.origin + '/robots.txt', 10000);
  if (txt === null) return { ok: false, why: 'robots.txt could not be read' };
  const groups = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if (cur) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const mine = 'binasmartbot';
  const forMe = groups.filter(g => g.agents.includes(mine));
  const g = (forMe.length ? forMe : groups.filter(x => x.agents.includes('*')))
    .reduce((a, b) => ({ agents: [], rules: [...a.rules, ...b.rules] }), { agents: [], rules: [] });
  if (!g.rules.length) return { ok: true };
  const path = u.pathname;
  let best = null;
  for (const r of g.rules) {
    if (!r.path) continue;                                  // "Disallow:" with nothing = allow all
    if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
  }
  if (best && !best.allow) return { ok: false, why: 'robots.txt disallows ' + best.path };
  return { ok: true };
}

// Some boards store the advert HTML entity-escaped INSIDE their JSON, so the description arrives as
// "&lt;h3&gt;…" and would otherwise be published as visible tag soup.
const unescapeEntities = str => String(str || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&rsquo;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '\u2013')
  // WordPress writes plain dashes and ampersands as numeric entities: "Manager &#8211; Relations".
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&');

const cleanHtml = html => String(html || '')
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/\son\w+="[^"]*"/gi, '')
  .replace(/<(?!\/?(p|ul|ol|li|strong|b|em|i|u|br|h[2-6])\b)[^>]*>/gi, '')
  .replace(/\n{3,}/g, '\n\n').trim();
const textOf = html => cleanHtml(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// schema.org JobPosting - the format made for aggregators, and what Google Jobs reads. A site that
// publishes it is telling machines how to read its adverts; we take it at its word and nothing else.
function parseJsonLd(html, url, sourceName, cfg = {}) {
  const blocks = [...String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let d;
    // Real sites put raw newlines inside JSON strings (ethiopianreporterjobs does), which is invalid
    // JSON by the letter and parses fine once the control characters are escaped. A strict parse here
    // would silently skip every advert on the site.
    try { d = JSON.parse(b[1]); } catch (e) {
      try { d = JSON.parse(b[1].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').replace(/\n|\r/g, ' ')); }
      catch (e2) { continue; }
    }
    const flat = Array.isArray(d) ? d : (Array.isArray(d['@graph']) ? d['@graph'] : [d]);
    d = flat.find(x => x && x['@type'] === 'JobPosting');
    if (!d) continue;
    const org = d.hiringOrganization || {};
    const place = (Array.isArray(d.jobLocation) ? d.jobLocation[0] : d.jobLocation || {}).address || {};
    // The Amharic title is often in brackets after the English one. Split only on a clearly Ethiopic
    // bracket - "(re-advertised)" is not a second title.
    const raw = unescapeEntities(String(d.title || '')).replace(/\s+/g, ' ').trim()
      .replace(cfg.stripTitle || /(?!)/g, '').trim();
    const m = /^(.*?)\s*[\(（]\s*([ሀ-፿][^)）]*)[\)）]\s*$/.exec(raw);
    const title = (m ? m[1] : raw).trim();
    if (!title || !org.name) return null;

    // A board that puts ITSELF in hiringOrganization.sameAs is telling us where the advert lives, not
    // where the company lives. Storing it would give 900 employers the same "website".
    let site = typeof org.sameAs === 'string' ? org.sameAs.trim() : null;
    try {
      if (site && new URL(site).hostname.replace(/^www\./, '') === new URL(url).hostname.replace(/^www\./, '')) site = null;
    } catch (e) { site = null; }

    // "2026-10-02                    T21:00" - their template pads the value with whitespace.
    const through = String(d.validThrough || '').replace(/\s+/g, '');
    const deadline = through ? new Date(through) : null;

    // employmentType arrives as FULL_TIME, "Full-time", or a list of both.
    const et = String(Array.isArray(d.employmentType) ? d.employmentType[0] : d.employmentType || '')
      .toUpperCase().replace(/[\s-]/g, '_');
    const sal = d.baseSalary && d.baseSalary.value ? d.baseSalary.value : null;
    const low = Number(sal && (sal.minValue ?? sal.value)) || 0;
    const high = Number(sal && sal.maxValue) || 0;

    const body = cleanHtml(unescapeEntities(String(d.description || '')));
    return {
      title, titleAm: m ? m[2].trim() : null,
      employer: unescapeEntities(String(org.name)).replace(/\s+/g, ' ').trim(),
      website: site,
      // The street address belongs to the EMPLOYER, not the vacancy - it is how the company profile
      // fills itself in, which is the whole point of linking every job to a company.
      address: String(place.streetAddress || '').replace(/\s+/g, ' ').replace(/\s+ET$/, '').trim().slice(0, 240) || null,
      // Some themes copy the whole street address into addressLocality - directions and all - which
      // then becomes a "city" nobody can filter by. When the locality is really an address, the region
      // is the city; it is stated on the advert, so this is reading the data, not guessing at it.
      city: (() => {
        const loc = String(place.addressLocality || '').replace(/\s+/g, ' ').trim();
        const region = String(place.addressRegion || '').replace(/\s+/g, ' ').trim();
        const localityIsAddress = loc.length > 40 || (place.streetAddress && loc === String(place.streetAddress).replace(/\s+/g, ' ').trim());
        if (localityIsAddress) return region || 'Addis Ababa';
        return loc || region || 'Addis Ababa';
      })(),
      jobType: TYPE_MAP[et] || null,
      // A salary range of 0-0 is the theme's empty state, not an offer of nothing.
      // Some boards publish their salary SLIDER's range on every advert (geezjobs: 5,000-100,000
      // on a cleaner's post and on a manager's). A number that is the same everywhere is not a
      // salary, and publishing it would misrepresent what the employer offered.
      salary: (!cfg.dropSalary && (low > 0 || high > 0))
        ? [low, high].filter(Boolean).join(' – ') + ' ' + (sal.currency || d.baseSalary.currency || 'ETB')
        : null,
      summary: (textOf(body).slice(0, 280) || title),
      bodyHtml: body || null,
      deadline: deadline && !isNaN(deadline.getTime()) ? deadline : null,
      publishedAt: d.datePosted ? new Date(d.datePosted) : new Date(),
      sourceUrl: url, sourceName,
    };
  }
  return null;
}

async function harvest(key, { dry = false, limit = 0, log = console.log } = {}) {
  const site = SITES[key];
  if (!site) throw new Error('unknown site: ' + key + ' (have: ' + Object.keys(SITES).join(', ') + ')');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { findOrCreateEmployer, uniqueJobSlug } = require('./publish')({ prisma });
  const { cleanCity } = require('./publish');
  const { saveLogo } = require('./logo-file');
  const parse = site.parse || parseJsonLd;

  try {
    // A source we read through its own public API: no sitemap, no page fetching, and the adapter hands
    // back listings in the same shape the HTML parsers produce, so everything below is shared.
    if (site.apiFetch) {
      const found = await site.apiFetch({ limit, maxAgeDays: site.maxAgeDays, log });
      log('[' + key + '] ' + found.length + ' vacancies read from the API');
      const have = new Set((await prisma.job.findMany({ where: { sourceName: site.name }, select: { sourceUrl: true } })).map(j => j.sourceUrl));
      const fresh = found.filter(j => !have.has(j.sourceUrl));
      log('[' + key + '] ' + fresh.length + ' not seen before');
      let made = 0, skipped = 0, failed = 0;
      for (const j of fresh) {
        if (dry) {
          log('\n--- ' + j.title + (j.titleAm ? ' · ' + j.titleAm : ''));
          log('    employer : ' + j.employer + (j.employerLogo ? '  [logo]' : ''));
          log('    city     : ' + j.city + (j.salary ? ' · ' + j.salary : ''));
          log('    deadline : ' + (j.deadline ? j.deadline.toISOString().slice(0, 10) : '(none stated)'));
          made++; continue;
        }
        try {
          j.city = cleanCity(j.city);
          const emp = await findOrCreateEmployer(j.employer, { city: j.city, website: j.website });
          // The company's own logo, offered by the source alongside the advert.
          if (j.employerLogo) {
            const cur = await prisma.employer.findUnique({ where: { id: emp.id }, select: { logoUrl: true, slug: true } });
            if (cur && !cur.logoUrl) {
              const saved = await saveLogo(j.employerLogo, cur.slug);
              if (saved) await prisma.employer.update({ where: { id: emp.id }, data: { logoUrl: saved } });
            }
          }
          const since = new Date(Date.now() - 120 * 86400000);
          const twin = await prisma.job.findFirst({ where: { employerId: emp.id, title: j.title, publishedAt: { gte: since } } });
          if (twin) { skipped++; continue; }
          await prisma.job.create({ data: {
            slug: await uniqueJobSlug(j.title + '-' + j.employer),
            title: j.title, titleAm: j.titleAm, employerId: emp.id, city: j.city, jobType: j.jobType,
            category: require('./categories').categorise(j.title, j.summary),
            salary: j.salary || null, summary: j.summary, bodyHtml: j.bodyHtml,
            howToApply: j.howToApply || null, deadline: j.deadline, publishedAt: j.publishedAt,
            sourceUrl: j.sourceUrl, sourceName: j.sourceName,
          } });
          made++;
          if (made % 25 === 0) log('  published ' + made);
        } catch (e) { failed++; log('  !! ' + j.title + ': ' + String(e.message).slice(0, 120)); }
      }
      log('[' + key + '] ' + (dry ? 'would publish ' : 'published ') + made + ', already held ' + skipped + ', failed ' + failed);
      return { made, skipped, failed };
    }

    let urls = [];
    const maps = site.sitemaps || (site.sitemap ? [site.sitemap] : []);
    if (maps.length) {
      // Newest first, and old adverts left alone. A sitemap is in the site's order, not ours: read from
      // the top of an eight-year archive and the first thousand pages we fetch are vacancies that closed
      // in 2019 - their bandwidth and our time spent filling the board with the past.
      const seen = [];
      for (const sm of maps) {
        const xml = await get(sm);
        if (!xml) { log('[' + key + '] could not read ' + sm); continue; }
        for (const block of xml.split(/<url>/).slice(1)) {
          const loc = (/<loc>([^<]+)<\/loc>/.exec(block) || [])[1];
          if (!loc) continue;
          const mod = (/<lastmod>([^<]+)<\/lastmod>/.exec(block) || [])[1];
          seen.push({ loc, at: mod ? Date.parse(mod) || 0 : 0 });
        }
        await sleep(600);
      }
      seen.sort((a, b) => b.at - a.at);
      const oldest = site.maxAgeDays ? Date.now() - site.maxAgeDays * 86400000 : 0;
      urls = seen.filter(x => !oldest || !x.at || x.at >= oldest).map(x => x.loc);
      if (!urls.length) return { made: 0, skipped: 0, failed: 1 };
    } else if (site.list) {
      const html = await get(site.list);
      if (!html) { log('[' + key + '] could not read the list page'); return { made: 0, skipped: 0, failed: 1 }; }
      urls = [...html.matchAll(/href="([^"#?]+)"/g)].map(m => new URL(m[1], site.list).toString());
    }
    urls = [...new Set(urls.filter(u => site.jobPath.test(u)))];
    log('[' + key + '] ' + urls.length + ' job urls listed');
    if (!urls.length) return { made: 0, skipped: 0, failed: 0 };

    const rob = await robotsAllows(urls[0]);
    if (!rob.ok) { log('[' + key + '] STOPPED: ' + rob.why); return { made: 0, skipped: 0, failed: 0, blocked: true }; }

    // The cheapest request is the one not made: skip what we already hold before fetching anything.
    const have = new Set((await prisma.job.findMany({ where: { sourceName: site.name }, select: { sourceUrl: true } })).map(j => j.sourceUrl));
    urls = urls.filter(u => !have.has(u));
    if (limit) urls = urls.slice(0, limit);
    log('[' + key + '] ' + urls.length + ' not seen before');

    let made = 0, skipped = 0, failed = 0, unreachable = 0;
    for (const url of urls) {
      let html = await get(url);
      await sleep(PACE_MS);
      // A board under sustained crawling starts refusing: the first full reporterjobs run lost 608 pages
      // this way and the log could not say why, because a failed fetch and an unparseable page were
      // counted the same. One patient retry recovers most of them, and the two failures are now
      // reported separately so the next person can see which one happened.
      if (!html) {
        await sleep(6000);
        html = await get(url);
        if (!html) { unreachable++; continue; }
      }
      const parsed = await parse(html, url, site.name, site);
      // A parser may return several listings from one page: some boards publish a company's whole
      // announcement as one post with five positions inside it, and five vacancies is what a job
      // seeker needs to see.
      const found = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
      if (!found.length) { failed++; continue; }

      for (const j of found) {
        if (dry) {
          log('\n--- ' + j.title + (j.titleAm ? ' · ' + j.titleAm : ''));
          log('    employer : ' + j.employer);
          log('    city/type: ' + j.city + (j.jobType ? ' · ' + j.jobType : ''));
          log('    deadline : ' + (j.deadline ? j.deadline.toISOString().slice(0, 10) : '(none stated)'));
          log('    apply    : ' + (j.howToApply ? j.howToApply.replace(/\n/g, ' ').slice(0, 70) : '(none)'));
          made++; continue;
        }
        try {
          j.city = cleanCity(j.city);
          const emp = await findOrCreateEmployer(j.employer, { city: j.city, website: j.website, address: j.address });
          // Same vacancy, any source and any date: employer + title, within the last four months.
          // The earlier rule keyed on the deadline too, and re-advertised posts ("Auditor II (Re
          // Advertise)") came back as second copies every time a company pushed the closing date out.
          // The owner's rule is simply: no duplicates. So a vacancy we already hold is UPDATED with the
          // later deadline rather than published again - the board shows one entry, with the date that
          // is still true.
          const since = new Date(Date.now() - 120 * 86400000);
          const twin = await prisma.job.findFirst({
            where: { employerId: emp.id, title: j.title, publishedAt: { gte: since } },
            orderBy: { publishedAt: 'desc' },
          });
          if (twin) {
            const later = j.deadline && (!twin.deadline || j.deadline > twin.deadline);
            if (later || (!twin.howToApply && j.howToApply)) {
              await prisma.job.update({ where: { id: twin.id }, data: {
                deadline: later ? j.deadline : twin.deadline,
                howToApply: twin.howToApply || j.howToApply || null,
                publishedAt: j.publishedAt > twin.publishedAt ? j.publishedAt : twin.publishedAt,
              } });
            }
            skipped++; continue;
          }
          await prisma.job.create({ data: {
            slug: await uniqueJobSlug(j.title + '-' + j.employer),
            title: j.title, titleAm: j.titleAm, employerId: emp.id, city: j.city, jobType: j.jobType,
            category: require('./categories').categorise(j.title, j.summary),
            salary: j.salary || null,
            summary: j.summary, bodyHtml: j.bodyHtml, howToApply: j.howToApply || null,
            imageUrl: j.imageUrl || null, deadline: j.deadline, publishedAt: j.publishedAt,
            sourceUrl: j.sourceUrl, sourceName: j.sourceName,
          } });
          made++;
          if (made % 25 === 0) log('  published ' + made);
        } catch (e) { failed++; log('  !! ' + j.title + ': ' + String(e.message).slice(0, 120)); }
      }
    }
    log('[' + key + '] ' + (dry ? 'would publish ' : 'published ') + made + ', already held ' + skipped
      + ', no job data ' + failed + ', could not fetch ' + unreachable);
    return { made, skipped, failed, unreachable };
  } finally { await prisma.$disconnect(); }
}

module.exports = { harvest, SITES, parseJsonLd, robotsAllows, UA };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const li = argv.indexOf('--limit');
  const limit = li > -1 ? Number(argv[li + 1]) || 0 : 0;
  const keys = argv.includes('--all') ? Object.keys(SITES) : argv.filter(a => !a.startsWith('--') && SITES[a]);
  if (!keys.length) {
    console.error('usage: jobs/harvest.js <' + Object.keys(SITES).join('|') + '|--all> [--dry-run] [--limit N]');
    process.exit(1);
  }
  (async () => { for (const k of keys) await harvest(k, { dry, limit }); })()
    .catch(e => { console.error('[harvest] failed: ' + e.message); process.exit(1); });
}
