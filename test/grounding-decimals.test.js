'use strict';
// The shed-price leak of 2026-09-22, pinned.
//
// Asked "How much does it cost to rent a shed in an industrial park in Ethiopia?", Bini answered twice with
// "Years 8-10: US$3.25 per square meter per month" for Adama & Dire Dawa and "US$3.0" for the other parks.
// The Ethiopian Investment Commission table it was handed says $3.5 and $2.75 for those rows. 3.25 is in no
// source, and it reached the reader for two reasons, both fixed in assistant/grounding.js:
//   1. a dollar price was not a figure at all: the only currency the guard knew was birr, and a currency
//      written before the number ($3.25, US$1.5, USD 4.34) matched no pattern whatever the currency;
//   2. a decimal was accepted when its integer part appeared anywhere ("3.25" passed because of a "$3").
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findUngrounded, dropUngrounded } = require('../assistant/grounding');

// knowledge/business/eic-faqs-industry-park-leases.md, the rows as the pack holds them
const LEASES = [
  'Source: https://investethiopia.gov.et/faqs (official Ethiopian Investment Commission page, in English), fetched 2026-09-17.',
  '- Readymade sheds are available start at a price of $2 per m2 per month',
  'Lease Period | Adama & Dire Dawa Industry Parks | All other Industry Parks',
  'Year 1 – 4: Adama & Dire Dawa Industry Parks $2.75 per m2 per month; All other Industry Parks $2.0 per m2 per month',
  'Year 5 – 7: Adama & Dire Dawa Industry Parks $3.0 per m2 per month; All other Industry Parks $2.5 per m2 per month',
  'Year 8 – 10: Adama & Dire Dawa Industry Parks $3.5 per m2 per month; All other Industry Parks $2.75 per m2 per month',
  'Year 11 – 15: Adama & Dire Dawa Industry Parks $4.0 per m2 per month; All other Industry Parks $3 per m2 per month',
].join('\n');
// knowledge/business/eic-special-economic-zones-integrated-agro-industrial-parks.md
const IAIP = 'Lease ready-made sheds built in three sizes: 1,500, 2,500 and 3,500 square meters. Currently, the lease cost for'
  + ' sheds inside IAIPs is US$1.5/square-meter/month for foreign investors. Currently, the cost of leasing land for'
  + ' construction is US$1.2/square-meter annually.';
const Q = 'How much does it cost to rent a shed in an industrial park in Ethiopia?';

test('the invented $3.25 is caught, in every way a price can be written', () => {
  for (const s of ['* Years 8-10: US$3.25 per square meter per month', 'It is $3.25 per m2 per month.',
    'It is USD 3.25 per m2.', 'It is 3.25 USD per m2.', 'It is 3.25 US dollars per m2.', 'It is 3.25 dollars per m2.',
    'It is US $3.25 per m2.', 'It is **$3.25** per m².', 'It is 3.25 birr per m2.', 'ዋጋው 3.25 ዶላር ነው።']) {
    const bad = findUngrounded(s, LEASES + ' ' + IAIP, Q);
    assert.equal(bad.length, 1, s + ' must be caught exactly once');
    assert.equal(bad[0].value, '3.25', s);
  }
});

test('the whole measured reply: only the invented row goes, the true rows and the list survive', () => {
  const reply = 'For other industry parks, ready-made sheds generally start at US$2 per square meter per month.\n'
    + '* **Adama & Dire Dawa Industry Parks:**\n'
    + '    * Years 1-4: US$2.75 per square meter per month\n'
    + '    * Years 5-7: US$3.0 per square meter per month\n'
    + '    * Years 8-10: US$3.25 per square meter per month\n'
    + '* **All other Industry Parks:**\n'
    + '    * Years 1-4: US$2.0 per square meter per month\n'
    + '    * Years 5-7: US$2.5 per square meter per month\n'
    + 'Which industrial park are you interested in?';
  const r = dropUngrounded(reply, LEASES, Q);
  assert.deepEqual(r.dropped.map(d => d.value), ['3.25']);
  assert.equal(r.text.includes('3.25'), false, 'the invented price is gone');
  assert.equal(r.text, reply.replace('    * Years 8-10: US$3.25 per square meter per month\n', ''),
    'every other line is kept exactly, with its line break and indentation');
});

