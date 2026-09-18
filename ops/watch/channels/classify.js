'use strict';
// The classifier, rules half. No network, no model, no clock: the same post always gets the same verdict.
//
// Three stages in this order, and the model (classify-model.js) is only ever the third:
//   1. hard exclusions — politics, conflict, elections, ethnicity, rumour, opinion, sport, holiday greetings,
//      ceremonies, diplomacy, live-stream markers, promotions and advertorials. The survey settled 22 of its
//      30 hand-classified items here, and none of them needed a model to be wrong about.
//   2. office and directive rules — an item is admitted when it carries a directive or a warning and comes
//      from an office channel, when it links the office's own host somewhere other than that host's front
//      page, or when it names an office and tells a citizen how to do something. An OUTLET item is admitted
//      only when it names one of the six offices with no channel of their own; anything else an outlet says
//      is refused without a model, because the two loudest channels post forty times a day between them.
//   3. whatever is left is `unsettled` — never admitted here.
//
// Two rules in here were written against real posts that broke the obvious version:
//   * "under 60 characters with no link" cannot be a blanket exclusion. Eight of NBE's nine pack-grade items
//     are 41-56 characters with no link at all ("NOTICE OF FOREIGN EXCHANGE AUCTION NO. 25"). The length rule
//     therefore yields to a directive word.
//   * "an office channel linking its own host" cannot be a blanket admission. Every one of the customs
//     commission's posts carries http://www.ecc.gov.et/ in its signature, so the bare front page of a host
//     proves nothing; a deeper address, a document, or another of the office's hosts does.

const ADMITTED = new Set(['pack-grade', 'perishable']);

// ---------- matching ----------
// Ethiopic has no case and no ASCII word boundary, so it matches as a substring. ASCII matches on word
// boundaries, which is not fussiness: "AWARENESS" contains "war", and NBE's hawala notice is a PUBLIC
// AWARENESS NOTICE. A substring match would have thrown away the single most useful item in the survey.
const _res = new Map();
function has(text, key) {
  if (/[ሀ-፿]/.test(key)) return text.includes(key);
  let re = _res.get(key);
  if (!re) { re = new RegExp('(^|[^A-Za-z0-9])' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9]|$)', 'i'); _res.set(key, re); }
  return re.test(text);
}
function firstHit(text, list) { for (const k of list) if (has(text, k)) return k; return ''; }

// ---------- stage 1: the exclusions ----------
// The POLITICS list of /root/storage/scripts/bina_news_candidates.py, extended with elections, ethnicity,
// rumour and opinion markers in both languages, as the design asks.
const POLITICS = ['election', 'ምርጫ', 'war', 'ጦርነት', 'conflict', 'ግጭት', 'tplf', 'ህወሓት', 'ሕወሓት', 'fano', 'ፋኖ',
  'protest', 'ተቃውሞ', 'ethnic', 'ብሔር', 'ብሄር', 'military', 'ወታደር', 'መከላከያ', 'army', 'rebel', 'አማፂ', 'አማጺ',
  'opposition', 'ተቃዋሚ', 'parliament approves law', 'minister of defense', 'minister of defence', 'peace talks',
  'prisoner', 'arrest', 'ቁጥጥር ስር', 'coup', 'መፈንቅለ', 'ታጣቂ', 'የጦር', 'ሁቲ', 'ግድያ', 'politics', 'political', 'ፖለቲካ',
  'rumour', 'rumor', 'አሉባልታ', 'ወሬ', 'opinion', 'አስተያየት', 'allegedly', 'ተብሏል ተብሎ'];
const DIPLOMACY = ['brics', 'ብሪክስ', 'bilateral', 'ሁለትዮሽ', 'summit', 'ጉባዔ', 'ጉባኤ', 'delegation', 'ልዑክ',
  'embassy', 'ኤምባሲ', 'diplomat', 'ዲፕሎማት', 'ambassador', 'አምባሳደር', 'igad', 'ኢጋድ', 'african union', 'አፍሪካ ህብረት',
  'united nations', 'ተባበሩት መንግስታት', 'treaty', 'memorandum', 'mou', 'cooperation framework', 'sidelines',
  'sign cooperation', 'ስምምነት ተፈራረሙ'];
