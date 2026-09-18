'use strict';
// The date guard (assistant/dates.js): a date the answer marks as Gregorian must be in the sources or be the
// exact conversion of an Ethiopian date that is. Measured 2026-09-18: asked in Amharic when the 2025 overseas
// employment proclamation took effect, the model wrote "እ.ኤ.አ. ነሐሴ 8 ቀን 2025" — the Ethiopian day carried
// into a Gregorian date. The sources say ነሐሴ 8 ቀን 2017 ዓ.ም. = 14 August 2025.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ethToGreg, gregToEth, guardDates, fixGregorianDates, validEth } = require('../assistant/dates');
const grounding = require('../assistant/grounding');

const NOW = new Date('2026-09-18T08:00:00Z');
const g = (text, ctx, q) => guardDates(text, ctx, q || '', { now: NOW });

// ---------- the converter ----------
test('converter: the pairs the corpus and the published rule give', () => {
  // ነሐሴ 8 2017 E.C. = 14 August 2025 (knowledge/law/returnee-migrants-reintegration-support.md)
  assert.deepEqual(ethToGreg(2017, 12, 8), { y: 2025, m: 8, d: 14 });
  // Meskerem 1 2018 E.C. = 11 September 2025
  assert.deepEqual(ethToGreg(2018, 1, 1), { y: 2025, m: 9, d: 11 });
  // Wikipedia, Ethiopian calendar: E.C. 1992 and 1996 began on 12 September 1999 and 2003
  assert.deepEqual(ethToGreg(1992, 1, 1), { y: 1999, m: 9, d: 12 });
  assert.deepEqual(ethToGreg(1996, 1, 1), { y: 2003, m: 9, d: 12 });
});

test('converter: the 2019/2020 E.C. leap boundary', () => {
  assert.equal(validEth(2019, 13, 6), true, '2019 E.C. is a leap year: Pagume has 6 days');
  assert.equal(validEth(2018, 13, 6), false, '2018 E.C. is not');
  assert.deepEqual(ethToGreg(2019, 1, 1), { y: 2026, m: 9, d: 11 });
  assert.deepEqual(ethToGreg(2019, 13, 5), { y: 2027, m: 9, d: 10 });
  assert.deepEqual(ethToGreg(2019, 13, 6), { y: 2027, m: 9, d: 11 });
  assert.deepEqual(ethToGreg(2020, 1, 1), { y: 2027, m: 9, d: 12 }, 'the year before a Gregorian leap year starts on 12 September');
  assert.deepEqual(ethToGreg(2021, 1, 1), { y: 2028, m: 9, d: 11 });
  assert.equal(ethToGreg(2018, 13, 6), null);
});

test('converter: round trip, every day from 1990 to 2040', () => {
  const start = Date.UTC(1990, 0, 1), end = Date.UTC(2040, 11, 31);
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    const e = gregToEth(y, m, day);
    assert.ok(validEth(e.y, e.m, e.d));
    assert.deepEqual(ethToGreg(e.y, e.m, e.d), { y, m, d: day });
  }
});

// ---------- the guard ----------
const RETURNEE = '- **የሕግ ለውጥ፦** የቀድሞው የውጭ አገር ሥራ ስምሪት አዋጅ ቁጥር 923/2008 እና ማሻሻያው (1246/2013) ተሽረዋል። የተተኩት ከነሐሴ 8 ቀን 2017 ዓ.ም (ኦገስት 14 ቀን 2025) ጀምሮ በሥራ ላይ በዋለው አዋጅ ቁጥር 1389/2017 እንደሆነ ተዘግቧል።\nSource: https://mols.gov.et/ fetched 2026-09-16';

