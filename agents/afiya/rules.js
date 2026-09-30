'use strict';
// Dr Afiya (ዶ/ር አፍያ) as an agent definition. The deterministic parts stay in assistant/afiya.js, where the
// tests and the evaluation read them; this file says in what order they apply. The engine
// (assistant/kit/engine.js) runs it.
const afiya = require('../../assistant/afiya');
const asmat = require('../../assistant/asmat');
const scope = require('../../assistant/scope');
const { isHealthSearch } = require('../../assistant/force');
const healthArgs = require('../../assistant/health-args');

// A question about WHERE to be seen is answered from bina.et/health (the same search as Bini's search_health), never
// from the demo departments: "which hospital near Piassa for my child with a fever" got "I cannot name a specific
// hospital" (30 Sep 2026). "Dr Afiya, where is…" is still a place question on her own page.
const askingForPlace = msg => isHealthSearch(String(msg || '').replace(/dr\.?\s*afiya|doctor afiya|afiya|ዶ\/ር\s*አፍያ|ዶክተር\s*አፍያ|አፍያ/gi, ' '));
// A question about where to be seen or which department, when it names no kind of place (30 Sep 2026 replay of the
// real questions: child fever x2, a child's vaccination).
const GO_WHERE_RE = /department|which (hospital|clinic|ward)|where (should|can|do) (i|we) (go|take)|vaccin|immuni[sz]|ክፍል|የት|ማስከተብ|ክትባት/i;
const placeLine = p => '- ' + p.name + (p.nameAm ? ' (' + p.nameAm + ')' : '') + ' · ' + p.kind + (p.area ? ' · ' + p.area : '')
  + (p.km != null ? ' · ' + p.km + ' km' : '') + (p.phone ? ' · phone ' + p.phone : '') + ' · ' + p.url;

