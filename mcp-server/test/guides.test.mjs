import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { htmlToText, titleOf, descriptionOf } from '../lib/html.mjs';
import { loadGuides } from '../tools/guides.mjs';

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
