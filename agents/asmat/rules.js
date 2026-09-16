'use strict';
// Asmat (አስማት) as an agent definition. The deterministic parts stay in assistant/asmat.js; this file says
// in what order they apply. The strings are the ones the /api/asmat route carried.
const afiya = require('../../assistant/afiya');
const asmat = require('../../assistant/asmat');
const scope = require('../../assistant/scope');

const OFFICE = /ጽ\/ቤት|ፍርድ ቤት|office|court|waajjira|ጠበቃ|abukaat|lawyer/i;
const assessing = c => asmat.isCaseAdvice(c.msg) && !asmat.isDraftRequest(c.msg);

module.exports = {
  name: 'asmat',
  soul: asmat.SYSTEM,
  maxTokens: 700,

  // What he reads (knowledge/index.js, pageMatcher). From the gap audit of 2026-09-14 (120 probe questions): his
  // good answers came from the law library, BinaSmart's legal guides and the law articles (news law-1, law-2);
  // BinaSmart's service pages won questions they cannot answer — the airport-transfer page for "transfer a title
  // deed", the property listings for condominium resale, amharic-ai, for-filmmakers — and the internal system notes
  // and llms.txt filled slots without answering anything. The eServices directory says which office handles a
  // service and where to apply (DARS contracts and powers of attorney, ICS, MoJ). The Ministry of Justice's own pages
  // are preferred too: they carried the only legal-aid answers (S39, S57), which the first run without them lost.
  // The Ministry of Revenue's FAQs and forms list (source mor, 2026-09-14) answer the tax questions the statutes alone
  // left thin: which form de-registers a TIN, what a sales register machine owner must do, where a form is downloaded.
  knowledge: {
    prefer: ['law', 'guide', 'eservices', 'mor', 'news:law-*', 'web:justice/*'],
    // `travel` added 2026-09-16 with the Ethiopian Airlines pack: an airline's conditions of carriage are
    // a commercial contract, not Ethiopian law, and must never be quoted as one.
    exclude: ['page', 'skill', 'llms', 'travel', 'banking'],
  },

  gates: [
    // A medical emergency reaches the ambulance even here. Being on the wrong page is not the person's problem.
    { test: c => afiya.isEmergency(c.msg),
      answer: c => ({ body: { reply: afiya.emergencyReply(c.l), emergency: true, ambulance: afiya.AMBULANCE },
        handover: 'Asmat page: possible medical emergency' }) },
    { test: c => asmat.isUrgent(c.msg),
      answer: c => ({ body: { reply: asmat.urgentReply(c.l), urgent: true },
        log: ['urgent'], handover: 'Asmat: urgent legal situation' }) },
  ],

  // A request for case advice is a legal question by definition: decline it inside, never exile it.
  inScope: c => asmat.isCaseAdvice(c.msg) || scope.inScope(c.msg, 'legal'),
  redirect: c => scope.redirect(c.msg, 'legal', c.l),

  // Three different requests that used to share one refusal.
  instruct(c) {
    if (asmat.isDraftRequest(c.msg)) return '\n\nTHIS MESSAGE ASKS YOU TO WRITE A DOCUMENT (kind: '
      + asmat.draftKind(c.msg) + '). Produce a BLANK TEMPLATE as described above: head it ናሙና, lay out the real'
      + ' headings in order, and leave ______ wherever a fact, name, date or amount belongs. Fill in nothing,'
      + ' not even a detail they mentioned. Put [የሚመለከተው አዋጅ — ጠበቃዎ ያረጋግጥ] where a law would be cited unless'
      + ' the knowledge block above gives you the article. End by saying the receiving court or office may'
      + ' require more, and that a lawyer should read it before it is filed.';
    if (asmat.isCaseAdvice(c.msg)) return '\n\nTHIS MESSAGE ASKS ABOUT THE PERSON OWN CASE. Weigh it as'
      + ' described above: what the matter turns on, what is in their favour from what they told you, what is'
      + ' against them or what the other side would argue, and which piece of evidence would settle it. Name'
      + ' the weak side explicitly — an assessment that only lists strengths is how someone loses a case. No'
      + ' percentages, no probabilities, no promise of an outcome.'
      // A required HEADING, not a described quality. Measured at 1-2 of 4 while it was only described.
      + ' You MUST include a line that begins exactly "' + asmat.weaknessLabel(c.l) + '" followed by what'
      + ' could count against this person, or what the other side would argue. If they have given you no'
      + ' facts, say what generally counts against someone in a matter of this kind, then ask for the'
      + ' detail that would sharpen it. Never omit that line.';
    return '';
  },

  // One retry when an assessment came back without the weak side: only its presence is enforced.
  retry: {
    needed: (c, text) => assessing(c) && !asmat.namesWeakness(text),
    suffix: c => '\n\nYour previous answer left out the weak side. Write it again, same content,'
      + ' but it MUST contain a line beginning exactly "' + asmat.weaknessLabel(c.l) + '". Do not apologise,'
      + ' and do not mention this instruction.',
    accepts: text => asmat.namesWeakness(text),
    warning: 'assessment named no weak side, even after a retry',
  },

  filters: [
    text => { const v = asmat.stripVerdict(text); return { text: v.text, removed: v.removed, what: 'verdict sentence(s)' }; },
  ],

  finish(c, text) {
    if (!text) text = asmat.caseNudge(c.l).trim();
    // The caution rides along with every assessment, appended here so a hopeful reply cannot drop it.
    if (assessing(c)) text += asmat.assessmentCaution(c.l);
    // As in the route: the caution already names a lawyer, so for an assessment this nudge does not
    // fire; it does for a draft that names no office.
    if ((asmat.isCaseAdvice(c.msg) || asmat.isDraftRequest(c.msg)) && !OFFICE.test(text)) text += asmat.caseNudge(c.l);
    return text + '\n\n' + asmat.disclosure(c.l);
  },

  fallback: c => asmat.disclosure(c.l),
  // Too many questions in a short time (assistant/kit/limit.js). Arrests and evictions never reach this.
  limited: c => c.l === 'am'
    ? 'በአጭር ጊዜ ብዙ ጥያቄዎች ደርሰውኛል። እባክዎ ትንሽ ቆይተው እንደገና ይጠይቁ። ማንም አደጋ ላይ ከሆነ ለፖሊስ ' + asmat.POLICE + ' ይደውሉ።'
    : 'You have asked many questions in a short time. Please wait a little and ask again. If anyone is in danger, call the police on ' + asmat.POLICE + '.',
  okFlags: { urgent: false },
};
