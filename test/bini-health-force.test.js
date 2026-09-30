'use strict';
// Bini and bina.et/health (30 Sep 2026): before this, a health-place question was answered from the map chunks in the
// knowledge block, with OpenStreetMap links and no directory, and "which hospital near Piassa is open at night for my
// child" got the Ministry's service package and no hospital. A place to be seen must reach search_health.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isHealthSearch, shouldForceTool } = require('../assistant/force');

test('looking for a place to be seen forces the directory', () => {
  for (const m of ['I need a dentist in Bole', 'ቦሌ አካባቢ የጥርስ ሐኪም የት አገኛለሁ?', 'Is there a laboratory in Arada where I can do blood tests?',
    'What is the phone number of Hayat Hospital?', 'My child has had a fever since yesterday, which hospital near Piassa is open at night?',
    'ለልጆች የሚሆን ክሊኒክ ቂርቆስ አካባቢ አለ?', 'Find me a gynecologist doctor in Addis', 'which hospital is close to Piassa', 'ፒያሳ አካባቢ ሆስፒታል'])
    { assert.equal(isHealthSearch(m), true, m); assert.equal(shouldForceTool(m), true, m); }
});

test('a trip, a job, a clinic joining, Dr Afiya or a bare symptom is not a place search', () => {
  for (const m of ['Take me to Hayat Hospital from Bole Medhanialem', 'ወደ ሆስፒታል ውሰደኝ', 'nurse job at a hospital', 'የሆስፒታል ሥራ አለ?',
    'I want to add my clinic', 'register our hospital', 'ask doctor afiya', 'my child has fever what should I do'])
    assert.equal(isHealthSearch(m), false, m);
});

test('an auction reaches the tender search (28 Sep 2026: "Auction" got "no information" with 11 auctions open)', () => {
  for (const m of ['Auction', 'any car auction?', 'የባንክ ሐራጅ አለ?']) assert.equal(shouldForceTool(m), true, m);
});
