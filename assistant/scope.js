'use strict';
// Each specialist agent answers only its own subject. Dr Afiya does health, Asmat does legal procedure, and
// anything else goes back to Bini, who handles rides, tenders, cinema and the rest.
//
// One deliberate exception, and it is not negotiable: the emergency gates run BEFORE this one. If someone
// types "my father is not breathing" into the legal page, they get the ambulance number. Telling a
// frightened person they are on the wrong page would be indefensible, and it costs nothing to be humane.

const HEALTH = /ሆስፒታል|ክሊኒክ|ሐኪም|ሀኪም|ዶክተር|ነርስ|ህክምና|ሕክምና|ትኩሳት|ህመም|ያመኛል|ያመዋል|ያማታል|መድሃኒት|ክኒን|ፋርማሲ|ላቦራቶሪ|ምርመራ|ክትባት|እርግዝና|ነፍሰ ጡር|ምጥ|ጥርስ|ራጅ|ደም ምርመራ|ቀዶ ጥገና|የጤና መድን|ጤና/i;
const HEALTH_EN = /hospital|clinic|doctor|nurse|pharmac|medicine|medical|symptom|fever|pain|illness|disease|treatment|surgery|vaccin|pregnan|dental|x-?ray|lab (test|result)|health insurance|\bhealth\b|patient|caregiver|diagnos|\bopd\b|out-?patient|emergency (room|department)|\bicu\b|midwife|ambulance|\bward\b|referral letter/i;

const LEGAL = /ሕግ|ህግ|አዋጅ|ደንብ|መመሪያ|ፍርድ ቤት|ችሎት|ጠበቃ|ክስ|ውል|ኮንትራት|ውርስ|ፍቺ|ጋብቻ ምዝገባ|ንብረት|ካሳ|ቅጣት|ይግባኝ|ምስክር|ሰነድ|ውክልና|የሥራ ውል|ኪራይ ውል|ግብር|ቫት|ንግድ ፈቃድ|ጉምሩክ|መብት|አከራይ|ተከራይ|ጉዳይ|ክርክር|ዳኛ|ዳኞች|ቅጣት|ዋስ|ውርስ|ኑዛዜ|አሳዳሪ|ሰበር|ውሳኔ|አስገዳጅ|መዝገብ|ችሎት|ጠበቃ|ከሳሽ|ተከሳሽ|ማስረጃ|ይግባኝ|ፍትሐብሔር|ወንጀል|ሥነ ሥርዓት|ስነ ስርዓት|አቤቱታ|ብይን|ፍርድ|ሕጋዊ|ህጋዊ|ሕገ መንግሥት|ህገ መንግስት|ደንብ ቁጥር|አዋጅ ቁጥር/i;
const LEGAL_EN = /\blaw\b|legal|proclamation|regulation|court|judge|lawyer|advocate|attorney|lawsuit|sue\b|contract|agreement|inherit|divorce|custody|tenanc|lease|evict|compensation|penalty|appeal|witness|notar|power of attorney|employment contract|\btax\b|\bvat\b|business licen[cs]e|customs|\brights?\b|landlord|tenant|\bcase\b|dispute|claim|liabl|damages|settlement|hearing|prosecut|bail|\bfine\b|deed|guardian|cassation|precedent|binding decision|bench|judgment|judgement|ruling|verdict|plaintiff|defendant|evidence|testimony|jurisdiction|file (an? )?(appeal|case|claim|suit)|civil procedure|criminal procedure|statute|decree|gazette/i;

function scores(msg) {
  const m = String(msg || '');
  return {
    health: (HEALTH.test(m) ? 1 : 0) + (HEALTH_EN.test(m) ? 1 : 0),
    legal: (LEGAL.test(m) ? 1 : 0) + (LEGAL_EN.test(m) ? 1 : 0),
  };
}

// 'health' | 'legal' | 'both' | 'other'
function topicOf(msg) {
  const s = scores(msg);
  if (s.health && s.legal) return 'both';          // a workplace injury is honestly both
  if (s.health) return 'health';
  if (s.legal) return 'legal';
  return 'other';
}

// A greeting or a thank-you is not off-topic; it is a person being polite.
const SOCIAL = /^\s*(ሰላም|ጤና ይስጥልኝ|እንደምን|hi|hello|hey|selam|nagaa|akkam|thank|ameseginalehu|አመሰግናለሁ|good (morning|afternoon|evening))(?![a-z])/i;

function inScope(msg, domain) {
  if (SOCIAL.test(String(msg || '').trim())) return true;
  const t = topicOf(msg);
  return t === domain || t === 'both';
}

// Where an off-topic message should go, and what to say about it.
function redirect(msg, domain, lang) {
  const t = topicOf(msg);
  const other = t === 'health' ? 'afiya' : (t === 'legal' ? 'asmat' : 'bini');
  const NAMES = { afiya: { am: 'ዶ/ር አፍያ', en: 'Dr Afiya', om: 'Dr Afiya' },
                  asmat: { am: 'አስማት', en: 'Asmat', om: 'Asmat' },
                  bini: { am: 'ቢኒ', en: 'Bini', om: 'Bini' } };
  const to = NAMES[other][lang] || NAMES[other].en;
  const where = other === 'bini' ? 'https://bina.et' : 'https://bina.et/' + other;
  const mine = domain === 'health'
    ? { am: 'ጤና አገልግሎት', en: 'health services', om: 'tajaajila fayyaa' }
    : { am: 'ሕግ አሰራርና ሰነድ', en: 'legal procedure and documents', om: 'adeemsa seeraa fi waraqaa' };
  const subject = mine[lang] || mine.en;
  if (lang === 'om') return `Ani ${subject} qofa irratti sin gargaara. Gaaffii kanaaf ${to} si gargaaruu danda'a: ${where}`;
  if (lang === 'en') return `I only help with ${subject}. For this one, ${to} is the right place: ${where}`;
  return `እኔ የምረዳው በ${subject} ላይ ብቻ ነው። ለዚህ ጥያቄ ${to} ይረዳዎታል፦ ${where}`;
}

module.exports = { topicOf, inScope, redirect, HEALTH, LEGAL };
