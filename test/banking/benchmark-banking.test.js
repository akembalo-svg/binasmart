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
//
// 2026-09-17, Task 10b: the gap was narrowed, so the floors below are raised - to what a measured run
// achieved, and not one tenth of a point further. Every English document of the pack now carries an
// Amharic title and an Amharic key-fact summary in its header, generated from that page's own text by
// ops/packs/am-headers.js and checked digit by digit against it. All 60: 66.7% retrieval, 61.7% as
// shipped. Amharic: 60.0% as shipped. The thirty Amharic questions whose only gold page is English went
// from 30.0% to 50.0% on retrieval; the ten on Amharic pages held at 90.0%. The design's 90.0% is still
// not met and the cross-lingual gap is still 23.3 points: an Amharic header is not an Amharic page.
//
// 2026-09-17, Task 15a: the National Bank of Ethiopia, telebirr and M-PESA were added to the pack (234
// documents to 404; the corpus 16,179 chunks to 18,611). The 60-question gold set, written before any of
// those pages existed, fell to 56.7% as shipped, and the two assertions below were LEFT RED rather than
// re-pinned inside the task that moved them.
//
// 2026-09-17, Task 15b: the floors move now, and here is exactly what moved them - none of it a threshold
// edited to make a run pass.
//   * The gold set went from 60 questions to 90. Batch 2 is 30 questions (20 Amharic, 10 English) on the
//     three new sources, each verified against the page's own body with the header and the disclaimer
//     stripped. It scores 93.3% / 93.3%, because fifteen of its twenty Amharic questions are answered by a
//     page that is itself in Amharic - which is the finding this pack exists to make, measured again.
//   * Two batch-1 labels were repaired (bk-004 and bk-028, both Amharic questions about receiving money
//     from abroad that named no institution and pointed at a bank's page while telebirr's own Amharic
//     remittance page answers them). Nothing else was retargeted: the other four questions the corpus
//     moved keep their labels and their misses. Batch 1 reads 60.0% / 61.7%.
//   * Retrieval was not touched by either task. hybridScore, the +0.06 tie-breaker, the reranker, the
//     embedding model and the chunking are exactly what they were.
// Measured twice, ten minutes apart, on 18,611 chunks - identical in every slice:
//   retrieval-gold-banking-20260917-052005.json and -053403.json
//   all 90        71.1% retrieval  72.2% as shipped
//   Amharic 60    65.0%            68.3%
//   English 30    83.3%            80.0%
//   same language 86.2%            84.5%      cross-lingual  43.8% / 50.0%
//   batch 1 (60)  60.0%            61.7%      batch 2 (30)   93.3% / 93.3%
// The design's 90.0% is met by batch 2 and not by the pack as a whole, and the cross-lingual gap is now
// 34.5 points on retrieval. Raise these thresholds when that gap is closed, never to make a run pass.
//
// 2026-09-17, Task 15c: 102 documents for the 99 National Bank directives that exist only as photographs
// entered the pack by OCR (404 documents to 506; the corpus 19,419 chunks to 22,326), and the gold set
// went from 90 questions to 110. Batch 3 is 20 questions (14 Amharic, 6 English) on the subjects those
// directives answer and the pack could not answer before: the complaint procedure and its time limit,
// fee disclosure, fraud reporting, the credit record, the currency directives, the payment-system rules
// and the 2025 banking proclamation.
// Measured on 22,326 chunks, twice, twenty-two minutes apart, identical in every slice but the third
// decimal of one MRR: retrieval-gold-banking-20260917-110428.json and -112648.json. The baseline is the
// run made on the same gold set immediately BEFORE the ingest, on 19,419 chunks:
// retrieval-gold-banking-20260917-103939.json.
//   slice            before (19,419)        after (22,326)
//   all 110          58.2 / 59.1            71.8 / 71.8
//   Amharic 74       52.7 / 55.4            64.9 / 67.6
//   English 36       69.4 / 66.7            86.1 / 80.6
//   same language    74.6 / 73.1            88.1 / 83.6
//   cross-lingual    32.6 / 37.2            46.5 / 53.5
//   batch 1 (60)     60.0 / 61.7            58.3 / 60.0
//   batch 2 (30)     93.3 / 93.3            90.0 / 90.0
//   batch 3 (20)      0.0 /  0.0            85.0 / 80.0
// Batch 3 went from nothing to 80.0% as shipped, which is the whole point of the task: those questions
// scored zero before because the documents that answer them were not in the pack at all.
// TWO SLICES FELL AND THE FLOORS BELOW FALL WITH THEM, which is why it is written here rather than
// averaged away: batch 1 lost 1.7 points as shipped (61.7 -> 60.0, one question) and batch 2 lost 3.3
// (93.3 -> 90.0, one question). 102 new documents on the same host now compete for the top three, so a
// question whose gold page was third can be fourth without anything in retrieval having changed -
// hybridScore, the +0.06 tie-breaker, the reranker, the embedding model and the chunking are untouched.
// The pack as a whole gained 12.7 points as shipped for those two questions. The floors are re-pinned to
// the measured numbers, DOWN where the measurement went down; they are not held at the old values to
// pretend nothing moved, and not rounded up to make a later run pass.
//
// A THIRD run landed while this was being written - retrieval-gold-banking-20260917-123617.json, made by
// another session on 22,352 chunks - and it is why the shipped floors below are pinned LOWER than the two
// runs above. Across all three:
//   column                run 110428   run 112648   run 123617
//   all, retrieval          71.8         71.8         71.8
//   all, as shipped         71.8         71.8         70.9
//   English, as shipped     80.6         80.6         77.8
//   batch 1, as shipped     60.0         60.0         58.3
//   same language           83.6         83.6         82.1
// The retrieval column is identical in all three, question for question, including under the 26 extra
// chunks of the third run: retrieval is deterministic and nothing in it moved. The shipped column is a
// live reranker call and it moves by a question or two between runs, which is the same variance
// test/travel/benchmark-travel-floor.test.js describes on tv-015. So the shipped floors are pinned at the
// LOWEST of the three, and the deterministic retrieval floor is asserted separately below - a floor that
// only the best run clears is not a floor.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { shippedFloor } = require('../lib/benchmark-floor');

