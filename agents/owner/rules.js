'use strict';
// Bini for building owners (Plan 2 of the owner Bini design). Answer only: it reads the owner's own buildings
// through ./tools/building.js and changes nothing. What the owner may see is decided before this file runs —
// by the owner key on the web today, by the Telegram link in Plan 3 — and arrives as c.scope.
//
// Tenants' and shops' names never reach the model: the tools hand it tokens such as [[P1]], and finish()
// puts the names back on the server once the model has answered.
const { foldEthiopic } = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const { loadSoul } = require('../../assistant/kit/soul');
const building = require('./tools/building');

// An emergency in a building, answered from code before anything else. afiya.isEmergency is written for
// someone describing a patient and fires on ordinary owner wording ("take a screenshot", "new fittings",
// "market collapsed", "ሞተሩ ተቃጠለ"), which would refuse the owner's question with an ambulance number. This
// list is narrow on purpose: fire or smoke in the building, a gas leak, a structure collapsing, someone
// trapped, not breathing, unconscious or bleeding heavily. Both the input and the Amharic patterns are folded
// (ሐ→ሀ, ፀ→ጸ …), as in assistant/afiya.js.
const foldRe = list => list.map(re => new RegExp(foldEthiopic(re.source), re.flags));
const PLACE_EN = '(building|floor|unit|flat|apartment|shop|office|lift|elevator|basement|stairs?|stairwell|staircase|kitchen|room|parking|garage|generator room|compound)';
const PLACE_AM = '(ህንፃ|ክፍል|ፎቅ|ቤት|ሱቅ|ቢሮ|ግቢ|ሊፍት|አሳንሰር|ኩሽና|ምድር ቤት|ፓርኪንግ|ደረጃ)';
const EMERGENCY = foldRe([
  new RegExp('\\b(fire|smoke)\\s+(is\\s+|coming\\s+)?(in|on|at|inside|from)\\s+(the\\s+|a\\s+|our\\s+|my\\s+)?(\\w+\\s+){0,2}' + PLACE_EN + '\\b', 'i'),
  /\b(is|are|was|has|have|just)\s+(caught\s+fire|on\s+fire|burning\s+down)\b|\bcaught\s+fire\b/i,
  /\bgas\s+(is\s+)?(leak|leaking)\b|\bleaking\s+gas\b|\bsmell(s|ing)?\s+(of\s+)?gas\b/i,
  /\b(building|ceiling|roof|wall|floor|staircase|stairs|balcony)\s+(has\s+|have\s+|is\s+|just\s+)*(collapsed|collapsing|caved\s+in|fallen\s+down|falling\s+down)\b/i,
  /\b(trapped|stuck)\s+(in|inside|under)\s+(the\s+|a\s+)?(lift|elevator|building|rubble|fire|basement|room|flat|unit)\b/i,
  /\b(not|stopped|isn'?t|can'?t|cannot)\s+breath(e|ing)\b/i,
  /\bunconscious\b|\bunresponsive\b|\bpassed\s+out\b/i,
  /\bbleeding\s+(heavily|badly|a\s+lot)\b|\bheavy\s+bleeding\b|\bwon'?t\s+stop\s+bleeding\b/i,
  // Amharic: a fire that started (ተነሳ/ተቀጣጠለ), with a place in the building on either side
  new RegExp(PLACE_AM + '[^።.!?]{0,30}እሳት[^።.!?]{0,12}(ተነሳ|ተነስ|ተቀጣጠለ|ተቀጣጥ)'),
  new RegExp('እሳት[^።.!?]{0,12}(ተነሳ|ተነስ|ተቀጣጠለ|ተቀጣጥ)[^።.!?]{0,30}' + PLACE_AM),
  /ጋዝ\s*(ሊክ|እየፈሰሰ|እያፈሰሰ|ይፈሳል|እየሸተተ|ይሸታል)/,
  /(ህንፃው|ህንፃ|ጣሪያው|ጣሪያ|ግድግዳው|ግድግዳ|ኮርኒሱ|ደረጃው|በረንዳው)\s*(ፈረሰ|ፈርሷል|ተደረመሰ|ተደርምሷል|ፈራረሰ)/,
  /(ሰው|ሰዎች|ልጅ|ተከራይ)[^።.!?]{0,20}(ተጣብቋል|ተጣብቀዋል|ተቀርቅሯል|ተቀርቅረዋል|ታፍኗል|ታፍነዋል)/,
  /አይተነፍስም|አትተነፍስም|እየተነፈሰ\s+አይደለም|እየተነፈሰች\s+አይደለም|መተንፈስ\s+(አልቻለም|አልቻለችም|አቃተው|አቃታት)/,
  /ራሱን\s+(ስቷል|ሳተ|ስቶ)|ራሷን\s+(ስታለች|ሳተች|ስታ)|ራሳቸውን\s+ስተዋል/,
  /ከባድ\s+ደም|ብዙ\s+ደም|ደም[^።.!?]{0,10}(አይቆምም|አልቆመም)/,
  // Afaan Oromoo: the breathing and consciousness lines of assistant/afiya.js
  /hafuura[^.!?]{0,22}(hin baafat|baafachuu hin danda|dhaabbate)|hin hargan|harganuu hin danda/i,
  /of wallaal|of hin beek/i,
]);
const isEmergency = msg => { const m = foldEthiopic(String(msg || '')); return EMERGENCY.some(re => re.test(m)); };

