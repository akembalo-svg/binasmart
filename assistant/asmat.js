'use strict';
const { foldEthiopic } = require('./lang');
// Asmat (አስማት) — BinaSmart's guide to Ethiopian legal procedure and documents.
//
// What he is: a guide to how things WORK. Which office or court, which proclamation governs a matter, what a
// contract must contain to be valid, what documents to bring, what order the steps go in. He is grounded in
// the guides BinaSmart wrote: tenancy (1320/2024), overseas employment (1389/2025), customs, business
// registration, TIN, VAT, civil records.
//
// What he is NOT, by construction: anyone's lawyer. He does not advise on a case, predict an outcome, tell
// anyone their rights in their particular dispute, or draft anything meant to be filed. He has not read the
// file, he does not know the other side's evidence, and being confidently wrong about a deadline can cost a
// person their claim.
//
// Same shape as assistant/afiya.js on purpose: the urgent cases never reach the model.

// ---------- 1. urgent: answered here, without the model ----------
// Verified number only. Police 991 (knowledge/addis-ababa.md). No invented hotlines: a wrong number in a
// crisis is worse than no number.
const POLICE = '991';

// Both sides folded, as in afiya.js: ሀ/ሐ/ኀ, ሰ/ሠ, አ/ዐ and ጸ/ፀ are the same sounds written
// differently and legal Amharic is full of the pairs - ፍትሕ/ፍትህ, ሰነድ/ሠነድ, ዐቃቤ ሕግ/አቃቤ ህግ.
const foldRe = list => list.map(re => new RegExp(foldEthiopic(re.source), re.flags));

const URGENT = foldRe([
  // detention / arrest happening now
  /ታሰረ|ታስሯል|እስር ቤት|ፖሊስ ወሰደው|ተይዞ|arrested|in custody|detained|police (took|are holding)|held at the station/i,
  // asked to sign right now
  /አሁን ፈርም|እንድፈርም|ፈርመህ|ፈርመሽ|ውል እንድፈርም|sign (this|it) (now|today)|told me to sign|being forced to sign|pressuring me to sign/i,
  // a deadline or hearing that is upon them
  // ችሎት (the session) is commoner than ፍርድ ቤት (the building), and Amharic puts words between the
  // day and the place - "ዛሬ ማታ ፍርድ ቤት". Measured: "ነገ ችሎት አለኝ" was not urgent.
  /(ነገ|ዛሬ|ጠዋት|ማታ)[^።.!?]{0,14}(ፍርድ ቤት|ችሎት|ቀጠሮ)|(ፍርድ ቤት|ችሎት|ቀጠሮ)[^።.!?]{0,10}(ነገ|ዛሬ)|court (tomorrow|today)|hearing (tomorrow|today)|deadline (is )?(today|tomorrow)|expires? (today|tomorrow)/i,

  // eviction / property being taken now
  // Match the VERB, not the noun phrase: ቤት takes a possessive (ከቤቴ = from MY house) and the
  // literal ከቤት stopped matching the moment someone spoke about their own home.
  /(እያ|ሊያ|እያስ|ሊያስ)?አስወጡኝ|እያስወጡኝ|ሊያስወጡኝ|አስወጡኝ|ቤቴን ለቀህ|ንብረቴን ወሰዱ|ንብረቴን ሊወስዱ|ዕቃዬን አወጡ|being evicted|locked me out|throwing me out|bailiffs? (are|at)/i,

  // violence / abuse / threat
  /ይደበድበኛል|ደበደበኝ|ዛተብኝ|ያስፈራራኛል|threatened me|beating me|domestic (violence|abuse)|he hit me|afraid for my (life|safety)/i,
  // a child taken
  /ልጄን ወሰዱ|ልጄን ወሰደ|took my child|child was taken|custody.{0,16}(taken|removed)/i,
  // Afaan Oromoo
  /hidhame|qabame|poolisiin[^.!?]{0,18}fudhate|mana hidhaa/i,
  /amma mallatteess|mallatteessuu[^.!?]{0,18}dirqisiis|mallatteessi jedhan/i,
  /bor mana murtii|har'a mana murtii|beellama bor|yeroon[^.!?]{0,14}dhumuuf/i,
  /mana kiyyaa[^.!?]{0,18}baas|manaa na baas|qabeenya koo fudhat/i,
  /na reeb|na dhaan|na doorsis|sodaadha[^.!?]{0,14}lubbuu/i,
  /mucaa koo fudhat|ijoollee koo fudhat/i,
]);
function isUrgent(msg) { const m = foldEthiopic(String(msg || '')); return URGENT.some(re => re.test(m)); }

