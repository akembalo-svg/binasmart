'use strict';
// knowledge/business joins law, health, eservices, mor, travel and banking as a CURATED source.
// Curated, not crawled: knowledge/web is the crawler's directory, is gitignored, and truncates every
// document at 20,000 characters.
//
// The two agent settings are as much the point of this file as the loading is, and they go in opposite
// directions. Dr Afiya must never see it - the 2026-09-14 gap audit measured the etrade BUSINESS licence
// checker answering "is this clinic licensed?", which is a patient sent to the wrong register. Asmat must
// see it, because a trade-licence renewal is paperwork and paperwork is his job.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { readSources, PACK_SOURCES } = require(path.join(ROOT, 'knowledge', 'index.js'));
// readSources(root, only) takes the list of sources itself, not an options object - knowledge/index.js:172,
// `const want = s => !only || only.includes(s)`. The plan wrote it as { only: [...] }, which every source
// silently passes, so the assertions would have run against the whole corpus instead of this pack.

test('business is a pack source, and its default language is Amharic', () => {
  const row = PACK_SOURCES.find(([s]) => s === 'business');
  assert.ok(row, 'business is not in PACK_SOURCES');
  assert.equal(row[1], 'am', 'motri is 43% Ethiopic and poessa 62%; the importer only ever demotes am to en');
});

test('readSources loads the business pack', () => {
  const docs = readSources(ROOT, ['business']);
  assert.ok(docs.length >= 60, 'expected at least 60 business documents, got ' + docs.length);
  for (const d of docs) {
    assert.equal(d.source, 'business');
    assert.ok(d.slug && !d.slug.endsWith('.md'), 'bad slug: ' + d.slug);
    assert.ok(/^https:\/\//.test(d.url || ''), d.slug + ' has no url');
    assert.ok(['en', 'am'].includes(d.lang), d.slug + ' lang: ' + d.lang);
    assert.ok(d.text.length > 400, d.slug + ' is too short to be worth indexing');
  }
});

test('a document marked gone is not loaded', () => {
  const dir = path.join(ROOT, 'knowledge', 'business');
  const gone = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    .filter(f => /^status: "gone"$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map(f => f.replace(/\.md$/, ''));
  const slugs = new Set(readSources(ROOT, ['business']).map(d => d.slug));
  for (const g of gone) assert.equal(slugs.has(g), false, g + ' is marked gone but was loaded');
});

test('the business pack is not truncated the way a crawled page is', () => {
  for (const d of readSources(ROOT, ['business']))
    assert.notEqual(d.text.length, 20000, d.slug + ' is exactly 20000 characters, which means truncation');
});

test('Dr Afiya cannot see the business pack', () => {
  const rules = require(path.join(ROOT, 'agents', 'afiya', 'rules.js'));
  assert.ok(rules.knowledge.exclude.includes('business'), 'afiya must exclude business');
  // and must still exclude everything she already did
  for (const s of ['travel', 'banking', 'mor', 'page', 'skill', 'llms'])
    assert.ok(rules.knowledge.exclude.includes(s), 'afiya lost her exclusion of ' + s);
  for (const g of ['guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia'])
    assert.ok(rules.knowledge.exclude.includes(g), 'afiya lost her exclusion of ' + g);
});

// The plan wrote this test expecting Asmat to PREFER the pack, and gated that preference on his v3-agents
// slice: down by even one question and the entry comes out. It was down by one question of 57, measured on one
// corpus of 23,430 chunks on 2026-09-17 - 84.2% retrieval and 89.5% as shipped with the preference against
// 86.0% and 91.2% without it - so the test follows the measurement, which is the whole point of having gated
// it. agents/asmat/rules.js carries all three readings, including that excluding the pack and simply not
// preferring it measure identically.
test('Asmat does not prefer the business pack, because it cost him a question', () => {
  const rules = require(path.join(ROOT, 'agents', 'asmat', 'rules.js'));
  assert.equal(rules.knowledge.prefer.includes('business'), false, 'the gate of Task 6 Step 5 took it out');
  assert.ok(rules.knowledge.exclude.includes('business'), 'and the plan says it goes into exclude instead');
  for (const s of ['law', 'guide', 'eservices', 'mor', 'news:law-*', 'web:justice/*'])
    assert.ok(rules.knowledge.prefer.includes(s), 'asmat lost his preference for ' + s);
  // and he still excludes the two packs that are not his
  for (const s of ['travel', 'banking'])
    assert.ok(rules.knowledge.exclude.includes(s), 'asmat lost his exclusion of ' + s);
});

test('the owner agent has no knowledge at all, so nothing to exclude', () => {
  const rules = require(path.join(ROOT, 'agents', 'owner', 'rules.js'));
  assert.equal(rules.knowledge, false);
});

test('loading every source still works and business is in it', () => {
  const sources = new Set(readSources(ROOT).map(d => d.source));
  for (const s of ['law', 'health', 'eservices', 'mor', 'travel', 'banking', 'business', 'guide', 'page'])
    assert.ok(sources.has(s), 'missing source: ' + s);
});