//
// 2026-09-17, bilingual query retrieval: the floors below did NOT move. The experiment is in the tree
// (KNOWLEDGE_BILINGUAL_QUERY, knowledge/index.js) and is off by default because of what it measured here —
// cross-lingual retrieval 43.8% -> 62.5%, but the whole pack as shipped 72.2% -> 70.0%, because the six
// Amharic questions it newly sends to an English page are six questions whose gold page was Amharic. See
// docs/superpowers/reports/2026-09-17-bilingual-query-retrieval.md. A run made with that flag on measures a
// configuration that does not ship, so it is skipped below rather than allowed to move a floor in either
// direction: runs written before the flag existed carry no `bilingual` block at all, and are shipped runs
// by definition.
const DIR = '/root/bini-eval';
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const shipped = j => !j.bilingual || j.bilingual.query === false;
const files = (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^retrieval-gold-banking-\d/.test(f)).sort() : [])
  .filter(f => { try { return shipped(read(f)); } catch (e) { return false; } });
const newest = () => read(files[files.length - 1]);
const pct = t => Number(String(t.shipped).replace('%', ''));

test('a banking benchmark has been run', { skip: !files.length && 'no banking benchmark yet' }, () => {
  assert.ok(files.length, 'run: node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold banking');
});

test('the newest banking run answers 110 questions', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const all = newest().table.find(t => /^all questions/.test(t.name));
  assert.equal(all.n, 110);
});