const CEREMONY = ['ውይይት', 'ስልጠና', 'ሥልጠና', 'ሽልማት', 'እውቅና', 'ተመረቀ', 'ምረቃ', 'ግምገማ', 'ጉብኝት', 'ceremony', 'training',
  'workshop', 'award', 'inaugurat', 'graduat', 'anniversary', 'ክብረ በዓል', 'ዓውደ ጥናት', 'meeting', 'green legacy',
  'ችግኝ', 'ተከላ', 'ዓመታዊ ስብሰባ', 'conference',
  // Added after the dry run of 18 September: a consultative forum the Ministry of Health held was admitted,
  // because CEREMONY knew ውይይት but not መድረክ or ምክክር, and knew ስልጠና but not that it had been ተካሄደ.
  'መድረክ', 'ምክክር', 'ተካሄደ', 'forum', 'consultative', 'held a', 'visited', 'awarded', 'celebrat'];
const HOLIDAY = ['በዓል', 'ዘመን መለወጫ', 'እንኳን አደረሳችሁ', 'እንኳን', 'መልካም አዲስ ዓመት', 'happy new year', 'new year',
  'holiday', 'ገና', 'ፋሲካ', 'ኢድ', 'መስቀል', 'ኢሬቻ', 'ሃይማኖት', 'ሀይማኖት', 'ቤተ ክርስቲያን', 'መስጊድ', 'ሽማግሌዎች', 'greetings'];
const SPORT = ['sport', 'ስፖርት', 'ሊግ', 'league', 'ውድድር', 'ሩጫ', 'ክለብ', 'ስታዲየም', 'football', 'እግር ኳስ', 'ጨዋታ',
  'ተጫዋች', 'ሻምፒዮን', 'champion', 'ኦሊምፒክ', 'olympic', 'ማራቶን', 'marathon'];
const LIVESTREAM = ['live stream', 'ቀጥታ ስርጭት', 'live now', 'ቀጥታ ስርጪት'];
const PROMO = ['ስጦታ', 'ትኬት', 'ticket', 'ዕጣ', 'ሎተሪ', 'lottery', 'prize', 'giveaway', 'ያሸንፉ', 'ጌም', 'game centre',
  'game center', 'ጨዋታዎችን', 'ሽልማቶችን', 'ይሸለሙ'];
const ADVERTORIAL = ['#sponsored', 'sponsored', 'advertorial', 'paid partnership', 'ማስታወቂያ ነው'];
// A quotation closed by the Ethiopic full colon or a dash and then a person's title is a press release about
// somebody having said something, not a rule anybody can follow.
const QUOTED = /["«»“”][\s\S]{10,900}["«»“”]\s*[፦፥:]-?/;
const VIDEO = /^(?:https?:\/\/\S+\s*)+$/;

// ---------- stage 2: what makes an item worth keeping ----------
const DIRECTIVE = ['መመሪያ', 'አዋጅ', 'ደንብ', 'ማስታወቂያ', 'ማሳሰቢያ', 'ማስጠንቀቂያ', 'ታሪፍ', 'ቀነ ገደብ', 'የስራ ሰዓት', 'የሥራ ሰዓት',
  'ተፈጻሚ', 'ተግባራዊ ይሆናል', 'directive', 'proclamation', 'regulation', 'circular', 'notice', 'auction', 'tariff',
  'fee', 'deadline', 'hours', 'announcement', 'guideline', 'amendment', 'effective from', 'with effect from', 'registration opens'];
const WARNING = ['fraud', 'ማጭበርበር', 'ጥንቃቄ', 'scam', 'illegal', 'unauthorized', 'unauthorised', 'ሕገ ወጥ', 'ህገ ወጥ',
  'ህገወጥ', 'awareness', 'warning', 'alert', 'ማስጠንቀቂያ'];
