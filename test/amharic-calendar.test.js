'use strict';
// Two defects the banking 15c close-out found in the ANSWER layer, not in the pack, on 2026-09-17.
//
//   1. "ከመስከረም 16 ቀን 2026 ዓ.ም." — the Gregorian fetch date 2026-09-16 written with `ዓ.ም.`, the marker that
//      means the Ethiopian year. The Ethiopian calendar runs seven to eight years behind, so to the reader
//      that line named a date nobody meant, on the one sentence whose whole job was to say how current the
//      rule is. Every dated Amharic citation was affected, not one answer.
//   2. The Amharic answer gave the right rule and the right escalation and named no directive and no date,
//      while the English answer named Banking Business Proclamation No. 1360/2025 unprompted. Asked where
//      the rule came from, the Amharic answer produced FCP/01/2020 at once — so the Source line was in the
//      Amharic context all along and the gap was in the answer.
//
// The prompt is the first half of each fix and a prompt is probabilistic, so the calendar marker also has a
// deterministic rewrite in assistant/grounding.js. Both halves are pinned here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fixCalendarMarker } = require('../assistant/grounding');
const { voiceBlock } = require('../knowledge');
const { GUARDRAILS } = require('../assistant/banking');

const ROOT = path.join(__dirname, '..');

test('a Gregorian year marked ዓ.ም. has its marker rewritten, and the date itself is untouched', () => {
  const said = 'ይህ መረጃ የተወሰደው ከመስከረም 16 ቀን 2026 ዓ.ም. በኢትዮጵያ ብሔራዊ ባንክ ድረ-ገጽ ላይ ከታተመ ሰነድ ነው።';
  const page = 'ምንጭ፦ https://nbe.gov.et/... የተወሰደበት ቀን 2026-09-16';
  const r = fixCalendarMarker(said, page);
  assert.equal(r.fixed, 1);
  assert.ok(!/ዓ\.ም/.test(r.text), 'the Ethiopian marker is gone');
  assert.ok(r.text.includes('እ.ኤ.አ.'), 'and the Gregorian one is there instead');
  assert.ok(r.text.includes('መስከረም 16 ቀን 2026'), 'the date itself is not rewritten, only the calendar it claims');
});

test('an Ethiopian year the source itself writes is left exactly as it stands', () => {
  const said = 'አዋጁ በ2029 ዓ.ም. ተሻሽሏል።';
  const page = 'አዋጁ በ2029 ዓ.ም. የተሻሻለ ነው።';   // the document itself writes that year as an Ethiopian year
  const r = fixCalendarMarker(said, page);
  assert.equal(r.fixed, 0, 'nothing invented the marker, so nothing is rewritten');
  assert.equal(r.text, said);
});

test('a year below 2020 is not touched at all — that is where Ethiopian years live', () => {
  const said = 'ሰነዱ በ2018 ዓ.ም. ታትሟል።';
  assert.deepEqual(fixCalendarMarker(said, ''), { text: said, fixed: 0 });
});

test('the marker only binds to the year next to it', () => {
  // in "2026 እና 2018 ዓ.ም." the marker belongs to 2018; rewriting 2026 would be a new error
  const said = 'በ2026 እና በ2018 ዓ.ም. መካከል።';
  assert.equal(fixCalendarMarker(said, '').fixed, 0);
});

test('the slash form ዓ/ም is rewritten too, and a clean answer passes through', () => {
  assert.equal(fixCalendarMarker('መስከረም 16 ቀን 2026 ዓ/ም', '').text.includes('እ.ኤ.አ.'), true);
  const clean = 'እ.ኤ.አ. መስከረም 16 ቀን 2026 ላይ የታተመ።';
  assert.deepEqual(fixCalendarMarker(clean, ''), { text: clean, fixed: 0 });
});

test('the rewrite runs on the two paths an answer can leave by', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/fixCalendarMarker/.test(server), 'Bini writes most of the Amharic there');
  const engine = fs.readFileSync(path.join(ROOT, 'assistant', 'kit', 'engine.js'), 'utf8');
  assert.ok(/fixCalendarMarker/.test(engine), 'and every kit agent gets the same filter');
});

test('the Amharic voice rules Bini is sent with every message state the calendar rule', () => {
  const v = voiceBlock(ROOT, 'am');
  assert.ok(v.includes('እ.ኤ.አ.'), 'the Gregorian marker is named');
  assert.ok(/ዓ\.ም\./.test(v) && /2018/.test(v), 'and so is the one case where ዓ.ም. is right');
  assert.ok(/Gregorian/i.test(v), 'the rule says which calendar a document date is in');
});

test('and they tell an Amharic answer to name its document in the first reply', () => {
  const v = voiceBlock(ROOT, 'am');
  assert.ok(/first reply/i.test(v), 'not when asked — in the first reply');
  assert.ok(v.includes('FCP/01/2020'), 'with the form a directive number takes');
});

test('the banking guardrail says a fetched date is Gregorian, in both halves', () => {
  assert.match(GUARDRAILS, /A FETCHED DATE IS A GREGORIAN DATE/);
  assert.ok(GUARDRAILS.includes('እ.ኤ.አ. መስከረም 16 ቀን 2026'), 'the form of words is given');
  assert.match(GUARDRAILS, /NEVER write "ዓ\.ም\." after a Gregorian year/);
  assert.ok(GUARDRAILS.includes('2018 ዓ.ም.'), 'and the one case where the Ethiopian marker is right');
  assert.ok(/ከግሪጎሪያን ዓመት ቀጥሎ/.test(GUARDRAILS), 'the Amharic half carries the same rule');
});

test('the banking guardrail asks an Amharic answer to name the directive unprompted', () => {
  assert.match(GUARDRAILS, /NAME THE DOCUMENT IN THE FIRST ANSWER, IN WHATEVER LANGUAGE YOU ARE WRITING/);
  assert.ok(GUARDRAILS.includes('FCP/01/2020'), 'by its number, with the form it takes in Amharic');
  assert.match(GUARDRAILS, /Never state a rule in Amharic and hold\s+the source back until you are asked/);
  assert.ok(/በመጀመሪያው መልስ ውስጥ ጥቀስ/.test(GUARDRAILS), 'and the Amharic half says it in Amharic');
});