test('the right page is in the top three at least as often as it was measured', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const all = newest().table.find(t => /^all questions/.test(t.name));
  // The design's target was 90.0. Measured 2026-09-17: 55.0, then 61.7 with the Amharic headers, then
  // 56.7 when the corpus grew under a gold set that could not see the new sources, and 72.2 once that
  // gold set was extended to 90 questions. See the note at the top of this file.
  assert.ok(shippedFloor(all, 70.9), 'as shipped is ' + all.shipped + ', the measured floor is 70.9%, the lowest of three runs (the design target was 90.0%)');
  // Retrieval is deterministic - identical in all three runs - so it is pinned exactly, not loosely.
  assert.ok(Number(String(all.plain).replace('%', '')) >= 71.8, 'retrieval is ' + all.plain + ', the measured floor is 71.8%');
});

test('the Amharic slice is not carried by the English one', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const am = newest().table.find(t => /^\s*Amharic/.test(t.name));
  assert.ok(am && am.n === 74, 'the Amharic slice should hold 74 questions');
  // The design wanted 85. Measured 2026-09-17: 52.5, then 60.0 with the Amharic headers, then 68.3 with
  // batch 2 - whose Amharic questions are mostly answered by telebirr's own Amharic pages - against 80.0
  // for the English slice. Still not carried, and still short of the design.
  assert.ok(shippedFloor(am, 67.6), 'the Amharic slice is ' + am.shipped + '; the measured floor is 67.6% (the design target was 85%)');
});

test('the same-language slice still beats the cross-lingual one', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const j = newest();
  const same = j.table.find(t => /^question \+ gold share a language/.test(t.name));
  const cross = j.table.find(t => /^am question, gold only in English/.test(t.name));
  assert.ok(same && cross, 'both cross-lingual slices should be in the table');
  // This is the finding the pack exists to measure: asking an Amharic page in Amharic works, asking an
  // English page in Amharic does not. If this ever inverts, something in retrieval changed, not the pack.
  assert.ok(pct(same) > pct(cross), 'same-language ' + same.shipped + ' should beat cross-lingual ' + cross.shipped);
});

// The three batches are pinned separately because a single number over all of them hides which one moved:
// batch 1 is the set written before the National Bank, telebirr and M-PESA were in the pack, batch 2 the set
// written against them, batch 3 the set written against the directives that were only ever photographs.
test('all three batches are in the run, and each is pinned to what it measured', { skip: !files.length && 'no banking benchmark yet' }, () => {
  const j = newest();
  const b1 = j.table.find(t => t.name === 'batch 1');
  const b2 = j.table.find(t => t.name === 'batch 2');
  const b3 = j.table.find(t => t.name === 'batch 3');
  assert.ok(b1 && b2 && b3, 'the run should slice by batch (ops/bini/rerun-retrieval-benchmark.js)');
  assert.equal(b1.n, 60);
  assert.equal(b2.n, 30);
  assert.equal(b3.n, 20);
  // Both of these floors are LOWER than they were before Task 15c: batch 1 61.7 -> 58.3 and batch 2
  // 93.3 -> 90.0, measured before and after the same ingest on the same gold set. See the Task 15c note at
  // the top. They are pinned to the lowest of the three runs made on the new corpus, not to what was hoped
  // for and not to the run that read best.
  assert.ok(shippedFloor(b1, 58.3), 'batch 1 is ' + b1.shipped + ', the measured floor is 58.3% (was 61.7% before Task 15c)');
  // Batch 1 retrieval is 58.3% in all three runs, down from 60.0% before the ingest - one question.
  assert.ok(Number(String(b1.plain).replace('%', '')) >= 58.3, 'batch 1 retrieval is ' + b1.plain + ', the measured floor is 58.3%');
  // 90.0% is the design's 90.0% exactly, on the slice of this pack written against sources whose Amharic
  // pages exist. It is not a general claim about the pack, and it is 3.3 points below what it was.
  assert.ok(shippedFloor(b2, 90.0), 'batch 2 is ' + b2.shipped + ', the measured floor is 90.0% (was 93.3% before Task 15c)');
  // Batch 3 scored 0.0% on the pre-ingest baseline because none of its documents were in the pack yet.
  assert.ok(shippedFloor(b3, 80.0), 'batch 3 is ' + b3.shipped + ', the measured floor is 80.0% (0.0% before the OCR documents were ingested)');
});
