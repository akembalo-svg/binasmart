'use strict';
// Is this message about doing business with an Ethiopian office? The question that points Bini's retrieval at
// the business pack (knowledge/business, source `business`). Same three tiers as assistant/travel.js and
// assistant/banking.js, different vocabulary - the machine is in assistant/intent.js.
//
// The collision here is with our own KNOWLEDGE rather than with our own services. knowledge/law holds the
// VAT, income-tax, turnover-tax, stamp-duty, customs, labour and trade-competition proclamations, and Asmat
// answers from them. So the line this file draws, and the design states, is:
//
//     a tax PROCEDURE at an office is this pack's; the text of a tax RULE is law's.
//
// "How do I get a TIN" is a counter. "What is the VAT rate" is a statute. That is why `tin registration`
// and `tax clearance certificate` are HARD here while `vat rate`, `income tax rate` and `proclamation` are
// OTHER_SERVICE - the tier that runs before every soft business word.
const { makeIntent, rxOf, hits, fold } = require('./intent');

// Only this sector says these. One is enough, and it beats the other-service guard: "I paid the bank, but
// what does a trade licence renewal cost" is a licence question with a bank in it.
const HARD = [
  'ንግድ ፈቃድ', 'የንግድ ፈቃድ', 'የንግድ ምዝገባ', 'የንግድ ስም ምዝገባ', 'ግብር ከፋይ መለያ ቁጥር', 'የግብር ክሊራንስ',
  'የኢንቨስትመንት ፈቃድ', 'የሥራ ፈቃድ', 'ኢንዱስትሪ ፓርክ', 'ጉምሩክ ዲክላራሲዮን', 'የመመዝገቢያ ካፒታል',
  'የንግድ ምልክት', 'የፈጠራ ባለቤትነት', 'የንግድ ምክር ቤት', 'ፈቃዴን ማደስ', 'ፈቃዱን ማደስ', 'ንግድ ፈቃዴ',
  'business licence', 'business license', 'trade licence', 'trade license', 'trade name registration',
  'commercial registration', 'business registration', 'tin registration', 'taxpayer identification number',
  'tax clearance certificate', 'sales register machine', 'investment permit', 'investment licence',
  'industrial park', 'one-stop shop', 'one stop shop', 'customs declaration', 'electronic single window',
  'franco valuta', 'import licence', 'import license', 'export licence', 'export license', 'work permit',
  'trademark registration', 'patent registration', 'register a trademark', 'licence renewal',
  'license renewal', 'renew my licence', 'renew my license', 'chamber of commerce',
];
// Another BinaSmart service, or another knowledge source, owns the question - unless a HARD word says
// otherwise. The tax-RULE words are here, and that is the whole point of the tier: a VAT-rate question
// answered from a ministry procedure page is a wrong answer that looks right, and the proclamation that
// answers it properly is Asmat's.
const OTHER_SERVICE = [
  'ታክሲ', 'ጋራ ጉዞ', 'ሾፌር', 'መኪና ኪራይ', 'ሆቴል', 'ሲኒማ', 'ፊልም', 'ሆስፒታል', 'ክሊኒክ', 'ጨረታ',
  'ባንክ', 'ብድር', 'ወለድ', 'ምንዛሪ', 'ሐዋላ', 'ተቀማጭ', 'ኤቲኤም', 'በረራ', 'ሻንጣ', 'አውሮፕላን',
  'ኪራይ', 'ተከራይ', 'አከራይ', 'ተ.እ.ታ', 'ተእታ', 'ቫት', 'የተጨማሪ እሴት ታክስ', 'አዋጅ', 'ደንብ',
  'ፍርድ ቤት', 'ጠበቃ', 'ክስ', 'ልመሥርት', 'አሰናበተኝ',
  'taxi', 'ride', 'rides', 'pool', 'driver', 'car rental', 'hotel', 'cinema', 'film', 'movie',
  'hospital', 'clinic', 'tender', 'tenders', 'bank', 'banks', 'loan', 'interest rate', 'exchange rate',
  'remittance', 'telebirr', 'm-pesa', 'mpesa', 'atm', 'flight', 'baggage', 'airline', 'check-in',
  'rent', 'tenant', 'landlord', 'vat rate', 'income tax rate', 'tax bracket', 'tax brackets',
  'turnover tax rate', 'stamp duty', 'proclamation', 'court', 'lawyer', 'lawsuit', 'my case', 'sue',
];
// Business words that other things also use. One decides it, once no other service has claimed the message.
const STRONG = [
  'ፈቃድ ማደስ', 'ግብር ከፋይ', 'ቀረጥ', 'ጉምሩክ', 'አስመጪ', 'ላኪ', 'የሥራ ውል', 'የጡረታ መዋጮ',
  'አክሲዮን ማህበር', 'ኃላፊነቱ የተወሰነ', 'ግለሰብ ነጋዴ', 'ማህበር ለማቋቋም', 'ድርጅት ለመመዝገብ', 'ንግድ ለመጀመር',
  'register a business', 'register a company', 'start a business', 'sole proprietor', 'plc',
  'share company', 'paid-up capital', 'minimum capital', 'import export', 'import-export',
  'clear goods', 'customs duty', 'duty band', 'employment contract', 'pension contribution',
  'severance pay', 'foreign investor', 'certificate of competence', 'single window', 'investment incentive',
  'investment incentives', 'tax holiday', 'duty-free', 'duty free',
];
// Two distinct ones of these, and the message is about business.
const WEAK = [
  'ንግድ', 'ድርጅት', 'ኩባንያ', 'ፈቃድ', 'ምዝገባ', 'ካፒታል', 'ሠራተኛ', 'አሠሪ', 'ደመወዝ', 'ማህተም',
  'ሰነድ', 'ማመልከቻ', 'ቢሮ', 'ክፍያ', 'ሰርተፊኬት', 'ማደስ', 'መመዝገብ',
  'business', 'company', 'firm', 'licence', 'license', 'permit', 'register', 'registration',
  'capital', 'employee', 'employer', 'salary', 'document', 'application', 'office', 'fee', 'fees',
  'renewal', 'certificate', 'stamp', 'ministry', 'bureau', 'tin',
];

