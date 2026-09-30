'use strict';
// ops/jobs/clean-employers.js: which names are one company. Names are real shapes seen on the board; nothing is written.
const test = require('node:test');
const assert = require('node:assert/strict');
const { key, cleanName } = require('../ops/jobs/clean-employers');

test('advert text, legal forms, trailing acronyms and a trailing Ethiopia do not make a second company', () => {
  const same = (a, b) => assert.equal(key(a), key(b), a + ' / ' + b);
  same('Ethiopian Airlines', 'Ethiopian Airlines Call For Written Exam');
  same('Ethiopian Airlines', 'Ethiopian Airlines Is');
  same('New Leaf Medical Complex', 'New Leaf Medical Complex PLC(NMC)');
  same('Safaricom Ethiopia', 'Safaricom eEthiopia');
  same('Tsehay Bank', 'Tsehay Bank for fresh graduates');
  same('British Embassy', 'British Embassy Vacancies');
});

test('different organisations that share words stay apart', () => {
  assert.notEqual(key('Addis Ababa University'), key('Addis Ababa City Bus Service'));
  assert.notEqual(key('Hope Enterprises'), key('Hope Enterprise University College'));
  assert.notEqual(key('Ethiopian Airlines'), key('Ethiopian Airlines Group'), 'the group is a person\'s call, not a rule\'s');
});

test('a real word that ends in "are" or "is" is never cut', () => {
  for (const n of ['Washington Healthcare', 'Anbessa Shoe Share', 'Little Seeds Montessori Daycare', 'Addis Ababa'])
    assert.equal(cleanName(n), n);
  assert.equal(cleanName('Yegna Microfinance for fresh graduates'), 'Yegna Microfinance');
});