test('a decimal is grounded only by the same value, never by its pieces', () => {
  assert.equal(findUngrounded('It is $3.25 per m2.', 'rows: $3 and 25 per m2 and 2.5').length, 1, 'not by 3, 25 or 2.5');
  assert.equal(findUngrounded('It is $3.25 per m2.', 'the rate is 32.5').length, 1, 'not by 32.5');
  assert.equal(findUngrounded('It is $3.25 per m2.', 'the rate is 3.255').length, 1, 'not by a longer decimal');
  assert.equal(findUngrounded('It is $3 per m2.', 'the rate is $3.5').length, 1, 'an integer is not grounded by a decimal that starts with it');
  assert.equal(findUngrounded('It is 1.8 USD per m2.', 'years 6-10: 1.795 (~1.8) USD').length, 0, 'but the same decimal is');
});

test('equal values are the same figure: 3 = 3.0 = 3.00, 3.5 = 3.50', () => {
  // The table itself writes "$3" in one row and "$3.0" in the next, and "$2" beside "$2.0".
  assert.deepEqual(findUngrounded('It is $3.0 per m2.', 'the rate is $3 per m2'), []);
  assert.deepEqual(findUngrounded('It is $3 per m2.', 'the rate is $3.00 per m2'), []);
  assert.deepEqual(findUngrounded('It is $3.50 per m2.', 'the rate is $3.5 per m2'), []);
  assert.deepEqual(findUngrounded('It is 1000 birr.', 'the fee is 1,000.00 birr'), []);
  // …and a value that differs is still a different figure
  assert.equal(findUngrounded('It is $3.0 per m2.', 'the rates are $3.5 and $2.75').length, 1, '3.0 is not 3.5');
});

test('a number that ends the source sentence still grounds the reply', () => {
  assert.deepEqual(findUngrounded('The fare is 239 birr.', 'The comfort fare for this trip is 239.'), []);
  assert.deepEqual(findUngrounded('The fare is 239.5 birr.', 'The fare is 239.5.'), []);
});

test('true answers measured live on 2026-09-22 keep every figure', () => {
  const hawassa = 'For Hawassa Industrial Park, the readymade shed rent for year 6 is $2.5 per square meter per month, '
    + 'according to the Ethiopian Investment Commission\'s FAQs, as fetched on 17 September 2026.';
  assert.deepEqual(findUngrounded(hawassa, LEASES, 'What is the shed rent in Hawassa industrial park for year 6?'), []);
  const adama = 'For the first 1-4 years, it\'s $2.75 per square meter per month. From year 5-7, it goes up to $3.0 per '
    + 'square meter per month, and for years 8-10, it\'s $3.5 per square meter per month. From year 11-15, it\'s $4.0 per square meter per month.';
  assert.deepEqual(findUngrounded(adama, LEASES, 'How much is a readymade shed in Adama Industrial Park?'), []);
  const iaip = 'For foreign investors, sheds inside IAIPs are US$1.5 per square meter per month, and land for construction is US$1.2 per square meter annually.';
  assert.deepEqual(findUngrounded(iaip, IAIP, 'How much is a shed in an integrated agro-industrial park?'), []);
});

test('ordinary figures written differently from the source are still grounded', () => {
  assert.deepEqual(findUngrounded('VAT is 15% of the price.', 'Value added tax is charged at 15 per cent.'), [], '15% from 15 per cent');
  assert.deepEqual(findUngrounded('You may check 2 × 23 kg bags.', 'Economy: 2 pieces 23kg each'), [], 'kg is not a policed unit');
  assert.deepEqual(findUngrounded('Sending 1,000 birr costs 4 birr.', 'telebirr: 501 to 1000 | 4'), [], '1,000 from 1000');
  assert.deepEqual(findUngrounded('It is ETB 1,000.', 'The fee is 1000 birr.'), [], 'ETB before the number');
  assert.deepEqual(findUngrounded('Sending 1,000 birr costs 4 birr.', 'send money | 4', 'what does it cost to send 1,000 birr?'), [],
    'a figure the user typed is still theirs');
});

test('a dollar figure nobody gave the model is caught like a birr one', () => {
  assert.equal(findUngrounded('The visa costs $82.', 'A 30-day tourist e-visa costs $52.').length, 1);
  assert.deepEqual(findUngrounded('The visa costs $52.', 'A 30-day tourist e-visa costs $52.'), []);
  assert.equal(findUngrounded('The fee is €20.', '').length, 1);
});
