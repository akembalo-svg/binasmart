'use strict';
// What a government office's assistant refuses before any model is asked, and what it must never say.
// Deterministic for the reason the emergency gates are: a model in a helpful mood answers a factual-sounding
// question it should decline, and on 2026-09-18 one invented five agency managers' phone numbers (the
// answerability note, Q3).
//
// Ethiopic: \b does not work after an Ethiopic character (assistant/politics.js explains why), so the
// Amharic patterns use no \b. Every pattern is tried on the raw text and on the folded text.
const { foldEthiopic } = require('../assistant/lang');

const hit = (res, msg) => {
  const raw = String(msg || '');
  const folded = foldEthiopic(raw);
  return res.some(re => re.test(raw) || re.test(folded));
};

const HOW = [/\bhow (do|can|to|does|long)\b/i, /እንዴት/, /akkamitti/i];

// ---- agency look-up: an agency word AND a look-up word ----
const AGENCY = [/agenc/i, /ኤጀን|ኤጄን|ወኪል/, /ejensii/i];
const LOOKUP = [
  /\b(phone|number|contact|address|call|list|which|name of|genuine|legit|registered)\b/i,
  /\bis\b[^?]{0,60}\blicen[cs]ed\b/i, /\bcheck\b[^?]{0,40}\blicen/i, /\blicen[cs]ed agenc/i,
  /ስልክ|ቁጥር|አድራሻ|ዝርዝር|የትኛው|የትኞቹ|ተመዝግ/,
  /(ፈቃድ|ፍቃድ)[^?።]{0,20}(እንዳለ|ያለው|አለው|ማረጋገጥ|አረጋግ)/,
  /lakkoofsa|bilbila|teessoo|hayyama qaba/i,
];
const isAgencyLookup = msg => hit(AGENCY, msg) && hit(LOOKUP, msg);