test('the 1389 case: the Ethiopian day carried into a Gregorian date is replaced by the conversion', () => {
  const said = 'የውጭ አገር ሥራ ስምሪት አዋጅ ቁጥር 1389/2025 በሥራ ላይ የዋለው እ.ኤ.አ. ነሐሴ 8 ቀን 2025 (በኢትዮጵያ አቆጣጠር ነሐሴ 8 ቀን 2017 ዓ.ም.) ነው።';
  const r = g(said, RETURNEE);
  assert.equal(r.text, 'የውጭ አገር ሥራ ስምሪት አዋጅ ቁጥር 1389/2025 በሥራ ላይ የዋለው እ.ኤ.አ. ኦገስት 14 ቀን 2025 (በኢትዮጵያ አቆጣጠር ነሐሴ 8 ቀን 2017 ዓ.ም.) ነው።');
  assert.deepEqual(r.changes, [{ before: 'ነሐሴ 8 ቀን 2025', after: 'ኦገስት 14 ቀን 2025' }]);
});

test('the 1389 case with only the Ethiopian date in the context: converted, not copied', () => {
  const ctx = 'አዋጅ ቁጥር 1389/2017 ከነሐሴ 8 ቀን 2017 ዓ.ም ጀምሮ በሥራ ላይ ውሏል።';
  const r = g('It came into force on 8 August 2025 (Nehase 8, 2017 E.C.).', ctx);
  assert.equal(r.text, 'It came into force on 14 August 2025 (Nehase 8, 2017 E.C.).');
});

test('a correct Gregorian date is left alone, in either script, whichever way it is grounded', () => {
  for (const said of ['አዋጁ እ.ኤ.አ. ኦገስት 14 ቀን 2025 በሥራ ላይ ውሏል።', 'It took effect on 14 August 2025.',
    'It took effect on August 14, 2025.', 'Effective 2025-08-14.']) {
    assert.deepEqual(g(said, RETURNEE), { text: said, changes: [] }, said);
    // grounded by conversion alone: the context prints only the Ethiopian date
    assert.deepEqual(g(said, 'ከነሐሴ 8 ቀን 2017 ዓ.ም ጀምሮ'), { text: said, changes: [] }, said);
  }
});

test('an Ethiopian-only date is left alone, even with nothing in the context', () => {
  const said = 'አዋጁ ከነሐሴ 8 ቀን 2017 ዓ.ም. ጀምሮ በሥራ ላይ ውሏል።';
  assert.deepEqual(g(said, ''), { text: said, changes: [] });
  assert.deepEqual(g('It took effect on Nehase 8, 2017 E.C.', ''), { text: 'It took effect on Nehase 8, 2017 E.C.', changes: [] });
});

test('a Gregorian date with no Ethiopian source and not in the context: only the Gregorian part is dropped', () => {
  const r = g('The proclamation took effect on 3 March 2024. Employers must register.', RETURNEE);
  assert.equal(r.text, 'The proclamation took effect. Employers must register.');
  assert.deepEqual(r.changes, [{ before: 'on 3 March 2024', after: '(dropped)' }]);
  // beside an Ethiopian date nothing grounds: the Ethiopian date stays, the bracketed Gregorian one goes
  const r2 = g('አዋጁ ነሐሴ 8 ቀን 2017 ዓ.ም. (እ.ኤ.አ. ነሐሴ 8 ቀን 2025) ጸድቋል።', 'no dates here');
  assert.equal(r2.text, 'አዋጁ ነሐሴ 8 ቀን 2017 ዓ.ም. ጸድቋል።');
});

// ---------- cases measured over the stored answers (2026-09-18) ----------
const LMIS = 'አዋጅ ቁጥር 1389/2017 ... ነሀሴ 8/2017 (14 August 2025)፤ ከታተመበት ቀን ጀምሮ ጸንቷል (አንቀጽ 89)። በሕዝብ ተወካዮች ም/ቤት ሰኔ 24/2017 በሙሉ ድምጽ ጸደቀ።';

test('measured: the Ethiopian date beside it carries no marker, and the context prints it as "ነሀሴ 8/2017"', () => {
  const said = 'አዋጅ ቁጥር 1389/2017 ሲሆን፣ እ.ኤ.አ. ነሐሴ 8 ቀን 2025 (በኢትዮጵያ አቆጣጠር ነሐሴ 8 ቀን 2017) ጸድቆ ሥራ ላይ ውሏል።';
  assert.equal(g(said, LMIS).text, 'አዋጅ ቁጥር 1389/2017 ሲሆን፣ እ.ኤ.አ. ኦገስት 14 ቀን 2025 (በኢትዮጵያ አቆጣጠር ነሐሴ 8 ቀን 2017) ጸድቆ ሥራ ላይ ውሏል።');
});

