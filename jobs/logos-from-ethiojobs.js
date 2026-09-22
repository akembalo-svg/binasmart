#!/usr/bin/env node
'use strict';
// Company logos for the employers that came from ethiojobs.
//
//   node --env-file=.env jobs/logos-from-ethiojobs.js --dry-run [--limit 20]
//   node --env-file=.env jobs/logos-from-ethiojobs.js [--limit 500]
//
// Most of our employers arrived from ethiojobs, whose job pages carry no logo - so the advert-based
// reader (jobs/logos-from-source.js) can do nothing for them. Their COMPANY sitemap can: it lists 5,310
// companies and, for each, the logo image the company itself uploaded, as <image:loc>. One 2MB file
// instead of 5,310 page fetches.
//
// The matching rule is the part to be careful about. A logo is a claim about who is hiring, and the
// wrong one is worse than none: a bank's mark on another bank's vacancy is a lie we published. So the
// company's name is taken from its page title (the sitemap's slug alone is lossy: "zoa", "oxfam-great-
// britain-1"), normalised through jobs/publish.js - the same normaliser the employer matching uses - and
// only an EXACT normalised match is accepted. A name that matches two different companies is skipped.
const fs = require('fs');
const path = require('path');

const SITEMAP = 'https://ethiojobs.net/sitemap-companies.xml';
const DIR = path.join(__dirname, '..', 'public', 'logos');
const PACE_MS = 350;                   // images only, from their CDN
const MAX_BYTES = 700 * 1024;
const MIN_BYTES = 700;
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; employer logo for the listing; contact https://t.me/Bina_smart)';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
// Their own stand-in, not a company's mark: 1,434 of the 5,310 companies point at the same
// /Image/seo/companies.jpg. Publishing it would put one identical grey picture on a quarter of the
// board and call it a logo. Any image shared by several companies is refused for the same reason.
const PLACEHOLDER = /(no[-_]?image|no[-_]?logo|placeholder|default[-_]?(logo|image)|company[-_]?default|\/Image\/seo\/)/i;

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, binary, timeout = 60000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: binary ? 'image/*' : 'application/xml' } });
    if (!r.ok) return null;
    if (!binary) return await r.text();
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return { buf: Buffer.from(await r.arrayBuffer()), type };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// The company name as ethiojobs writes it in the slug. Their slugs end in a disambiguating number
// ("oxfam-great-britain-1") which is theirs, not part of the name.
const nameFromSlug = slug => slug.replace(/-\d+$/, '').replace(/-/g, ' ').trim();

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { normName } = require('./publish');
  fs.mkdirSync(DIR, { recursive: true });

  const xml = await get(SITEMAP, false);
  if (!xml) { console.error('[logos] could not read the company sitemap'); process.exit(1); }

  // name → image, and any name that appears twice is dropped rather than guessed at.
  const byName = new Map(); const ambiguous = new Set(); const shared = new Map();
  for (const block of xml.split('<url>').slice(1)) {
    const loc = (/<loc>\s*([^<\s]+)/.exec(block) || [])[1];
    const img = (/<image:loc>\s*([^<\s]+)/.exec(block) || [])[1];
    if (!loc || !img || PLACEHOLDER.test(img)) continue;
    const slug = (loc.match(/\/companies\/([^/?#]+)/) || [])[1];
    if (!slug) continue;
    const key = normName(nameFromSlug(slug));
    if (!key) continue;
    if (byName.has(key) && byName.get(key) !== img) { ambiguous.add(key); continue; }
    byName.set(key, img);
    shared.set(img, (shared.get(img) || 0) + 1);
  }
  for (const k of ambiguous) byName.delete(k);
  // "Picture1.png", "logo.png", "images.png" - generic uploads that several companies happen to share.
  let dropped = 0;
  for (const [k, img] of byName) if (shared.get(img) > 1) { byName.delete(k); dropped++; }
  if (dropped) console.log('[logos] ' + dropped + ' companies dropped: their image is shared with another company');
  console.log('[logos] ethiojobs lists ' + byName.size + ' companies with a logo (' + ambiguous.size + ' ambiguous names skipped)');

  let employers = await prisma.employer.findMany({ where: { logoUrl: null }, select: { id: true, slug: true, name: true } });
  const matched = employers
    .map(e => ({ e, img: byName.get(normName(e.name)) }))
    .filter(x => x.img);
  console.log('[logos] ' + matched.length + ' of our ' + employers.length + ' logo-less employers match by name');

  const work = LIMIT ? matched.slice(0, LIMIT) : matched;
  let got = 0, bad = 0;
  for (const { e, img } of work) {
    if (DRY) { console.log('  ok ' + e.name + ' → ' + img.slice(0, 90)); got++; continue; }
    const r = await get(img, true, 25000);
    await sleep(PACE_MS);
    const ext = r && EXT[r.type];
    if (!r || !ext || r.buf.length < MIN_BYTES || r.buf.length > MAX_BYTES) { bad++; continue; }
    fs.writeFileSync(path.join(DIR, e.slug + '.' + ext), r.buf);
    await prisma.employer.update({ where: { id: e.id }, data: { logoUrl: '/static/logos/' + e.slug + '.' + ext } });
    got++;
    if (got % 50 === 0) console.log('  ' + got + ' logos saved');
  }
  console.log('\n[logos] ' + (DRY ? 'would save ' : 'saved ') + got + ', unusable ' + bad);
  await prisma.$disconnect();
})().catch(e => { console.error('[logos] failed: ' + e.message); process.exit(1); });
