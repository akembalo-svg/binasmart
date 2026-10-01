'use strict';
// The English backstop's decision (assistant/lang.js wantsEnglish). 1 Oct 2026: a first message "Ok" on Telegram
// got an Amharic reply because only messages of 3+ Latin words were checked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detect, wantsEnglish } = require('../assistant/lang');
const am = [{ role: 'user', content: 'ሰላም፣ ታክሲ እፈልጋለሁ' }, { role: 'assistant', content: 'እሺ፣ ከየት ወደ የት?' }];
const en = [{ role: 'user', content: 'I need a taxi to Bole' }, { role: 'assistant', content: 'Sure, from where?' }];

test('a first "Ok" is English, so an Amharic answer to it gets translated', () => {
  assert.equal(detect('Ok'), 'en');
  assert.equal(wantsEnglish('Ok', 'en', []), true);
  assert.equal(wantsEnglish('Ok thanks', 'en', en), true);
});

test('"Ok" after an Amharic conversation stays Amharic', () => {
  assert.equal(wantsEnglish('Ok', 'en', am), false);
});

test('long English questions behave as before', () => {
  assert.equal(wantsEnglish('Tenders released today please', 'en', am), true, '3+ words: English whatever came before');
});

test('Amharic typed in Latin, Ethiopic, numbers only and other languages are left alone', () => {
  assert.equal(wantsEnglish('selam', 'en', []), false);
  assert.equal(wantsEnglish('eshi', 'en', []), false);
  assert.equal(wantsEnglish('እሺ', 'am', []), false);
  assert.equal(wantsEnglish('Ok እሺ', 'am', []), false);
  assert.equal(wantsEnglish('0900000001', 'en', []), false);
  assert.equal(wantsEnglish('👍', 'en', []), false);
  assert.equal(wantsEnglish('Akkam jirta', 'om', []), false);
});
