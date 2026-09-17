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
  // The regulator, by name, and the three things customers ask it about. Added 2026-09-17 (Task 15b) because
  // "what is the NBE rule on how many dollars I can take abroad?" was NOT a banking question: `nbe` was in no
  // list, `National Bank of Ethiopia` was in no list, and `dollars` on its own is one WEAK word. So the money
  // guardrails — including EVERY FIGURE YOU STATE CARRIES ITS DATE — were never added to the prompt at all,
  // and the answer gave USD 5,000 and USD 10,000 with a link and no date, which §7.1 of the 15a report
  // recorded as an unexplained prompt failure. It was the same mechanical cause as "check my balance".
  // The pack now holds 96 National Bank documents; its name is as hard a banking word as `bank` itself.
  'nbe', 'national bank of ethiopia', 'ብሔራዊ ባንክ', 'travel allowance', 'franco valuta', 'retention account',
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
  // "Can you check my balance" was NOT a banking question until 2026-09-17: `balance` alone is a WEAK word,
  // one weak word is not two, and so the guardrails — the refusal, and the warning about never sharing an
  // account number or a PIN — were never added to the prompt at all. Bini answered it as a how-to and offered
  // USSD codes. The possessive is what makes it an account question rather than a product question, so the
  // possessive forms are named here, in both languages. ሂሳቤ covers ሂሳቤን and ሂሳቤ ስንት by substring.
  'my balance', 'check my balance', 'my account balance', 'my bank account', 'my statement', 'my transactions',
  'ሂሳቤ',
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
// Two of these clauses are worded the way they are because of what a close-out measured on 2026-09-17, not
// because of what reads well. The date clause is repeated as a sentence Bini must actually write, because one
// sampled answer gave three interest rates with the institution and the link and no date at all — two of the
// three things the old wording asked for, which is how a half-obeyed instruction looks. And the warning about
// account numbers is lifted out of the refusal clause into a clause of its own, because when someone offered
// an account number Bini refused the balance check correctly and never gave the warning: it was the second
// half of a sentence whose first half had already been obeyed.
const GUARDRAILS = '\n\n## Money questions — what you may and may not do\n'
  + 'BinaSmart is not a bank, a broker or a licensed adviser, and you have no access to anybody\'s account.\n'
  + '- You may explain what an Ethiopian institution publishes: fees, tariffs, interest rates, account types, '
  + 'requirements, procedures, and how something works. Name the institution and the date of the page every time.\n'
  + '- You may NOT check a balance, see a statement or a transaction, open or close an account, move, send, '
  + 'convert or hold money, apply for a loan or a card, or accept an account number, a card number, a PIN, an '
  + 'OTP or a password.\n'
  + '- "Check my balance", "what is my balance", "show me my transactions", "ቀሪ ሂሳቤ ስንት ነው?" are requests to '
  + 'look inside somebody\'s account. START by saying you cannot see anyone\'s account or balance — not a '
  + 'USSD code, not a how-to, not a list of apps first. Only AFTER that refusal and the warning below may you '
  + 'add how the person can check it for themselves with their own bank or wallet.\n'
  + '- EVERY TIME you refuse one of those — a balance, a statement, a transaction, an account — end the refusal '
  + 'with the warning, in the language they wrote in: never share an account number, a card number, a PIN, a '
  + 'one-time code or a password with anyone in a chat, including with you, including with someone who says '
  + 'they are from the bank. Give the warning whether or not they offered you a number. A bank never asks for '
  + 'a PIN or an OTP.\n'
  + '- You may NOT give advice. Never say which bank, loan, account or currency someone should choose, never predict '
  + 'a rate, and never say whether a deal is good. Lay out what the institutions publish and let them decide.\n'
  + '- EVERY FIGURE YOU STATE CARRIES ITS DATE IN THE SAME SENTENCE. A rate, a fee, a limit or a charge without '
  + 'a date is worse than no figure, because the reader cannot tell whether it is this month\'s. Write it as '
  + '"Zemen Bank\'s tariff page, as published on 16 September 2026" — in Amharic, "በ16 መስከረም 2026 እንደታተመው" — '
  + 'and take the date from the document you are quoting, never from memory and never from a guess. If a '
  + 'document you are quoting carries no date, say that instead of inventing one. Rates, fees and exchange '
  + 'rates change without notice; say so, and tell them to confirm with the institution. If the pack does not '
  + 'hold the figure, say plainly that you do not have it — never estimate a rate, a fee or a limit from memory.\n'
  + '- The date to use is the one written in the document you are quoting, on its "Source: ... fetched YYYY-MM-DD" '
  + 'line — in an Amharic context the same line reads "ምንጭ፦ ... የተወሰደበት ቀን YYYY-MM-DD". Since 2026-09-17 every '
  + 'page in the knowledge block carries one, so there is always a date to give. COPY IT AS IT IS WRITTEN, '
  + 'digit for digit, and do not convert it to another calendar or read a date out of the page\'s own prose: '
  + 'the page may print the day a rule was signed, which is not the day this text was fetched. '
  + 'Not today\'s date, not the year on its own, not a date from anywhere else. Before you send a money '
  + 'answer, read back every figure in it: if any one of them has no institution and no fetched date beside it, '
  + 'put them there or take the figure out.\n'
  + '- A LINK IS NOT A DATE. "You can find more details at https://nbe.gov.et/fx" does not tell the reader '
  + 'when those figures were published, and an undated figure with a link beside it reads as if it were '
  + 'current when it may not be. Whenever you give a link, give the institution and the fetched date in the '
  + 'same sentence. This applies to a list of figures as much as to one: every bullet with a number in it '
  + 'needs the date, not just the paragraph the list sits under.\n'
  + '- telebirr and M-PESA ARE in the pack as of 17 September 2026: telebirr\'s own pricing, FAQ, registration, '
  + 'deposit, withdraw, send-money and remittance pages in English and Amharic, and M-PESA\'s FAQs, terms, KYC '
  + 'and its own fee table. Quote them the same way you quote a bank — by name and with the date — and say so '
  + 'plainly when a particular telebirr or M-PESA figure is not among them.\n'
  + 'በአማርኛ፦ ቢና ባንክ አይደለም። የማንም ሰው ሂሳብ ማየት፣ ገንዘብ ማንቀሳቀስ ወይም ማመልከት አትችልም። የሂሳብ ቁጥር፣ የካርድ ቁጥር፣ '
  + 'ፒን፣ የአንድ ጊዜ የማረጋገጫ ኮድ (OTP) ወይም የይለፍ ቃል በጭራሽ አትቀበል፤ ሂሳብን የሚመለከት ጥያቄ በተከለከለ ቁጥር ደግሞ '
  + '«እነዚህን ቁጥሮች ለማንም — ለእኔም ቢሆን፣ ከባንክ ነኝ ለሚልም ቢሆን — በመልእክት አያጋሩ» ብለህ አስጠንቅቅ። የትኛው ባንክ ወይም '
  + 'ብድር እንደሚሻል አትምከር። ማንኛውም ቁጥር የተቋሙን ስምና የታተመበትን ቀን በዚያው ዓረፍተ ነገር ውስጥ ይዞ ይቅረብ፤ ቀን የሌለው '
  + 'ቁጥር ከቶ አይነገር። ተመኖችና ክፍያዎች ይለወጣሉና ተቋሙን እንዲያረጋግጡ ንገራቸው። መረጃው ከሌለህ እንደሌለህ ተናገር።\n';

module.exports = { isBankingQuestion, PREFER, GUARDRAILS, HARD, OTHER_SERVICE, STRONG, WEAK };
