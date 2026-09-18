'use strict';
// Which messages point Bini's retrieval at the business pack, and - more importantly - which do not.
// The collision is with our own knowledge: knowledge/law holds the VAT, income-tax, customs and labour
// proclamations and Asmat answers from them. A tax PROCEDURE at an office belongs here; the text of a tax
// RULE belongs to law. The three other packs and BinaSmart's own services claim the rest.
const test = require('node:test');
const assert = require('node:assert');
const { isBusinessQuestion, PREFER, GUARDRAILS } = require('../../assistant/business');
const { pageMatcher, contextSearchOptions } = require('../../knowledge/index.js');

const BUSINESS = [
  'የንግድ ፈቃድ ለማውጣት ምን ያስፈልጋል?',
  'ንግድ ፈቃዴን እንዴት ላድስ?',
  'የንግድ ስም ምዝገባ ስንት ያስከፍላል?',
  'ግብር ከፋይ መለያ ቁጥር እንዴት አገኛለሁ?',
  'የግብር ክሊራንስ ሰርተፊኬት የት ይወሰዳል?',
  'የኢንቨስትመንት ፈቃድ ከንግድ ፈቃድ ይለያል?',
  'ለውጭ ባለሀብት ዝቅተኛው የመመዝገቢያ ካፒታል ስንት ነው?',
  'በኢንዱስትሪ ፓርክ ውስጥ ሼድ እንዴት ይከራያል?',
  'የሥራ ፈቃድ ለውጭ ሀገር ሠራተኛ ማን ይሰጣል?',
  'የጡረታ መዋጮ ምጣኔው ስንት ነው?',
  'የሥራ ውል ምን መያዝ አለበት?',
  'የንግድ ምልክት እንዴት እመዘግባለሁ?',
  'ጉምሩክ ዲክላራሲዮን ምን ይፈልጋል?',
  'የንግድ ምክር ቤት አባል መሆን ምን ይጠቅማል?',
  'how do I register a business name in Ethiopia',
  'what does a trade licence renewal cost',
  'how do I get a taxpayer identification number',
  'what is the minimum capital for a foreign investor',
  'do I need an investment permit as well as a business licence',
  'what must an employment contract contain',
  'what are the employer and employee pension contribution rates',
  'how do I register a trademark',
  'what does a customs declaration need',
  'what is the one-stop shop at the investment commission',
];

const NOT_BUSINESS = [
  // BinaSmart's own services
  'ከቦሌ ወደ ፒያሳ ታክሲ ስንት ነው?',
  'ሆቴል ክፍል ዋጋ ስንት ነው?',
  'ኪራይ እንዴት እሰበስባለሁ?',
  'ጨረታ የት አገኛለሁ?',
  'how much is a ride to the airport',
  // the other two packs
  'የባንክ ብድር ወለድ ስንት ነው?',
  'ከውጭ ሀገር ገንዘብ እንዴት እቀበላለሁ?',
  'what is the telebirr transfer fee',
  'how much baggage can I take on Ethiopian Airlines',
  'የበረራ ሻንጣ ክብደት ስንት ነው?',
  // the text of a tax or labour RULE - knowledge/law and Asmat
  'የተጨማሪ እሴት ታክስ ምጣኔው ስንት ነው?',
  'what is the VAT rate in Ethiopia',
  'what does the income tax proclamation say about the brackets',
  'አዋጅ ቁጥር 1156/2011 ስለ ማቋረጥ ምን ይላል?',
  'what is the stamp duty on a lease deed',
  // Asmat's own territory: a case
  'አሠሪዬ ያለ ማስጠንቀቂያ አሰናበተኝ፤ ክስ ልመሥርት?',
  'my landlord is taking me to court, what are my chances',
];

test('a business question is recognised', () => {
  for (const q of BUSINESS) assert.equal(isBusinessQuestion(q), true, 'missed: ' + q);
});

test('a question another service or another source owns is not claimed', () => {
  for (const q of NOT_BUSINESS) assert.equal(isBusinessQuestion(q), false, 'wrongly claimed: ' + q);
});

test('a hard word beats the other-service guard', () => {
  // a licence question with a taxi in it is still a licence question
  assert.equal(isBusinessQuestion('በታክሲ ሄጄ የንግድ ፈቃዴን ማደስ እችላለሁ?'), true);
  assert.equal(isBusinessQuestion('I paid the bank, but what does a trade licence renewal cost'), true);
});

test('one weak word alone is not enough', () => {
  assert.equal(isBusinessQuestion('ፈቃድ'), false);
  assert.equal(isBusinessQuestion('what is a company'), false);
});

test('an empty or nonsense message is not a business question', () => {
  for (const q of ['', '   ', '???', 'hello']) assert.equal(isBusinessQuestion(q), false, 'claimed: ' + JSON.stringify(q));
});