const isBusinessQuestion = makeIntent({ hard: HARD, otherService: OTHER_SERVICE, strong: STRONG, weak: WEAK });

// Does the message carry a word only this sector uses? This is the banking/business tie-breaker server.js
// applies, and it is needed because a message can honestly be both: "I paid the bank, but what does a trade
// licence renewal cost" is a licence question with a bank in it, and `isBankingQuestion` says true of it as
// well. The rule: a HARD word here takes the +0.06 preference back from the banking pack; with only soft
// business signal the banking pack keeps it, because `bank`, `loan` and `interest rate` are OTHER_SERVICE
// words above precisely because that question is the bank's. Both guardrail blocks are appended either way -
// only one pack can hold the tie-breaker, but a limit is not a preference.
const HARD_RE = rxOf(HARD);
const hasBusinessHardWord = msg => hits(HARD_RE, fold(msg)).size > 0;

// What Bini prefers on a business question: the pack, three of BinaSmart's own business guides, and the
// eServices directory, which is the only thing in the repository that answers WHICH office. Deliberately
// short, and deliberately without `law`: a licence-procedure question pulled onto the VAT proclamation is
// the mirror image of the mistake the banking pack avoided by keeping the tax guides out of ITS prefer list.
const PREFER = ['business', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia',
  'guide:tin-registration-ethiopia', 'eservices'];

// What this pack is not. Added to Bini's system prompt for the message that triggered the preference, so the
// limits are stated where the answer is written rather than hoped for. The wording follows the banking
// pack's, including the clause it had to learn: the identifier warning is its own clause rather than the
// second half of a sentence whose first half has already been obeyed.
//
// Dating and attribution is no longer here either. It said the same thing as the banking block, and between
// them the two blocks only reached a message one of the two packs claimed — which the Ministry of Labour
// audit of 2026-09-18 measured as 10 of 40 answers carrying a date. It is in assistant/dating.js now, in the
// base prompt for every message.
const GUARDRAILS = '\n\n## Business, licence and paperwork questions — what you may and may not do\n'
  + 'BinaSmart is not the Ministry of Trade, the Revenue office, the Customs Commission or the Investment '
  + 'Commission, and is not a lawyer, an accountant or a customs broker. You can see no register of any kind.\n'
  + '- You may explain what an Ethiopian office publishes: the steps, the documents required, the fees, the '
  + 'thresholds, the capital requirements, the contribution rates and the processing times. Name the office '
  + 'and the date of the page every time.\n'
  + '- You may NOT register, renew, submit, lodge, file or apply for anything on anyone\'s behalf, book an '
  + 'appointment, fill in a form for them, or pay a fee. Explain what the form asks and where it is lodged.\n'
  + '- You may NOT accept a TIN, a licence number, a business registration number, a passport or Fayda '
  + 'number, a password or a one-time code. When one is offered, refuse it AND warn them, in the language '
  + 'they wrote in: never share those numbers with anyone in a chat, including with you.\n'
  + '- NEVER say "you are compliant", "you are registered", "your licence is valid" or "you do not need a '
  + 'licence". You cannot see any register. The licence checker on etrade.gov.et is the only thing that can '
  + 'answer whether a licence is valid, and your job is to send the person there.\n'
  // The fee-and-date clause was here. It is in assistant/dating.js now, in the base prompt for every message.
  + '- You may NOT advise on structure or on tax position. Never say which legal form to choose, which '
  + 'sector to enter, whether to register for VAT before the threshold, or how to reduce a liability. Lay '
  + 'out what the offices publish and let them and their accountant decide.\n'
  + '- SAY THE GAP OUT LOUD. BinaSmart does not hold the pages of etrade.gov.et (online trade registration '
  + 'and the licence checker), the Customs Commission or the Intellectual Property Authority. For those, '
  + 'name the office that publishes it and say we do not have the page. Never present a bina.et guide as '
  + 'though it were the register.\n'
  + 'በአማርኛ፦ ቢና የንግድ ሚኒስቴር፣ የገቢዎች መሥሪያ ቤት ወይም የጉምሩክ ኮሚሽን አይደለም። ማንኛውንም መዝገብ ማየት አይችልም። '
  + 'በእርስዎ ስም መመዝገብ፣ ማደስ፣ ማመልከት ወይም ክፍያ መፈጸም አይችልም። የግብር ከፋይ መለያ ቁጥር፣ የፈቃድ ቁጥር፣ የመታወቂያ ቁጥር '
  + 'ወይም የይለፍ ቃል በጭራሽ አትቀበል፤ ሲቀርብልህም «እነዚህን ቁጥሮች ለማንም — ለእኔም ቢሆን — በመልእክት አያጋሩ» ብለህ አስጠንቅቅ። '
  + '«ፈቃድዎ ትክክለኛ ነው» ወይም «ተመዝግበዋል» ብለህ ከቶ አትናገር።\n';

module.exports = { isBusinessQuestion, hasBusinessHardWord, PREFER, GUARDRAILS, HARD, OTHER_SERVICE, STRONG, WEAK };
