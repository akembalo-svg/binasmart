'use strict';
// Is this message about money at a bank? The question that points Bini's retrieval at the banking pack
// (knowledge/banking, source `banking`). Same three tiers as assistant/travel.js, different vocabulary —
// the machine is in assistant/intent.js.
//
// The collision here is worse than the airline's, because BinaSmart itself takes money. A ride has a fare, a
// hotel room has a price, rent is collected, an invoice is issued, and the repository holds the VAT and
// income-tax proclamations, which belong to `law` and to Asmat. So a money word proves nothing on its own;
// what matters is WHOSE money. The other-service tier is long here for that reason, and it runs before every
// soft banking word.
const { makeIntent } = require('./intent');

// Only banking and payments say these. One is enough, and it beats the other-service guard: "I paid for the
// taxi by card, but what does the bank charge on an overdraft" is a banking question with a taxi in it.
const HARD = [
  'ባንክ', 'ባንኩ', 'ባንኮች', 'ብድር', 'ወለድ', 'የውጭ ምንዛሪ', 'ምንዛሪ', 'ሐዋላ', 'ሃዋላ', 'ተቀማጭ', 'ቁጠባ ሂሳብ', 'የቁጠባ ሂሳብ',
  'ወለድ አልባ', 'ዲያስፖራ ሂሳብ', 'ኤቲኤም', 'ዴቢት ካርድ', 'ክሬዲት ካርድ', 'ማስያዣ', 'ተበዳሪ', 'አበዳሪ', 'ቼክ መጽሐፍ',
  'bank', 'banks', 'banking', 'bank account', 'savings account', 'current account', 'deposit account',
  'loan', 'loans', 'credit facility', 'overdraft', 'mortgage', 'collateral', 'interest rate', 'interest rates',
  'forex', 'foreign exchange', 'exchange rate', 'exchange rates', 'remittance', 'remittances', 'money transfer',
  'western union', 'moneygram', 'swift', 'iban', 'kyc', 'know your customer', 'anti-money laundering', 'aml',
  'telebirr', 'm-pesa', 'mpesa', 'cbe birr', 'ethswitch', 'atm', 'debit card', 'credit card', 'pos machine',
  'interest-free banking', 'interest free banking', 'islamic banking', 'murabaha', 'mudarabah', 'wadiah',
  'diaspora account', 'foreign currency account', 'treasury bill', 'capital market', 'stock exchange',
  'deposit insurance', 'cheque book', 'bank statement', 'bank tariff', 'bank charges',
];
// Another BinaSmart service, or another knowledge source, owns the question — unless a HARD word says
// otherwise. `ግብር`, `tax`, `vat` and `ተ.እ.ታ` are here because tax is knowledge/law's and Asmat's: a VAT
// question pulled into a bank's tariff page is a wrong answer that looks right.
const OTHER_SERVICE = [
  'ታክሲ', 'ጋራ ጉዞ', 'ሾፌር', 'መኪና ኪራይ', 'ሆቴል', 'ሲኒማ', 'ፊልም', 'ሆስፒታል', 'ክሊኒክ', 'ጨረታ',
  'ግብር', 'ተ.እ.ታ', 'ተእታ', 'ቫት', 'ንግድ ፈቃድ', 'ኪራይ', 'ተከራይ', 'አከራይ', 'ደረሰኝ', 'በረራ', 'ሻንጣ', 'አውሮፕላን',
  'taxi', 'ride', 'rides', 'pool', 'driver', 'car rental', 'hotel', 'cinema', 'film', 'movie',
  'hospital', 'clinic', 'tender', 'tenders', 'vat', 'tax', 'taxes', 'income tax', 'turnover tax', 'stamp duty',
  'customs duty', 'business licence', 'business license', 'rent', 'tenant', 'landlord', 'invoice', 'receipt',
  'flight', 'baggage', 'airline', 'check-in',
];
// Banking words that other things also use. One decides it, once no other service has claimed the message.
const STRONG = [
  'ሂሳብ ለመክፈት', 'ሂሳብ መክፈት', 'ሂሳብ ከፍቻለሁ', 'የባንክ ሂሳብ', 'የክፍያ ካርድ', 'ሞባይል ባንኪንግ', 'ኢንተርኔት ባንኪንግ',
  'የምንዛሪ ተመን', 'ገንዘብ ላክ', 'ገንዘብ ለመላክ',
  // the Amharic mirror of 'receive money from abroad': ገንዘብ on its own is only a WEAK word, and both spellings of ሀገር occur
  'ከውጭ ሀገር ገንዘብ', 'ከውጭ አገር ገንዘብ', 'ቅርንጫፍ',
  'open an account', 'account opening', 'mobile banking', 'internet banking', 'digital banking',
  'wire transfer', 'send money abroad', 'receive money from abroad', 'minimum balance', 'account balance',
  'branch', 'branches', 'tariff', 'service charge', 'card issuance', 'pin code',
];
// Two distinct ones of these, and the message is about banking.
const WEAK = [
  'ገንዘብ', 'ብር', 'ክፍያ', 'ካርድ', 'ሂሳብ', 'ቀሪ ሂሳብ', 'ዶላር', 'ዩሮ', 'ፓውንድ', 'ዲያስፖራ', 'ወኪል', 'ማንነት መታወቂያ',
  'money', 'birr', 'etb', 'dollar', 'dollars', 'usd', 'euro', 'payment', 'payments', 'card', 'cards',
  'balance', 'fee', 'fees', 'charge', 'charges', 'deposit', 'withdraw', 'withdrawal', 'diaspora',
  'agent', 'identification', 'passbook', 'opening hours',
];