test('PREFER names the pack and three of our own guides, and does not name law', () => {
  assert.equal(PREFER[0], 'business');
  for (const p of ['guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia',
    'guide:tin-registration-ethiopia', 'eservices']) assert.ok(PREFER.includes(p), 'PREFER is missing ' + p);
  assert.equal(PREFER.includes('law'), false,
    'a licence-procedure question pulled onto the VAT proclamation is a wrong answer that looks right');
  assert.ok(PREFER.length <= 6, 'a long prefer list is the same as no prefer list');
});

test('every PREFER entry matches something the index can actually return', () => {
  const m = pageMatcher(PREFER);
  assert.equal(typeof m, 'function');
  // pageMatcher returns (source, slug) => boolean - positional, as knowledge/index.js line 436 defines it
  // and as test/banking/bini-banking-prefer.test.js calls it. The plan wrote an object argument.
  assert.equal(m('business', 'motri-trade-registration'), true);
  assert.equal(m('guide', 'business-registration-ethiopia'), true);
  assert.equal(m('eservices', 'ministry-of-trade-and-regional-integration'), true);
  assert.equal(m('law', 'vat-proclamation-1341-2024'), false);
  assert.equal(m('banking', 'zemen-tariff'), false);
});

test('contextSearchOptions accepts the prefer list', () => {
  const o = contextSearchOptions({ prefer: PREFER });
  assert.ok(o && typeof o === 'object');
});

test('the guardrails say the three things this pack must never do', () => {
  assert.match(GUARDRAILS, /not.*(file|submit|lodge|register).*on (your|anyone|anybody)/i);
  assert.match(GUARDRAILS, /compliant|valid/i);
  assert.match(GUARDRAILS, /TIN|licence number|registration number/i);
  assert.ok(/[ሀ-፿]/.test(GUARDRAILS), 'the guardrails must also be stated in Amharic');
  assert.ok(GUARDRAILS.length > 1200, 'the banking guardrails are this long because half-stated rules are half-obeyed');
});

test('the fee-and-date clause left this pack for the base prompt, and is still stated once', () => {
  // Until 2026-09-18 this pack and the banking pack each carried their own copy, and a question neither
  // pack claimed — a labour-law question, a pension question, a work-permit question — got neither.
  const { DATING } = require('../../assistant/dating');
  assert.ok(!/CARRIES THE OFFICE AND THE/.test(GUARDRAILS), 'the pack no longer says it');
  assert.match(DATING, /EVERY FIGURE YOU STATE CARRIES ITS DATE IN THE SAME SENTENCE/, 'the base prompt does');
  assert.match(DATING, /Source: \.\.\. fetched YYYY-MM-DD/, 'and still says which date to copy');
  assert.ok(/የተወሰደበት ቀን YYYY-MM-DD/.test(DATING), 'in the Amharic form of the same line too');
});

test('the word tables do not overlap between tiers', () => {
  const B = require('../../assistant/business');
  const seen = new Map();
  for (const tier of ['HARD', 'OTHER_SERVICE', 'STRONG', 'WEAK'])
    for (const w of B[tier]) {
      const prev = seen.get(w);
      assert.equal(prev, undefined, JSON.stringify(w) + ' is in both ' + prev + ' and ' + tier);
      seen.set(w, tier);
    }
});

// Beyond the plan's block: the banking/business precedence rule, and the wiring that applies it. A message
// can honestly be both a bank question and a licence question, and only one pack can hold the +0.06.
test('a HARD word is what wins the preference back from the banking pack', () => {
  const { hasBusinessHardWord } = require('../../assistant/business');
  assert.equal(hasBusinessHardWord('I paid the bank, but what does a trade licence renewal cost'), true);
  assert.equal(hasBusinessHardWord('ባንክ ከፍዬ የንግድ ፈቃዴን ማደስ እችላለሁ?'), true);
  // soft business words next to a bank: that question is the banking pack's and it keeps the preference
  assert.equal(hasBusinessHardWord('which bank account do I need to register a company'), false);
  assert.equal(hasBusinessHardWord('የባንክ ብድር ወለድ ስንት ነው?'), false);
  assert.equal(hasBusinessHardWord(''), false);
});

test('server.js consults the business intent next to the banking one', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /biniBusiness\.isBusinessQuestion\(msg\)/, 'the route must ask the business intent');
  assert.match(src, /biniBusiness\.PREFER/, 'and pass its prefer list to contextFor');
  assert.match(src, /biniBusiness\.GUARDRAILS/, 'and put its guardrails in the system prompt');
  assert.match(src, /hasBusinessHardWord\(msg\)/, 'business HARD words win the tie with banking');
  assert.match(src, /bankGuard \+ bizGuard/, 'a message that is both gets both guardrail blocks');
});
