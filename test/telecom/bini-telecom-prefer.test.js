'use strict';
// Which messages point Bini's retrieval at the telecom pack, and which do not. Three collisions decide the
// tests: telebirr and M-PESA (banking's), the airline's eSIM add-on (travel's), and the Amharic Ethio telecom
// FAQ that lives in a banking document, which is why the preference is a soft boost and never a filter.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../../assistant/telecom');
const { pageMatcher, contextSearchOptions } = require('../../knowledge/index.js');

const TELECOM = [
  'የኢትዮ ቴሌኮም ዳታ ጥቅል ዋጋ ስንት ነው?',
  'ሳፋሪኮም ሲም ካርድ እንዴት ማግኘት እችላለሁ?',
  'ሲም ካርዴ ተበላሽቷል፤ እንዴት እተካዋለሁ?',
  'ኢ-ሲም ምንድን ነው?',
  'ወደ ሳዑዲ ለሐጅ ስሄድ የሮሚንግ ጥቅል አለ?',
  'የአየር ሰዓት ክሬዲት ለማግኘት ምን ያስፈልጋል?',
  'የኮሙኒኬሽን ባለሥልጣን የደንበኞች መብት መመሪያ ምን ይላል?',
  'ቤቴ ውስጥ ብሮድባንድ ኢንተርኔት እንዴት ልመዝገብ?',
  'ስልኬ በ5ጂ ኔትወርክ ይሰራል?',
  'how much is the 1 GB data package on Ethio telecom?',
  'does Safaricom Ethiopia offer VoLTE?',
  'how do I register my SIM card?',
  'what is the roaming package for the UAE?',
  'can I use eSIM on Ethio telecom?',
  'who regulates telecom in Ethiopia and how do I complain?',
  'what does the Ethiopian Communications Authority say about SIM registration?',
  'how much is postpaid mobile per month?',
  'what is the USSD code to check my airtime?',
  'what is the customer care number and mobile network coverage in Jimma?',
  'my data and internet keep running out',
  // the regulator's Amharic spellings carry a suffix (ባለሥልጣኑ), the universal-access fund and the postpaid words are
  // telecom's alone, and a dialing code is a telecom question with no operator named
  'ወደ ኮሙኒኬሽን ባለሥልጣኑ በስንት ቀን ውስጥ ማመልከት እችላለሁ?',
  'ለሁለንተናዊ ተደራሽነት ፈንድ ስንት በመቶ ይከፈላል?',
  'የድህረ ክፍያ ጥቅል ስንት ብር ነው?',
  'what is the international dialing code for Bahrain?',
];

const NOT_TELECOM = [
  'ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?',
  'ሆቴል ውስጥ ዋይፋይ አለ?',
  'የቤት ኪራይ ውል የት ይመዘገባል?',
  'ተ.እ.ታ ስንት ነው?',
  'ዛሬ ምን ፊልም አለ?',
  'የባንክ ብድር ወለድ ስንት ነው?',
  'how do I open a bank account?',
  'what is the VAT rate in Ethiopia?',
  'how much is a ride to the airport?',
  'book me a hotel room in Addis',
  'what tenders are open this week?',
  'how much baggage can I take in economy?',
  'how do I get a trade licence?',
];

test('a telecom question is recognised', () => {
  for (const q of TELECOM) assert.equal(T.isTelecomQuestion(q), true, 'missed: ' + q);
});

test('another BinaSmart service keeps its own question', () => {
  for (const q of NOT_TELECOM) assert.equal(T.isTelecomQuestion(q), false, 'wrongly claimed: ' + q);
});

test('a pure telebirr or mobile-money question is not pulled to telecom', () => {
  for (const q of [
    'ቴሌብር 1,000 ብር ለመላክ ስንት ያስከፍላል?',
    'ቴሌብር ውስጥ ገንዘብ እንዴት ላስገባ?',
    'how do I send money with telebirr?',
    'what is telebirr and how do its limits work?',
    'what does M-PESA charge to withdraw cash?',
    'ኤም-ፔሳ ምንድን ነው?',
  ]) assert.equal(T.isTelecomQuestion(q), false, 'wrongly claimed a wallet question: ' + q);
});