const isBankingQuestion = makeIntent({ hard: HARD, otherService: OTHER_SERVICE, strong: STRONG, weak: WEAK });

// What Bini prefers on a banking question: the pack, plus BinaSmart's own two money pages — the
// open-a-bank-account guide (source `guide`) and the diaspora page (source `page`). Deliberately short. The
// tax guides are NOT here: a bank tariff and a VAT proclamation answer different questions, and naming the
// tax guides would move the tie-breaker onto them for every fee question.
const PREFER = ['banking', 'guide:open-bank-account-ethiopia', 'page:diaspora'];

// What this pack is not. Added to Bini's system prompt for the message that triggered the preference, so the
// limits are stated where the answer is written rather than hoped for. Four things:
//   it cannot touch an account, it cannot move money, it does not advise, and every figure it gives is dated
//   and attributed, because a rate quoted without a date and a bank's name is worse than no rate at all.
const GUARDRAILS = '\n\n## Money questions — what you may and may not do\n'
  + 'BinaSmart is not a bank, a broker or a licensed adviser, and you have no access to anybody\'s account.\n'
  + '- You may explain what an Ethiopian institution publishes: fees, tariffs, interest rates, account types, '
  + 'requirements, procedures, and how something works. Name the institution and the date of the page every time.\n'
  + '- You may NOT check a balance, open or close an account, move, send, convert or hold money, apply for a '
  + 'loan or a card, or accept an account number, a card number, a PIN or a password. If the person offers one, '
  + 'tell them not to share it with anyone, including you.\n'
  + '- You may NOT give advice. Never say which bank, loan, account or currency someone should choose, never predict '
  + 'a rate, and never say whether a deal is good. Lay out what the institutions publish and let them decide.\n'
  + '- Every figure you give carries its source and its date, in the form "Zemen Bank\'s tariff page, fetched '
  + '16 September 2026". Rates, fees and exchange rates change without notice; say so, and tell them to confirm '
  + 'with the bank. If the pack does not hold the figure, say plainly that you do not have it — never estimate a '
  + 'rate, a fee or a limit from memory.\n'
  + '- BinaSmart has no source for telebirr or M-PESA fees and limits: those sites do not answer from our '
  + 'server. Say so rather than guessing.\n'
  + 'በአማርኛ፦ ቢና ባንክ አይደለም። የማንም ሰው ሂሳብ ማየት፣ ገንዘብ ማንቀሳቀስ ወይም ማመልከት አትችልም። የሂሳብ ቁጥር፣ የካርድ ቁጥር፣ '
  + 'ፒን ወይም የይለፍ ቃል በጭራሽ አትቀበል። የትኛው ባንክ ወይም ብድር እንደሚሻል አትምከር። ማንኛውም ቁጥር የተቋሙን ስምና '
  + 'የተወሰደበትን ቀን ይዞ ይቅረብ፤ ተመኖችና ክፍያዎች ይለወጣሉና ባንኩን እንዲያረጋግጡ ንገራቸው። መረጃው ከሌለህ እንደሌለህ ተናገር።\n';

module.exports = { isBankingQuestion, PREFER, GUARDRAILS, HARD, OTHER_SERVICE, STRONG, WEAK };
