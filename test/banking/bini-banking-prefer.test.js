'use strict';
// Which messages point Bini's retrieval at the banking pack, and — more importantly — which do not.
// BinaSmart itself takes money: rides, hotel rooms, cinema seats, rent collection, invoices. And tax belongs
// to knowledge/law and to Asmat. A money word alone therefore proves nothing; the question is whose money.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { isBankingQuestion, PREFER, GUARDRAILS } = require('../../assistant/banking');
const { pageMatcher, contextSearchOptions } = require('../../knowledge/index.js');

const BANKING = [
  'የባንክ ብድር ወለድ ስንት ነው?',
  'ሂሳብ ለመክፈት ምን ያስፈልጋል?',
  'የውጭ ምንዛሪ ተመን ዛሬ ስንት ነው?',
  'ከውጭ ሀገር ገንዘብ እንዴት ልቀበል?',
  'የዲያስፖራ ሂሳብ መክፈት እችላለሁ?',
  'ወለድ አልባ ባንክ አገልግሎት አላችሁ?',
  'የኤቲኤም ካርዴ ተውጦብኛል፤ ምን ላድርግ?',
  'ባንኩ ለሐዋላ ስንት ያስከፍላል?',
  'የሞባይል ባንኪንግ እንዴት ልጀምር?',
  'ቅሬታዬን ለባንኩ እንዴት ላቅርብ?',
  'what does the bank charge for an international transfer?',
  'how do I open a savings account in Ethiopia?',
  'what documents do I need for KYC at a bank?',
  'what is the overdraft interest rate?',
  'how does interest-free banking work here?',
  'can a diaspora member open a foreign currency account?',
  'what is the remittance fee?',
  'my debit card was swallowed by the ATM',
  'what is telebirr and how do its limits work?',
  'how do I complain about my bank?',
  // 2026-09-17, Task 15b: the regulator by name. These were not recognised, so the money guardrails never
  // reached the prompt and the travel-allowance answer gave USD 5,000 with a link and no date at all.
  'what is the NBE rule on how many dollars I can take abroad?',
  'what travel allowance does the National Bank of Ethiopia permit?',
  'የብሔራዊ ባንክ መመሪያ ምን ይላል?',
];

const NOT_BANKING = [
  'ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?',
  'እቤቴን ኪራይ እንዴት ልቀበል?',
  'ደረሰኝ እንዴት ላውጣ?',
  'ተ.እ.ታ ስንት ነው?',
  'የደመወዝ ግብር ስንት ነው?',
  'ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?',
  'ዛሬ ምን ፊልም አለ?',
  'ጨረታ ማግኘት እችላለሁ?',
  'ንግድ ፈቃድ እንዴት ላውጣ?',
  'በኢኮኖሚ ክፍል ስንት ኪሎ ሻንጣ ነፃ ይፈቀድልኛል?',
  'how much is a ride to the airport?',
  'how do I collect rent from my tenant?',
  'send my tenant an invoice please',
  'what is the VAT rate in Ethiopia?',
  'what is the salary income tax rate?',
  'book me a hotel room in Addis',
  'how much baggage can I take in economy?',
  'what tenders are open this week?',
];

test('a banking question is recognised', () => {
  for (const q of BANKING) assert.equal(isBankingQuestion(q), true, 'missed: ' + q);
});

test('another BinaSmart service, or tax, keeps its own question', () => {
  for (const q of NOT_BANKING) assert.equal(isBankingQuestion(q), false, 'wrongly claimed: ' + q);
});

test('a hard banking word beats a BinaSmart service word in the same sentence', () => {
  assert.equal(isBankingQuestion('I paid for the ride with my bank card — what does the bank charge for a POS payment?'), true);
  assert.equal(isBankingQuestion('ለታክሲው ከፈልኩ፤ የባንክ ብድር ወለድ ግን ስንት ነው?'), true);
});

test('a soft money word alone is not enough', () => {
  assert.equal(isBankingQuestion('ገንዘብ'), false);
  assert.equal(isBankingQuestion('how much money?'), false);
  assert.equal(isBankingQuestion('payment'), false);
});

