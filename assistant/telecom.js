'use strict';
// Is this message about a phone line, a mobile package or the telecom rules? The question that points Bini's
// retrieval at the telecom pack (knowledge/telecom, source `telecom`). Same three tiers as assistant/banking.js
// and assistant/business.js; the machine is in assistant/intent.js.
//
// Three collisions shaped the word lists, and each has a test in test/telecom/bini-telecom-prefer.test.js.
//
//   telebirr and M-PESA. Ethio telecom runs telebirr and Safaricom runs M-PESA, so the operator's name is in
//   half of the questions the banking pack answers. A pure telebirr or mobile-money question stays with the
//   banking pack: `telebirr`, `m-pesa` and the two wallets' Amharic names are OTHER_SERVICE here, which ends
//   the test for any message with no HARD telecom word in it. And when a message does have one ("what does
//   Ethio telecom charge to buy data with telebirr") PREFER still names banking, so nothing is lost.
//
//   The Amharic FAQ. The general Amharic Ethio telecom FAQ was deduplicated against the banking copy of the
//   telebirr FAQ when the pack was built, so Amharic questions about SIM replacement, the number scheme and
//   customer-service hours are answered by a document in `banking` (banking/ethiotelecom-am-telebirr-faq). A
//   preference that pointed only at `telecom` would move the tie-breaker AWAY from the page that answers
//   them, which is why PREFER is a soft boost for three sources and never an exclusive filter.
//
//   The airline. Ethiopian Airlines sells an eSIM add-on, and its page outranked Ethio telecom's own eSIM
//   page in the build-1 probe. A message that names the airline stays with the travel pack; one that names
//   Ethio telecom, or a data package, or a SIM, goes to this pack (see telecomWins).
const { makeIntent, rxOf, hits, fold } = require('./intent');

// Only telecom says these. One is enough, and it beats the other-service guard.
const HARD = [
  'ኢትዮ ቴሌኮም', 'ኢትዮቴሌኮም', 'ኢትዮ ቴሌ', 'ሳፋሪኮም', 'ቴሌኮም', 'ቴሌኮሙኒኬሽን', 'ኮሙኒኬሽን', 'ሁለንተናዊ ተደራሽነት', 'ድህረ ክፍያ',
  'ሞባይል ሼር ፕላን', 'universal access',
  'የኮሙኒኬሽን አገልግሎት', 'ሲም ካርድ', 'ሲም', 'የአየር ሰዓት', 'የአየር ሰአት', 'የአየር ጊዜ', 'የሞባይል ካርድ', 'ሞባይል ካርድ', 'ሮሚንግ',
  'ዳታ ጥቅል', 'የዳታ ጥቅል', 'የድምፅ ጥቅል', 'ድምፅ ጥቅል', 'የሞባይል ጥቅል', 'ሞባይል ጥቅል', 'የኢንተርኔት ጥቅል', 'ኢንተርኔት ጥቅል',
  'ሞባይል ዳታ', 'የሞባይል ዳታ', 'የሞባይል ኢንተርኔት', '4ጂ', '5ጂ', 'ብሮድባንድ', 'ፋይበር ኢንተርኔት', 'ቮልቲኢ', 'ቨርቹዋል ነምበር',
  'ethio telecom', 'ethiotelecom', 'ethio-telecom', 'ethio tel', 'safaricom', 'telecom', 'telecoms', 'telecommunications',
  'telecommunication', 'sim card', 'sim cards', 'sim', 'sims', 'airtime', 'air time', 'roaming', 'data package', 'data packages',
  'data bundle', 'data bundles', 'mobile data', 'mobile package', 'mobile packages', 'voice package', 'sms package',
  'internet package', 'data plan', 'mobile plan', 'postpaid', 'volte', '4g', '5g', 'lte', 'broadband', 'fixed line',
  'fibre internet', 'fiber internet', 'sim registration', 'sim swap', 'network coverage',
  'ethiopian communications authority', 'communications authority', 'communications service proclamation',
  'directive 832', 'directive 799', 'consumer rights directive',
];
// Another BinaSmart service, or another knowledge source, owns the question - unless a HARD word says otherwise.
// The two wallets are here on purpose: see the header.
const OTHER_SERVICE = [
  'ታክሲ', 'ጋራ ጉዞ', 'ሾፌር', 'መኪና ኪራይ', 'ሆቴል', 'ሲኒማ', 'ፊልም', 'ሆስፒታል', 'ክሊኒክ', 'ጨረታ',
  'ቴሌብር', 'ቴሌ ብር', 'ኤም-ፔሳ', 'ኤምፔሳ', 'ባንክ', 'ብድር', 'ወለድ', 'ምንዛሪ', 'ሐዋላ', 'ተቀማጭ', 'ኤቲኤም',
  'በረራ', 'ሻንጣ', 'አውሮፕላን', 'አየር መንገድ', 'ግብር', 'ተ.እ.ታ', 'ንግድ ፈቃድ', 'ኪራይ', 'ተከራይ', 'አከራይ',
  'taxi', 'ride', 'rides', 'pool', 'driver', 'car rental', 'hotel', 'cinema', 'film', 'movie', 'hospital', 'clinic',
  'tender', 'tenders', 'telebirr', 'm-pesa', 'mpesa', 'cbe birr', 'bank', 'banks', 'loan', 'interest rate',
  'exchange rate', 'remittance', 'atm', 'flight', 'flights', 'airline', 'airlines', 'baggage', 'luggage', 'check-in',
  'vat', 'tax', 'income tax', 'business licence', 'business license', 'trade licence', 'rent', 'tenant', 'landlord',
  'invoice',
];
// Telecom words other things also use. One decides it, once no other service has claimed the message.
const STRONG = [
  'ኢ-ሲም', 'ኢሲም', 'ቅድመ ክፍያ', 'የሞባይል አገልግሎት', 'ሞባይል አገልግሎት', 'ኦፕሬተር', 'ፍሪኩዌንሲ', 'ስልክ ቁጥር', 'የሞባይል ቁጥር', 'የስልክ መስመር', 'ኔትወርክ', 'ኔትዎርክ', 'የኔትወርክ ሽፋን', 'ዩኤስኤስዲ',
  'ካርድ መሙላት', 'ካርድ ለመሙላት', 'የደንበኞች አገልግሎት ማዕከል', 'የጥሪ ክፍያ', 'የጥሪ ታሪፍ',
  'esim', 'e-sim', 'dialing code', 'dialling code', 'country code', 'international call', 'international calls', 'phone number', 'mobile number', 'phone line', 'mobile network', 'network signal', 'ussd', 'short code',
  'recharge card', 'top up', 'top-up', 'call rates', 'call charges', 'call tariff', 'customer care', 'prepaid',
  'wifi router', 'mifi', 'home internet', 'business internet',
];
// Two distinct ones of these, and the message is about telecom.
const WEAK = [
  'ዳታ', 'ጥቅል', 'ኢንተርኔት', 'ሞባይል', 'ደቂቃ', 'ጥሪ', 'መልእክት', 'መልዕክት', 'ካርድ', 'ሽፋን', 'ኔትወርክ ሽፋን',
  'data', 'internet', 'mobile', 'network', 'package', 'packages', 'bundle', 'bundles', 'sms', 'minutes', 'call', 'calls',
  'coverage', 'signal', 'card', 'validity', 'fibre', 'fiber', 'wifi',
];

