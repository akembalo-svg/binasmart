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

// ---- the review queue: nothing identifying reaches disk ----
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const NUMBERISH = /\+?\d[\d \-]{6,}\d/g;
function scrub(s, max = 2000) {
  return String(s == null ? '' : s).slice(0, max)
    .replace(EMAIL, '[email]')
    .replace(NUMBERISH, m => (/^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/\D/g, '').length < 8 ? m : '[number]'));
}

module.exports = { isAgencyLookup, isPersonalRecords, isCaseAdvice, isDangerAbroad, stripMobiles, scrub, MOBILE };
