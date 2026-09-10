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
  assert.deepEqual(findUngrounded('Open in 2026. Call 0911244344.', ''), [], 'a year or a phone number carries no unit');
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
