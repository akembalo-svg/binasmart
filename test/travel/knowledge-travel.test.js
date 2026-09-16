'use strict';
// The travel pack as a knowledge source. Two things must hold that are easy to get silently wrong: a long
// page must be indexed whole (the crawler's loader truncates at 20,000 characters and a conditions-of-
// carriage page is longer than that), and a page the airline has removed must stop being an answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSources } = require('../../knowledge/index');

function root(files) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'travelsrc-'));
  fs.mkdirSync(path.join(r, 'knowledge', 'travel'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(r, 'knowledge', 'travel', name), body);
  return r;
}
const doc = (extra, body) => '---\nurl: "https://www.ethiopianairlines.com/et/x"\n' +
  'title: "Ethiopian Airlines — Free Baggage Allowance"\nsource_name: "Ethiopian Airlines"\nlang: "en"\n' + extra + '---\n' + body + '\n';

test('a travel document is loaded with its title, url and language', () => {
  const r = root({ 'a.md': doc('status: "live"\n', 'Maximum weight: 50 lbs (23 kg).') });
  const docs = readSources(r, ['travel']);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'travel');
  assert.equal(docs[0].slug, 'a');
  assert.equal(docs[0].title, 'Ethiopian Airlines — Free Baggage Allowance');
  assert.equal(docs[0].url, 'https://www.ethiopianairlines.com/et/x');
  assert.equal(docs[0].lang, 'en');
  assert.ok(docs[0].text.includes('23 kg'));
});

test('travel defaults to English, because the airline publishes no Amharic page', () => {
  const r = root({ 'a.md': '---\nurl: "https://x/y"\ntitle: "t"\n---\n' + 'body text long enough to be real.\n' });
  assert.equal(readSources(r, ['travel'])[0].lang, 'en');
});

test('a travel document is indexed whole, never truncated at 20,000 characters', () => {
  const long = 'Article 1. The carrier is not liable beyond the stated limit. '.repeat(600);   // ~37,000 chars
  const r = root({ 'conditions.md': doc('status: "live"\n', long) });
  const d = readSources(r, ['travel'])[0];
  assert.ok(d.text.length > 30000, 'truncated to ' + d.text.length);
});

test('a page the airline removed is not loaded, so it stops being an answer', () => {
  const r = root({
    'live.md': doc('status: "live"\n', 'This page is still on the airline site.'),
    'gone.md': doc('status: "gone"\ngoneAt: "2026-09-23"\n', 'This page was removed from the airline site.'),
  });
  const docs = readSources(r, ['travel']);
  assert.deepEqual(docs.map(d => d.slug), ['live']);
});

test('a document with no front matter is skipped rather than indexed as raw text', () => {
  const r = root({ 'bad.md': 'no front matter here at all\n' });
  assert.deepEqual(readSources(r, ['travel']), []);
});

test('asking for another source does not load travel, and travel does not load the others', () => {
  const r = root({ 'a.md': doc('status: "live"\n', 'body text long enough to be real.') });
  assert.deepEqual(readSources(r, ['law']), []);
  assert.equal(readSources(r, ['travel']).length, 1);
});
