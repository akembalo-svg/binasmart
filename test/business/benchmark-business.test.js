'use strict';
// The benchmark runs against a live database and Gemini, so it is not a unit test. This reads the newest
// result file and holds it to the design's targets, so a regression in a later task shows up in `npm test`
// rather than in somebody's memory of what the number used to be.
//
// THE TARGETS ARE PER SLICE AND THE WHOLE-SET ONE IS NOT 90 PERCENT. Measured on the banking pack,
// 2026-09-17: 86.2% when a question and its gold page share a language, 43.8% when they do not. A single
// 90% target would be a promise the corpus cannot keep, and the honest thing is five numbers.
//
// RAISE THESE FLOORS WHEN THE GAP CLOSES. NEVER LOWER ONE TO MAKE A RUN PASS.
//
// WHAT THE FLOORS BELOW ARE, AND WHY THEY ARE NOT THE PLAN'S NUMBERS. The plan set 72/85/50/80/68 from the
// banking pack's experience. Two runs of the 60-question business set on an identical corpus of 23,430
// chunks (2026-09-17, /root/bini-eval/retrieval-gold-business-20260917-203034.json and -203310.json)
// measured far higher, so the floors are raised to what was measured, never to what was hoped:
//
//   slice                              run 1              run 2            floor pinned
//   all questions            95.0 / 91.7        95.0 / 90.0        95.0 retrieval, 90.0 shipped
//   Amharic (40)             97.5 / 92.5        97.5 / 90.0        97.5 retrieval, 90.0 shipped
//   English (20)             90.0 / 90.0        90.0 / 90.0        90.0 retrieval, 90.0 shipped
//   share a language (44)    95.5 / 93.2        95.5 / 90.9        95.5 retrieval, 90.9 shipped
//   cross-lingual (16)       93.8 / 87.5        93.8 / 87.5        93.8 retrieval, 87.5 shipped
//
// SHIPPED FLOORS RAISED 2026-09-22, after the reranker was given 1000 characters of each passage instead of 420
// (knowledge/index.js RERANK_CHARS). Two runs on an identical corpus of 27,810 chunks
// (/root/bini-eval/retrieval-gold-business-20260922-104526.json and -104638.json) measured the same thing twice:
//   all 96.7 / 96.7   Amharic 97.5 / 97.5   English 95.0 / 95.0   same-language 97.7 / 97.7   cross-lingual 93.8 / 93.8
// (retrieval / shipped). The reranker now drops 1 gold page (bz-045) where it dropped 8. Each shipped floor below is
// that measured value; shippedFloor() still allows one question of reranker variance under it.
//
// RETRIEVAL WAS IDENTICAL IN BOTH RUNS, every slice, so the retrieval floors are pinned at the exact
// measured value. Only `shipped` moved, by one question: bz-018 survived the reranker in run 1 and was
// dropped in run 2. That is the same reranker variance the travel and banking packs recorded, so every
// `shipped` floor is the LOWER of the two runs.
//
// The cross-lingual number is the surprise of this pack and is worth saying out loud: 87.5 per cent, where
// banking measured 43.8 and the plan's floor was 50. The 16 cross-lingual questions here name an
// institution, a park, an agency or a figure that appears nowhere else, and every English document in the
// pack carries an Amharic key-fact header from ops/packs/am-headers.js. Banking's cross-lingual questions
// competed with fourteen other banks saying the same thing in the same words. Supply of Amharic pages is
// not the only thing that decides a cross-lingual score; how distinctive the answer is decides it too.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shippedFloor } = require('../lib/benchmark-floor');

const DIR = '/root/bini-eval';
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^retrieval-gold-business-\d/.test(f)).sort() : [];
const newest = () => JSON.parse(fs.readFileSync(path.join(DIR, files[files.length - 1]), 'utf8'));
const row = (j, re) => j.table.find(t => re.test(t.name));
const pct = v => Number(String(v).replace('%', ''));
const skip = !files.length && 'no business benchmark yet';

test('a business benchmark has been run', { skip }, () => {
  assert.ok(files.length, 'run: node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold business');
});

test('the newest business run answers 60 questions', { skip }, () => {
  assert.equal(row(newest(), /^all questions/).n, 60);
});

test('the whole set is at or above 96.7 per cent as shipped', { skip }, () => {
  const all = row(newest(), /^all questions/);
  assert.ok(shippedFloor(all, 96.7),
    'as shipped is ' + all.shipped + '; two runs with RERANK_CHARS 1000 measured 96.7 and 96.7 (85.0 with the old 420)');
  assert.ok(pct(all.plain) >= 95,
    'retrieval is ' + all.plain + '; both runs measured exactly 95.0% on 23,430 chunks');
});

test('the same-language slice is at or above 97.7 per cent', { skip }, () => {
  const s = row(newest(), /share a language/);
  assert.ok(s, 'the benchmark must report the same-language slice');
  assert.ok(s.n === 44, 'the same-language slice should hold 44 questions (24 am on am pages + 20 en)');
  assert.ok(shippedFloor(s, 97.7),
    'same-language is ' + s.shipped + '; two runs with RERANK_CHARS 1000 measured 97.7 and 97.7');
  assert.ok(pct(s.plain) >= 95.5, 'same-language retrieval is ' + s.plain + '; both runs measured 95.5%');
});

test('the cross-lingual slice is at or above 93.8 per cent', { skip }, () => {
  const s = row(newest(), /am question, gold only in English/);
  assert.ok(s, 'the benchmark must report the cross-lingual slice');
  assert.ok(s.n === 16, 'the cross-lingual slice should hold 16 questions; the spec measured 16 before the run');
  assert.ok(shippedFloor(s, 93.8),
    'cross-lingual is ' + s.shipped + '; two runs with RERANK_CHARS 1000 measured 93.8% (87.5 before it), against banking 43.8/50.0 and a plan floor of 50. '
    + 'A fall towards 50 means ops/packs/am-headers.js has not run, or has run and failed - check that before touching anything else');
  assert.ok(pct(s.plain) >= 93.8, 'cross-lingual retrieval is ' + s.plain + '; both runs measured 93.8%');
});

test('the English slice is at or above 95 per cent', { skip }, () => {
  const s = row(newest(), /^\s*English/);
  assert.ok(s && s.n === 20, 'the English slice should hold 20 questions');
  assert.ok(shippedFloor(s, 95), 'English is ' + s.shipped + '; two runs with RERANK_CHARS 1000 measured 95.0%');
  assert.ok(pct(s.plain) >= 90, 'English retrieval is ' + s.plain + '; both runs measured 90.0%');
});

test('the Amharic slice is not carried by the English one', { skip }, () => {
  const am = row(newest(), /^\s*Amharic/);
  assert.ok(am && am.n === 40, 'the Amharic slice should hold 40 questions');
  assert.ok(shippedFloor(am, 97.5), 'the Amharic slice is ' + am.shipped
    + '; two runs with RERANK_CHARS 1000 measured 97.5 and 97.5 (92.5 and 90.0 before it), and the plan floor was 68. Below 90 the pack is answering English and not Amharic');
  assert.ok(pct(am.plain) >= 97.5, 'Amharic retrieval is ' + am.plain + '; both runs measured 97.5%');
});

test('same-language beats cross-lingual, which is the fact the targets are built on', { skip }, () => {
  const j = newest();
  const same = row(j, /share a language/), cross = row(j, /am question, gold only in English/);
  assert.ok(pct(same.shipped) > pct(cross.shipped),
    'if cross-lingual ever beats same-language, something changed that this plan did not predict; measure before celebrating');
});
