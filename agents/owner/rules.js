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

// A request to DO something Bini cannot do in this version — message or call tenants, create an invoice, record a
// payment or an expense, change rent, add or remove a tenant, close a repair — matched only where the verb and
// its object make it unambiguous. A false positive refuses a question the owner is entitled to ask; a missed
// request costs little, because there are no write tools and the soul says the same. "send a reminder" acts,
// "did I send a reminder" and "send me the list" read; ልቀይር? ("should I change?") asks, ቀይር ("change it")
// orders. Each action has its own answer naming the tab and the button public/owner.html really has (a test
// reads the file), because "I can't" with no next step is what confused the first owner.
const LEAD = '^\\s*(please\\s+|pls\\s+|can\\s+you\\s+|could\\s+you\\s+|bini,?\\s+)?';
const en = s => new RegExp(LEAD + s, 'i');
// an Amharic imperative closing the message, never the first-person ል- form of a question (ልላክ? ልደውል?)
const AM_END = '(ልኝ|ሉኝ|ለት|ላት|ላቸው)?\\s*[።.!?]*\\s*$';
const amVerb = (object, verbs) => new RegExp((object ? '(' + object + ')[^።.!?]{0,30}?' : '') + '(?:^|[\\s፣])(?!ል)\\S{0,3}?(' + verbs + ')' + AM_END);
const ACTION_PATTERNS = [
  ['message', [
    en('(send|write)\\s+(an?\\s+|the\\s+)?(message|messages|text|sms|notice|announcement|reminder|reminders)\\b'),
    en('(message|text|notify|inform|tell|remind|alert)\\s+(all\\s+)?(of\\s+)?(the\\s+|my\\s+)?(tenants?|shops?|renters|customers|everyone)\\b'),
  ], [amVerb('መልእክት|ማሳሰቢያ|ማስታወቂያ|ማስጠንቀቂያ|ኤስኤምኤስ|sms|ቴክስት', 'ላክ|ላኩ|አስተላልፍ|አስተላልፉ'),
    amVerb('ተከራይ|ተከራዮች|ደንበኛ|ደንበኞች', 'ንገር|ንገሩ|ንገራቸው|አሳውቅ|አሳውቁ|አሳውቃቸው')]],
  ['call', [en('(call|phone|ring|whatsapp)\\s+(the\\s+|my\\s+|all\\s+)?(tenants?|units?|shops?|him|her|them)\\b')],
    [amVerb('', 'ደውል|ደውሉ')]],
  ['invoice', [en('(create|make|generate|issue|raise|prepare|send)\\s+(an?\\s+|the\\s+|new\\s+|all\\s+|monthly\\s+|this\\s+month[\'’]?s\\s+)*(invoices?|bills?)\\b')],
    [amVerb('ኢንቮይስ|ደረሰኝ|ቢል|መጠየቂያ', 'አዘጋጅ|አዘጋጁ|ፍጠር|ፍጠሩ|ቁረጥ|ቁረጡ|አውጣ|አውጡ|ላክ|ላኩ')]],
  ['expense', [en('(add|record|enter|log)\\s+(an?\\s+|the\\s+|new\\s+)*expenses?\\b')],
    [amVerb('ወጪ', 'መዝግብ|መዝግቡ|ጨምር|ጨምሩ|አስገባ|አስገቡ')]],
  ['paid', [en('mark\\s+(unit\\s+)?\\S+\\s+(as\\s+)?(paid|unpaid)\\b')],
    [amVerb('ክፍያ|ተከፍሏል|ከፍሏል', 'መዝግብ|መዝግቡ')]],
  ['rent', [en('(change|update|raise|lower|increase|decrease|set)\\s+(the\\s+)?rent\\s+(of|for|on)\\b')],
    [amVerb('ኪራይ', 'ጨምር|ጨምሩ|ቀንስ|ቀንሱ'), amVerb('', 'ቀይር|ቀይሩ')]],
  ['tenant', [en('(vacate|evict)\\s+(the\\s+)?(unit\\s+\\S+|tenants?\\b|\\d)'), en('(add|register)\\s+(a\\s+|the\\s+)?(new\\s+)?tenants?\\b'),
    en('mark\\s+(unit\\s+)?\\S+\\s+(as\\s+)?(vacant|occupied)\\b'), en('(delete|remove)\\s+(the\\s+|this\\s+|that\\s+|a\\s+)?(tenant|unit)\\b')], []],
  ['repair', [en('(assign|close|resolve|complete|finish|start)\\s+(a\\s+|an\\s+|the\\s+|this\\s+)?(\\w+\\s+)?(technician|plumber|electrician|repairs?|maintenance|request|ticket)\\b')], []],
  ['change', [en('(delete|remove|cancel)\\s+(the\\s+|this\\s+|that\\s+|an?\\s+)?(invoice|expense)\\b')],
    [amVerb('', 'አጥፋ|አጥፉ|ሰርዝ|ሰርዙ|መዝግብ|መዝግቡ')]],
];
function actionFor(msg) {
  const m = String(msg || '').trim();
  const folded = foldEthiopic(m);
  for (const [action, english, amharic] of ACTION_PATTERNS)
    if (english.some(re => re.test(m)) || amharic.some(re => re.test(folded))) return action;
  return null;
}
const isChangeRequest = msg => actionFor(msg) !== null;

