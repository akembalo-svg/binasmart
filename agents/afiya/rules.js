'use strict';
// Dr Afiya (ዶ/ር አፍያ) as an agent definition. The deterministic parts stay in assistant/afiya.js, where the
// tests and the evaluation read them; this file says in what order they apply. The engine
// (assistant/kit/engine.js) runs it.
const afiya = require('../../assistant/afiya');
const asmat = require('../../assistant/asmat');
const scope = require('../../assistant/scope');

module.exports = {
  name: 'afiya',
  soul: afiya.SYSTEM,
  maxTokens: 700,

  gates: [
    // An emergency: fixed answer, no model, and a human is told straight away.
    { test: c => afiya.isEmergency(c.msg),
      answer: c => ({ body: { reply: afiya.emergencyReply(c.l), emergency: true, ambulance: afiya.AMBULANCE },
        log: ['emergency'], handover: 'Dr Afiya: possible emergency' }) },
    // An urgent legal situation typed at the health desk still gets the legal answer.
    { test: c => asmat.isUrgent(c.msg),
      answer: c => ({ body: { reply: asmat.urgentReply(c.l), urgent: true } }) },
  ],

  // A clinical question is a health question by definition: decline it inside, never exile it.
  inScope: c => afiya.isClinical(c.msg) || scope.inScope(c.msg, 'health'),
  redirect: c => scope.redirect(c.msg, 'health', c.l),

  // The one hospital in the system is demo data; she must never present it as a real place to attend.
  async context(c, { prisma }) {
    if (!prisma) console.warn('[afiya] engine built without prisma: departments and the demo notice are off');
    let depts = '', demoRows = null;
    try {
      const rows = demoRows = await prisma.department.findMany({ where: { active: true },
        select: { name: true, nameAm: true, nameOm: true, floor: true, room: true, fee: true, openHours: true }, take: 20 });
      // The Amharic stays in brackets for an Oromo speaker: the sign above the door is in Amharic.
      const deptLabel = d => c.l === 'om' && d.nameOm ? `${d.nameOm} (${d.name}${d.nameAm ? ' · ' + d.nameAm : ''})`
        : (c.l === 'am' || c.l === 'am-latin') && d.nameAm ? `${d.nameAm} (${d.name})`
        : `${d.name}${d.nameAm ? ' (' + d.nameAm + ')' : ''}`;
      if (rows.length) depts = '\n\n## Departments in the BinaSmart demo hospital (DEMO DATA — say so; it is not a real place to attend)\n'
        + rows.map(d => `- ${deptLabel(d)} · floor ${d.floor} room ${d.room}`
          + (d.fee ? ` · fee ${d.fee} ETB` : '') + (d.openHours ? ` · ${JSON.stringify(d.openHours).slice(0, 60)}` : '')).join('\n');
    } catch (e) { /* no departments, she simply has less to offer */ }
    return {
      prompt: depts + `\n\nEmergency numbers, if they are ever needed: ambulance ${afiya.AMBULANCE}, police ${afiya.POLICE}, fire ${afiya.FIRE}.`,
      grounding: depts,
      state: { demoRows },
    };
  },

  instruct: c => afiya.isClinical(c.msg)
    ? '\n\nTHIS MESSAGE ASKS YOU TO DIAGNOSE, PRESCRIBE OR REASSURE. Decline in one warm sentence, then be immediately useful: which department, what to bring, how soon. Do not name an illness, a medicine or a dose.'
    : '',

  filters: [
    text => { const d = afiya.stripDosage(text); return { text: d.text, removed: d.removed, what: 'dosage sentence(s)' }; },
  ],

  finish(c, text, { demoRows }) {
    if (!text) text = afiya.clinicalNudge(c.l).trim();
    if (afiya.isClinical(c.msg) && !/ክፍል|department|kutaa/i.test(text)) text += afiya.clinicalNudge(c.l);
    // Measured: the model disclosed the demo hospital in only 2 of 4 replies. Enforced here instead.
    if (demoRows && demoRows.length && !/demo|fakkeenya|ማሳያ|ሙከራ/i.test(text)
        && demoRows.some(d => [d.name, d.nameAm, d.nameOm, d.room].filter(Boolean).some(n => text.includes(n))))
      text += afiya.demoNotice(c.l);
    return text + '\n\n' + afiya.disclosure(c.l);
  },

  fallback: c => afiya.disclosure(c.l) + '\n' + (c.l === 'am'
    ? 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። አስቸኳይ ከሆነ ' + afiya.AMBULANCE + ' ይደውሉ።'
    : 'Sorry, I could not answer just now. If this is urgent, call ' + afiya.AMBULANCE + '.'),

  // Too many questions in a short time (assistant/kit/limit.js). Emergencies never reach this.
  limited: c => c.l === 'am'
    ? 'በአጭር ጊዜ ብዙ ጥያቄዎች ደርሰውኛል። እባክዎ ትንሽ ቆይተው እንደገና ይጠይቁ። አስቸኳይ ከሆነ አሁኑኑ ' + afiya.AMBULANCE + ' ይደውሉ።'
    : 'You have asked many questions in a short time. Please wait a little and ask again. If this is urgent, call ' + afiya.AMBULANCE + ' now.',

  okFlags: { emergency: false },
};