// A request to change something, matched only where the object makes it unambiguous. A false positive
// refuses a question the owner is entitled to ask; a missed request costs nothing, because there are no
// write tools and the soul says so. "send a reminder" writes, "did I send a reminder" and "send me the
// list" read; ልቀይር? ("should I change?") asks, ቀይር ("change it") orders.
const LEAD = '^\\s*(please\\s+|pls\\s+|can\\s+you\\s+|could\\s+you\\s+)?';
const CHANGE_EN = [
  new RegExp(LEAD + 'mark\\s+(unit\\s+)?\\S+\\s+(as\\s+)?(paid|unpaid|vacant|occupied)\\b', 'i'),
  new RegExp(LEAD + '(change|update|raise|lower|increase|decrease|set)\\s+(the\\s+)?rent\\s+(of|for|on)\\b', 'i'),
  new RegExp(LEAD + '(send|issue)\\s+(an?\\s+)?(reminder|notice|sms|invoice)\\b', 'i'),
  new RegExp(LEAD + '(delete|remove|cancel)\\s+(the\\s+|this\\s+|that\\s+|an?\\s+)?(invoice|expense|tenant|unit)\\b', 'i'),
  new RegExp(LEAD + '(vacate|evict)\\s+(the\\s+)?(unit\\s+\\S+|tenants?\\b|\\d)', 'i'),
];
const CHANGE_AM = [
  // an imperative closing the message, never the first-person ል- form of a question
  /(^|[\s፣])(?!ል)\S*(ቀይር|ቀይሩ|አጥፋ|አጥፉ|ሰርዝ|ሰርዙ|መዝግብ|መዝግቡ)(ልኝ|ሉኝ)?\s*[።.!?]*\s*$/,
  /ማሳሰቢያ\s*(ላክ|ላኩ)(ልኝ|ሉኝ|ለት|ላት|ላቸው)?\s*[።.!?]*\s*$/,
];
const isChangeRequest = msg => { const m = String(msg || '').trim(); return CHANGE_EN.some(re => re.test(m)) || CHANGE_AM.some(re => re.test(m)); };

const am = (c, amharic, english) => (c.l === 'am' ? amharic : english);
const scopeIds = c => (c.scope && Array.isArray(c.scope.buildingIds) && c.scope.buildingIds.length ? c.scope.buildingIds : null);

// How recent the records are, per building, from the tools' own newestInvoice / newestPayment.
function recordsLine(c, toolResults) {
  const per = new Map();
  for (const r of toolResults) for (const b of (r.out && r.out.buildings) || []) {
    if (!b.newestInvoice && !b.newestPayment) continue;
    const e = per.get(b.building) || { name: b.building, nameAm: b.buildingAm, inv: null, pay: null };
    if (b.newestInvoice && (!e.inv || b.newestInvoice > e.inv)) e.inv = b.newestInvoice;
    if (b.newestPayment && (!e.pay || b.newestPayment > e.pay)) e.pay = b.newestPayment;
    per.set(b.building, e);
  }
  if (!per.size) return '';
  const label = per.size > 1 || (scopeIds(c) || []).length > 1;
  return '\n\n' + [...per.values()].map(e => am(c,
    '📅 መዝገቡ' + (label ? ' (' + (e.nameAm || e.name) + ')' : '') + '፦ የመጨረሻው ኢንቮይስ የሚከፈልበት ቀን ' + (e.inv || 'የለም') + '፣ የመጨረሻው የተመዘገበ ክፍያ ' + (e.pay || 'የለም') + '።',
    '📅 Records' + (label ? ' for ' + e.name : '') + ': newest invoice due ' + (e.inv || 'none') + ', newest recorded payment ' + (e.pay || 'none') + '.')).join('\n');
}

