'use strict';
// Bini for building owners (Plan 2 of the owner Bini design). Answer only: it reads the owner's own buildings
// through ./tools/building.js and changes nothing. What the owner may see is decided before this file runs —
// by the owner key on the web today, by the Telegram link in Plan 3 — and arrives as c.scope.
const afiya = require('../../assistant/afiya');
const { loadSoul } = require('../../assistant/kit/soul');
const building = require('./tools/building');

// A request to change something. Anchored to how such requests are phrased, because a false positive
// refuses a question the owner is entitled to ask: "send me the list" reads, "send a reminder" writes.
const CHANGE_EN = /^\s*(please\s+)?(mark|set|change|update|delete|remove|vacate|record|cancel|edit|raise|lower|increase|decrease)\b|\bsend\s+(an?\s+)?(reminder|notice|warning|sms)\b/i;
const CHANGE_AM = /(ቀይር|ቀይሩ|አጥፋ|አጥፉ|ሰርዝ|ሰርዙ|መዝግብ|መዝግቡ|ጨምር|ጨምሩ|ቀንስ|ቀንሱ)(ልኝ|ሉኝ)?\s*[።.!?]*\s*$|ማሳሰቢያ\s*ላክ/;
const isChangeRequest = msg => CHANGE_EN.test(msg) || CHANGE_AM.test(String(msg).trim());

const am = (c, amharic, english) => (c.l === 'am' ? amharic : english);

function recordsLine(c, toolResults) {
  if (!toolResults.length) return '';
  let inv = null, pay = null;
  for (const r of toolResults) for (const b of (r.out && r.out.buildings) || []) {
    if (b.newestInvoice && (!inv || b.newestInvoice > inv)) inv = b.newestInvoice;
    if (b.newestPayment && (!pay || b.newestPayment > pay)) pay = b.newestPayment;
  }
  if (!inv && !pay) return '';
  return am(c,
    '\n\n📅 መዝገቡ፦ የመጨረሻው ደረሰኝ ' + (inv || 'የለም') + '፣ የመጨረሻው የተመዘገበ ክፍያ ' + (pay || 'የለም') + '።',
    '\n\n📅 Records: newest invoice ' + (inv || 'none') + ', newest recorded payment ' + (pay || 'none') + '.');
}

module.exports = {
  name: 'owner',
  soul: loadSoul('owner'),
  maxTokens: 700,
  knowledge: false,   // the owner's records are the only source; general documents would only add unrelated figures
  log: false,         // replies carry tenants' names and money: audited, never kept in the chat log

  gates: [
    { test: c => afiya.isEmergency(c.msg),
      answer: c => ({ body: { reply: afiya.emergencyReply(c.l), emergency: true, ambulance: afiya.AMBULANCE },
        log: ['emergency'], handover: 'Owner Bini: possible emergency' }) },
    { test: c => !c.scope || !Array.isArray(c.scope.buildingIds) || !c.scope.buildingIds.length,
      answer: c => ({ body: { reply: am(c, 'ይቅርታ፣ የትኛው ህንፃ የእርስዎ እንደሆነ አልታወቀም። እባክዎ እንደገና ይግቡ።',
        'Sorry, I could not tell which building is yours. Please sign in again.') } }) },
    { test: c => isChangeRequest(c.msg),
      answer: c => ({ body: { readOnly: true, reply: am(c,
        'በዚህ ስሪት መዝገብዎን ማንበብ ብቻ ነው የምችለው፤ መለወጥ አልችልም። ክፍያ ለመመዝገብ፣ ማሳሰቢያ ለመላክ ወይም ክፍል ለማስተካከል የባለቤት ዳሽቦርዱን ይጠቀሙ (Rent Collection፣ Units፣ Accounting)።',
        'In this version I can only read your records, not change them. To record a payment, send a reminder or edit a unit, use the owner dashboard: Rent Collection, Units or Accounting.') } }) },
  ],

  inScope: () => true,
  redirect: () => '',

  tools: building.DEFS,
  executor: (c, deps) => building.makeExecutor({ prisma: deps.prisma })(c.scope),

  instruct: () => '\n\nToday is ' + new Date().toISOString().slice(0, 10) + '. Answer only from the tool results.',

  finish(c, text, { toolResults = [] }) {
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

  isChangeRequest,
};
