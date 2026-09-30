// Jev as a VETO on newly harvested vacancies, before they are published (owner's request, 27 Sep 2026).
//
// Same shape as the tender autopublisher's Jev check (bina_tender_autopublish.py, jev_kind):
//   · a VETO only - Jev can HOLD an advert for a person to look at, it can never publish one;
//   · it holds only when it is sure: a scam-type verdict at >= 0.85 confidence. On the 810-advert audit of
//     26 Sep 2026 (ops/jev-audit-scams.js) nothing on the live board reached 0.85, and the random control
//     flagged 1 of 150 at any confidence - so a hold is rare and worth reading;
//   · it FAILS OPEN - an unreachable or rate-limited Jev must not stop real vacancies;
//   · only adverts with a risk word are asked (about 1 in 5), so the daily harvest stays fast.
// Harvested adverts only. Employer submissions (jobs/submit.js) are NOT sent: they are not public yet and
// can carry the submitter's own details, and BinaSmart user data does not leave the VPS. A person already
// approves every one of them.
// Sent to Jev: the public advert text with phone numbers, e-mail names and Telegram handles masked.
// A held advert is created with published:false, listed in /root/storage/jev/jobs-held.json and reported to
// the owner on Telegram; ops/jobs-held.js publishes or rejects it.
const fs = require('fs');

const API = process.env.JEV_API_URL, MODEL = process.env.JEV_MODEL, KEY = process.env.JEV_API_KEY;
const HOLD_AT = 0.85;
const HOLD_VERDICTS = new Set(['asks_applicant_money', 'abroad_recruitment', 'other_red_flags']);
const HELD_FILE = process.env.BINA_JOBS_HELD || '/root/storage/jev/jobs-held.json';
const RISK = /\b(fee|fees|deposit|registration fee|pay (for|a)|payment|processing|training cost|uniform cost)\b|ክፍያ|ብር ይከፈላል|ያስይዙ|ማስያዣ|ምዝገባ|dubai|saudi|qatar|kuwait|abroad|overseas|ዱባይ|ሳዑዲ|ውጭ ሀገር|whatsapp|telegram|work from home|earn \$|per day/i;
const VERDICT_EN = { asks_applicant_money: 'asks applicants for money', abroad_recruitment: 'recruits for work abroad', other_red_flags: 'other scam signs' };

const QUESTIONS = {
  scam: { type: 'choice',
    instructions: 'This is a job advert published on an Ethiopian job board. Read it as a careful job seeker would. Which describes it best?',
    criteria: {
      normal_job: 'An ordinary vacancy: a named employer hiring for a post; applicants send a CV or documents or apply in person. Words like payment, fee or deposit refer to the work itself (an accountant who processes payments, a cashier who handles deposits) or to what the employer pays.',
      asks_applicant_money: 'The job seeker must pay something: an application, registration, form, exam, training, uniform, medical, visa, ticket or placement fee, or a deposit or guarantee, before or in order to get the job.',
      abroad_recruitment: 'Offers work in another country (for example the Gulf, the Middle East or Europe) or recruits people to travel for work, through an agent, broker or recruitment office.',
      other_red_flags: 'No real employer and other scam signs: pay far above normal for easy work, earn per day from home, commission-only selling to your own contacts, contact only through a private phone, Telegram or WhatsApp, urgency and no job details.' } },
};

