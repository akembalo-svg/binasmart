'use strict';
// Which language did the user write in? am (Ethiopic), am-latin (Amharic typed in Latin letters),
// om (Afaan Oromoo, qubee), en. Deterministic so the reply-language directive never depends on the model.
const OROMO = /\b(akkam|qoricha|dhukkub|dhukkubbii|hakiima|narsii|fayyaa|yaalaa|yaala|daa'ima|daa'imni|mucaa|mucaan|hafuura|onnee|dhiiga|dhiigni|summii|ulfa|da'umsa|kutaan|qorannoo|talaallii|seera|seeraa|labsii|abukaatoo|himata|waliigaltee|waliigalteen|mallatteess|hidhame|murtii|poolisii|ragaa|galmee|beellama|mirga|gibira|hayyama|kiraa|fudhadhu|fudhate|barbaada|ajjeesuu|lubbuu|du'uu|dhukkubsat|balaa|gargaarsa|ariifachiisaa|danda'a|dandeenye|hin|koo|kiyya|keessan|isaa|ishee|nagaa|nagaan|galatoomi|galatoomaa|galatoomaa|maal|maali|maaliif|eessa|eessatti|meeqa|gatii|gatiin|konkolaataa|konkolaachisaa|imala|imalaa|yeroo|daqiiqaa|teessoo|waliin|qarshii|birrii|har'a|bor|ganama|galgala|finfinnee|baankii|tajaajila|mootummaa|eenyummaa|hojii|barumsaa|hospitaala|dubartoota|qofa|karaa|gaaffii|deebii|jira|jirta|jirtu|jiraa|natti|nuuf|isin|isiniif|ani|nuti|kana|akkamitti|waan|qaba|qabna|qabda|qabdu|barbaada|barbaanna|barbaadda|fedha|danda'a|dandeenya|dandeessu|dhufa|deema|deemuu|dhufuu|bilbila|lakkoofsa|guyyaa|ji'a|waggaa|magaalaa|biyya|itoophiyaa|oromoo|afaan|kaffaltii|kaffaluu|maallaqa|mana|namoota|nama|garaa|gara|irraa|hanga|booda|dura|amma|kutaa|adeemsa|hayyama|mirga|seera|manni|murtii|abbaa|haadha|ijoollee|obboleessa|obboleettii|jaalala|fayyaa|nyaata|bishaan|daandii|taaksii|baajaajii|saffisaan|suuta|hedduu|xiqqoo|baay'ee|gaarii|hamaa|tole|eeyyee|lakki|miti|raadiyoo|raadiyoon|naaf|banaa|bani|banuu|televizhinii|ilaaluu|ilaali|dhaggeeffachuu|dhageeffadhu|sagalee|muuziqaa|fiilmii|diraamaa|gargaari|gargaarsa|barbaachisa|yaadadhu|maqaan|koo|keenya|kee|isaa|ishee)\b/gi;
const AM_LATIN = /\b(selam|salam|sint|endet|endemin|yet|alegn|alesh|aleh|ebakih|ebakish|ebakwo|ameseginalehu|amesegnalehu|tadia|eshi|new|nesh|neh|nachu|min|man|wede|ke|lay|birr|awo|aydelem|yikirta|betam|dehna|dehena|chigir|yelem|alle|ale|endale|tiru|tilik|tinish|meche|lemin|manew|yihe|yih|ezih|eziya|bet|sira|wond|set|lij)\b/gi;

// Afaan Oromoo is recognisable from its spelling, not only its vocabulary. Long vowels aa/uu/ii and
// the digraphs dh/ny are ordinary in qubee and rare in English, which is what makes them usable as a
// signal: "ee" and "oo" are NOT counted here, because English is full of them (see, need, book, good).
// This exists because a short question carries only one dictionary word, and one was not enough:
// "Kaanserii qabaa?" and "Ati dhugumatti hakiima dhaa?" were both answered in English to a speaker
// who had written in Afaan Oromoo.
const OM_SHAPE = /(aa|uu|ii|dh|ny)/gi;
// Afaan Oromoo nouns inflect by suffix — beellama/Beellamni, kutaa/kutaan, mucaa/mucaan, dhukkuba/
// dhukkubni — so a whole-word list cannot see the form people actually type. These are matched as
// PREFIXES for that reason, and kept to words that carry the subject of a health or legal question.
const OM_STEM = /\b(beellam|dhukkub|qorich|hakiim|narsii|abukaat|himat|waliigalt|ragaa|mirg|hayyam|kiraa|gibir|dhiig|hafuur|onnee|mucaa|daa'im|ulf|summi|gargaars|adeems|waajjir|kutaa|fayya|talaall|qorann|labs|poolis|galmee|eenyum|kaffalt|maallaq|konkolaat|baajaaj|hospitaal|buufata|inshuraans|beenyaa|abbaa seeraa|mana murt|mana hidh)/gi;

function detect(text) {
  const s = String(text || '');
  if (/[ሀ-፿]/.test(s)) return 'am';
  const om = (s.match(OROMO) || []).length, am = (s.match(AM_LATIN) || []).length;
  const shape = (s.match(OM_SHAPE) || []).length;
  const stem = (s.match(OM_STEM) || []).length;
  if (om + stem >= 2 && om + stem > am) return 'om';
  // A dictionary hit counts double, spelling counts single. Three is the bar. An English sentence
  // scores 0-1 here unless it also contains an Afaan Oromoo word, and Amharic-in-Latin scores 0.
  if ((om + stem) * 2 + shape >= 3 && om + stem + shape > am) return 'om';
  if (am >= 2) return 'am-latin';
  return 'en';
}

const NAMES = { am: 'Amharic', 'am-latin': 'Amharic', om: 'Afaan Oromoo', en: 'English' };

// The one-line directive that goes into the system prompt for this turn.
function directive(lang) {
  if (lang === 'am') return 'LANGUAGE: the user wrote in Amharic script. Reply in Amharic script.';
  if (lang === 'am-latin') return 'LANGUAGE: the user typed Amharic in LATIN letters. Reply in Amharic script (Ethiopic), then end with ONE short line in parentheses that gives the key point in Latin letters the way they typed, e.g. (Wagaw kwami new, /ride lay yasgebu.)';
  if (lang === 'om') return 'LANGUAGE: the user wrote in Afaan Oromoo (qubee). Reply in Afaan Oromoo, Latin script, polite "isin" form, short clear sentences. Keep product names as they are (BinaSmart, BinaRide, Bini) and say "Imala Waliinii (BinaPool)" for the shared commute. Amharic words only inside product names. If a fact in the knowledge block is only in Amharic or English, translate its meaning faithfully, never the numbers.';
  return 'LANGUAGE: the user wrote in ENGLISH. Reply in English only (Amharic words allowed only for product names). Do not switch to Amharic even if the knowledge block is in Amharic.';
}

// Amharic writes the same sound with several different characters: ሀ ሐ ኀ are all "ha", ሰ and ሠ are
// both "sa", አ and ዐ both "a", ጸ and ፀ both "tsa". Writers use them interchangeably and none of them
// is wrong. Any pattern that matches Amharic therefore has to fold them first, or it only catches
// whichever spelling the person who wrote the pattern happened to use.
// Measured: "ለልጄ መድኃኒት ስንት ልስጠው?" (how much medicine for my child) walked past the clinical gate
// while "መድሃኒት" was caught. Same question, different letter.
// The vowel order within a family is preserved - only the consonant family is folded.
const FOLD = [[0x1210, 0x1200], [0x1280, 0x1200], [0x1220, 0x1230], [0x12D0, 0x12A0], [0x1340, 0x1338]];
function foldEthiopic(s) {
  return String(s || '').replace(/[ሐ-ሗሠ-ሧኀ-ኇዐ-዗ፀ-ፇ]/g, ch => {
    const c = ch.codePointAt(0);
    for (const [from, to] of FOLD) if (c >= from && c <= from + 7) return String.fromCodePoint(to + (c - from));
    return ch;
  });
}

module.exports = { detect, directive, NAMES, foldEthiopic };