const SERVICE = ['ምዝገባ', 'ኅትመት', 'ህትመት', 'portal', 'ፖርታል', 'self-service', 'self service', 'e-service', 'eservice',
  'አገልግሎት ማዕከል', 'shortcode', 'አጭር የጽሑፍ መልእክት', 'ኦንላይን', 'online service', 'apply online', 'ማመልከቻ'];
// An offer word is a tariff on its own: nobody writes ቅናሽ or ጥቅል or ብድር about anything but money.
// Reported speech. An office channel writing "the deputy director general explained", "he said", "she called on
// stakeholders" is issuing a press release about somebody having spoken, which is the same thing QUOTED catches
// when quotation marks are used and a title follows. It is checked in stage 2, after a directive word, a public
// warning and a link into the office's own host have all had their say, so an announcement that happens to quote
// the official who made it is still kept.
const REPORTED = ['ብለዋል', 'እንደገለጹት', 'እንደገለፁት', 'እንደተናገሩት', 'ገልጸዋል', 'ገልፀዋል', 'ገልፃል', 'ገልጿል', 'አስረድተዋል',
  'አመልክተዋል', 'ተናግረዋል', 'ጠቁመዋል', 'ጥሪ አቅርበዋል', 'አጽንኦት ሰጥተዋል', 'ነው ያሉት', 'told reporters'];
// And the other half of a bureau press item: work is underway, work is being carried out, the school is creating
// opportunities. A progress report is never a rule a citizen can follow, and like REPORTED it is only asked after
// a directive word, a warning and an own-host link have been looked for.
const PROGRESS = ['እየተሰራ ነው', 'እየሰራ ነው', 'በማከናወን ላይ', 'እያከናወነ ይገኛል', 'እየፈጠረ ይገኛል', 'እየተሰራ መሆኑን'];

const OFFER = ['ቅናሽ', 'discount', 'ጥቅል', 'bundle', 'offer', 'በየወሩ', 'per month', 'ክፍያ', 'ብድር', 'ወለድ', 'loan',
  'interest rate'];
// A price noun is not. ብር is inside ቴሌብር, inside ግብርና and inside መርሐ ግብር; ዋጋ is inside የዋጋ ግሽበት, which is
// inflation and not a price list. On 18 September those two letter pairs admitted a health ministry consultative
// forum and two school press items. A price noun now counts only when an amount is written against it, and a bare
// currency word must also say what the money is for — a fee word, or the name of a service.
const CURRENCY = ['ብር', 'birr', 'etb'];
const PRICED = ['ታሪፍ', 'tariff', 'ዋጋ', 'price', 'fee', 'charge'].concat(CURRENCY);
const FEE = ['ክፍያ', 'ታሪፍ', 'ዋጋ', 'fee', 'tariff', 'price', 'charge'];
const TARIFF = OFFER.concat(PRICED);   // kept for anything that wants to read the whole vocabulary
// A digit within a dozen characters of the word, on either side: በ30 ብር, 3,189 ብር, ETB 500, tariff of 149.
function amountNear(text, word) {
  const hay = text.toLowerCase();
  const needle = word.toLowerCase();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (/[0-9]/.test(hay.slice(Math.max(0, at - 12), at + needle.length + 12))) return true;
  }
  return false;
}
function tariffHit(text) {
  const offer = firstHit(text, OFFER);
  if (offer) return offer;
  for (const w of PRICED) {
    if (!has(text, w) || !amountNear(text, w)) continue;
    if (CURRENCY.indexOf(w) < 0) return w;
    const what = firstHit(text, FEE) || firstHit(text, SERVICE);
    if (what) return w + ' against ' + what;
  }
  return '';
}

