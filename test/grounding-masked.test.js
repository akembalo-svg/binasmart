'use strict';
// The privacy incident of 2026-09-18, pinned.
//
// knowledge/business/mols-agencies*.md is the Ministry of Labour and Skills register of licensed overseas
// employment agencies. It carries each agency manager's personal mobile, and the number is masked to its
// last four digits — 251•••••0042 — because 1,190 personal mobiles in a public git repository is a
// harvestable list rather than a page somebody has to visit. That masking was a deliberate decision, made
// before the repository went public, and test/business/mask-phones.test.js pins it on disk.
//
// Asked in Amharic how to check whether an agency is licensed, Bini answered with five of those numbers in
// full: 251900000042, 251900000021, 251900000010. It had seen three digits of twelve and guessed the other
// five, and it presented the result as the ministry's published data. Whether a guessed number happens to
// reach a real person is worse than if it does not.
//
// Grounding alone cannot catch this, and it is worth being precise about why: the ordinary rule asks whether
// the model was shown these digits, and here it half was. So the mask gets a rule of its own, and the rule
// is deliberately one that no amount of surrounding context can satisfy — if the context masks a number, a
// number in the answer that completes that mask is ungrounded, full stop.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findUngrounded, dropUngrounded, maskedShapes } = require('../assistant/grounding');

// A register row as the pack actually holds it.
const ROW = '| AKLID EMPLOYMENT AGENCY | አክሊል | Addis Ababa, Bole, Woreda 03 | 251' + '•'.repeat(5) + '0042 | Saudi Arabia |';
const REGISTER = 'Source: https://mols.gov.et/agencies/ fetched 2026-09-17\n'
  + 'Phone numbers on this page are masked.\n' + ROW;

test('a number that completes a masked one is dropped, however the context reads', () => {
  const said = 'The manager of AKLID Employment Agency can be reached on 251900000042.';
  const bad = findUngrounded(said, REGISTER);
  assert.equal(bad.length, 1, 'exactly the number, nothing else');
  assert.equal(bad[0].reason, 'masked', 'and it is dropped as a mask reconstruction, not as an ordinary miss');
  assert.equal(dropUngrounded(said, REGISTER).text, '', 'the sentence carrying it goes');
});

test('all five numbers the audit measured are caught', () => {
  const rows = ['0042', '0021', '0010', '0035', '0092']
    .map(t => '| AGENCY | 251' + '•'.repeat(5) + t + ' | Saudi Arabia |').join('\n');
  const said = 'Call 251900000042, 251900000021, 251900000010, 251900000035 or 251900000092.';
  const bad = findUngrounded(said, rows);
  assert.equal(bad.length, 5);
  assert.ok(bad.every(b => b.reason === 'masked'));
});

test('the mask is recognised whichever character stands in for the digits', () => {
  for (const [name, token] of [['bullet', '251•••••0042'], ['asterisk', '251*****0042'],
                               ['lower x', '251xxxxx0042'], ['upper X', '251XXXXX0042'],
                               ['ellipsis', '251…0042']]) {
    const ctx = '| AGENCY | ' + token + ' | Saudi Arabia |';
    assert.equal(maskedShapes(ctx).length, 1, name + ' must register as a masked number');
    const bad = findUngrounded('Their number is 251900000042.', ctx);
    assert.equal(bad.length, 1, name + ': the reconstruction must be caught');
    assert.equal(bad[0].reason, 'masked', name + ': and caught as a mask reconstruction');
  }
});

test('the reconstruction does not escape by being written in national form', () => {
  const bad = findUngrounded('Their number is 0900000042.', REGISTER);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].reason, 'masked', '0900000042 is the same subscriber as 251900000042');
});

// The guard has to be safe for the numbers we most want said, or it will be turned off. Two of those:
// the ministry's own switchboard, which sits in full in the work-permit document, and BinaSmart's WhatsApp.
test('an institutional number printed in full in the context survives', () => {
  const doc = 'Source: https://mols.gov.et/ fetched 2026-09-17. Directive 44/2013. '
    + 'The Ministry of Labour and Skills can be reached on +251 116 671792 or info@Mols.gov.et.';
  const said = 'You can call the Ministry on +251 116 671792.';
  assert.deepEqual(findUngrounded(said, doc), [], 'a number the document prints in full is grounded');
  assert.equal(dropUngrounded(said, doc).text, said);
  // …and it still survives when the register, with its masked rows, is in the same context. The head of a
  // masked Ethiopian number is 251, and every Ethiopian number begins 251: if a three-digit head counted,
  // this guard would delete the ministry's own phone number from an answer that quoted it correctly.
  assert.deepEqual(findUngrounded(said, doc + '\n' + REGISTER), [],
    'the masked rows next to it must not take the switchboard with them');
});