test('a hard telecom word beats a wallet word in the same sentence, and the preference still names banking', () => {
  const q = 'what does Ethio telecom charge for a data package bought with telebirr?';
  assert.equal(T.isTelecomQuestion(q), true);
  assert.equal(T.hasTelecomHardWord(q), true);
  assert.ok(T.PREFER.includes('banking'), 'the telebirr half of the answer lives in banking');
  assert.equal(T.telecomWins(q, { banking: true }), true, 'a hard telecom word takes the preference from banking');
});

test('soft telecom signal wins nothing another pack has claimed', () => {
  assert.equal(T.hasTelecomHardWord('my data and internet keep running out'), false);
  assert.equal(T.telecomWins('my data and internet keep running out', {}), true);
  assert.equal(T.telecomWins('my data and internet keep running out', { banking: true }), false);
  assert.equal(T.telecomWins('my data and internet keep running out', { business: true }), false);
  assert.equal(T.telecomWins('my data and internet keep running out', { travel: true }), false);
});

test('the airline eSIM add-on stays with travel; Ethio telecom eSIM goes to telecom', () => {
  // build-1 probe: the Ethiopian Airlines eSIM page outranked Ethio telecom own eSIM page.
  const airline = 'how much is the Ethiopian Airlines eSIM add-on for my flight?';
  assert.equal(T.isTelecomQuestion(airline), false, 'the airline word ends the soft test');
  const both = 'does the Ethiopian Airlines eSIM work on an Ethio telecom data package?';
  assert.equal(T.hasTelecomHardWord(both), true);
  assert.equal(T.namesAirline(both), true);
  assert.equal(T.telecomWins(both, { travel: true }), false, 'a message that names the airline stays travel');
  const ours = 'which Ethio telecom data package should I use for my flight to Dubai?';
  assert.equal(T.namesAirline(ours), false);
  assert.equal(T.telecomWins(ours, { travel: true }), true, 'an Ethio telecom question that mentions a flight is telecom');
  assert.equal(T.telecomWins('does Ethio telecom support eSIM?', {}), true);
});

test('a business HARD word keeps a licence question with the licence counter', () => {
  const q = 'I need a business licence for a company that resells Ethio telecom SIM cards';
  assert.equal(T.hasTelecomHardWord(q), true);
  assert.equal(T.telecomWins(q, { business: true, businessHard: true }), false);
  assert.equal(T.telecomWins(q, { business: true, businessHard: false }), true);
});

test('a soft word alone is not enough', () => {
  for (const q of ['data', 'ዳታ', 'internet', 'ደቂቃ', 'network']) assert.equal(T.isTelecomQuestion(q), false, q);
  assert.equal(T.isTelecomQuestion('data and internet'), true, 'two distinct soft words are');
});

test('it never throws on rubbish', () => {
  for (const q of [null, undefined, '', 0, {}, []]) assert.equal(T.isTelecomQuestion(q), false);
  assert.equal(T.telecomWins(null), false);
});

test('PREFER is a soft boost for telecom, banking and law - never a filter', () => {
  assert.deepEqual(T.PREFER, ['telecom', 'banking', 'law']);
  const m = pageMatcher(T.PREFER);
  assert.equal(m('telecom', 'telecom-safaricom-packages-data'), true);
  assert.equal(m('banking', 'ethiotelecom-am-telebirr-faq'), true, 'the Amharic FAQ that answers SIM replacement is a banking document');
  assert.equal(m('law', 'telecom-consumer-complaint-eca-directive-832-2021'), true);
  assert.equal(m('travel', 'baggage-information-free-baggage-allowance'), false);
  assert.equal(m('guide', 'open-bank-account-ethiopia'), false);
  const o = contextSearchOptions({ prefer: T.PREFER });
  assert.deepEqual(o.prefer, T.PREFER);
  assert.equal(o.sources, undefined, 'a filter would drop the banking FAQ that answers Amharic SIM questions');
});

