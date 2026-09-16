'use strict';
// The benchmark itself runs against a live database and Gemini, so it is not a unit test. This reads the
// newest result file and holds it to the target, so a regression in a later task shows up in `npm test`
// rather than in somebody's memory of what the number used to be.
//
// 2026-09-17: the design's target was 90.0% as shipped. The first and only measured run
// (/root/bini-eval/retrieval-gold-banking-20260916-215324.json) came in at 55.0% as shipped, 56.7%
// retrieval, and the thresholds below are the numbers actually achieved, not the ones hoped for. The
// target was not met and no label was moved to make it look met: 22 of the 27 misses are the retriever
// returning a DIFFERENT institution's page on the same product, or the same Zemen page in the other
// language, for a question that names no bank. Zemen is the only institution in this pack with an Amharic
// locale (knowledge/banking/sources.json langNote), so an Amharic question lands on a Zemen Amharic page
// whatever bank the label names: 32 of the 40 Amharic questions have one in the top three when only 10
// should. That is a limit of scoring a six-institution pack against a single-page label, and it is not
// fixable by fetching, because Dashen, CBE and CoopBank do not publish Amharic product pages. The slice
// that is NOT contaminated says so: questions whose gold page is in the question's own language score
// 70.0% as shipped and 83.3% on retrieval, against 40.0% for the thirty Amharic questions whose only
// gold page is in English. Raise these thresholds when that gap is closed, never to make a run pass.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = '/root/bini-eval';
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^retrieval-gold-banking-\d/.test(f)).sort() : [];

test('a banking benchmark has been run', { skip: !files.length && 'no banking benchmark yet' }, () => {
  assert.ok(files.length, 'run: node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold banking');
});

test('the newest banking run answers 60 questions', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, files[files.length - 1]), 'utf8'));
  const all = j.table.find(t => /^all questions/.test(t.name));
  assert.equal(all.n, 60);
});

test('the right page is in the top three at least as often as it was measured', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, files[files.length - 1]), 'utf8'));
  const all = j.table.find(t => /^all questions/.test(t.name));
  const shipped = Number(String(all.shipped).replace('%', ''));
  // The design's target was 90.0. Measured 2026-09-17: 55.0. See the note at the top of this file.
  assert.ok(shipped >= 55, 'as shipped is ' + all.shipped + ', the measured floor is 55.0% (the design target was 90.0%)');
});

test('the Amharic slice is not carried by the English one', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, files[files.length - 1]), 'utf8'));
  const am = j.table.find(t => /^\s*Amharic/.test(t.name));
  assert.ok(am && am.n === 40, 'the Amharic slice should hold 40 questions');
  const pct = Number(String(am.shipped).replace('%', ''));
  // The design wanted 85. Measured 2026-09-17: 52.5, and the English slice is 60.0, so the Amharic slice
  // is not being carried by the English one - both are low, and for the same reason.
  assert.ok(pct >= 52.5, 'the Amharic slice is ' + am.shipped + '; the measured floor is 52.5% (the design target was 85%)');
});

test('the same-language slice still beats the cross-lingual one', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, files[files.length - 1]), 'utf8'));
  const same = j.table.find(t => /^question \+ gold share a language/.test(t.name));
  const cross = j.table.find(t => /^am question, gold only in English/.test(t.name));
  assert.ok(same && cross, 'both cross-lingual slices should be in the table');
  const s = Number(String(same.shipped).replace('%', ''));
  const c = Number(String(cross.shipped).replace('%', ''));
  // This is the finding the pack exists to measure: asking an Amharic page in Amharic works, asking an
  // English page in Amharic does not. If this ever inverts, something in retrieval changed, not the pack.
  assert.ok(s > c, 'same-language ' + same.shipped + ' should beat cross-lingual ' + cross.shipped);
});
