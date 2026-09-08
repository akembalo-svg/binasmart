'use strict';
// Which language did the user write in? am (Ethiopic), am-latin (Amharic typed in Latin letters),
// om (Afaan Oromoo, qubee), en. Deterministic so the reply-language directive never depends on the model.
const OROMO = /\b(akkam|nagaa|nagaan|galatoomi|galatoomaa|galatoomaa|maal|maali|maaliif|eessa|eessatti|meeqa|gatii|gatiin|konkolaataa|konkolaachisaa|imala|imalaa|yeroo|daqiiqaa|teessoo|waliin|qarshii|birrii|har'a|bor|ganama|galgala|finfinnee|baankii|tajaajila|mootummaa|eenyummaa|hojii|barumsaa|hospitaala|dubartoota|qofa|karaa|gaaffii|deebii|jira|jirta|jirtu|jiraa|natti|nuuf|isin|isiniif|ani|nuti|kana|akkamitti|waan|qaba|qabna|qabda|qabdu|barbaada|barbaanna|barbaadda|fedha|danda'a|dandeenya|dandeessu|dhufa|deema|deemuu|dhufuu|bilbila|lakkoofsa|guyyaa|ji'a|waggaa|magaalaa|biyya|itoophiyaa|oromoo|afaan|kaffaltii|kaffaluu|maallaqa|mana|namoota|nama|garaa|gara|irraa|hanga|booda|dura|amma|kutaa|adeemsa|hayyama|mirga|seera|manni|murtii|abbaa|haadha|ijoollee|obboleessa|obboleettii|jaalala|fayyaa|nyaata|bishaan|daandii|taaksii|baajaajii|saffisaan|suuta|hedduu|xiqqoo|baay'ee|gaarii|hamaa|tole|eeyyee|lakki|miti|raadiyoo|raadiyoon|naaf|banaa|bani|banuu|televizhinii|ilaaluu|ilaali|dhaggeeffachuu|dhageeffadhu|sagalee|muuziqaa|fiilmii|diraamaa|gargaari|gargaarsa|barbaachisa|yaadadhu|maqaan|koo|keenya|kee|isaa|ishee)\b/gi;
const AM_LATIN = /\b(selam|salam|sint|endet|endemin|yet|alegn|alesh|aleh|ebakih|ebakish|ebakwo|ameseginalehu|amesegnalehu|tadia|eshi|new|nesh|neh|nachu|min|man|wede|ke|lay|birr|awo|aydelem|yikirta|betam|dehna|dehena|chigir|yelem|alle|ale|endale|tiru|tilik|tinish|meche|lemin|manew|yihe|yih|ezih|eziya|bet|sira|wond|set|lij)\b/gi;

function detect(text) {
  const s = String(text || '');
  if (/[ሀ-፿]/.test(s)) return 'am';
  const om = (s.match(OROMO) || []).length, am = (s.match(AM_LATIN) || []).length;
  if (om >= 2 && om > am) return 'om';
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

module.exports = { detect, directive, NAMES };