function urgentReply(lang) {
  if (lang === 'om') {
    return `⚠️ Kun dhimma ariifachiisaa fakkaata, ani immoo abukaattoo miti.\n\n`
      + `• Waan hin dubbisin yookaan hin hubanne **hin mallatteessin**.\n`
      + `• **Abukaatoo gaafadhu** — mana murtii biratti waajjira abukaatoo uummataa jira.\n`
      + `• Balaan yoo jiru poolisii **${POLICE}** bilbili.\n`
      + `• Waraqaa, ergaa fi maqaa nama sitti dubbate hunda kaa'i.\n\n`
      + `Nama dhugaa waliin walqunnamuuf: https://wa.me/251911244344`;
  }
  if (lang === 'en') {
    return `⚠️ This sounds urgent, and I am not a lawyer.\n\n`
      + `• **Do not sign** anything you have not read or do not understand.\n`
      + `• **Ask for a lawyer.** Courts have a public defender's office; you may also instruct a licensed advocate.\n`
      + `• If anyone is in danger, call the police on **${POLICE}**.\n`
      + `• Keep every document, message and the name of whoever spoke to you.\n\n`
      + `To reach a person at BinaSmart: https://wa.me/251911244344`;
  }
  return `⚠️ ይህ አስቸኳይ ጉዳይ ይመስላል፤ እኔ ደግሞ ጠበቃ አይደለሁም።\n\n`
    + `• ያላነበቡትን ወይም ያልገባዎትን ነገር **አይፈርሙ**።\n`
    + `• **ጠበቃ ይጠይቁ።** በፍርድ ቤቶች የሕዝብ ተከራካሪ ጠበቃ ጽ/ቤት አለ፤ በራስዎም ፈቃድ ያለው ጠበቃ መቅጠር ይችላሉ።\n`
    + `• ማንም አደጋ ላይ ከሆነ ለፖሊስ **${POLICE}** ይደውሉ።\n`
    + `• ሁሉንም ሰነድ፣ መልእክትና ያናገርዎትን ሰው ስም ይያዙ።\n\n`
    + `ሰው ለማነጋገር፦ https://wa.me/251911244344`;
}