// Office names, in both languages, and the hosts each office publishes on. This is the classifier's own
// knowledge and is deliberately not in registry.json: the registry says where to READ, this says how to
// RECOGNISE. The six offices with no channel are in here too — they are the only ones an outlet item can be
// admitted for.
const OFFICES = {
  mols: { names: ['ሠራተኛና ክህሎት ሚኒስቴር', 'ሰራተኛና ክህሎት ሚኒስቴር', 'የሥራና ክህሎት ሚኒስቴር', 'ministry of labour and skills', 'ministry of labor and skills'], hosts: ['mols.gov.et'] },
  nbe: { names: ['ብሔራዊ ባንክ', 'ብሄራዊ ባንክ', 'national bank of ethiopia'], hosts: ['nbe.gov.et'] },
  ethiotelecom: { names: ['ኢትዮ ቴሌኮም', 'ethio telecom', 'ethiotelecom'], hosts: ['ethiotelecom.et'] },
  telebirr: { names: ['ቴሌብር', 'telebirr'], hosts: ['telebirr.et', 'ethiotelecom.et'] },
  safaricom: { names: ['ሳፋሪኮም', 'safaricom'], hosts: ['safaricom.et'] },
  ecc: { names: ['ጉምሩክ ኮሚሽን', 'የኢትዮጵያ ጉምሩክ', 'customs commission'], hosts: ['ecc.gov.et'] },
  efda: { names: ['ምግብና መድኃኒት', 'ምግብና መድሃኒት', 'food and drug authority'], hosts: ['efda.gov.et'] },
  moh: { names: ['ጤና ሚኒስቴር', 'ministry of health'], hosts: ['moh.gov.et'] },
  moe: { names: ['ትምህርት ሚኒስቴር', 'ministry of education'], hosts: ['moe.gov.et'] },
  'aa-land': { names: ['መሬት ልማትና አስተዳደር', 'land development and administration'], hosts: [] },
  'aa-construction': { names: ['ዲዛይንና ግንባታ ስራዎች', 'design and construction works'], hosts: [] },
  'aa-education': { names: ['አዲስ አበባ ትምህርት ቢሮ', 'addis ababa education bureau'], hosts: [] },
  'aa-justice': { names: ['ፍትህ ቢሮ', 'bureau of justice'], hosts: [] },
  ethiopianairlines: { names: ['የኢትዮጵያ አየር መንገድ', 'ethiopian airlines'], hosts: ['ethiopianairlines.com'] },
  motri: { names: ['ንግድና ቀጣናዊ ትስስር', 'ministry of trade and regional integration', 'etrade'], hosts: ['etrade.gov.et'] },
  // the six with no channel of their own
  mor: { names: ['ገቢዎች ሚኒስቴር', 'ministry of revenue', 'ministry of revenues'], hosts: ['mor.gov.et'], uncovered: true },
  eic: { names: ['ኢንቨስትመንት ኮሚሽን', 'investment commission', 'invest ethiopia'], hosts: ['investinethiopia.gov.et'], uncovered: true },
  moj: { names: ['ፍትህ ሚኒስቴር', 'ministry of justice'], hosts: ['moj.gov.et'], uncovered: true },
  'insa-fayda': { names: ['ፋይዳ', 'fayda', 'ብሔራዊ መታወቂያ', 'ብሄራዊ መታወቂያ', 'national id', 'insa'], hosts: ['id.gov.et', 'insa.gov.et'], uncovered: true },
  poessa: { names: ['የውጭ ሀገር ስራ ስምሪት', 'overseas employment', 'poessa'], hosts: [], uncovered: true },
  'aa-central': { names: ['አዲስ አበባ ከተማ አስተዳደር', 'ከተማ አስተዳደሩ', 'addis ababa city administration'], hosts: ['addisababa.gov.et'], uncovered: true },
};
const UNCOVERED = new Set(Object.entries(OFFICES).filter(([, o]) => o.uncovered).map(([id]) => id));

function officeNamed(text) {
  for (const [id, o] of Object.entries(OFFICES)) if (firstHit(text, o.names)) return id;
  return null;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; } }
