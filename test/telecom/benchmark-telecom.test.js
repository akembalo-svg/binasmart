'use strict';
// The benchmark itself runs against a live database and Gemini, so it is not a unit test. This reads the
// newest result file and holds it to what was measured, so a regression shows up in `npm test` rather than in
// somebody's memory of what the number used to be.
//
// 2026-09-22: the first and second runs of the 60-question gold set (knowledge/telecom/gold-spec.json) on
// 27,819 chunks were identical in every slice (retrieval-gold-telecom-20260922-002458.json and -002602.json):
//   slice                            n   retrieval   as shipped
//   all                             60   96.7        96.7
//   Amharic                         40   95.0        95.0
//   English                         20   100.0       100.0
//   same language                   45   100.0       97.8
//   Amharic question, English page  15   86.7        93.3
// The floors below are those figures minus ONE question (the margin), and the shipped floors are then judged
// with the one-question slack of test/lib/benchmark-floor.js - so a shipped column two questions under the
// measurement passes and three under fails. Retrieval (`plain`) is deterministic and is held to its floor exactly.
// No floor is above what was measured, and none was moved to make a run pass. The cross-lingual gap that
// banking showed at first (43.8 / 50.0) does not appear here because the ECA laws and the Safaricom pages are
// English-only documents whose distinctive words (directive numbers, Safaricom, VoLTE) survive translation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shippedFloor } = require('../lib/benchmark-floor');

const DIR = '/root/bini-eval';
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^retrieval-gold-telecom-\d/.test(f)).sort() : [];
const newest = () => JSON.parse(fs.readFileSync(path.join(DIR, files[files.length - 1]), 'utf8'));
const row = (j, re) => j.table.find(t => re.test(t.name));
const pct = v => Number(String(v).replace('%', ''));
const skip = !files.length && 'no telecom benchmark yet';

test('a telecom benchmark has been run', { skip }, () => {
  assert.ok(files.length, 'run: node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold telecom');
});

test('the newest telecom run answers 60 questions', { skip }, () => {
  assert.equal(row(newest(), /^all questions/).n, 60);
});

test('the whole set is at or above 95 per cent, retrieval and as shipped', { skip }, () => {
  const all = row(newest(), /^all questions/);
  assert.ok(shippedFloor(all, 95.0), 'as shipped is ' + all.shipped + '; two runs measured 96.7');
  assert.ok(pct(all.plain) >= 95.0, 'retrieval is ' + all.plain + '; two runs measured 96.7');
});

test('the Amharic slice is at or above 92.5 per cent', { skip }, () => {
  const am = row(newest(), /^\s*Amharic/);
  assert.ok(am && am.n === 40, 'the Amharic slice should hold 40 questions');
  assert.ok(shippedFloor(am, 92.5), 'Amharic is ' + am.shipped + '; two runs measured 95.0');
  assert.ok(pct(am.plain) >= 92.5, 'Amharic retrieval is ' + am.plain + '; two runs measured 95.0');
});

test('the English slice is at or above 95 per cent', { skip }, () => {
  const s = row(newest(), /^\s*English/);
  assert.ok(s && s.n === 20, 'the English slice should hold 20 questions');
  assert.ok(shippedFloor(s, 95.0), 'English is ' + s.shipped + '; two runs measured 100.0');
  assert.ok(pct(s.plain) >= 95.0, 'English retrieval is ' + s.plain + '; two runs measured 100.0');
});

test('the same-language slice is at or above 95.6 per cent', { skip }, () => {
  const s = row(newest(), /share a language/);
  assert.ok(s && s.n === 45, 'the same-language slice should hold 45 questions (25 am on am pages + 20 en)');
  assert.ok(shippedFloor(s, 95.6), 'same-language is ' + s.shipped + '; two runs measured 97.8');
  assert.ok(pct(s.plain) >= 97.8, 'same-language retrieval is ' + s.plain + '; two runs measured 100.0');
});

test('the cross-lingual slice is at or above 86.7 per cent as shipped', { skip }, () => {
  const s = row(newest(), /am question, gold only in English/);
  assert.ok(s && s.n === 15, 'the cross-lingual slice should hold 15 questions');
  assert.ok(shippedFloor(s, 86.7), 'cross-lingual is ' + s.shipped + '; two runs measured 93.3. A fall towards banking\'s 50 means ops/packs/am-headers.js has not run');
  assert.ok(pct(s.plain) >= 80.0, 'cross-lingual retrieval is ' + s.plain + '; two runs measured 86.7');
});

test('same-language retrieval is not below cross-lingual', { skip }, () => {
  const j = newest();
  const same = row(j, /share a language/), cross = row(j, /am question, gold only in English/);
  assert.ok(pct(same.plain) >= pct(cross.plain), 'same-language ' + same.plain + ' vs cross-lingual ' + cross.plain);
});