// ---------- 2. what he will not do ----------
// Case advice, predictions, and anything meant to be filed.
const CASE_ADVICE = foldRe([
  // Amharic conjugates the person into the verb, so "who will win" (ያሸንፋል) shares no ending with
  // "will I win" (አሸንፋለሁ). Asking what the judge will decide is the same request in other words.
  /አሸንፋለሁ|እናሸንፋለን|ያሸንፋል|ታሸንፋለች|ማን ያሸንፋል|ዳኛው?[^።.!?]{0,12}(ይወስናል|ይፈርዳል)|ፍርድ ቤቱ[^።.!?]{0,12}(ይወስናል|ይፈርዳል)|will i win|who will win|do i have a case|chances? (of|in) (winning|court)|am i going to (win|lose)|what will the (judge|court) (decide|rule)|ውጤቱ ምን ይሆናል/i,

  /ምን ላድርግ.{0,20}(ጉዳዬ|ክሴ|ችሎት)|what should i do (about|in) my (case|situation)|advise me on my case|ጉዳዬን እንዴት/i,
  // ነኝ (I am) / ነው (he is) / ነን (we are) / ነሽ (you are) are the same question about different
  // people. Measured: "ጥፋተኛ ነኝ?" - am I guilty - walked past a gate that only knew ጥፋተኛ ነው.
  /(ጥፋተኛ|ወንጀለኛ)\s*(ነኝ|ነው|ናት|ናቸው|ነን|ነሽ|ነህ|ነኝ\?)|is he guilty|am i guilty|are they guilty|is (this|that) (illegal|a crime)|ወንጀል ነው ወይ/i,

  /ክስ ልመሰርት|ልክሰው|should i sue|should i take (him|her|them) to court|ፍርድ ቤት ልውሰደው/i,
  /መከላከያ|አቤቱታ|ክስ/.source && /(መከላከያ|አቤቱታ|ክስ|ማመልከቻ)[ዬውንህሽ]{0,3}\s*(ጻፍ|ጻፍልኝ|አዘጋጅ|አዘጋጅልኝ)|draft (my|a) (defence|defense|claim|petition|affidavit|statement)|write my (case|appeal|complaint)/i,
  /ውሌ ተቀባይነት አለው|is my contract (valid|enforceable)|is this contract legal|ውሉ ይፀናል/i,
  // Afaan Oromoo: outcome, advice on my case, guilt, suing, drafting, validity
  /nan mo'adhaa|ni mo'annaa|dhimmi koo[^.!?]{0,18}(mo'|injifat)|firiin isaa maal ta'a/i,
  /maal godhu[^.!?]{0,18}dhimma koo|dhimma koo irratti gorsi/i,
  /yakkamaadhaa|balleessaa qabaa|seeraan alaadhaa/i,
  /himata banuu qabaa|mana murtiitti geessuu qabaa/i,
  /naaf barreess|barreessii naaf|himata naaf qopheess/i,
  /waliigalteen koo[^.!?]{0,18}(fudhatama|seera qabeess)/i,
]);
function isCaseAdvice(msg) { const m = foldEthiopic(String(msg || '')); return CASE_ADVICE.some(re => re.test(m)); }

// Someone asking for the document itself, rather than for an explanation of it. They get a blank
// template: the right headings in the right order with the facts left to them. A person with no
// lawyer who files nothing loses by default, and a skeleton is strictly better than a blank page -
// but a skeleton cannot put a fact in their mouth, which a filled-in draft can.
const DRAFT_REQUEST = foldRe([
  // "የመከላከያ ሰነድ ጻፍልኝ" - write me a defence DOCUMENT - put a noun between the subject and the
  // verb, and only a space was allowed. ደብዳቤ (letter) was missing from the list entirely.
  /(አቤቱታ|መከላከያ|ክስ|ማመልከቻ|ይግባኝ|ውል|ስምምነት|ደብዳቤ|ማስረጃ)[ዬውንህሽ]{0,3}[^።.!?]{0,16}(?<![ሲስሳለየበከእንደ])(ጻፍ|ጻፍልኝ|ጽፍ|ጽፍልኝ|አዘጋጅ|አዘጋጅልኝ|ስራልኝ|አርቅቅ)/i,

  /\b(draft|write|prepare)\s+(me\s+)?(a|my|the)\s+(defence|defense|claim|petition|complaint|affidavit|appeal|statement|contract|agreement)/i,
  /(naaf barreess|barreessii naaf|naaf qopheess|himata naaf|falmii naaf)/i,
]);
function isDraftRequest(msg) { const m = foldEthiopic(String(msg || '')); return DRAFT_REQUEST.some(re => re.test(m)); }

// Which skeleton. Deliberately coarse: the four things people actually ask for.
function draftKind(msg) {
  const m = String(msg || '');
  if (/መከላከያ|defence|defense|falmii/i.test(m)) return 'defence';
  if (/ይግባኝ|appeal|ol.?iyyannoo/i.test(m)) return 'appeal';
  if (/ውል|ስምምነት|contract|agreement|waliigaltee/i.test(m)) return 'contract';
  return 'claim';
}

// ---------- 3. the output filter: a verdict is this agent's dosage ----------
// The harm here is a confident legal conclusion someone acts on. Strip sentences that decide the matter.
// A verdict is this agent's dosage. The line moved on 2026-09-11: Asmat may now WEIGH a case, so
// "the strong point here is X, the weak point is Y" has to get through. What must never get through
// is CERTAINTY about an outcome - no lawyer promises that either, and a person who believes it may
// drop a good claim or refuse a fair settlement. So this strips promises, not analysis.
const VERDICT = /\b(you will (definitely |certainly )?(win|lose)|you are (guaranteed|certain to)|is guaranteed|there is no (doubt|chance)|the court will (rule|find|decide|order)|you cannot lose|it is certain)\b|ታሸንፋለህ|ታሸንፋለሽ|ትሸነፋለህ|በእርግጠኝነት ታሸንፋለህ|ፍርድ ቤቱ ይወስንልዎታል|ጉዳዩን በእርግጠኝነት/i;
function stripVerdict(text) {
  const parts = String(text || '').split(/(?<=[.!?።])\s+/);
  const kept = parts.filter(p => !VERDICT.test(p));
  return { text: kept.join(' ').replace(/\s{2,}/g, ' ').trim(), removed: parts.length - kept.length };
}

// ---------- 4. persona ----------
const { loadPrompt } = require('./prompt');
const SYSTEM = loadPrompt('asmat', 'You are Asmat, BinaSmart\'s guide to Ethiopian legal procedure and paperwork. You are not a lawyer and you never promise an outcome. Explain the procedure, the office and the documents. The operational prompt for this agent is not published.');

function disclosure(lang) {
  if (lang === 'om') return 'Ani gargaartuu odeeffannoo BinaSmart — abukaattoo miti, dhimma kee irrattis si hin bakka bu\'u. Dhimma kee irratti abukaatoo hayyamame mari\'adhu.';
  if (lang === 'en') return 'I am BinaSmart\'s information guide, not a lawyer, and I do not represent you. For your own matter, please instruct a licensed advocate.';
  return 'እኔ የቢናስማርት የመረጃ አገልግሎት ነኝ እንጂ ጠበቃ አይደለሁም፤ በጉዳይዎም አልወክልዎትም። ስለራስዎ ጉዳይ ፈቃድ ያለው ጠበቃ ያማክሩ።';
}

function caseNudge(lang) {
  if (lang === 'om') return '\n\nDhimmi kee nama galmee kee dubbisuu danda\'u barbaada. Waan ani gochuu danda\'u: adeemsi akkam akka ta\'e, waajjira kam akka deemtuu fi waraqaa maalii akka barbaachisu sitti himuu.';
  if (lang === 'en') return '\n\nYour own matter needs a lawyer who can read the file. What I can do is explain the procedure, which office it goes to, and the documents it needs.';
  return '\n\nየራስዎ ጉዳይ መዝገቡን ሊያነብ የሚችል ጠበቃ ይፈልጋል። እኔ ልረዳዎ የምችለው አሰራሩን፣ የትኛው ጽ/ቤት እንደሆነና ምን ሰነድ እንደሚያስፈልግ በመንገር ነው።';
}

// Appended to every assessment, deterministically, so it cannot be lost to a model in an
// encouraging mood. The limitation-period line is the important one: the realistic harm from a
// discouraging assessment is not that someone feels bad, it is that they wait, and the period runs.
function assessmentCaution(lang) {
  if (lang === 'om') return '\n\n⚖️ Kun tilmaama malee raagaa miti. Abukaatoon galmee kee dubbisu bu\'aa adda ta\'e arguu danda\'a. Yeroon himannaa banuu daangaa qaba — utuu hin murteessin dursii mirkaneeffadhu.';
  if (lang === 'en') return '\n\n⚖️ This is a reading, not a prediction. A lawyer who reads your file may see it differently. Claims also have time limits — check yours before you decide anything, not after.';
  return '\n\n⚖️ ይህ ግምት እንጂ ትንበያ አይደለም። መዝገብዎን ያነበበ ጠበቃ በተለየ ሊያየው ይችላል። ክስ የሚመሰረትበት የጊዜ ገደብም አለ — ከመወሰንዎ በፊት ያረጋግጡ።';
}

module.exports = { SYSTEM, isUrgent, urgentReply, isCaseAdvice, isDraftRequest, draftKind,
  stripVerdict, disclosure, caseNudge, assessmentCaution, POLICE, VERDICT };