test('two soft words together are', () => {
  assert.equal(isBankingQuestion('what is the balance and the branch opening time?'), true);
});

test('a travel question is not a banking question, and the two do not fight', () => {
  const { isTravelQuestion } = require('../../assistant/travel');
  for (const q of ['በኢኮኖሚ ክፍል ስንት ኪሎ ሻንጣ ነፃ ይፈቀድልኛል?', 'when does online check-in close?']) {
    assert.equal(isTravelQuestion(q), true, 'travel missed: ' + q);
    assert.equal(isBankingQuestion(q), false, 'banking wrongly claimed a travel question: ' + q);
  }
});

test('it never throws on rubbish', () => {
  for (const q of [null, undefined, '', 0, {}, []]) assert.equal(isBankingQuestion(q), false);
});

test('PREFER names the pack and BinaSmart own money pages, and nothing else', () => {
  assert.deepEqual(PREFER, ['banking', 'guide:open-bank-account-ethiopia', 'page:diaspora']);
  const m = pageMatcher(PREFER);
  assert.equal(m('banking', 'zemen-tariff'), true);
  assert.equal(m('guide', 'open-bank-account-ethiopia'), true);
  assert.equal(m('page', 'diaspora'), true);
  assert.equal(m('law', 'vat-proclamation-1341-2024'), false);
  assert.equal(m('travel', 'baggage-information-free-baggage-allowance'), false);
});

test('the preference becomes real search options', () => {
  // `watch` is excluded by default now: a question with no recency marker must reach the law, not a Telegram post.
  assert.deepEqual(contextSearchOptions({ prefer: PREFER }),
    { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6, prefer: PREFER });
});

test('the guardrail says the three things this pack will not do', () => {
  assert.match(GUARDRAILS, /not a bank/i);
  assert.match(GUARDRAILS, /account/i);
  assert.match(GUARDRAILS, /advice/i);
  assert.ok(/[ሀ-፿]/.test(GUARDRAILS), 'the guardrail must also be stated in Amharic');
});

test('the fourth thing — a figure without a date — is now said to every message, not only this one', () => {
  // It was a bullet here until 2026-09-18. A rule that only fires on the intents two packs happen to
  // recognise is a coincidence, not a rule, so it is in the base prompt now. See assistant/dating.js.
  const { DATING } = require('../../assistant/dating');
  assert.match(DATING, /date/i);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(src.includes("require('./assistant/dating')"), 'the shared rule is not required by the server');
  assert.ok(/ASSIST_SYS \+ ASSIST_FACTS \+ BINI_TOOL_RULES \+ BINI_SHARED/.test(src),
    'and it is not in the base prompt every answer is written under');
});

test('Bini asks for the banking pack only when the message is about money at a bank', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(src.includes("const biniBanking = require('./assistant/banking');"), 'assistant/banking is not required');
  assert.ok(src.includes('const bankingPrefer = !travelPrefer.prefer && biniBanking.isBankingQuestion(msg) ? { prefer: biniBanking.PREFER } : {};'),
    'the per-message banking preference is not computed, or travel does not win a tie');
  // The business pack joined the merge in Task 7 of the business plan. Banking still wins over a merely soft
  // business signal; only a business HARD word (assistant/business.js hasBusinessHardWord) takes it back.
  assert.ok(src.includes('const packPrefer = { ...travelPrefer, ...bankingPrefer, ...(businessWins ? businessPrefer : {}) };'), 'the three are not merged');
  assert.ok(src.includes('const businessWins = !!businessPrefer.prefer && (!bankingPrefer.prefer || biniBusiness.hasBusinessHardWord(msg));'),
    'a banking question with only soft business words must keep the banking preference');
  assert.ok(src.includes('knowledge.contextFor(msg, { lang, ...packPrefer })'), 'contextFor is not given the merged preference');
  assert.ok(src.includes('+ bankGuard'), 'the guardrail is not added to the system prompt');
});

test('Dr Afiya and Asmat never prefer the banking pack', () => {
  assert.equal(require('../../agents/afiya/rules').knowledge.prefer.includes('banking'), false);
  assert.equal(require('../../agents/asmat/rules').knowledge.prefer.includes('banking'), false);
});