const isTelecomQuestion = makeIntent({ hard: HARD, otherService: OTHER_SERVICE, strong: STRONG, weak: WEAK });

// Does the message carry a word only this sector uses? The tie-breaker against the banking and business packs:
// a HARD telecom word takes the preference from them, soft telecom signal does not.
const HARD_RE = rxOf(HARD);
const hasTelecomHardWord = msg => hits(HARD_RE, fold(msg)).size > 0;

// Names the airline itself. The eSIM add-on Ethiopian Airlines sells is the travel pack's; a message that says
// the airline stays with travel even when it also says eSIM.
const AIRLINE_RE = rxOf(['airline', 'airlines', 'ethiopian airlines', 'አየር መንገድ', 'shebamiles', 'sheba miles', 'cloud nine',
  'boarding pass', 'in-flight', 'inflight']);
const namesAirline = msg => hits(AIRLINE_RE, fold(msg)).size > 0;

// Does telecom take the per-message preference, given which other packs have already claimed the message?
// travel / banking / business are the booleans server.js already has (bankingPrefer.prefer and so on);
// businessHard is biniBusiness.hasBusinessHardWord(msg).
//   - With a HARD telecom word it wins over banking (PREFER names banking too, so a telebirr detail is still
//     boosted), over travel unless the message names the airline, and over business unless a business HARD
//     word is present ("renew my trade licence" is the licence counter's, whoever the operator is).
//   - With only soft telecom signal it wins nothing: any other pack that claimed the message keeps it.
function telecomWins(msg, { travel = false, banking = false, business = false, businessHard = false } = {}) {
  if (!isTelecomQuestion(msg)) return false;
  if (hasTelecomHardWord(msg)) {
    if (travel && namesAirline(msg)) return false;
    if (business && businessHard) return false;
    return true;
  }
  return !travel && !banking && !business;
}

// What Bini prefers on a telecom question: the pack, plus banking and law. Banking because the Amharic general
// Ethio telecom FAQ lives in a banking document and the telebirr pages answer the "how do I pay for this" half
// of a package question; law because the ECA instruments the pack holds sit beside the law library's own
// hand-written telecom summaries. A soft boost for all three, never an exclusive filter.
const PREFER = ['telecom', 'banking', 'law'];

module.exports = { isTelecomQuestion, hasTelecomHardWord, namesAirline, telecomWins, PREFER, HARD, OTHER_SERVICE, STRONG, WEAK };
