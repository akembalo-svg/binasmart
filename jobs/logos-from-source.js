#!/usr/bin/env node
'use strict';
// Company logos taken from the advert the company itself posted.
//
//   node --env-file=.env jobs/logos-from-source.js --dry-run [--limit 20]
//   node --env-file=.env jobs/logos-from-source.js [--limit 300]
//
// jobs/fetch-logos.js can only help the ~9% of employers who published a website. Most Ethiopian
// companies on these boards have none - and the owner's point stands: a board of grey initials does not
// look like a real product.
//
// But the logo is usually there anyway: when a company posts a vacancy on a job board it uploads its
// logo, and the board publishes it in the advert's structured data (hiringOrganization.logo). That is
// the company's own mark, put there by the company. We copy it to our own server - never hotlink - and
// it belongs to the EMPLOYER row, so it then appears on every vacancy that company ever posts.
//
// What this will not do: invent a logo, or borrow one from a company with a similar name. An employer we
// cannot find a mark for keeps the monogram, which is honest.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'logos');
const PACE_MS = 1200;
const MAX_BYTES = 600 * 1024;
const MIN_BYTES = 700;
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; employer logo for the listing; contact https://t.me/Bina_smart)';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, binary) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: binary ? 'image/*' : 'text/html' } });
    if (!r.ok) return null;
    if (!binary) return await r.text();
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return { buf: Buffer.from(await r.arrayBuffer()), type };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// The logo the company uploaded with its advert. A board's own placeholder ("no-image", "default") is
// not a logo - publishing one would put the same grey square on fifty different companies.
const PLACEHOLDER = /(no[-_]?image|no[-_]?logo|placeholder|default[-_]?(logo|image)|avatar[-_]?default|company[-_]?default)/i;

function logoFrom(html) {
  for (const m of String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let d;
    try { d = JSON.parse(m[1]); } catch (e) {
      try { d = JSON.parse(m[1].replace(/[\u0000-\u001f]/g, ' ')); } catch (e2) { continue; }
    }
    const flat = Array.isArray(d) ? d : (Array.isArray(d['@graph']) ? d['@graph'] : [d]);
    const job = flat.find(x => x && x['@type'] === 'JobPosting');
    const logo = job && job.hiringOrganization && job.hiringOrganization.logo;
    const url = typeof logo === 'string' ? logo : (logo && logo.url);
    if (url && !PLACEHOLDER.test(url)) return url;
  }
  return null;
}

// Boards serve a thumbnail ("-150x150"); the original sits beside it and prints better.
const biggerFirst = u => [u.replace(/-\d+x\d+(\.\w+)$/, '$1'), u];

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  fs.mkdirSync(DIR, { recursive: true });

  // Employers with no logo, and the advert most likely to carry one.
  //
  // Which advert matters: only some boards publish hiringOrganization.logo. Picking a company's newest
  // advert blindly means fetching a thousand pages that were never going to have a mark on them, at
  // 1.2s each, mostly from the two boards that publish none. So each employer is traced through an
  // advert on a board that DOES carry logos, and employers with no such advert are not fetched at all.
  const LOGO_SOURCES = ['Ethiopian Reporter Jobs'];
  let targets = await prisma.$queryRawUnsafe(`
    SELECT e.id, e.slug, e.name, (
      SELECT j."sourceUrl" FROM "Job" j
       WHERE j."employerId" = e.id AND j."sourceUrl" IS NOT NULL
         AND j."sourceName" = ANY($1)
       ORDER BY j."publishedAt" DESC LIMIT 1) AS src
      FROM "Employer" e
     WHERE e."logoUrl" IS NULL
     ORDER BY e."name" ASC`, LOGO_SOURCES);
  targets = targets.filter(t => t.src);
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log('[logos] ' + targets.length + ' companies without a logo that we can trace to an advert');

  let got = 0, none = 0;
  for (const e of targets) {
    const html = await get(e.src, false);
    await sleep(PACE_MS);
    if (!html) { none++; continue; }
    const remote = logoFrom(html);
    if (!remote) { none++; continue; }

    let saved = null;
    for (const cand of biggerFirst(remote)) {
      const img = await get(cand, true);
      if (!img || !img.buf) continue;
      const ext = EXT[img.type];
      if (!ext || img.buf.length < MIN_BYTES || img.buf.length > MAX_BYTES) continue;
      saved = { ext, buf: img.buf, from: cand };
      break;
    }
    if (!saved) { none++; continue; }

    const rel = '/static/logos/' + e.slug + '.' + saved.ext;
    if (DRY) { got++; console.log('  ok ' + e.name + ' → ' + saved.from); continue; }
    fs.writeFileSync(path.join(DIR, e.slug + '.' + saved.ext), saved.buf);
    await prisma.employer.update({ where: { id: e.id }, data: { logoUrl: rel } });
    got++;
    if (got % 25 === 0) console.log('  ' + got + ' logos saved');
  }
  console.log('\n[logos] ' + (DRY ? 'would save ' : 'saved ') + got + ', none found for ' + none);
  await prisma.$disconnect();
})().catch(e => { console.error('[logos] failed: ' + e.message); process.exit(1); });
