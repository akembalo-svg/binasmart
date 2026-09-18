'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../gov/filters');

test('agency look-ups are caught in English and Amharic', () => {
  for (const q of ['What is the phone number of Selam employment agency?', 'How do I check the agency is licensed?',
    'Which agencies send workers to Qatar?', 'Give me a list of licensed agencies',
    'የሰላም ኤጀንሲ ስልክ ቁጥር ስጠኝ', 'ኤጀንሲው ፈቃድ እንዳለው እንዴት አረጋግጣለሁ?', 'ወደ ኳታር የሚልኩ ኤጀንሲዎች ዝርዝር'])
    assert.equal(f.isAgencyLookup(q), true, q);
});

test('a question about the law on agencies is not a look-up', () => {
  for (const q of ['What must an agency do to get a licence under Proclamation 1389/2025?',
    'How are private employment agencies licensed?', 'ኤጀንሲ ፈቃድ ለማውጣት ምን ያስፈልጋል?'])
    assert.equal(f.isAgencyLookup(q), false, q);
});

test('a person\'s own records are caught; how a procedure works is not', () => {
  for (const q of ['What is the status of my Labor ID application?', 'Where is my work permit? It is delayed',
    'የሌበር አይዲ ማመልከቻዬ የት ደረሰ?', 'ውጤቴ መቼ ይደርሳል?'])
    assert.equal(f.isPersonalRecords(q), true, q);
  for (const q of ['How do I check my Labor ID status?', 'How long does a work permit take?',
    'የሌበር አይዲ እንዴት አገኛለሁ?'])
    assert.equal(f.isPersonalRecords(q), false, q);
});

test('personal legal advice is caught; the law in general is not', () => {
  for (const q of ['Is my contract legal? They pay 1000 riyal a month', 'Should I sign this contract?',
    'Will I win if I sue my employer?', 'ውሌ ሕጋዊ ነው?', 'ውሌ ህጋዊ ነው?', 'ብከሰው አሸንፋለሁ?'])
    assert.equal(f.isCaseAdvice(q), true, q);
  for (const q of ['What are my rights if I am dismissed?', 'What notice period does the labour law set?',
    'ያለ ማስጠንቀቂያ ከሥራ ማሰናበት ይቻላል?'])
    assert.equal(f.isCaseAdvice(q), false, q);
});

test('danger abroad is caught; travel paperwork is not', () => {
  for (const q of ['My sister in Saudi Arabia is locked in and her passport was taken',
    'My brother in Dubai has not been paid for months and cannot leave',
    'እህቴ ሳውዲ ውስጥ ተቆልፋለች ፓስፖርቷን ወስደውባታል', 'ልጄ ዱባይ ውስጥ ይደበድቧታል'])
    assert.equal(f.isDangerAbroad(q), true, q);
  for (const q of ['How do I renew my passport before going to Saudi Arabia?', 'What documents do I need for Qatar?',
    'ወደ ሳውዲ ለመሄድ ፓስፖርቴን ማሳደስ አለብኝ?'])
    assert.equal(f.isDangerAbroad(q), false, q);
});

test('a sentence carrying a full Ethiopian mobile number is removed; the rest stays', () => {
  const r = f.stripMobiles('Call the agency on 0900000012. The register is at mols.gov.et. Or +251 900 000 013 today.');
  assert.equal(r.removed, 2);
  assert.equal(r.text, 'The register is at mols.gov.et.');
  const am = f.stripMobiles('ኤጀንሲው 251900000014 ነው። ዝርዝሩ በሚኒስቴሩ ድረ ገጽ አለ።');
  assert.equal(am.removed, 1);
  assert.equal(am.text, 'ዝርዝሩ በሚኒስቴሩ ድረ ገጽ አለ።');
});

test('landlines, fees and document numbers are not phones', () => {
  const s = 'The ministry line is +251 116 671792. The fee is 2,000 Birr under Regulation 394/2016.';
  assert.deepEqual(f.stripMobiles(s), { text: s, removed: 0 });
});

test('scrub masks emails and long numbers, keeps dates and document numbers', () => {
  assert.equal(f.scrub('mail me at a.b@example.org or 0900000015, fetched 2026-09-17, Proclamation 1156/2019'),
    'mail me at [email] or [number], fetched 2026-09-17, Proclamation 1156/2019');
  assert.equal(f.scrub('x'.repeat(50), 10), 'x'.repeat(10));
});