const mask = s => String(s || '')
  .replace(/[\w.+-]+@([\w-]+\.[\w.-]+)/g, '[email at $1]')
  .replace(/(?:\+?251|\b0)[\s-]?[1-9](?:[\s-]?\d){7,8}\b/g, '[phone number]')
  .replace(/(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?(?:[\s-]?\d{2,4}){2,4}/g, m => m.replace(/\D/g, '').length >= 9 ? '[phone number]' : m)
  .replace(/(^|\s)@[A-Za-z0-9_]{4,}/g, '$1[telegram handle]');
const text = h => String(h || '').replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function stateOf(j) {
  return [
    'Job title: ' + j.title, 'Employer: ' + (j.employer || 'not given'), j.city && 'City: ' + j.city,
    j.salary && 'Salary: ' + mask(j.salary), j.howToApply && 'How to apply: ' + mask(text(j.howToApply)).slice(0, 400),
    'Advert text:\n' + mask(text(j.bodyHtml) || j.summary).slice(0, 1400),
  ].filter(Boolean).join('\n');
}

// A 401/403 is not a busy moment, it is the account: a key that no longer works, or the Vercel team dropping
// to the free tier (27 Sep 2026: "Free tier users do not have access to this model"). Retrying that on every
// advert would only slow the harvest, so the first one switches the gate off for this run and tells the owner
// once. Everything still publishes - the gate fails open.
let accountDown = null;

// Returns { hold, verdict, conf } - never throws. hold is true only on a sure scam-type verdict.
async function check(j) {
  if (process.env.JEV_GATE === 'off' || !API || !KEY) return { hold: false, skipped: 'off' };
  if (accountDown) return { hold: false, error: accountDown };
  if (!RISK.test([j.title, j.summary, j.salary, j.howToApply, text(j.bodyHtml)].join(' '))) return { hold: false, skipped: 'no risk word' };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API, { method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state: stateOf(j), questions: QUESTIONS }) });
      const d = await r.json().catch(() => null);
      if (r.status === 401 || r.status === 403) {
        accountDown = 'jev account refused (HTTP ' + r.status + '): ' + String(((d || {}).error || {}).message || '').slice(0, 90);
        await tellOwner('⚠️ Jev job check is OFF for this harvest - Vercel refused the key (HTTP ' + r.status + ').\n'
          + String(((d || {}).error || {}).message || '').slice(0, 160) + '\n\nJob ads still publish as normal. Fix it in Vercel (AI Gateway billing / API key).');
        return { hold: false, error: accountDown };
      }
      if (r.status === 200 && d && d.answers) {
        const a = d.answers.scam || {};
        // Hold on how sure Jev is that it is NOT a normal job - not on the top choice alone. A real scam is often
        // several kinds at once (a Dubai job with a registration fee): Jev then splits its certainty between
        // "asks for money", "abroad" and "red flags", none reaches 0.85, and the top-choice rule let it through.
        // Gate test 27 Sep 2026: that advert scored normal_job 0.00 but top choice only 0.52.
        const pr = a.probabilities || {};
        const pScam = typeof pr.normal_job === 'number' ? 1 - pr.normal_job : (HOLD_VERDICTS.has(a.choice) ? (a.confidence || 0) : 1 - (a.confidence || 0));
        const verdict = HOLD_VERDICTS.has(a.choice) ? a.choice
          : [...HOLD_VERDICTS].sort((x, y) => (pr[y] || 0) - (pr[x] || 0))[0];
        return { hold: pScam >= HOLD_AT, verdict, conf: +pScam.toFixed(3), top: a.choice, topConf: a.confidence || 0 };
      }
    } catch (e) { /* timeout or network - retry, then fail open */ }
    await new Promise(res => setTimeout(res, 3000 * (i + 1)));
  }
  return { hold: false, error: 'jev unavailable' };   // fail OPEN on purpose
}

async function tellOwner(msg) {
  try {
    const env = fs.readFileSync('/root/.config/gcc-monitor.env', 'utf8');
    const tok = (env.match(/^TG_TOKEN=(\S+)/m) || [])[1], chat = (env.match(/^TG_CHAT=(\S+)/m) || [])[1];
    if (!tok || !chat) return false;
    const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: msg, disable_web_page_preview: true }) });
    return !!(await r.json().catch(() => ({}))).ok;
  } catch (e) { return false; }
}

async function recordHeld(job, j, gate, log = console.log) {
  let list = []; try { list = JSON.parse(fs.readFileSync(HELD_FILE, 'utf8')); } catch (e) { /* first one */ }
  list.push({ slug: job.slug, id: job.id, title: job.title, employer: j.employer, source: j.sourceName, sourceUrl: j.sourceUrl,
    verdict: gate.verdict, conf: gate.conf, heldAt: new Date().toISOString(), status: 'held' });
  fs.writeFileSync(HELD_FILE, JSON.stringify(list, null, 1));
  const sent = await tellOwner('⏸️ Job ad HELD by Jev - not published\n\n' + job.title + ' - ' + (j.employer || '?') + '\nJev: '
    + Math.round(gate.conf * 100) + '% sure this is not a normal job (mostly: ' + (VERDICT_EN[gate.verdict] || gate.verdict) + ')\nSource: ' + (j.sourceName || '?') + ' ' + (j.sourceUrl || '')
    + '\n\nReply "publish ' + job.slug + '" or "reject ' + job.slug + '".');
  log('  HELD by Jev (' + gate.verdict + ' ' + gate.conf.toFixed(2) + '): ' + job.title + (sent ? '' : ' - Telegram notice FAILED'));
}

module.exports = { check, recordHeld, stateOf, RISK, HOLD_AT };
