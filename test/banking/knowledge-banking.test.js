'use strict';
// knowledge/banking joins law, health, eservices, mor and travel as a curated source. Curated, not crawled:
// knowledge/web is the crawler's directory, is gitignored, and truncates every document at 20,000 characters,
// which would cut Zemen's 16,000-character tariff off mid-table and CBE's 31,000-character one in half.
//
// The two exclusions are the point of this file as much as the loading is. Dr Afiya answers health questions
// and Asmat answers legal ones; neither should ever quote a bank's loan page, and both are at 96% and 100%
// on their own gold sets, which is a number this pack must not touch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { readSources } = require(path.join(ROOT, 'knowledge', 'index.js'));

test('readSources loads the banking pack', () => {
  const docs = readSources(ROOT, ['banking']);
  assert.ok(docs.length >= 80, 'expected at least 80 banking documents, got ' + docs.length);
  for (const d of docs) {
    assert.equal(d.source, 'banking');
    assert.ok(d.slug && !d.slug.endsWith('.md'), 'bad slug: ' + d.slug);
    assert.ok(/^https:\/\//.test(d.url || ''), d.slug + ' has no url');
    assert.ok(['en', 'am'].includes(d.lang), d.slug + ' lang: ' + d.lang);
    assert.ok(d.text.length > 400, d.slug + ' is too short to be worth indexing');
  }
});

test('a document marked gone is not loaded', () => {
  const dir = path.join(ROOT, 'knowledge', 'banking');
  const gone = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    .filter(f => /^status: "gone"$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map(f => f.replace(/\.md$/, ''));
  const slugs = new Set(readSources(ROOT, ['banking']).map(d => d.slug));
  for (const g of gone) assert.equal(slugs.has(g), false, g + ' is marked gone but was loaded');
});

test('the banking pack is not truncated the way a crawled page is', () => {
  const docs = readSources(ROOT, ['banking']);
  const big = docs.filter(d => d.text.length > 20000);
  assert.ok(big.length >= 1, 'at least one document (a tariff) should be longer than the crawler ceiling');
  for (const d of big) assert.notEqual(d.text.length, 20000, d.slug + ' is exactly 20000 characters, which means truncation');
});

test('Dr Afiya cannot see the banking pack', () => {
  const rules = require(path.join(ROOT, 'agents', 'afiya', 'rules.js'));
  assert.ok(rules.knowledge.exclude.includes('banking'), 'afiya must exclude banking');
  assert.ok(rules.knowledge.exclude.includes('travel'), 'and must still exclude travel');
});

test('Asmat cannot see the banking pack', () => {
  const rules = require(path.join(ROOT, 'agents', 'asmat', 'rules.js'));
  assert.ok(rules.knowledge.exclude.includes('banking'));
  assert.ok(rules.knowledge.exclude.includes('travel'));
});

test('the owner agent has no knowledge at all, so nothing to exclude', () => {
  const rules = require(path.join(ROOT, 'agents', 'owner', 'rules.js'));
  assert.equal(rules.knowledge, false);
});

test('loading every source still works and banking is in it', () => {
  const docs = readSources(ROOT);
  const sources = new Set(docs.map(d => d.source));
  for (const s of ['law', 'health', 'eservices', 'mor', 'travel', 'banking', 'guide', 'page'])
    assert.ok(sources.has(s), 'missing source: ' + s);
});
