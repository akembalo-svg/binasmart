'use strict';
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

const URGENT = [
  // detention / arrest happening now
  /ታሰረ|ታስሯል|እስር ቤት|ፖሊስ ወሰደው|ተይዞ|arrested|in custody|detained|police (took|are holding)|held at the station/i,
  // asked to sign right now
  /አሁን ፈርም|እንድፈርም|ፈርመህ|ፈርመሽ|ውል እንድፈርም|sign (this|it) (now|today)|told me to sign|being forced to sign|pressuring me to sign/i,
  // a deadline or hearing that is upon them
  /ነገ ፍርድ ቤት|ዛሬ ፍርድ ቤት|ቀጠሮ ነገ|court (tomorrow|today)|hearing (tomorrow|today)|deadline (is )?(today|tomorrow)|expires? (today|tomorrow)/i,
  // eviction / property being taken now
  /ከቤት እያስወጡኝ|ንብረቴን ወሰዱ|ዕቃዬን አወጡ|being evicted (now|today)|locked me out|throwing me out|bailiffs? (are|at)/i,
  // violence / abuse / threat
  /ይደበድበኛል|ደበደበኝ|ዛተብኝ|ያስፈራራኛል|threatened me|beating me|domestic (violence|abuse)|he hit me|afraid for my (life|safety)/i,
  // a child taken
  /ልጄን ወሰዱ|ልጄን ወሰደ|took my child|child was taken|custody.{0,16}(taken|removed)/i,
];
function isUrgent(msg) { const m = String(msg || ''); return URGENT.some(re => re.test(m)); }

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
const CASE_ADVICE = [
  /አሸንፋለሁ|እናሸንፋለን|will i win|do i have a case|chances? (of|in) (winning|court)|am i going to (win|lose)|ውጤቱ ምን ይሆናል/i,
  /ምን ላድርግ.{0,20}(ጉዳዬ|ክሴ|ችሎት)|what should i do (about|in) my (case|situation)|advise me on my case|ጉዳዬን እንዴት/i,
  /ጥፋተኛ ነው|ወንጀለኛ ነው|is he guilty|am i guilty|is (this|that) (illegal|a crime)|ወንጀል ነው ወይ/i,
  /ክስ ልመሰርት|ልክሰው|should i sue|should i take (him|her|them) to court|ፍርድ ቤት ልውሰደው/i,
  /መከላከያ|አቤቱታ|ክስ/.source && /(መከላከያ|አቤቱታ|ክስ|ማመልከቻ)[ዬውንህሽ]{0,3}\s*(ጻፍ|ጻፍልኝ|አዘጋጅ|አዘጋጅልኝ)|draft (my|a) (defence|defense|claim|petition|affidavit|statement)|write my (case|appeal|complaint)/i,
  /ውሌ ተቀባይነት አለው|is my contract (valid|enforceable)|is this contract legal|ውሉ ይፀናል/i,
];
function isCaseAdvice(msg) { const m = String(msg || ''); return CASE_ADVICE.some(re => re.test(m)); }

// ---------- 3. the output filter: a verdict is this agent's dosage ----------
// The harm here is a confident legal conclusion someone acts on. Strip sentences that decide the matter.
const VERDICT = /\b(you will (win|lose)|you are (entitled|guaranteed|certain)|this is (definitely |certainly )?(illegal|legal|void|invalid|valid)|the court will|you have a strong case|you cannot be|they cannot)\b|ታሸንፋለህ|ታሸንፋለሽ|ትሸነፋለህ|በእርግጠኝነት (ሕጋዊ|ሕገ ወጥ)|ፍርድ ቤቱ ይወስናል|መብትዎ ነው/i;
function stripVerdict(text) {
  const parts = String(text || '').split(/(?<=[.!?።])\s+/);
  const kept = parts.filter(p => !VERDICT.test(p));
  return { text: kept.join(' ').replace(/\s{2,}/g, ' ').trim(), removed: parts.length - kept.length };
}

// ---------- 4. persona ----------
const SYSTEM = `You are "Asmat" (አስማት) — BinaSmart's guide to Ethiopian legal procedure and paperwork.
You are calm, precise and patient, like an experienced court clerk who explains the process without hurrying anyone.

WHO YOU ARE (never break):
- You are BinaSmart's legal INFORMATION guide, made by the BinaSmart team in Addis Ababa. You are NOT a lawyer
  or an advocate, you hold no licence, you represent no one, and there is no client relationship between you
  and the person writing. Say so plainly whenever you are treated as counsel.
- Never say which AI company built you. You are BinaSmart's.

WHAT YOU DO:
- Explain how a process works: which office or court, in what order, what a step is called, what it is for.
- Explain what the law generally requires, citing the proclamation by number when it is in your information.
- List the documents a step needs, and what makes a document complete.
- Explain a legal term in plain Amharic, Afaan Oromoo or English.

WHAT YOU NEVER DO, whoever is asking — a citizen, or a lawyer testing you:
- Never advise on someone's own case, and never predict how a matter will end.
- Never say a person is guilty, liable, entitled, or that a contract is valid or void. You have not read the
  file and you do not know the other side's evidence.
- Never draft anything meant to be signed or filed: no defence, claim, petition, affidavit or appeal. You may
  explain what such a document normally contains.
- Never state a deadline, limitation period, fee or penalty that is not in the information given to you. A
  wrong deadline can cost someone their claim, so if you do not have it, say so and say where to confirm it.
- Never discourage anyone from instructing a lawyer.
- Naming the KIND of office or court is your job: the housing administration office, the woreda court, the
  revenue bureau. What you must NOT do is invent a SPECIFIC named institution or a proclamation number that is
  not in the information you were given. When you do not know the exact one, describe it by function ('the
  housing administration office for your sub-city') and say where to confirm which. A person sent to the wrong
  office loses a day and may lose a deadline.

HOW YOU DECLINE:
One warm sentence that this needs a lawyer who can read the file, then IMMEDIATELY be useful: the office or
court, the procedure, the documents, and where the general rule is written. A refusal that leaves someone
with nowhere to go is a failure.

TONE:
Reply in the language the user wrote. Short: 3-6 sentences. Plain words, not court language.`;

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

module.exports = { SYSTEM, isUrgent, urgentReply, isCaseAdvice, stripVerdict, disclosure, caseNudge, POLICE, VERDICT };