const CANT = {
  message: ['ለተከራዮች መልእክት መላክ በዚህ ስሪት አልችልም። ዳሽቦርዱም ለሁሉም በአንድ ጊዜ የሚልክ ቁልፍ የለውም፦ በInvoices ገጽ በኢንቮይሱ ላይ ያለው «📤 Send» ኢንቮይሱን ለዚያ ክፍል ተከራይ በWhatsApp ወይም በቴሌግራም ይልካል፤ የእያንዳንዱ ተከራይ ስልክ በTenants ገጽ ከስሙ ስር አለ።',
    'I can\'t send messages to tenants in this version, and the dashboard has no send-to-everyone button either. In the Invoices tab, "📤 Send" on an invoice sends it to that unit\'s tenant by WhatsApp or Telegram; each tenant\'s phone number is under their name in the Tenants tab.'],
  call: ['ስልክ መደወል አልችልም። የእያንዳንዱ ተከራይ ስልክ ቁጥር በባለቤት ዳሽቦርዱ Tenants ገጽ ከስሙ ስር አለ፤ የጥገና ጠያቂ ስልክ ደግሞ በMaintenance ገጽ 📞 ቁልፍ ላይ ነው።',
    'I can\'t make calls. Each tenant\'s phone number is under their name in the Tenants tab of the owner dashboard; for a repair request, use the 📞 button in the Maintenance tab.'],
  invoice: ['ኢንቮይስ ማዘጋጀትም መላክም በዚህ ስሪት አልችልም። በባለቤት ዳሽቦርዱ Invoices ገጽ «⚡ Generate month invoices» የወሩን የኪራይ ኢንቮይሶች ያዘጋጃል፣ በኢንቮይሱ ላይ ያለው «📤 Send» ለተከራዩ ይልካል። የመብራትና የውሃ ቢል በMeters ገጽ «💡 Bill» ነው።',
    'I can\'t create or send invoices in this version. In the Invoices tab of the owner dashboard, "⚡ Generate month invoices" creates this month\'s rent invoices and "📤 Send" on an invoice sends it to the tenant. Electricity and water bills are under "💡 Bill" in the Meters tab.'],
  expense: ['ወጪ መመዝገብ በዚህ ስሪት አልችልም። በባለቤት ዳሽቦርዱ Accounting ገጽ «➕ Add expense» ይጫኑ።',
    'I can\'t record an expense in this version. In the Accounting tab of the owner dashboard, press "➕ Add expense".'],
  paid: ['ክፍያ መመዝገብ በዚህ ስሪት አልችልም፤ ማንበብ ብቻ ነው የምችለው። በባለቤት ዳሽቦርዱ Invoices ገጽ በኢንቮይሱ ላይ ያለውን «✓ Paid» ይጫኑ።',
    'I can\'t record a payment in this version; I can only read. In the Invoices tab of the owner dashboard, press "✓ Paid" on the invoice.'],
  rent: ['ኪራይን ወይም የተከራይን መረጃ መለወጥ በዚህ ስሪት አልችልም። በባለቤት ዳሽቦርዱ Tenants ገጽ በክፍሉ ላይ ያለውን «✏️ Edit» ይጫኑ።',
    'I can\'t change rent or a tenant\'s details in this version. In the Tenants tab of the owner dashboard, press "✏️ Edit" on the unit.'],
  tenant: ['ተከራይ ማስገባት ወይም ማስወጣት በዚህ ስሪት አልችልም። በባለቤት ዳሽቦርዱ Tenants ገጽ ባዶ ክፍል ላይ «➕ Add tenant»፣ ተከራይ ባለበት ክፍል ላይ «🚪 Vacate» ይጫኑ።',
    'I can\'t add or remove a tenant in this version. In the Tenants tab of the owner dashboard, press "➕ Add tenant" on a vacant unit or "🚪 Vacate" on an occupied one.'],
  repair: ['የጥገና ጥያቄን መጀመር ወይም መዝጋት በዚህ ስሪት አልችልም። በባለቤት ዳሽቦርዱ Maintenance ገጽ በጥያቄው ላይ «▶ Start» ወይም «✓ Done» ይጫኑ።',
    'I can\'t start or close a repair request in this version. In the Maintenance tab of the owner dashboard, press "▶ Start" or "✓ Done" on the request.'],
  change: ['በዚህ ስሪት መዝገብዎን ማንበብ ብቻ ነው የምችለው፤ መለወጥ አልችልም። ኢንቮይስ መከፈሉን ለመመዝገብ በባለቤት ዳሽቦርዱ Invoices የሚለውን ገጽ፣ ክፍልን ወይም ተከራይን ለማስተካከል ደግሞ Tenants የሚለውን ገጽ ይክፈቱ።',
    'I can\'t change records in this version; I can only read them. To mark an invoice as paid, open the Invoices tab of the owner dashboard; to edit a unit or a tenant, open the Tenants tab.'],
};
const actionReply = (action, l) => (CANT[action] || CANT.change)[l === 'am' ? 0 : 1];