// ---- a person's own records (not "how does the procedure work") ----
const RECORDS = [
  /\bmy\b[^.?!]{0,40}\b(application|labou?r ?id|lmis|coc|work permit|permit|file|record|result|certificate)\b[^.?!]{0,40}\b(status|where|when|approved|ready|progress|track|stuck|delayed)\b/i,
  /\b(status|track|where is)\b[^.?!]{0,30}\bmy\b[^.?!]{0,30}\b(application|labou?r ?id|lmis|coc|permit|file|record|result|certificate)\b/i,
  /ማመልከቻዬ|ማመልከቻየ|ሰርተፊኬቴ|ሰርተፍኬቴ|ውጤቴ|ፋይሌ|መዝገቤ|ፈቃዴ|ፍቃዴ|መታወቂያዬ|አይዲዬ/,
  /(iyyannoo|galmee|bu'aa|hayyama) koo/i,
];
const isPersonalRecords = msg => !hit(HOW, msg) && hit(RECORDS, msg);

// ---- personal legal advice: judging THIS person's contract or case ----
const CASE = [
  /\bis (my|this|the) (contract|dismissal|termination|salary|deduction|agreement)\b[^?]{0,60}\b(legal|lawful|valid|fair|allowed)\b/i,
  /\bshould i (sign|accept|quit|resign)\b/i,
  /\bwill i win\b|\bdo i have a case\b|\bcan i win\b/i,
  /ውሌ[^?።]{0,20}((ሕ|ህ)ጋዊ|ትክክል)/, /ልፈርም|ይፈረም ወይ|አሸንፋለሁ|ማሸነፍ እችላለሁ/,
  /waliigalteen koo seeraa|mo'achuu nan danda'a/i,
];
const isCaseAdvice = msg => hit(CASE, msg);

// ---- someone in danger abroad: a place AND a danger ----
const PLACE = [
  /\b(saudi|arabia|riyadh|jeddah|dubai|uae|emirates|abu dhabi|qatar|doha|kuwait|jordan|amman|lebanon|beirut|oman|bahrain|abroad|overseas)\b/i,
  /ሳውዲ|ሳዑዲ|ሳኡዲ|አረብ|ዱባይ|ኳታር|ኩዌት|ዮርዳኖስ|ሊባኖስ|ኦማን|ባህሬን|ውጭ (አገር|ሀገር)/,
  /biyya alaa|saawudii|arabaa/i,
];
const DANGER = [
  /\blocked (in|up)\b|\bbeat(en|ing)?\b|\babus(e|ed|ing)\b|\braped?\b|\btrapped\b|\bkidnap|\bescape\b|can'?t leave|cannot leave/i,
  /passport (was |is |has been )?(taken|held|confiscated)|took (her|his|my|our) passport/i,
  /not (been )?paid for (months|weeks)/i,
  /ተቆልፎ|ተቆልፋ|ተቆልፌ|ተደበደ|ይደበድ|ደበደቡ|ታግታ|ታግቶ|ተደፈረ|ተደፍራ|ማምለጥ|አምልጣ/,
  /ፓስፖርት(ቷን|ቱን|ቴን|ዋን)\s*(ወሰዱ|ወስደ|ቀሙ|ያዙ|ነጠቁ)/,
  /(ደሞዝ|ደመወዝ)[^?።]{0,15}(አልተከፈ|አልከፈ)/,
  /reebam|cufam|paaspoortii (ishee|isaa|koo) fudhat/i,
];
const isDangerAbroad = msg => hit(PLACE, msg) && hit(DANGER, msg);

// ---- output: no full Ethiopian mobile number, ever (the shape test/no-real-phone-numbers.test.js uses) ----
const MOBILE = /(?<![0-9A-Za-z_])(?:\+?251[ -]?[79](?:[ -]?[0-9]){8}|0[79](?:[ -]?[0-9]){8})(?![0-9A-Za-z_])/;
const SENTENCE = /[^.!?።\n]+[.!?።]*[ \t]*|\n/g;
function stripMobiles(text) {
  const parts = String(text || '').match(SENTENCE) || [];
  let removed = 0;
  const kept = parts.filter(p => { if (MOBILE.test(p)) { removed++; return false; } return true; });
  return { text: removed ? kept.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : String(text || ''), removed };
}

// ---- output: no Ethiopian landline either ----
// Owner decision Y5 (2026-09-18): an office's answers show the emergency numbers only (991, 907); the
// ministry's own landline stays hidden until the ministry confirms it is current. On 2026-09-24 a
// complaints-desk page added to the index after that decision put "+251 11 667 1792" into an answer - the
// mobile filter above only knows 07/09 numbers. Area-coded numbers: 0 or +251, a two-digit area code
// starting 1-5, then seven digits. Three-digit emergency numbers are nowhere near this shape.
const LANDLINE = /(?<![0-9A-Za-z_])(?:\+?251[ -]?(?:\(0\)[ -]?)?|0)[1-5][0-9](?:[ -]?[0-9]){7}(?![0-9A-Za-z_])/;
function stripLandlines(text) {
  const parts = String(text || '').match(SENTENCE) || [];
  let removed = 0;
  const kept = parts.filter(p => { if (LANDLINE.test(p)) { removed++; return false; } return true; });
  return { text: removed ? kept.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : String(text || ''), removed };
}

// ---- output: the unsigned 2018 E.C. directive is never presented as law ----
// gov/tenants.json tells the model to say so in the same sentence; on 2026-09-24 (safety s16) it listed the
// directive's document requirements and did not. Dots are allowed inside the span: «እ.ኤ.አ.» and «ዓ.ም.» carry them. When an answer names it and nowhere says draft/unsigned,
// the warning is added in the answer's language.
const DRAFT_DIRECTIVE = /(ሥራና ክህሎት ሚኒስቴር|Ministry of Labou?r and Skills|MoLS)[^።\n]{0,60}(መመሪያ|[Dd]irective)[^።\n]{0,40}2018|2018\s*(ዓ\.?\s?ም|E\.?\s?C)[^።\n]{0,40}(መመሪያ|[Dd]irective)|(መመሪያ|[Dd]irective)[^።\n]{0,40}2018\s*(ዓ\.?\s?ም|E\.?\s?C)/;
const SAYS_DRAFT = /ረቂቅ|ያልተፈረመ|draft|unsigned|not in force/i;   // not ያልጸደቀ: «ያልጸደቀ ውል» is an unapproved contract, not the directive
function flagDraftDirective(text) {
  const s = String(text || '');
  if (!DRAFT_DIRECTIVE.test(s) || SAYS_DRAFT.test(s)) return { text: s, removed: 0 };
  const am = /[ሀ-፿]/.test(s);
  const note = am
    ? 'ማሳሰቢያ፦ የተጠቀሰው የሥራና ክህሎት ሚኒስቴር የ2018 ዓ.ም. መመሪያ ያልተፈረመ ረቂቅ ነው፤ በሥራ ላይ አልዋለም። ከመተግበርዎ በፊት ከሚኒስቴሩ ያረጋግጡ።'
    : 'Note: the 2018 E.C. Ministry of Labour and Skills directive cited above is an unsigned draft and is not in force. Confirm with the Ministry before relying on it.';
  return { text: s.trim() + '\n\n' + note, removed: 1 };
}

// ---- "do it for me": the assistant submits, files and registers nothing for anybody ----
// Not a refusal gate: the visitor still needs the how-to, so the model answers and the answer is made to open
// with the plain "I can't do that for you" when it did not say so itself (safety s13, 2026-09-24: the facts
// were right, the "I can't" was missing, and the reader could take the silence for a yes).
const BEHALF = [
  /\b(can|could|will|would)\s+you\b[^?.!]{0,60}\b(submit|file|send|lodge|register|apply|process|renew)\b/i,
  /\b(submit|file|send|lodge|register|apply|renew)\b[^?.!]{0,50}\b(for me|on my behalf|for us|on our behalf)\b/i,
  /አስገባልኝ|ታስገባልኛለ|ታስገቡልኛላ|ያስገቡልኝ|አመልክትልኝ|ያመልክቱልኝ|ታመለክትልኛለ|መዝግብልኝ|ይመዝግቡልኝ|ላክልኝ|ይላኩልኝ|ታሳድስልኛለ|አሳድስልኝ/,
];
const isOnBehalf = msg => hit(BEHALF, msg);
const SAYS_CANT = /\b(can(no|')?t|cannot|not able|unable|do(es)? not (submit|file|send|register))\b|አልችልም|አይቻልም|አልችልም/i;

// ---- the review queue: nothing identifying reaches disk ----
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NUMBERISH = /\+?\d[\d \-]{6,}\d/g;
function scrub(s, max = 2000) {
  return String(s == null ? '' : s).slice(0, max)
    .replace(EMAIL, '[email]')
    .replace(NUMBERISH, m => (/^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/\D/g, '').length < 8 ? m : '[number]'));
}

module.exports = { isAgencyLookup, isPersonalRecords, isCaseAdvice, isDangerAbroad, isOnBehalf, SAYS_CANT, stripMobiles, stripLandlines, flagDraftDirective, scrub, MOBILE, LANDLINE };
