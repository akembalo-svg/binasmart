import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { htmlToText, titleOf, descriptionOf } from '../lib/html.mjs';
import { loadGuides, GUIDE_SLUGS } from '../tools/guides.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, 'fixtures');

test('htmlToText strips nav/script/style/footer and keeps headings, paragraphs, lists', async () => {
  const t = htmlToText(await readFile(path.join(fx, 'guide.html'), 'utf8'));
  assert.equal(t.includes('Home'), false);
  assert.equal(t.includes('console.log'), false);
  assert.equal(t.includes('color:red'), false);
  assert.equal(t.includes('© BinaSmart'), false);
  assert.match(t, /^# TIN registration/m);
  assert.match(t, /^## Documents/m);
  assert.match(t, /Bring your Fayda & a passport photo\./);
  assert.match(t, /^- Fayda ID\n- Photo/m);
  assert.match(t, /Free of charge\.\nTakes 1 day\./);
});

test('titleOf / descriptionOf', async () => {
  const html = await readFile(path.join(fx, 'guide.html'), 'utf8');
  assert.equal(titleOf(html), 'TIN — how to get one');
  assert.equal(descriptionOf(html), 'Ten-digit tax ID: documents, steps, fees.');
});

test('loadGuides reads slug.html files, skips missing ones, caps text', async () => {
  const guides = await loadGuides(fx, ['guide', 'does-not-exist'], 60);
  assert.equal(guides.size, 1);
  const g = guides.get('guide');
  assert.equal(g.title, 'TIN — how to get one');
  assert.equal(g.summary, 'Ten-digit tax ID: documents, steps, fees.');
  assert.equal(g.url, 'https://bina.et/guide');
  assert.ok(g.text.length <= 60 + 20, 'capped (plus the truncation marker)');
  assert.match(g.text, /…\[truncated\]$/);
});

// 2026-09-12. "The guides" is maintained by hand in three places — a route in server.js, a URL in the
// sitemap array, and GUIDE_SLUGS. Diffing them found ethiopia-income-tax-calculator published and
// indexed but absent here, so every assistant calling get_ethiopia_guide was blind to the PAYE bands.
test('every slug in GUIDE_SLUGS names a page that exists', async () => {
  const pub = path.join(here, '..', '..', 'public');
  const missing = [];
  for (const slug of GUIDE_SLUGS) {
    try { await readFile(path.join(pub, slug + '.html'), 'utf8'); } catch { missing.push(slug); }
  }
  assert.deepEqual(missing, [], 'GUIDE_SLUGS names pages that do not exist: ' + missing.join(', '));
});

// The specific gap, pinned. Someone tidying this list should have to delete this line on purpose.
test('the income-tax calculator is served to assistants', () => {
  assert.ok(GUIDE_SLUGS.includes('ethiopia-income-tax-calculator'),
    'it carries the 2025 PAYE bands and the 7% pension rate — a question assistants are asked constantly');
});

// And the one that looks like a gap but is not, so it does not get "fixed" back in.
test('diaspora stays out: it is a product page, not a guide to a public service', () => {
  assert.ok(!GUIDE_SLUGS.includes('diaspora'));
});