test('the same document written in the national form grounds the international one and back', () => {
  const doc = 'Source: https://mols.gov.et/ fetched 2026-09-17. Call 0116671792.';
  assert.deepEqual(findUngrounded('Call +251 116 671792.', doc), []);
});

test('BinaSmart\'s own WhatsApp number is never dropped, because the prompt is what published it', () => {
  // It is in prompts/bini.txt and in the fallback line, not in any retrieved document, so without this the
  // guard would delete the one number every answer is meant to be able to offer.
  for (const said of ['Please reach us on WhatsApp: https://wa.me/251911244344',
                      'Call 0911244344 and we will help.']) {
    assert.deepEqual(findUngrounded(said, 'some page with no numbers in it'), [], said);
  }
});

test('a number the user typed is theirs, mask or no mask', () => {
  const q = 'I was given the number 251900000042 by an agency, is that a licensed one?';
  assert.deepEqual(findUngrounded('The number 251900000042 is not one I can check against the register.',
    REGISTER, q), [], 'a person must be able to see their own number read back');
  assert.ok(findUngrounded('The number 251900000042 is not one I can check against the register.',
    REGISTER).length, 'and without the question it is dropped again');
});

test('a short code is not a number this rule touches', () => {
  // 8482 and 6333 are published short codes; test/business/mask-phones.test.js pins that the masker leaves
  // them alone, and the answer guard must leave them alone for the same reason — four digits is not a phone.
  assert.deepEqual(findUngrounded('Dial 8482 for the service.', ''), []);
  assert.deepEqual(findUngrounded('Dial 6333.', REGISTER), []);
});

test('a document number, a proclamation and a date are not phone numbers', () => {
  const page = 'Source: https://mols.gov.et/ fetched 2026-09-17. Labour Proclamation No. 1156/2019, Art 77.';
  assert.deepEqual(findUngrounded('Proclamation No. 1156/2019 gives 16 working days, per the page fetched 2026-09-17.', page), [],
    'a proclamation number is split by its slash and a fetched date is in the context');
});

test('an Amharic answer loses only the sentence with the invented number', () => {
  const said = 'የኤጀንሲው ሥራ አስኪያጅ ስልክ 251900000042 ነው። '
    + 'ፈቃድ ያለው መሆኑን በሚኒስቴሩ ድረ-ገጽ ላይ ካለው መዝገብ ማረጋገጥ ይችላሉ።';
  const r = dropUngrounded(said, REGISTER);
  assert.equal(r.text.includes('251900000042'), false, 'the reconstructed number goes');
  assert.ok(r.text.includes('ማረጋገጥ ይችላሉ'), 'and the sentence that actually answers the question stays');
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].reason, 'masked');
});

test('the drop is logged as a mask reconstruction, on whichever path the answer left by', () => {
  const warned = [];
  const real = console.warn;
  console.warn = m => warned.push(String(m));
  try { dropUngrounded('Call 251900000042.', REGISTER); } finally { console.warn = real; }
  assert.ok(warned.some(w => /dropped masked-number reconstruction/.test(w)),
    'the log line names what happened, and it is written inside the guard so both callers get it');
});

test('a fetched date is too short to be a phone number, even when a mask ends in those four digits', () => {
  // The collision this floor exists for: a register chunk holds dozens of masked rows, so dozens of
  // four-digit tails, and 2026-09-17 ends in 0917. Dropping a dated citation because one agency's number
  // happens to end 0917 would undo the other half of this work.
  const ctx = 'Source: https://mols.gov.et/agencies/ fetched 2026-09-17\n| AGENCY | 251' + '•'.repeat(5) + '0917 |';
  assert.deepEqual(findUngrounded('The register was fetched on 2026-09-17.', ctx), [],
    'eight digits is a date, not somebody mobile');
  // and the twelve-digit completion of that same row is still caught
  assert.equal(findUngrounded('Call 251900000917.', ctx)[0].reason, 'masked');
});

test('a row of asterisks is emphasis, and a year with an ellipsis after it is prose', () => {
  assert.deepEqual(maskedShapes('**bold** and *emphasis*'), [], 'markdown is not a masked number');
  assert.deepEqual(maskedShapes('in 2026… 45 people applied'), [],
    'a head with an uncountable stand-in and a space is not a masked number');
  // and the consequence that matters: a fetched date is not read as completing anything
  const page = 'Source: https://mols.gov.et/ fetched 2026-09-17. In 2026… 45 offices reported.';
  assert.deepEqual(findUngrounded('The page was fetched 2026-09-17.', page), []);
});
