'use strict';
// A government office as a kit agent definition, built from its data (gov/tenants.json via gov/registry.js).
// The engine (assistant/kit/engine.js) owns the order; this file owns only what the office says and refuses.
//
// Nothing here pages anyone or writes a chat log: a ministry visitor's words do not go to our Telegram and
// are not kept (design §4, §7). The only record is the ledger count gov/routes.js files after the reply.
const afiya = require('../assistant/afiya');
const asmat = require('../assistant/asmat');
const politics = require('../assistant/politics');
const { SHARED } = require('../assistant/dating');
const F = require('./filters');

const L = l => (l === 'am' || l === 'om' ? l : 'en');
const pick = (o, l) => (o && (o[L(l)] || o.en)) || '';

const TEXT = {
  agency: {
    am: r => 'በዚህ ረዳት በኩል ስለ ተወሰኑ ኤጀንሲዎች መፈለግም ሆነ ስልክ ቁጥራቸውን መስጠት አልችልም። ፈቃድ ያላቸውን የግል ሥራና ሠራተኛ አገናኝ ኤጀንሲዎች ዝርዝር ሚኒስቴሩ ራሱ ያትማል፦ ' + r + ' — ኤጀንሲውን እዚያ ይፈልጉ፣ ወይም ሚኒስቴሩን በቀጥታ ይጠይቁ።',
    en: r => 'I can\'t look up individual agencies or give their phone numbers here. The Ministry publishes its own list of licensed private employment agencies: ' + r + ' — check the agency there, or ask the Ministry directly.',
    om: r => 'Asitti ejensiiwwan tokko tokko barbaaduu ykn lakkoofsa bilbilaa isaanii kennuu hin danda\'u. Ministeerichi tarree ejensiiwwan hayyama qabanii ofii isaatii maxxansa: ' + r + ' — achitti barbaadaa, ykn Ministeerichaan kallattiin gaafadhaa.',
  },
  records: {
    am: g => 'የማንንም ሰው የግል መዝገብ፣ ማመልከቻ ወይም ውጤት ማየት አልችልም። የራስዎን ማመልከቻ ሁኔታ ለማወቅ ያመለከቱበትን ፖርታል ወይም ቢሮ ይጠይቁ። የሌበር አይዲና የኤል.ኤም.አይ.ኤስ ምዝገባ እንዴት እንደሚሠራ መመሪያችን ያብራራል፦ ' + g,
    en: g => 'I can\'t see anyone\'s own records, applications or results. For the status of your own application, ask the portal or office where you applied. Our guide explains how Labor ID and LMIS registration work: ' + g,
    om: g => 'Galmee dhuunfaa, iyyannoo ykn bu\'aa nama kamiyyuu arguu hin danda\'u. Haala iyyannoo keessanii beekuuf poortaalii ykn waajjira itti iyyattan gaafadhaa. Qajeelfamni keenya Labor ID fi galmee LMIS akkamitti akka hojjetu ibsa: ' + g,
  },
  advice: {
    am: () => 'ስለ ራስዎ ውል ወይም ጉዳይ የሕግ ምክር መስጠት አልችልም፤ ያ የጠበቃ ሥራ ነው። ሕጉ በጠቅላላ ምን እንደሚል ግን መጠየቅ ይችላሉ — ለምሳሌ «በአዋጅ ቁጥር 1156/2019 የማስጠንቀቂያ ጊዜ ስንት ነው?»። ነጻ የሕግ ድጋፍ ለማግኘት በአካባቢዎ ያለውን የሥራና ክህሎት ቢሮ ወይም የሕግ ድጋፍ ማዕከል ይጠይቁ።',
    en: () => 'I can\'t give legal advice about your own contract or case; that needs a lawyer. You can ask what the law says in general, for example "what notice period does Proclamation No. 1156/2019 set?". For free legal help, ask your local labour and skills office or a legal aid centre.',
    om: () => 'Waa\'ee waliigaltee ykn dhimma keessan dhuunfaa gorsa seeraa kennuu hin danda\'u; kun hojii abukaatoo ti. Seerri waliigalaan maal akka jedhu garuu gaafachuu dandeessu — fakkeenyaaf "Labsiin lakk. 1156/2019 yeroo beeksisaa meeqa kaa\'a?". Gargaarsa seeraa bilisaa argachuuf waajjira hojii fi ogummaa naannoo keessanii ykn wiirtuu gargaarsa seeraa gaafadhaa.',
  },
  danger: {
    am: p => 'አንድ ሰው አሁን አደጋ ላይ ከሆነ፦ በዚያው አገር የሚገኘውን የኢትዮጵያ ኤምባሲ ወይም ቆንስላ እና የአገሩን ፖሊስ ወዲያውኑ ያነጋግሩ። ኢትዮጵያ ውስጥ፦ የፌዴራል ፖሊስ ' + p + '።',
    en: p => 'If someone is in danger now: contact the Ethiopian embassy or consulate in that country and the local police there straight away. In Ethiopia: Federal Police ' + p + '.',
    om: p => 'Namni tokko amma balaa keessa yoo jiraate: ambaasii ykn qonsilaa Itoophiyaa biyya sana jiru fi poolisii biyyattii battaluma quunnamaa. Itoophiyaa keessatti: Poolisii Federaalaa ' + p + '.',
  },
  limited: {
    am: () => 'በአጭር ጊዜ ብዙ ጥያቄዎች ደርሰውኛል። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።',
    en: () => 'Too many questions in a short time. Please wait a little and try again.',
    om: () => 'Yeroo gabaabaa keessatti gaaffiin baay\'een na qaqqabe. Maaloo xiqqoo turaatii irra deebi\'aa yaalaa.',
  },
  // Y8: a language the office has not switched on. Said in both switched-on languages, never in the one asked in:
  // the Oromo strings are not shown until a speaker has read them.
  language: {
    am: () => 'ለጊዜው የምመልሰው በአማርኛና በእንግሊዝኛ ብቻ ነው። እባክዎ ጥያቄዎን በአማርኛ ወይም በእንግሊዝኛ ይጠይቁ።',
    en: () => 'For now I answer in Amharic and English only. Please ask your question in Amharic or English.',
  },
  fallback: {
    am: h => 'አሁን መመለስ አልቻልኩም። እባክዎ ቆይተው ይሞክሩ፤ ወይም የሚኒስቴሩን ድረ ገጽ ይመልከቱ፦ ' + h,
    en: h => 'I couldn\'t answer just now. Please try again later, or see the Ministry\'s own site: ' + h,
    om: h => 'Amma deebisuu hin dandeenye. Maaloo booda yaalaa, ykn marsariitii Ministeerichaa ilaalaa: ' + h,
  },
};
const say = (key, l, arg) => TEXT[key][L(l)](arg);

