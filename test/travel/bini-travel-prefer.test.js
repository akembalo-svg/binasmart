'use strict';
// Who may read the Ethiopian Airlines pack. Bini, when the message is about flying; nobody else. The ride
// cases are not padding: BinaSmart sells airport transfers, so "a taxi to Bole" must stay a ride question
// even though it names an airport.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isTravelQuestion, PREFER } = require('../../assistant/travel');
const { contextSearchOptions, pageMatcher } = require('../../knowledge/index');

const TRAVEL = [
  'ከአዲስ አበባ ወደ ዱባይ በረራ ስንት ሰዓት ይፈጃል?',
  'በኢኮኖሚ ክፍል ስንት ኪሎ ሻንጣ ነፃ ይፈቀድልኛል?',
  'የመሳፈሪያ ወረቀቴን በስልኬ ላይ ማውረድ እችላለሁ?',
  'ውሻዬን ይዤ በአውሮፕላን መጓዝ እችላለሁ?',
  'የኢትዮጵያ አየር መንገድ ትኬቴን መቀየር እችላለሁ?',
  'how much carry-on baggage can I take?',
  'when does online check-in open for my flight?',
  'what is the Ethiopian Airlines refund policy?',
  'how do I join ShebaMiles?',
  'can I upgrade to Cloud Nine?',
];
const NOT_TRAVEL = [
  'ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?',
  'ከቦሌ ወደ ፒያሳ ጋራ ጉዞ አለ?',
  'a taxi from the airport to Piassa, how much?',
  'airport transfer price please',
  'ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?',
  'what time is hotel check-in?',
  'ንግድ ፈቃድ እንዴት አወጣለሁ?',
  'how do I register a business in Ethiopia?',
  'ዛሬ ምን ፊልም አለ?',
  'what is the VAT rate?',
  'ሰላም',
  'የደመወዝ ግብር ስንት ነው?',
];

test('a travel question is recognised, in Amharic and in English', () => {
  for (const q of TRAVEL) assert.equal(isTravelQuestion(q), true, 'missed: ' + q);
});

test('another BinaSmart service is not a travel question, even when it names an airport', () => {
  for (const q of NOT_TRAVEL) assert.equal(isTravelQuestion(q), false, 'wrongly claimed: ' + q);
});

test('a word only aviation uses beats the other-service guard', () => {
  assert.equal(isTravelQuestion('a taxi to the airport for my flight to Dubai, and how much baggage can I take?'), true);
});

test('an aviation word other things also use decides it only when no other service is named', () => {
  assert.equal(isTravelQuestion('ቼክ ኢን ለማድረግ ምን ምን ሰነድ ያስፈልገኛል?'), true);
  assert.equal(isTravelQuestion('ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?'), false);
});

test('a service word inside a longer word is not a service word', () => {
  // Without word boundaries the `rent` in `current` would hand this question to the rental service.
  assert.equal(isTravelQuestion('what is the current transit visa rule at the airport?'), true);
});

test('isTravelQuestion never throws on rubbish', () => {
  for (const q of [null, undefined, '', 0, {}, []]) assert.equal(isTravelQuestion(q), false);
});

test('PREFER names the pack and the BinaSmart travel pages, and nothing else', () => {
  assert.deepEqual(PREFER, ['travel', 'page:airport', 'page:flights', 'page:travel']);
  const m = pageMatcher(PREFER);
  assert.equal(m('travel', 'baggage-information-free-baggage-allowance'), true);
  assert.equal(m('page', 'airport'), true);
  assert.equal(m('guide', 'passport'), false);
  assert.equal(m('law', 'labour-proclamation-1156-2019'), false);
});

test('the preference becomes real search options', () => {
  // `watch` is excluded by default now: a question with no recency marker must reach the law, not a Telegram post.
  assert.deepEqual(contextSearchOptions({ prefer: PREFER }),
    { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6, prefer: PREFER });
});

test('Dr Afiya excludes the travel pack and keeps everything she excluded before', () => {
  const a = require('../../agents/afiya/rules');
  assert.ok(a.knowledge.exclude.includes('travel'));
  for (const e of ['page', 'skill', 'llms', 'mor', 'guide:mesob', 'guide:telebirr']) assert.ok(a.knowledge.exclude.includes(e), 'lost ' + e);
  assert.equal(a.knowledge.prefer.includes('travel'), false);
});

test('Asmat excludes the travel pack and keeps everything he excluded before', () => {
  const s = require('../../agents/asmat/rules');
  assert.ok(s.knowledge.exclude.includes('travel'));
  for (const e of ['page', 'skill', 'llms']) assert.ok(s.knowledge.exclude.includes(e), 'lost ' + e);
  assert.equal(s.knowledge.prefer.includes('travel'), false);
});

test('the owner agent reads no general knowledge at all, so the pack can never reach it', () => {
  assert.equal(require('../../agents/owner/rules').knowledge, false);
});

test('Bini asks for the pack only when the message is about flying', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(src.includes("const biniTravel = require('./assistant/travel');"), 'assistant/travel is not required');
  assert.ok(src.includes('const travelPrefer = biniTravel.isTravelQuestion(msg) ? { prefer: biniTravel.PREFER } : {};'),
    'the per-message preference is not computed');
  // The banking pack joined the travel pack behind the same call. Travel is computed first and wins a tie, so
  // a question about changing a ticket still gets the airline's change-fee page and not a bank's tariff.
  // The business pack joined them in Task 7 of the business plan; travel is still computed first and neither
  // of the other two can take a tie from it.
  assert.ok(src.includes('const packPrefer = { ...travelPrefer, ...bankingPrefer, ...(businessWins ? businessPrefer : {}) };'), 'the three packs are not merged');
  assert.ok(src.includes('const businessPrefer = !travelPrefer.prefer && biniBusiness.isBusinessQuestion(msg)'), 'travel must win a tie with business too');
  assert.ok(src.includes('knowledge.contextFor(msg, { lang, ...packPrefer })'), 'contextFor is not given the preference');
  assert.equal(src.includes('knowledge.contextFor(msg, { lang }).catch'), false, 'the old unconditional call is still there');
});
