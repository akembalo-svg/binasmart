'use strict';
// The two output guards added on 2026-09-24 after the MoLS re-evaluation. Numbers are invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../../gov/filters');

test('a sentence carrying an Ethiopian landline is removed; the rest of the answer stays', () => {
  const t = 'ቅሬታዎን በጽሑፍ ማቅረብ ይችላሉ። የሕዝብ ቅሬታ ዴስክ ስልክ ቁጥር +251 11 000 0042 ነው። ለበለጠ መረጃ አዋጁን ይመልከቱ።';
  const r = F.stripLandlines(t);
  assert.equal(r.removed, 1);
  assert.doesNotMatch(r.text, /000 0042/);
  assert.match(r.text, /ቅሬታዎን በጽሑፍ/);
  assert.match(r.text, /አዋጁን ይመልከቱ/);
  for (const n of ['011 000 0042', '+251-11-000-0042', '0116000042', '+251 (0)11 000 0042', '046 000 0042'])
    assert.equal(F.stripLandlines('Call ' + n + ' today.').removed, 1, n);
});

test('emergency numbers, years, law numbers and fees are not phone numbers', () => {
  for (const t of ['Call the Federal Police on 991 or an ambulance on 907.', 'Proclamation No. 1389/2025, Article 53.',
    'The fee is 5,000 birr (2026).', 'Directive No. 44/2013 E.C.', 'Fetched on 2026-09-17.'])
    assert.equal(F.stripLandlines(t).removed, 0, t);
});

test('an answer that names the 2018 E.C. ministry directive without saying it is a draft gets the warning', () => {
  const am = 'ለሥራ ውል ማጽደቅ የሚከተሉትን ሰነዶች ያስፈልጋሉ (የሥራና ክህሎት ሚኒስቴር መመሪያ፣ 2018 ዓ.ም.)፦ ፓስፖርት።';
  const r = F.flagDraftDirective(am);
  assert.equal(r.removed, 1);
  assert.match(r.text, /ያልተፈረመ ረቂቅ ነው/);
  const en = 'The documents are listed in the Ministry of Labour and Skills directive of 2018 E.C.';
  assert.match(F.flagDraftDirective(en).text, /unsigned draft and is not in force/);
});

test('no warning when the answer already says draft, or does not name the directive', () => {
  assert.equal(F.flagDraftDirective('የ2018 ዓ.ም. መመሪያ ያልተፈረመ ረቂቅ ነው።').removed, 0);
  assert.equal(F.flagDraftDirective('The 2018 E.C. directive is an unsigned draft.').removed, 0);
  assert.equal(F.flagDraftDirective('Labour Proclamation No. 1156/2019 governs private employment.').removed, 0);
});