test('the word tables do not overlap between tiers', () => {
  const seen = new Map();
  for (const tier of ['HARD', 'OTHER_SERVICE', 'STRONG', 'WEAK'])
    for (const w of T[tier]) {
      const prev = seen.get(w);
      assert.equal(prev, undefined, JSON.stringify(w) + ' is in both ' + prev + ' and ' + tier);
      seen.set(w, tier);
    }
});

test('the telecom intent does not claim what the banking intent recognises first', () => {
  const { isBankingQuestion } = require('../../assistant/banking');
  for (const q of ['what is telebirr and how do its limits work?', 'ቴሌብር 1,000 ብር ለመላክ ስንት ያስከፍላል?', 'how do I open a bank account?']) {
    assert.equal(isBankingQuestion(q), true, 'banking missed: ' + q);
    assert.equal(T.isTelecomQuestion(q), false, 'telecom wrongly claimed a banking question: ' + q);
  }
});

test('server.js consults the telecom intent and merges it after the others', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(src.includes("const biniTelecom = require('./assistant/telecom');"), 'assistant/telecom is not required');
  assert.match(src, /biniTelecom\.telecomWins\(msg, \{ travel: !!travelPrefer\.prefer, banking: !!bankingPrefer\.prefer, business: !!businessPrefer\.prefer, businessHard: biniBusiness\.hasBusinessHardWord\(msg\) \}\)/,
    'the route must ask the telecom intent with the other three verdicts');
  assert.ok(src.includes('...(businessWins ? businessPrefer : {}), ...telecomPrefer };'), 'the telecom preference is not merged last');
  assert.ok(src.includes('knowledge.contextFor(msg, { lang, ...packPrefer })'), 'contextFor is not given the merged preference');
});

test('Dr Afiya never reads the telecom pack, and Asmat keeps only the regulator\'s documents', () => {
  const afiya = require('../../agents/afiya/rules').knowledge;
  const asmat = require('../../agents/asmat/rules').knowledge;
  assert.equal(afiya.prefer.includes('telecom'), false);
  assert.equal(asmat.prefer.includes('telecom'), false);
  const afiyaOut = pageMatcher(afiya.exclude), asmatOut = pageMatcher(asmat.exclude);
  for (const slug of ['telecom-ethiotelecom-student-package', 'telecom-safaricom-packages-data', 'telecom-eca-directive-799-2021-sim-card-registration'])
    assert.equal(afiyaOut('telecom', slug), true, 'Afiya must not read ' + slug);
  for (const slug of ['telecom-ethiotelecom-am-student-package', 'telecom-ethiotelecom-faq', 'telecom-safaricom-packages-data', 'telecom-safaricom-fixed-service-fiber'])
    assert.equal(asmatOut('telecom', slug), true, 'Asmat must not read the commercial page ' + slug);
  for (const slug of ['telecom-eca-directive-799-2021-sim-card-registration', 'telecom-eca-communications-service-proclamation-1148-2019', 'telecom-eca-consumer-affairs'])
    assert.equal(asmatOut('telecom', slug), false, 'Asmat keeps the ECA document ' + slug);
});

test('a public workspace keeps the ECA law but not the commercial pages', () => {
  const ws = fs.readFileSync(path.join(__dirname, '..', '..', 'workspaces', 'index.js'), 'utf8');
  assert.ok(ws.includes("'telecom:telecom-ethiotelecom-*'") && ws.includes("'telecom:telecom-safaricom-*'"));
  assert.equal(ws.includes("'telecom'"), false, 'a whole-source exclusion would drop the regulator too');
});