// The office's own host, at an address that is not simply that host's front page. A signature link to
// http://www.ecc.gov.et/ appears under every post the commission writes and says nothing about this one.
function officeDocumentLink(links, office) {
  const o = OFFICES[office];
  const hosts = (o && o.hosts) || [];
  for (const u of links || []) {
    const h = hostOf(u);
    if (!h) continue;
    const mine = hosts.some(x => h === x || h.endsWith('.' + x)) || /\.gov\.et$/.test(h);
    if (!mine) continue;
    let p = '/';
    try { p = new URL(u).pathname + new URL(u).search; } catch (e) { /* keep '/' */ }
    const deeper = p.replace(/\/+$/, '').length > 0;
    const sub = hosts.some(x => h !== x && h.endsWith('.' + x));   // fixedservices.ethiotelecom.et
    if (deeper || sub) return u;
  }
  return '';
}

// post -> { label, admit, office, reason, settled, stage }
// `settled` is false only for `unsettled`: that is the item the model is asked about, and the model is the
// only thing allowed to change it.
function classifyByRules(post, { source } = {}) {
  const text = String((post && post.text) || '');
  const links = (post && post.links) || [];
  const kind = (source && source.kind) || 'outlet';
  const channelOffice = kind === 'office' && source ? source.office : null;
  const out = (label, reason, office, stage) => ({ label, admit: ADMITTED.has(label), office: office || null, reason, settled: label !== 'unsettled', stage });

  if (!text.trim() && !links.length) return out('excluded', 'no text and no link', channelOffice, 1);

  const directive = firstHit(text, DIRECTIVE);
  const warning = firstHit(text, WARNING);

  // ---- stage 1 ----
  for (const [why, list] of [['politics', POLITICS], ['diplomacy', DIPLOMACY], ['ceremony', CEREMONY],
    ['holiday', HOLIDAY], ['sport', SPORT], ['live stream', LIVESTREAM], ['promotion', PROMO], ['advertorial', ADVERTORIAL]]) {
    const k = firstHit(text, list);
    if (!k) continue;
    // Only CEREMONY yields, and only to a directive word: a deadline read out at a forum, a registration opened at
    // a launch. Politics, sport, holidays and the rest are never overridden by anything.
    if (why === 'ceremony' && directive) continue;
    return out('excluded', why + ': ' + k, channelOffice, 1);
  }
  if (QUOTED.test(text)) return out('excluded', 'a quotation attributed to a person', channelOffice, 1);
  if (VIDEO.test(text.trim())) return out('excluded', 'a bare link with no text', channelOffice, 1);
  if (text.trim().length < 60 && !links.length && !directive) return out('excluded', 'under 60 characters with no link', channelOffice, 1);

  // ---- stage 2 ----
  const named = officeNamed(text);
  if (kind === 'outlet') {
    // The net, and only the net: an outlet is read for the six offices that have no channel of their own.
    if (named && UNCOVERED.has(named) && directive) return out('pack-grade', 'an outlet naming ' + named + ' with a directive word: ' + directive, named, 2);
    return out('excluded', 'an outlet item that names no office without a channel', null, 2);
  }
  const doc = officeDocumentLink(links, channelOffice);
  if (directive) return out('pack-grade', 'an office channel with a directive word: ' + directive, channelOffice, 2);
  if (warning) return out('pack-grade', 'an office channel with a public warning: ' + warning, channelOffice, 2);
  if (doc) return out('pack-grade', 'an office channel linking its own host: ' + doc, channelOffice, 2);
  const spoken = firstHit(text, REPORTED);
  if (spoken) return out('excluded', 'a press release about somebody having spoken: ' + spoken, channelOffice, 2);
  const progress = firstHit(text, PROGRESS);
  if (progress) return out('excluded', 'a progress report, not a rule: ' + progress, channelOffice, 2);
  if (named && firstHit(text, SERVICE)) return out('pack-grade', 'names ' + named + ' and tells a citizen how to use a service', named, 2);
  const tariff = tariffHit(text);
  if (tariff) return out('perishable', 'a price or an offer: ' + tariff, channelOffice, 2);
  return out('unsettled', 'neither rule settled it', channelOffice, 2);
}

module.exports = { classifyByRules, ADMITTED, OFFICES, UNCOVERED, officeNamed, officeDocumentLink, has, firstHit, DIRECTIVE, WARNING };
