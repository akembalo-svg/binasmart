#!/usr/bin/env node
'use strict';
// GCC Domestic's Ethiopia articles, as BinaSmart knowledge documents.
//
//   node ops/knowledge/gcc-to-md.js            write knowledge/gcc/*.md
//   node ops/knowledge/gcc-to-md.js --dry-run  print what it would write, write nothing
//
// Why this exists: on 2026-09-20 the assistant log showed the same questions failing over and over —
// "list five licensed overseas employment agencies from the Ministry register", "my sister is in
// trouble with her employer in Dubai, who do I contact", the Ministry's phone number. Bini had no
// answer. gccdomestic.com — the same owner's other platform — had published those answers months ago.
// The facts were not missing; they were in another database. This copies the Ethiopia-relevant ones in.
//
// Scope, deliberately narrow: only articles about ETHIOPIAN workers going to, or working in, the Gulf,
// plus the worker-rights guides that carry the labour authorities' hotlines. gccdomestic has hundreds of
// other posts written for Gulf employers (visa renewal in Abu Dhabi, retaining a housemaid); they would
// bury a worker's question under an employer's. The Arabic editions are skipped too: Bini answers in
// Amharic, English and Afaan Oromoo, and an Arabic copy of the same article only dilutes retrieval.
//
// Each document keeps its own url, so an answer built from it cites gccdomestic and a reader can check
// the original. Nothing here is rewritten, summarised or "improved" — a fact about a worker's rights is
// quoted from what was published or not carried at all.

// Reads through the mysql client rather than a driver: gccdomestic is a Laravel/MySQL app and this repo
// is Postgres/Prisma. Adding a MySQL driver to a live Node service to copy fifteen articles once a month
// is a dependency nobody would defend later. JSON_OBJECT gives one parseable row per line.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DRY = process.argv.includes('--dry-run');
const OUT = path.join(__dirname, '..', '..', 'knowledge', 'gcc');
const BACKEND_ENV = '/var/www/gccdomestic/backend/.env';
const BASE = 'https://www.gccdomestic.com/en/blog/';

// The slug list is written out rather than pattern-matched, so adding an article is a deliberate act and
// a reviewer can see exactly what Bini was given. Checked 2026-09-20: all fifteen exist and none is Arabic.
const SLUGS = [
  'domestic-worker-rights-amharic-guide-2026',
  'gulf-domestic-worker-jobs-amharic-guide-2026',
  'ethiopia-lmis-gcc-agencies-register-recruit-domestic-workers-2026',
  'gcc-agency-ethiopia-deployment-process-a-to-z-2026',
  'hiring-ethiopian-housemaid-gcc-2026',
  'ethiopian-maid-uae-hiring-guide-2026',
  'ethiopian-maid-saudi-arabia-2026',
  'ethiopian-maid-kuwait-2026',
  'ethiopian-maid-qatar-2026',
  'ethiopian-maid-bahrain-2026',
  'ethiopian-maid-oman-2026',
  'domestic-worker-rights-oman-2026',
  'domestic-worker-rights-saudi-arabia-2026',
  'know-your-rights-saudi-law-protection-for-domestic-workers',
  'empowering-domestic-workers-in-dubai-know-your-rights',
];

function envValue(key) {
  const line = fs.readFileSync(BACKEND_ENV, 'utf8').split('\n').find(l => l.startsWith(key + '='));
  if (!line) throw new Error(key + ' not found in ' + BACKEND_ENV);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8217': '’', '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—' };
function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENT[e] !== undefined) return ENT[e];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (/^#/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return m;
  });
}

// The articles are stored as HTML. Headings and lists carry the structure a reader needs, so they become
// markdown; everything else becomes plain lines.
function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<(script|style|iframe|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => '\n\n' + '#'.repeat(Math.min(Number(n) + 1, 6)) + ' ' + t + '\n\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  return s.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const langOf = text => (/[ሀ-፿]/.test(text) ? 'am' : 'en');
const yaml = s => '"' + String(s == null ? '' : s).replace(/"/g, '\\"') + '"';

(async () => {
  const inList = SLUGS.map(s => "'" + s.replace(/'/g, "''") + "'").join(',');
  const sql = `SELECT JSON_OBJECT('slug', slug, 'title', title, 'content', content, 'canonical_url', canonical_url) AS j
               FROM posts WHERE slug IN (${inList})`;
  const out = execFileSync('mysql', ['--batch', '--raw', '--skip-column-names',
    '-u', envValue('DB_USERNAME'), '-p' + envValue('DB_PASSWORD'), envValue('DB_DATABASE'), '-e', sql],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // --raw keeps the content bytes intact; each line is one JSON object, and a newline inside a value is
  // escaped by JSON_OBJECT, so splitting on newlines is safe here.
  const rows = out.split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));

  const found = new Set(rows.map(r => r.slug));
  const missing = SLUGS.filter(s => !found.has(s));
  if (missing.length) console.log('[gcc] NOT FOUND, skipped: ' + missing.join(', '));

  if (!DRY) fs.mkdirSync(OUT, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let written = 0;
  const keep = new Set();
  for (const r of rows) {
    const text = htmlToText(r.content || '');
    if (text.length < 400) { console.log('[gcc] too short, skipped: ' + r.slug); continue; }
    const lang = langOf(text);
    const url = r.canonical_url || (BASE + r.slug + '/');
    const head = ['---',
      'title: ' + yaml(r.title || r.slug),
      'source_name: ' + yaml('GCC Domestic (gccdomestic.com), published article'),
      'url: ' + yaml(url),
      'lang: ' + yaml(lang),
      'fetched: ' + yaml(today),
      'generated_by: ' + yaml('ops/knowledge/gcc-to-md.js'),
      'source_note: ' + yaml('Written and published by GCC Domestic, the same owner\'s platform for Gulf domestic-worker recruitment. Copied here unchanged so Bini can answer an Ethiopian worker\'s question with what that platform already states publicly. Figures, fees and hotline numbers are as published there - confirm on the url before acting.'),
      '---', ''].join('\n');
    const file = path.join(OUT, r.slug + '.md');
    keep.add(r.slug + '.md');
    if (DRY) { console.log('[gcc] would write ' + r.slug + '.md (' + lang + ', ' + text.length + ' chars)'); continue; }
    fs.writeFileSync(file, head + '# ' + (r.title || r.slug) + '\n\n' + text + '\n');
    written++;
  }
  // A file this script wrote before but did not write this run is an article dropped from the list, and
  // it should leave the index at the next ingest. A file it never wrote is somebody's hand-written
  // document (gulf-labour-hotlines.md is one) and deleting it would be this script quietly destroying
  // work it does not own - so the test is the generated_by line, not "is it in my list".
  if (!DRY) {
    for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.md'))) {
      if (keep.has(f)) continue;
      let head = ''; try { head = fs.readFileSync(path.join(OUT, f), 'utf8').slice(0, 800); } catch (e) { continue; }
      if (!head.includes('generated_by: "ops/knowledge/gcc-to-md.js"')) { console.log('[gcc] left alone (hand-written): ' + f); continue; }
      fs.unlinkSync(path.join(OUT, f)); console.log('[gcc] removed ' + f + ' (no longer in the list)');
    }
  }
  console.log('[gcc] ' + (DRY ? 'would write ' : 'wrote ') + (DRY ? rows.length : written) + ' document(s) to knowledge/gcc/');
})().catch(e => { console.error('[gcc] failed: ' + e.message); process.exit(1); });
