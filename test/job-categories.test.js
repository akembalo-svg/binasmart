'use strict';
// The category rules. Titles below are the shapes that sat under Other on 24 September 2026.
const test = require('node:test');
const assert = require('node:assert/strict');
const { categorise } = require('../jobs/categories');

test('Amharic titles are filed: the Latin word boundary never fired before Ethiopic letters', () => {
  assert.equal(categorise('ከባድ መኪና ሹፌር'), 'logistics');
  assert.equal(categorise('የውሃ ቦቴ መኪና ሹፌር'), 'logistics');
  assert.equal(categorise('የፅዳት ሠራተኛ / ክሊነር'), 'security');
  assert.equal(categorise('ተላላኪ'), 'admin');
  assert.equal(categorise('ሲኒየር ሴክሬተሪ'), 'admin');
  assert.equal(categorise('ካሸር'), 'accounting');
  assert.equal(categorise('ኮንስትራክሽን መሐንዲስ'), 'engineering');
  assert.equal(categorise('ሲኒየር ኳንቲቲ ሰርቬየር'), 'engineering');
  assert.equal(categorise('የኤክስፖርት ቡና ማዘጋጃ ክፍል ኃላፊ'), 'agriculture');
  assert.equal(categorise('የመኝታ አገልግሎት ተቆጣጣሪ'), 'hospitality');
});

test('the plain English jobs that had no rule', () => {
  assert.equal(categorise('Male Messenger'), 'admin');
  assert.equal(categorise('Reception'), 'admin');
  assert.equal(categorise('Call Center Operator'), 'admin');
  assert.equal(categorise('Liaison Officer'), 'admin');
  assert.equal(categorise('Jr. Motorist/Expeditor'), 'logistics');
  assert.equal(categorise('Transitor'), 'logistics');
  assert.equal(categorise('Purchasing Officer'), 'logistics');
  assert.equal(categorise('Drafts Man'), 'engineering');
  assert.equal(categorise('Assistant Driller'), 'engineering');
  assert.equal(categorise('Cafteria Manager'), 'hospitality');
  assert.equal(categorise('Rhodes Scholarships at Oxford University — vacancy notice (21 Jun 2026)'), 'education');
  assert.equal(categorise('Site Manager – Infrastructure Projects'), 'construction');
});

test('vague titles still stay under Other rather than being guessed', () => {
  for (const t of ['General Manager', 'Project Director', 'Store Manager', 'Deputy Director', 'Chief of Staff', 'Political Parties Liaison Expert'])
    assert.equal(categorise(t), null, t);
});

test('the older rules still win where they already matched', () => {
  assert.equal(categorise('Customer Service Officer'), 'banking');
  assert.equal(categorise('Software Engineer'), 'it');
  assert.equal(categorise('Store Keeper'), 'logistics');
  assert.equal(categorise('HR Officer'), 'admin');
});