// [[P1]] → the name the tools tokenised for this question; a token they never gave is removed.
function restoreNames(c, text) {
  const names = c.names instanceof Map ? c.names : new Map();
  return String(text || '')
    .replace(/\[\[\s*P(\d+)\s*\]\]/gi, (_, n) => names.get('[[P' + n + ']]') || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?።፣])/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

module.exports = {
  name: 'owner',
  soul: loadSoul('owner'),
  maxTokens: 700,
  knowledge: false,   // the owner's records are the only source; general documents would only add unrelated figures
  log: false,         // replies carry tenants' names and money: audited, never kept in the chat log

  gates: [
    // Before the scope gate on purpose: an emergency gets 907 even if the owner's session is broken.
    { test: c => isEmergency(c.msg),
      answer: c => ({ body: { reply: afiya.emergencyReply(c.l), emergency: true, ambulance: afiya.AMBULANCE },
        log: ['emergency'], handover: 'Owner Bini: possible emergency · building ' + ((scopeIds(c) || ['unknown']).join(',')) }) },
    { test: c => !scopeIds(c),
      answer: c => ({ body: { reply: am(c, 'ይቅርታ፣ የትኛው ህንፃ የእርስዎ እንደሆነ አልታወቀም። እባክዎ እንደገና ይግቡ።',
        'Sorry, I could not tell which building is yours. Please sign in again.') } }) },
    { test: c => isChangeRequest(c.msg),
      answer: c => ({ body: { readOnly: true, reply: am(c,
        'በዚህ ስሪት መዝገብዎን ማንበብ ብቻ ነው የምችለው፤ መለወጥ አልችልም። ኢንቮይስ መከፈሉን ለመመዝገብ በባለቤት ዳሽቦርዱ Invoices የሚለውን ገጽ፣ ክፍልን ወይም ተከራይን ለማስተካከል ደግሞ Tenants የሚለውን ገጽ ይክፈቱ።',
        'In this version I can only read your records, not change them. To mark an invoice as paid, open the Invoices tab of the owner dashboard; to edit a unit or a tenant, open the Tenants tab.') } }) },
  ],

  inScope: () => true,
  redirect: () => '',

  tools: building.DEFS,
  executor: (c, deps) => {
    const ex = building.makeExecutor({ prisma: deps.prisma })(c.scope);
    c.names = ex.names;   // token -> name, filled as the tools run; read by finish()
    return ex;
  },

  instruct: () => '\n\nToday is ' + new Date().toISOString().slice(0, 10) + '. Answer only from the tool results.',

  finish(c, text, { toolResults = [] }) {
    text = restoreNames(c, text);
    if (!text) text = am(c, 'ይቅርታ፣ ይህን በመዝገብዎ ውስጥ አላገኘሁትም። በሌላ መንገድ ይጠይቁ ወይም ዳሽቦርዱን ይክፈቱ።',
      'Sorry, I could not find that in your records. Ask another way, or open the dashboard.');
    return text + recordsLine(c, toolResults);
  },

  fallback: c => am(c, 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ ዳሽቦርዱን ይመልከቱ።', 'Sorry, I could not answer just now. Please check the dashboard.'),

  // Who asked, through which door, with which tools — never the answer.
  audit(c, { tools }, deps) {
    if (typeof deps.audit !== 'function') return;
    for (const id of c.scope.buildingIds)
      deps.audit(id, 'OWNER_BINI_Q', c.channel + ' · ' + (tools.join(',') || 'no tools') + ' · ' + c.msg.slice(0, 120));
  },

  isEmergency,
  isChangeRequest,
};