module.exports = {
  name: 'afiya',
  soul: afiya.SYSTEM,
  maxTokens: 700,
  // Display names, so the engine can remove a self-introduction the model repeats on a later reply.
  names: ['ዶ/ር አፍያ', 'ዶክተር አፍያ', 'Dr Afiya', 'Doctor Afiya', 'Afiya', 'አፍያ'],

  // What she reads (knowledge/index.js, pageMatcher). From the gap audit of 2026-09-14 (120 probe questions):
  // with the whole index and the own-source boost, the etrade BUSINESS licence checker answered "is this clinic /
  // doctor licensed?" (a patient sent to the wrong register), the Mesob guide's "where is it" section answered
  // Amharic "where can I get…" questions, and the amharic-ai and insurance marketing pages took slots from the
  // health documents. None of the excluded pages produced a single good answer for her in that audit.
  // Preferred: the health library and the MoH site (most of her good answers), the labour law (sick and maternity
  // leave), the Addis notes (emergency numbers) and the one health regulator in the eServices directory.
  knowledge: {
    prefer: ['health', 'web:moh/*', 'law:labour-proclamation-1156-2019', 'addis', 'eservices:ethiopian-food-and-drug-authority'],
    // `travel` added 2026-09-16 with the Ethiopian Airlines pack: baggage rules and lounge access are not
    // health answers, and a page about travelling while pregnant belongs to the airline, not to a clinician.
    // `business` added 2026-09-17 with the trade, labour and pension pack, and it is measured rather than
    // assumed: the gap audit of 2026-09-14 found the etrade BUSINESS licence checker answering "is this clinic
    // / doctor licensed?" - a patient sent to the wrong register - which is why the two bina.et business
    // guides below were already excluded. The whole pack now follows them out.
    // `telecom` added 2026-09-22 with the telecom pack: package prices, SIM rules and the communications-authority
    // directives are not health answers, and a patient asking about a clinic must never be handed an operator's page.
    exclude: ['page', 'skill', 'llms', 'mor', 'travel', 'banking', 'business', 'telecom', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia',
      'guide:mesob', 'guide:telebirr', 'guide:tenant-screening-ethiopia'],
  },

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
    // A place question: the directory, and not the demo hospital's departments beside it.
    if (askingForPlace(c.msg)) {
      const found = await module.exports.findPlaces(c.msg).catch(() => null);
      if (found && ((found.results || []).length || (found.nearest || []).length)) {
        c._places = found;
        const block = '\n\n## Places from BinaSmart Health for this question (bina.et/health: the city map plus what facilities confirmed; opening hours unknown unless given)'
          + (found.near ? '\nNear: ' + found.near + ' (distances from there)' : '') + '\n' + (found.results || []).slice(0, 6).map(placeLine).join('\n')
          + ((found.nearest || []).length ? '\nThe closest places of the same kind (they have not listed that specialty):\n' + found.nearest.map(placeLine).join('\n') : '')
          + '\nFull list: ' + found.more;
        return { prompt: block + `\n\nEmergency numbers, if they are ever needed: ambulance ${afiya.AMBULANCE}, police ${afiya.POLICE}, fire ${afiya.FIRE}.`,
          grounding: block, state: { demoRows: null, places: found } };
      }
    }
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

  instruct: c => (c._places
    ? '\n\nTHIS PERSON ASKS WHERE TO GO. Answer from the "Places from BinaSmart Health" block: name 2 to 5 places (nearest first when distances are given), each with its phone when given and its bina.et/health url right after the name. Say plainly that opening hours are not known unless given, so they should call before going. Do not describe what an illness might be or how it is treated. If it could be urgent, say: call 907.'
    : '') + (afiya.isClinical(c.msg)
    ? '\n\nTHIS MESSAGE ASKS YOU TO DIAGNOSE, PRESCRIBE OR REASSURE. Decline in one warm sentence, then be immediately useful: which department, what to bring, how soon. Do not name an illness, a medicine or a dose.'
    : ''),

  filters: [
    text => { const d = afiya.stripDosage(text); return { text: d.text, removed: d.removed, what: 'dosage sentence(s)' }; },
  ],

  finish(c, text, { demoRows, places }) {
    if (!text) text = afiya.clinicalNudge(c.l).trim();
    // Every place she NAMED keeps its page, and the directory closes a place answer (the same rule as Bini's).
    if (places) {
      const low = text.toLowerCase(), seen = new Set(), miss = [];
      for (const p of [].concat(places.results || [], places.nearest || [])) {
        if (!p || !p.url || seen.has(p.url)) continue; seen.add(p.url);
        if ((low.includes(String(p.name).toLowerCase()) || (p.nameAm && text.includes(p.nameAm))) && !text.includes(p.url.replace(/^https:\/\//, ''))) miss.push(p);
      }
      if (miss.length) text += '\n\n' + miss.slice(0, 6).map(p => '🏥 ' + p.name + ': ' + p.url).join('\n');
      if (!/bina\.et\/health/.test(text)) text += (c.l === 'am' ? '\n\n🏥 ሁሉም ሆስፒታሎች፣ ክሊኒኮችና የጥርስ ክሊኒኮች፦ ' : c.l === 'om' ? '\n\n🏥 Hospitaalota, kilinikoota fi ilkaan hundaa: ' : '\n\n🏥 All hospitals, clinics and dentists: ') + 'https://bina.et/health';
    }
    if (afiya.isClinical(c.msg) && !/ክፍል|department|kutaa/i.test(text)) text += afiya.clinicalNudge(c.l);
    // Measured: the model disclosed the demo hospital in only 2 of 4 replies. Enforced here instead.
    // Department questions still get the broad rule (measured: the model disclosed the demo in only 2 of 4 replies). A
    // place answer has demoRows null: it never saw the demo departments, so "Dental clinic" is never stamped demo again.
    if (demoRows && demoRows.length && !/demo|fakkeenya|ማሳያ|ሙከራ/i.test(text)
        && demoRows.some(d => [d.name, d.nameAm, d.nameOm, d.room].filter(Boolean).some(n => text.includes(n))))
      text += afiya.demoNotice(c.l);
    // A department question that names what the person needs also gets the real places for it. 30 Sep 2026, a real
    // person: "Which department should I go to for a dental check-up?" heard only about the demo hospital's room 2-06,
    // while bina.et/health lists 30 dental clinics.
    if (!places && !/bina\.et\/health/.test(text)) {
      const a = healthArgs.healthArgsFromText(c.msg), K = a.kind ? require('../../health/directory').KINDS[a.kind] : null;
      const label = K ? K[1].toLowerCase() : a.q ? String(a.q) : '';
      if (label) {
        const url = 'https://bina.et/health?q=' + encodeURIComponent(label);
        text += '\n\n' + (K ? K[0] : '🏥') + ' ' + (c.l === 'am' ? 'በአዲስ አበባ ያሉ እውነተኛ ' + (K ? K[2] : label) + ' ቦታዎች፦ '
          : c.l === 'om' ? 'Iddoowwan dhugaa Finfinnee keessatti (' + label + '): '
          : 'Real ' + (K ? label + 's' : 'places for "' + label + '"') + ' in Addis Ababa: ') + url;
      } else if (GO_WHERE_RE.test(String(c.msg || ''))) {
        // No kind named ("which department treats a child with fever?", "ልጄን የት ማስከተብ እችላለሁ?"): any hospital or
        // clinic will do, so the whole directory, the same line a place answer closes with.
        text += (c.l === 'am' ? '\n\n🏥 ሁሉም ሆስፒታሎች፣ ክሊኒኮችና የጥርስ ክሊኒኮች፦ ' : c.l === 'om' ? '\n\n🏥 Hospitaalota, kilinikoota fi ilkaan hundaa: ' : '\n\n🏥 All hospitals, clinics and dentists: ') + 'https://bina.et/health';
      }
    }
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
module.exports.findPlaces = msg => healthArgs.findHealthPlaces(msg);
module.exports.askingForPlace = askingForPlace;