// A follow-up with nothing in it: "what do you mean?", "እሺ አንተ ምንድነው የምትለው?". Bini for owners has no memory
// (the engine sends the model the current message only, from the dashboard and from Telegram alike), so a
// model can only guess what "that" was — the first owner got a guess. Answered from code: I do not see my
// earlier answer, write the whole question, and this is what I can answer. Matched only when nothing but
// such a phrase is left once fillers (እሺ, ok, you …) are removed, so "what do you mean by overdue?" is a question.
const FILLERS = new Set(['እሺ', 'ኦኬ', 'ok', 'okay', 'እና', 'ግን', 'ታዲያ', 'ታድያ', 'ደግሞ', 'ኧረ', 'so', 'well', 'but', 'and', 'hmm', 'sorry', 'ይቅርታ',
  'አንተ', 'አንቺ', 'እርስዎ', 'bini', 'ቢኒ', 'please', 'pls', 'then', 'now', 'አሁን'].map(foldEthiopic));
const FOLLOW_UP = [
  /^(ምንድነው|ምንድን ነው|ምን ነው) (የምትለው|የምትይው|የምትሉት|ያልከው|ያልከኝ|ማለትህ|ማለትሽ|ማለትዎ)$/,
  /^(የምትለው|ያልከው|ያልከኝ|ማለትህ|ማለትዎ) (ምንድነው|ምንድን ነው|ምን ነው)$/,
  /^ምን (ማለትህ|ማለትሽ|ማለትዎ|ማለት) ነው$/, /^ምን (እያልክ|እያልሽ|እያሉ) ነው$/, /^ምን (አልክ|አልከኝ|አልሽ|አሉ)$/,
  /^(አልገባኝም|አልገባኝ|አልተረዳሁም|አልተረዳሁህም|ግልጽ አይደለም)( ምን ማለትህ ነው)?$/,
  /^ምን (ትረዳኛለህ|ልትረዳኝ ትችላለህ|ማድረግ ትችላለህ|ታደርጋለህ|ትሰራለህ|ትችላለህ)$/, /^(እርዳታ|help|menu)$/,
  /^what (do|did) you mean( by that)?$/, /^what (are|were) you (saying|talking about)$/, /^(what|huh|eh|pardon)$/,
  /^i (dont|do not|didnt|did not) (understand|get it|follow)$/, /^(come again|say that again|explain( that)? again|im confused|i am confused|confused)$/,
  /^what (can|do) you do$/, /^what can you help (me )?with$/,
];
function isFollowUp(msg) {
  const words = foldEthiopic(String(msg || '')).toLowerCase().replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter(w => w && !FILLERS.has(w));
  const rest = words.join(' ');
  return !!rest && rest.length <= 60 && FOLLOW_UP.some(re => re.test(rest));
}
const HELP = [
  'ቀደም ብዬ የመለስኩትን አላየውም፤ እያንዳንዱን መልእክት ለብቻው ነው የምመልሰው፣ ስለዚህ ጥያቄዎን ሙሉ በሙሉ ይጻፉልኝ። ከመዝገብዎ ልመልስ የምችለው፦ የወሩ ኪራይ፣ የተከፈለና ያልተከፈለ፣ ያልከፈሉ ክፍሎች፣ አንድ ክፍል በቁጥሩ፣ በአንድ ፎቅ ያሉ ተከራዮች (ለምሳሌ «2ኛ ፎቅ»)፣ ተከራይን በስሙ መፈለግ፣ ባዶ ክፍሎች፣ የሚያልቁ ውሎች፣ ጥገና፣ ገቢ፣ ወጪና ቫት። መልእክት መላክ፣ መደወል ወይም መዝገብ መለወጥ አልችልም፤ ያንን በባለቤት ዳሽቦርዱ ያድርጉ።',
  'I don\'t see my earlier answers: I answer each message on its own, so please write your whole question. From your records I can answer: this month\'s rent, what is paid and unpaid, who has not paid, one unit by its number, the tenants on a floor (e.g. "floor 2"), a tenant by name, vacant units, contracts ending, repairs, income, expenses and VAT. I can\'t send messages, make calls or change records; do that in the owner dashboard.',
];

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
    { test: c => isFollowUp(c.msg), answer: c => ({ body: { help: true, reply: am(c, HELP[0], HELP[1]) } }) },
    { test: c => actionFor(c.msg) !== null,
      answer: c => { const action = actionFor(c.msg); return { body: { readOnly: true, action, reply: actionReply(action, c.l) } }; } },
  ],

  inScope: () => true,
  redirect: () => '',

  tools: building.DEFS,
  executor: (c, deps) => {
    // c.msg is the owner's own message, already on its way to the model; find_tenant may only search its words
    const ex = building.makeExecutor({ prisma: deps.prisma })(c.scope, { question: c.msg });
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
  actionFor,
  actionReply,
  isFollowUp,
};