test('measured: the defect with no Ethiopian date beside it is still converted, in bold, both dates', () => {
  const said = 'አዋጁ እ.ኤ.አ **ነሐሴ 8 ቀን 2025** ታትሞ ጸንቷል፡፡ በሕዝብ ተወካዮች ም/ቤት እ.ኤ.አ **ሰኔ 24 ቀን 2025** ጸድቋል፡፡';
  const r = g(said, LMIS);
  // ሰኔ 24 2017 E.C. = 1 July 2025
  assert.equal(r.text, 'አዋጁ እ.ኤ.አ **ኦገስት 14 ቀን 2025** ታትሞ ጸንቷል፡፡ በሕዝብ ተወካዮች ም/ቤት እ.ኤ.አ **ጁላይ 1 ቀን 2025** ጸድቋል፡፡');
});

test('measured: a Gregorian date that is the exact conversion of the Ethiopian date beside it is kept', () => {
  const said = 'አዲሱ የጉምሩክ አዋጅ ቁጥር 1425/2018 ከሐምሌ 16 ቀን 2018 ዓ.ም. (እ.ኤ.አ. July 23, 2026) ጀምሮ ተፈጻሚነት አለው።';
  assert.deepEqual(g(said, RETURNEE), { text: said, changes: [] });
});

test('measured: an invented fetch date is dropped, the sentence kept', () => {
  const r = g("These details are from Dashen Bank's FAQ page, fetched on February 13, 2024 [1]. Check with ethio telecom.", 'Source: https://dashenbanksc.com/faq fetched 2026-09-16');
  assert.equal(r.text, "These details are from Dashen Bank's FAQ page, fetched [1]. Check with ethio telecom.");
  const bold = g('አዋጁ እ.ኤ.አ **ነሐሴ 3 ቀን 2025** ጸንቷል።', 'no dates');
  assert.equal(bold.text, 'አዋጁ ጸንቷል።');
  // measured (banking-manual t15a): no page in the knowledge base carries this date
  const glued = g('ንግድ ባንክ በ3 መስከረም 2026 ባሳተመው መረጃ መሰረት 7% ነው።', 'Source: https://combanketh.et/ fetched 2026-09-16');
  assert.equal(glued.text, 'ንግድ ባንክ ባሳተመው መረጃ መሰረት 7% ነው።');
});

test('measured: "ቁጥር 44/2013" is a directive number, not the month ጥር', () => {
  const said = 'ይህ መረጃ የመጣው ከሥራና ክህሎት ሚኒስቴር መመሪያ ቁጥር 44/2013 (እ.ኤ.አ.) ነው። ቁጥር 12 ቀን 2025 ላይ።';
  assert.deepEqual(g(said, ''), { text: said, changes: [] });
});

test('fetch dates, Source lines and years inside document numbers are untouched', () => {
  const said = 'Proclamation No. 1389/2025 and Proclamation No. 1156/2019 apply (Ministry of Labour and Skills, fetched 2026-09-16).\nSource: https://mols.gov.et/ fetched 2026-09-16';
  assert.deepEqual(g(said, RETURNEE), { text: said, changes: [] });
  const am = 'የሥራና ክህሎት ሚኒስቴር (እ.ኤ.አ. ሴፕቴምበር 16 ቀን 2026) እንዳሳተመው፣ አዋጅ ቁጥር 1156/2011 ዓ.ም. ተፈጻሚ ነው።';
  assert.deepEqual(g(am, RETURNEE), { text: am, changes: [] });
  const en = 'as published on 16 September 2026 by the Ministry.';
  assert.deepEqual(g(en, RETURNEE), { text: en, changes: [] });
});

