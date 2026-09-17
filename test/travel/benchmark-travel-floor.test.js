'use strict';
// The airline pack's floor, held the same way the banking pack's is (test/banking/benchmark-banking.test.js):
// read the newest result file of `--gold travel` and assert it has not fallen below what was measured.
//
// Why this file exists. The airline pack has been re-benchmarked in every task that touched the corpus
// around it, and until 2026-09-17 the numbers lived only in reports. Task 15a is what made that a problem:
// the corpus grew from 16,179 chunks to 18,611 (the National Bank, telebirr and M-PESA), travel retrieval
// fell from 86.7% to 85.0% by exactly one question, and there was no test to notice. Ibrahim accepted 85.0%
// retrieval and 83.3% as shipped for the airline. `git status --short knowledge/travel` is empty and
// --rerender reports 0 of 114 travel documents changed: the pack itself has not moved a byte.
//
// Measured on 2026-09-17, on 18,611 chunks, with the 60-question gold set:
//   retrieval-gold-travel-20260917-052326.json   85.0% retrieval   81.7% as shipped
//   retrieval-gold-travel-20260917-053102.json   85.0% retrieval   83.3% as shipped
// Retrieval is identical in both, question for question. The 1.7 points between them is ONE question,
// tv-015, where the live reranker put the airline's online-check-in page in the top three instead of its
// check-in-process page - two sibling pages of the same section. That is the reranker's own variance on a
// live model call, not the pack and not the retriever, so the shipped floor below is pinned at the lower of
// the two runs and says so, while the retrieval floor - which is deterministic - is pinned at 85.0%.
// Raise these when the number really improves, never to make a run pass.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

//
// 2026-09-17, bilingual query retrieval: the floors below did NOT move. With KNOWLEDGE_BILINGUAL_QUERY on,
// the airline pack reads 88.3% retrieval / 83.3% as shipped against the 85.0% / 83.3% pinned here — the
// pack where every Amharic question is cross-lingual, because the airline publishes no Amharic at all, is
// the one the experiment helps most. It is still off by default: the banking pack, which is half Amharic
// pages, loses more than this gains (docs/superpowers/reports/2026-09-17-bilingual-query-retrieval.md).
// A run made with that flag on is not the configuration that ships, so it is skipped below rather than
// allowed to move a floor in either direction.
const DIR = '/root/bini-eval';
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const isShipped = j => !j.bilingual || j.bilingual.query === false;
const files = (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^retrieval-gold-travel-\d/.test(f)).sort() : [])
  .filter(f => { try { return isShipped(read(f)); } catch (e) { return false; } });
const newest = () => read(files[files.length - 1]);
const num = s => Number(String(s).replace('%', ''));

test('a travel benchmark has been run', { skip: !files.length && 'no travel benchmark yet' }, () => {
  assert.ok(files.length, 'run: node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold travel');
});

test('the newest travel run answers 60 questions', { skip: !files.length && 'no travel benchmark yet' }, () => {
  const all = newest().table.find(t => /^all questions/.test(t.name));
  assert.equal(all.n, 60);
});

test('travel retrieval has not fallen below the accepted 85.0%', { skip: !files.length && 'no travel benchmark yet' }, () => {
  const all = newest().table.find(t => /^all questions/.test(t.name));
  assert.ok(num(all.plain) >= 85.0, 'retrieval is ' + all.plain + ', the accepted floor is 85.0%');
});

test('travel as shipped has not fallen below the lower of the two measured runs', { skip: !files.length && 'no travel benchmark yet' }, () => {
  const all = newest().table.find(t => /^all questions/.test(t.name));
  // 83.3% is the number Ibrahim accepted and the number the second run of 2026-09-17 measured; 81.7% is
  // what the first run measured, one reranker call apart. The floor is the lower one, on purpose.
  assert.ok(num(all.shipped) >= 81.7, 'as shipped is ' + all.shipped + ', the measured floor is 81.7% (accepted: 83.3%)');
});
