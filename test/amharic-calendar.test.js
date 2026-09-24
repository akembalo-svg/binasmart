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
// The dating rule used to live in the banking pack's guardrails and was asserted here against them. It said
// the same thing as the business pack's, and between the two of them it only ever reached a message one of
// the two packs claimed — so a labour-law or overseas-employment question was never told to date anything,
// which the Ministry of Labour audit of 2026-09-18 measured as 10 of 40 answers carrying a date. It is in
// assistant/dating.js now and in the base prompt for every message; the assertions follow it there.
const { DATING } = require('../assistant/dating');

const ROOT = path.join(__dirname, '..');
// Bini's Amharic style guide is private (.gitignore); these run where it is deployed and skip elsewhere.
const HAS_STYLE = fs.existsSync(path.join(ROOT, 'knowledge', 'amharic-style.md'));

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

test('the Amharic voice rules Bini is sent with every message state the calendar rule', { skip: !HAS_STYLE && 'knowledge/amharic-style.md is private (.gitignore) and not in this checkout' }, () => {
  const v = voiceBlock(ROOT, 'am');
  assert.ok(v.includes('እ.ኤ.አ.'), 'the Gregorian marker is named');
  assert.ok(/ዓ\.ም\./.test(v) && /2018/.test(v), 'and so is the one case where ዓ.ም. is right');
  assert.ok(/Gregorian/i.test(v), 'the rule says which calendar a document date is in');
});

test('and they tell an Amharic answer to name its document in the first reply', { skip: !HAS_STYLE && 'knowledge/amharic-style.md is private (.gitignore) and not in this checkout' }, () => {
  const v = voiceBlock(ROOT, 'am');
  assert.ok(/first reply/i.test(v), 'not when asked — in the first reply');
  assert.ok(v.includes('FCP/01/2020'), 'with the form a directive number takes');
});

test('the shared rule says a fetched date is Gregorian, in both halves', () => {
  assert.match(DATING, /A FETCHED DATE IS A GREGORIAN DATE/);
  assert.ok(DATING.includes('እ.ኤ.አ. ሴፕቴምበር 16 ቀን 2026'), 'the form of words is given, with the Gregorian month');
  // 2026-09-18: the example used to be "እ.ኤ.አ. መስከረም 16 ቀን 2026" — the Ethiopian month, which is ten days off
  // (መስከረም 16 is 26 September) and taught the model "እ.ኤ.አ. ነሐሴ 8 ቀን 2025" for 14 August 2025.
  assert.ok(!/እ\.ኤ\.አ\.\s*(?:በ\d{1,2}\s*)?መስከረም\s*\d/.test(DATING.replace(/"እ\.ኤ\.አ\. መስከረም 16" is a wrong date|«እ\.ኤ\.አ\. መስከረም 16» ስህተት ነው/g, '')),
    'no example pairs the Gregorian marker with an Ethiopian month');
  assert.ok(DATING.includes('ጃንዋሪ ፌብሩዋሪ ማርች ኤፕሪል ሜይ ጁን ጁላይ ኦገስት ሴፕቴምበር ኦክቶበር'), 'the Gregorian months are named');
  assert.ok(DATING.includes('ኦገስት፣ ሴፕቴምበር፣ ኦክቶበር'), 'in the Amharic half too');
  assert.match(DATING, /NEVER write "ዓ\.ም\." after a Gregorian year/);
  assert.ok(DATING.includes('2018 ዓ.ም.'), 'and the one case where the Ethiopian marker is right');
  assert.ok(/ከግሪጎሪያን ዓመት ቀጥሎ/.test(DATING), 'the Amharic half carries the same rule');
  assert.match(DATING, /NEVER write "E\.C\." after one either/, 'the Latin marker is the same mistake');
  // Measured on 2026-09-18, the same day the rule moved into the shared prompt: an English answer copied
  // the old example "16 September 2026 (እ.ኤ.አ.)" and put an Amharic marker in an English sentence. The
  // example only ever reached banking answers until then.
  assert.ok(!DATING.includes('16 September 2026 (እ.ኤ.አ.)'), 'the example that taught English to use the Amharic marker is gone');
  assert.match(DATING, /In an English\s+answer write "16 September 2026" with no marker at all/);
});

test('the shared rule asks every answer to name its document in the first reply', () => {
  assert.match(DATING, /NAME THE DOCUMENT IN THE FIRST ANSWER, IN WHATEVER LANGUAGE YOU ARE WRITING/);
  assert.ok(DATING.includes('FCP/01/2020'), 'by its number, with the form it takes in Amharic');
  assert.match(DATING, /Never state a rule and hold\s+the source back until you are asked/);
  assert.ok(/በመጀመሪያው መልስ ውስጥ ጥቀስ/.test(DATING), 'and the Amharic half says it in Amharic');
});

test('an English answer that stamps a Gregorian year E.C. is corrected in English', () => {
  // Measured 2026-09-18, question 38 of the Ministry of Labour run: "fetched on 2011 E.C." — the Ethiopian
  // marker on what was meant to be a fetch date. The marker is the same mistake in either script, and the
  // correction is written in the script the mistake was written in.
  const r = fixCalendarMarker('The page was fetched in 2026 E.C.', 'Source: https://mols.gov.et/ fetched 2026-09-17');
  assert.equal(r.fixed, 1);
  assert.ok(r.text.includes('2026 (Gregorian)'), 'an English sentence gets an English marker, got ' + r.text);
  assert.ok(!/E\.C/.test(r.text), 'and the Ethiopian one is gone');
  // A year the Ethiopian calendar is actually in is never touched, in either script.
  assert.deepEqual(fixCalendarMarker('published in 2011 E.C.', ''), { text: 'published in 2011 E.C.', fixed: 0 });
});
