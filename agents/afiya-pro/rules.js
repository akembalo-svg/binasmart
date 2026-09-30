'use strict';
// Dr Afiya for health PROFESSIONALS (30 Sep 2026): the assistant inside bina.et/health/dashboard. Same engine and the same
// hard lines as the public Afiya (assistant/afiya.js), a different job: profile text, services, hours, patient-message
// drafts and facility standards from the health library. Ibrahim's rule: never diagnosis or doses, even for doctors.
// Reached only through POST /api/health/assist, which checks the account owns a checked profile (health/dashboard.js)
// and puts that profile in options.scope. The request body never sets the scope.
const afiya = require('../../assistant/afiya');
const asmat = require('../../assistant/asmat');
const { loadSoul } = require('../../assistant/kit/soul');

// A profile that sells with a promise is the harm here, so these sentences go whatever the prompt said.
const HYPE = /\b(guarantee[ds]?|100\s*%|painless|pain-free|best (doctor|dentist|clinic|hospital|lab|in addis|in ethiopia)|number one|no\.?\s*1\b|miracle|cures?\b|cured\b)/i;
// Both filters work LINE BY LINE: a reply here has a shape the dashboard reads ("English:" / "አማርኛ:" blocks, "- " lists),
// and splitting on sentences across newlines flattened it (measured on the first live run, 30 Sep 2026).
function perLine(text, drop) {
  let removed = 0;
  const out = String(text || '').split('\n').map(line => {
    const parts = line.split(/(?<=[.!?።])\s+/), kept = parts.filter(p => !drop(p));
    removed += parts.length - kept.length; return kept.join(' ');
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, removed };
}
const stripHype = text => perLine(text, p => HYPE.test(p));
const stripDose = text => perLine(text, p => afiya.DOSAGE.test(p));

// A patient's emergency pasted in for a reply: the professional is the human in the loop, so no page to our team,
// and nothing about the patient is written to the chat log.
function proEmergency(l) {
  if (l === 'am') return '🚨 ይህ መልእክት ድንገተኛ ሁኔታን ይገልጻል። ለታካሚው አሁኑኑ ይንገሩ፦ **907** (አምቡላንስ) ይደውሉ ወይም በአቅራቢያ ወዳለ የድንገተኛ ክፍል ይሂዱ። ቀጠሮ አይጠብቁ።\n\nለታካሚው መላክ የሚችሉት፦ "የገለጹት ሁኔታ አስቸኳይ ነው። እባክዎ አሁኑኑ 907 ይደውሉ ወይም በአቅራቢያዎ ወዳለ የድንገተኛ ክፍል ይሂዱ።"';
  return '🚨 This message describes an emergency. Tell the patient now: call **907** (ambulance) or go to the nearest emergency department. Do not wait for an appointment.\n\nA reply you can send: "What you describe is urgent. Please call 907 now or go to the nearest emergency department."';
}

const TASKS = {
  about: '\n\nTASK: write the "About" text for their public BinaSmart Health page from the profile block. At most 90 words, warm and plain, first person for a doctor ("I…") and "we" for a facility. Write it in English, then the same text in Amharic, in exactly this shape:\nEnglish:\n<text>\n\nአማርኛ:\n<text>\nThis task overrides the LANGUAGE line above. Use [add: …] for any missing fact; never invent one.',
  services: '\n\nTASK: suggest up to 12 services this professional or facility could list, named the way a patient would search for them. One per line, each line starting with "- ", the plain English name only (for example "- Tooth extraction"); a wrong Amharic medical term on a public page is worse than none, so the professional adds Amharic names themselves. Skip services already listed in the profile. No descriptions, no prices, no other text.',
  reply: '\n\nTASK: the message is from a PATIENT (pasted by the professional). Draft the professional\'s reply: short, polite, in the patient\'s language. Use only the hours, fee and location in the profile block; otherwise use [add: …]. No diagnosis, no medicine, no dose; if symptoms are described, invite them to come in, and say that anything urgent means calling 907. Leave out any name or phone number.',
  standards: '\n\nTASK: answer from the health-standards documents in the knowledge block only, and name the document. If they do not cover it, say so and name who to ask.',
};

module.exports = {
  name: 'afiya-pro',
  soul: loadSoul('afiya-pro'),
  maxTokens: 900,
  log: false,
  // No `names`: the engine would then drop a first sentence like "I am Dr Selam…" as a repeated self-introduction, and
  // here that sentence is the doctor's own About text, written in their voice (measured 30 Sep 2026).
  knowledge: {
    prefer: ['health', 'web:moh/*', 'eservices:ethiopian-food-and-drug-authority', 'law:labour-proclamation-1156-2019'],
    exclude: ['page', 'skill', 'llms', 'mor', 'travel', 'banking', 'business', 'telecom', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia',
      'guide:mesob', 'guide:telebirr', 'guide:tenant-screening-ethiopia'],
  },
  gates: [
    { test: c => afiya.isEmergency(c.msg), answer: c => ({ body: { reply: proEmergency(c.l), emergency: true, ambulance: afiya.AMBULANCE } }) },
    { test: c => asmat.isUrgent(c.msg), answer: c => ({ body: { reply: asmat.urgentReply(c.l), urgent: true } }) },
  ],
  // The route admits only the owner of a checked profile and limits the calls; the soul keeps her to practice work.
  inScope: () => true,
  redirect: () => '',

  async context(c) {
    const p = (c.scope && c.scope.profile) || {};
    const line = (k, v) => v && (!Array.isArray(v) || v.length) ? '\n- ' + k + ': ' + (Array.isArray(v) ? v.join(', ') : v) : '';
    const block = '\n\n## The profile you are helping with (their own, checked by BinaSmart; use these facts and invent no others)'
      + line('Kind', p.kind) + line('Name', p.name) + line('Profession', p.profession) + line('Specialty', p.specialty)
      + line('Works at', p.facility) + line('Sub-city', p.area) + line('Services listed now', p.services) + line('Languages', p.languages)
      + line('Hours', p.hours) + line('Consultation fee', p.fee) + line('Current About text', p.about);
    return { prompt: block + '\n\nEmergency number: ambulance ' + afiya.AMBULANCE + '.', grounding: block, state: {} };
  },

  instruct: c => (TASKS[c.scope && c.scope.task] || '') + (afiya.isClinical(c.msg)
    ? '\n\nPART OF THIS MESSAGE ASKS FOR A CLINICAL DECISION (a diagnosis, a medicine, a dose, a result). You do not make those, even for a licensed professional: say so in one sentence (they belong to the clinician and the national treatment guidelines), then do the practice part of the request. Writing about a service they offer is NOT a clinical decision.'
    : ''),

  filters: [
    text => { const d = stripDose(text); return { text: d.text, removed: d.removed, what: 'dosage sentence(s)' }; },
    text => { const d = stripHype(text); return { text: d.text, removed: d.removed, what: 'promise sentence(s)' }; },
  ],

  finish(c, text) {
    if (!text) return module.exports.fallback(c);
    if (afiya.isClinical(c.msg) && !/clinical|clinician|guideline|ክሊኒካል|ሕክምና ውሳኔ|ህክምና ውሳኔ|መመሪያ/i.test(text))
      text += c.l === 'am' ? '\n\nየሕክምና ውሳኔ የእርስዎና የብሔራዊ የሕክምና መመሪያዎች ነው፤ እኔ የሥራውን አስተዳደራዊ ጎን ብቻ እረዳለሁ።'
        : '\n\nClinical decisions stay with you and the national treatment guidelines; I help with the practice side.';
    return text;
  },
  fallback: c => c.l === 'am' ? 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ ከትንሽ ጊዜ በኋላ እንደገና ይሞክሩ።' : 'Sorry, I could not answer just now. Please try again in a minute.',
  limited: c => c.l === 'am' ? 'የዛሬው የአፍያ እገዛ ገደብ ደርሷል። ነገ እንደገና ይሞክሩ።' : 'You have used today\'s Afiya help for this dashboard. It resets tomorrow.',
  okFlags: {},
};
module.exports.stripHype = stripHype;
module.exports.proEmergency = proEmergency;
module.exports.TASKS = TASKS;