function dangerReply(t, l) {
  const lines = [say('danger', l, asmat.POLICE)];
  for (const c of t.contacts || []) if (c.approved === true) lines.push(pick(c.label, l) + (L(l) === 'am' ? '፦ ' : ': ') + c.tel);
  return lines.join('\n');
}

function soulFor(t) {
  const inst = t.institution.en, name = t.assistantName.en;
  return 'You are ' + name + ', an information assistant that BinaSmart runs on the website of the ' + inst + '. '
    + 'You are NOT the ' + inst + ' and you never speak for it. If asked who you are, say you are BinaSmart\'s assistant, '
    + 'and that the ' + inst + ' publishes its own information at ' + t.home + '.\n'
    + 'Answer in the language of the question, from the documents in the "Information you may use" block and from nothing else. '
    + 'If the block does not hold the answer, say plainly that you do not hold it and name the office or document that would; '
    + 'never fill a gap from memory. A figure, a number of days, a fee or a date that is not in the block must not appear in your answer.\n'
    + 'You explain what the law and the published procedures say in general. You never assess a person\'s own contract, case or '
    + 'chances, and you never tell them what to sign. You cannot see anyone\'s records, applications or results.\n'
    + 'You never give, complete or guess a phone number of an agency, a company or a person. A number shown with dots stays masked.\n'
    + 'Keep answers short: the answer first, then the steps or conditions, then the document it comes from. No emoji.\n'
    + (t.notes || []).map(n => '- ' + n).join('\n') + '\n'
    + SHARED;
}

function makeOfficeAgent(office) {
  const t = office.tenant;
  const refuse = t.refuse || {};
  const gate = (id, test, body) => ({ id, test, answer: c => ({ body: body(c) }) });
  const gates = [
    gate('emergency', c => afiya.isEmergency(c.msg), c => ({ reply: afiya.emergencyReply(c.l), emergency: true, ambulance: afiya.AMBULANCE })),
    gate('danger', c => F.isDangerAbroad(c.msg), c => ({ reply: dangerReply(t, c.l), urgent: true })),
  ];
  const langs = Array.isArray(t.languages) && t.languages.length ? t.languages : ['am', 'en'];
  gates.push(gate('language', c => !langs.includes(c.l),
    () => ({ reply: TEXT.language.en() + '\n' + TEXT.language.am(), redirected: true, refused: 'language' })));
  if (refuse.politics) gates.push(gate('politics', c => politics.isPolitical(c.msg),
    c => ({ reply: politics.politicalReply(c.l), redirected: true, refused: 'politics' })));
  if (refuse.agencyLookup) gates.push(gate('agency', c => F.isAgencyLookup(c.msg),
    c => ({ reply: say('agency', c.l, t.agencyRegister), redirected: true, refused: 'agency' })));
  if (refuse.personalRecords) gates.push(gate('records', c => F.isPersonalRecords(c.msg),
    c => ({ reply: say('records', c.l, t.recordsGuide), redirected: true, refused: 'records' })));
  if (refuse.caseAdvice) gates.push(gate('advice', c => F.isCaseAdvice(c.msg),
    c => ({ reply: say('advice', c.l), redirected: true, refused: 'advice' })));

  const fallback = c => say('fallback', c.l, t.home);
  return {
    name: 'gov-' + t.id,
    soul: soulFor(t),
    // The office's own limit (gov/tenants.json maxTokens): 700 cut long Amharic answers mid-word (2026-09-18).
    maxTokens: Number.isInteger(t.maxTokens) && t.maxTokens > 0 ? t.maxTokens : 700,
    names: [t.assistantName.am, t.assistantName.en, t.assistantName.om].filter(Boolean),
    knowledge: { prefer: t.prefer.slice(), exclude: office.exclude.slice() },
    gates,
    inScope: () => true,          // off-subject questions are handled by the prompt, and measured by the gold set
    redirect: fallback,
    filters: [
      text => { const m = F.stripMobiles(text); return { text: m.text, removed: m.removed, what: 'sentence(s) carrying a mobile number' }; },
      text => { const v = asmat.stripVerdict(text); return { text: v.text, removed: v.removed, what: 'verdict sentence(s)' }; },
    ],
    finish(c, text) { if (!String(text || '').trim()) { c.govEmpty = true; return fallback(c); } return text; },
    body: c => (c.govEmpty ? { answered: false } : {}),
    fallback,
    limited: c => say('limited', c.l),
    log: false,
    sourceDetail: true,
    sourceMax: 3,
    okFlags: { answered: true },
  };
}

module.exports = { makeOfficeAgent, soulFor, dangerReply, TEXT };
