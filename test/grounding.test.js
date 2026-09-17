'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findUngrounded, dropUngrounded } = require('../assistant/grounding');

test('an invented fare is caught, a quoted one is not', () => {
  // the real failure: no tool ran, so none of these numbers came from anywhere
  const invented = 'ከቦሌ መድኃኔዓለም እስከ ፒያሳ 4.4 ኪሎ ሜትር ነው። ተሳፋሪው 239 ብር ሲከፍል ሹፌሩ ሙሉውን ያገኛል።';
  const bad = findUngrounded(invented, '');
  assert.ok(bad.some(b => b.value === '239'), 'the fare must be caught');
  assert.ok(bad.some(b => b.value === '4.4'), 'the distance must be caught');

  // the same sentence is fine when quote_ride actually returned that fare
  const grounding = JSON.stringify({ fares: [{ tier: 'comfort', etb: 239 }], distanceKm: 4.4 });
  assert.deepEqual(findUngrounded(invented, grounding), []);
});

test('figures that came from a document are allowed, however they are written', () => {
  const reply = 'የኢትዮጵያ ኢ-ፓስፖርት መደበኛ ክፍያ 5,000 ብር ነው።';
  assert.deepEqual(findUngrounded(reply, 'passport fee is 5000 birr for the regular service'), []);
  assert.deepEqual(findUngrounded('The fee is 5000 ETB.', 'ክፍያው 5,000 ብር ነው'), [], 'comma form in the source');
  assert.ok(findUngrounded('The fee is 7000 ETB.', 'ክፍያው 5,000 ብር ነው').length, 'a different number is not grounded');
});

test('ordinary speech is left alone, money never is', () => {
  assert.deepEqual(findUngrounded('እስከ 4 ሰው ተጋርቶ፣ 8 ደቂቃ ይጠብቃል።', ''), [], 'small counts are not policed');
  assert.ok(findUngrounded('ዋጋው 20 ብር ነው።', '').length, 'even a small money figure must be grounded');
  assert.deepEqual(findUngrounded('Call 0911244344.', ''), [], 'a phone number is not four digits standing alone');
});

// Until 2026-09-17 a bare year went through untouched: it carries no unit, and the regex above wants a unit.
// Measured that day inside an answer that cited Banking Business Proclamation No. 1360/2025 correctly —
// "This change came about in the last quarter of 2022 with a new bill" — a date in no page of the pack,
// sitting inside a cited answer.
test('a year nobody gave the model is caught, a year from the page is not', () => {
  const page = 'Source: https://nbe.gov.et/... fetched 2026-09-16. Banking Business Proclamation No. 1360/2025.';
  const bad = findUngrounded('This change came about in the last quarter of 2022 with a new bill.', page);
  assert.ok(bad.some(b => b.value === '2022' && b.unit === 'year'), 'the invented year must be caught');
  assert.deepEqual(findUngrounded('The proclamation was fetched on 2026-09-16.', page), [],
    'the fetched date on the Source line grounds itself');
  assert.deepEqual(findUngrounded('Banking Business Proclamation No. 1360/2025 sets this out.', page), [],
    'a document number is not a date, and is in the context anyway');
  assert.deepEqual(findUngrounded('The directive is FCP/01/2020.', 'Financial Consumer Protection Directive FCP/01/2020'), [],
    'nor is the year inside FCP/01/2020');
});

test('a year the user typed in the question is theirs', () => {
  assert.deepEqual(findUngrounded('The 2018 proclamation was replaced.', '', 'what happened to the 2018 proclamation?'), [],
    'the question grounds the year the user chose');
  assert.ok(findUngrounded('The 2018 proclamation was replaced.', '', 'what changed?').length,
    'and without it the year is still dropped');
});

test('the sentence with the ungrounded year goes, the cited one stays', () => {
  const page = 'Source: https://nbe.gov.et/banking fetched 2026-09-16. Proclamation No. 1360/2025 opens the sector.';
  const reply = 'A foreign bank may open a subsidiary or a branch. This came about in the last quarter of 2022 with a new bill. '
    + 'Banking Business Proclamation No. 1360/2025 sets out how, fetched on 2026-09-16.';
  const r = dropUngrounded(reply, page);
  assert.equal(r.text.includes('2022'), false, 'the ungrounded year takes its sentence with it');
  assert.ok(r.text.includes('1360/2025'), 'the cited proclamation survives');
  assert.ok(r.text.includes('2026-09-16'), 'and so does the fetch date');
});

test('dropUngrounded removes only the offending sentence', () => {
  const t = 'ሹፌሩ የሚያገኘው እንደየጉዞው ብዛት ነው። ተሳፋሪው 239 ብር ይከፍላል። ቢናስማርት ኮሚሽን አይወስድም።';
  const r = dropUngrounded(t, '');
  assert.equal(r.text.includes('239'), false);
  assert.ok(r.text.includes('እንደየጉዞው'), 'the true first sentence survives');
  assert.ok(r.text.includes('ኮሚሽን አይወስድም'), 'the true last sentence survives');
  assert.equal(r.dropped.length, 1);
});

test('a clean reply passes through untouched', () => {
  const t = 'ዋጋው ቋሚ ነው፣ ከመያዝዎ በፊት ይታያል።';
  assert.deepEqual(dropUngrounded(t, ''), { text: t, dropped: [] });
});

test('a figure the user typed in the question is grounded by the question', () => {
  // The measured failure: asked what telebirr charges to send 1,000 birr, the guard dropped the sentence
  // carrying "1,000 Birr" even though the fee itself was on the page, and the answer came out mangled.
  const question = 'what does telebirr charge to send 1,000 birr to another telebirr user?';
  const page = 'telebirr send money to another telebirr user: 501 to 1500 | 4';
  const reply = 'Sending 1,000 Birr to another telebirr user costs 4 Birr.';
  assert.ok(findUngrounded(reply, page).length, 'without the question the user amount is dropped');
  assert.deepEqual(findUngrounded(reply, page, question), [], 'the question grounds the amount the user chose');
  assert.equal(dropUngrounded(reply, page, question).text, reply, 'the sentence survives whole');
});

test('the question grounds only what it actually contains', () => {
  const question = 'what does telebirr charge to send 1,000 birr?';
  const page = 'telebirr send money: 501 to 1500 | 4';
  assert.ok(findUngrounded('The fee is 37 Birr.', page, question).length,
    'a figure in neither the page nor the question is still dropped');
  assert.deepEqual(findUngrounded('The fee is 4 Birr.', page, question), [],
    'a figure that came from the page is still grounded');
});

test('the question is normalised the same way the documents are', () => {
  assert.deepEqual(findUngrounded('Sending 1500 ETB costs 4 Birr.', 'tariff 501 to 1500 | 4',
    'የ 1,500 ብር ብልክ ስንት ነው?'), [], 'commas and Ethiopic script in the question still match');
});