test('English formats: "August 8, 2025", "8th of August 2025" and ISO are corrected in their own format', () => {
  const ctx = 'ከነሐሴ 8 ቀን 2017 ዓ.ም ጀምሮ';
  assert.equal(g('In force since August 8, 2025 (Nehase 8, 2017 E.C.).', ctx).text, 'In force since August 14, 2025 (Nehase 8, 2017 E.C.).');
  assert.equal(g('In force since the 8th of August 2025 (Nehase 8, 2017 E.C.).', ctx).text, 'In force since the 14 August 2025 (Nehase 8, 2017 E.C.).');
  assert.equal(g('In force since 2025-08-08 (Nehase 8, 2017 E.C.).', ctx).text, 'In force since 2025-08-14 (Nehase 8, 2017 E.C.).');
});

test('a date the user typed is grounded, and so is today', () => {
  const said = 'You wrote 5 May 2026; today is 18 September 2026.';
  assert.deepEqual(g(said, '', 'what happened on 5 May 2026?'), { text: said, changes: [] });
});

test('runs after fixCalendarMarker and does not undo it', () => {
  const ctx = 'Source: https://mols.gov.et/ fetched 2026-09-16';
  const cal = grounding.fixCalendarMarker('ከመስከረም 16 ቀን 2026 ዓ.ም. ጀምሮ', ctx);
  assert.equal(cal.fixed, 1);
  // the marker fix keeps the date; the date guard then gives it the Gregorian month, digits unchanged
  assert.equal(g(cal.text, ctx).text, cal.text.replace('መስከረም', 'ሴፕቴምበር'));
  assert.ok(g(cal.text, ctx).text.includes('(እ.ኤ.አ.)'));
});

test('a Source-line date written with the Ethiopian month gets the Gregorian month, digits kept', () => {
  const ctx = 'ምንጭ፦ https://mols.gov.et/ የተወሰደበት ቀን 2026-09-16';
  const r = g('የሥራና ክህሎት ሚኒስቴር እ.ኤ.አ. መስከረም 16 ቀን 2026 እንዳሳተመው፣ ክፍያው 500 ብር ነው።', ctx);
  assert.equal(r.text, 'የሥራና ክህሎት ሚኒስቴር እ.ኤ.አ. ሴፕቴምበር 16 ቀን 2026 እንዳሳተመው፣ ክፍያው 500 ብር ነው።');
  assert.deepEqual(r.changes, [{ before: 'መስከረም 16 ቀን 2026', after: 'ሴፕቴምበር 16 ቀን 2026' }]);
  assert.equal(g('እ.ኤ.አ. በ16 መስከረም 2026 እንደታተመው', ctx).text, 'እ.ኤ.አ. በ16 ሴፕቴምበር 2026 እንደታተመው');
  // an Ethiopian date the document prints with ዓ.ም. keeps its Ethiopian month
  assert.deepEqual(g('መስከረም 6 ቀን 2019 ዓ.ም.', ctx).changes, []);
});

test('fixGregorianDates logs before and after under the agent name', () => {
  const lines = [];
  const out = fixGregorianDates('እ.ኤ.አ. ነሐሴ 8 ቀን 2025 (ነሐሴ 8 ቀን 2017 ዓ.ም.)', RETURNEE, '', 'bini', m => lines.push(m));
  assert.equal(out, 'እ.ኤ.አ. ኦገስት 14 ቀን 2025 (ነሐሴ 8 ቀን 2017 ዓ.ም.)');
  assert.deepEqual(lines, ['[bini] corrected a Gregorian date: ነሐሴ 8 ቀን 2025 -> ኦገስት 14 ቀን 2025']);
  assert.equal(grounding.fixGregorianDates, fixGregorianDates, 'exported where fixCalendarMarker is');
});

test('wired wherever fixCalendarMarker runs, right after it', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const engine = fs.readFileSync(path.join(__dirname, '..', 'assistant', 'kit', 'engine.js'), 'utf8');
  for (const [name, src] of [['server.js', server], ['engine.js', engine]]) {
    const a = src.indexOf('fixCalendarMarker(t'), b = src.indexOf('fixCalendarMarker(text');
    const cal = Math.max(a, b);
    const dates = src.indexOf('fixGregorianDates(cal.text');
    assert.ok(cal > 0 && dates > cal && dates - cal < 400, name + ': the date guard follows the marker fix');
  }
});
