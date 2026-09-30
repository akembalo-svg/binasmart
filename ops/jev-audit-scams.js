// Jev second opinion on open vacancies: does the advert show signs of a job scam? READ-ONLY - it reports,
// it never unpublishes, edits or messages anyone.
//
//   node --env-file=.env ops/jev-audit-scams.js --n 20    first 20 of the set, to see the answers
//   node --env-file=.env ops/jev-audit-scams.js           the full set
// Report: /root/storage/jev/bina-jobs-scam-audit.json (+ summary on stdout).
//
// The set: every open vacancy with a risk word (fee, ክፍያ, deposit, Dubai, WhatsApp, abroad...), every advert
// an employer posted on bina.et directly, and a random 150 of the rest as a CONTROL - how often Jev raises a
// false alarm on ordinary adverts is what tells us how far to trust the flags.
// Sent to Jev: the public advert text with phone numbers, e-mail names and Telegram handles MASKED (the e-mail
// domain is kept - gmail vs a company domain is itself a signal). Nothing about job seekers, CVs or accounts.
// Criteria examples are generic on purpose - none are from our adverts.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { openJobsWhere } = require('../tenders/deadline');

const API = process.env.JEV_API_URL, MODEL = process.env.JEV_MODEL, KEY = process.env.JEV_API_KEY;
const PRICE_PER_M_IN = 0.042;
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const N = Number(arg('--n')) || 0;
const OUT = '/root/storage/jev/bina-jobs-scam-audit.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RISK = /\b(fee|fees|deposit|registration fee|pay (for|a)|payment|processing|training cost|uniform cost)\b|ክፍያ|ብር ይከፈላል|ያስይዙ|ማስያዣ|ምዝገባ|dubai|saudi|qatar|kuwait|abroad|overseas|ዱባይ|ሳዑዲ|ውጭ ሀገር|whatsapp|telegram|work from home|earn \$|per day/i;
const EMPLOYER_POSTED = new Set(['BinaSmart', 'Employer notice']);

const QUESTIONS = {
  scam: { type: 'choice',
    instructions: 'This is a job advert published on an Ethiopian job board. Read it as a careful job seeker would. Which describes it best?',
    criteria: {
      normal_job: 'An ordinary vacancy: a named employer hiring for a post; applicants send a CV or documents or apply in person. Words like payment, fee or deposit refer to the work itself (an accountant who processes payments, a cashier who handles deposits) or to what the employer pays.',
      asks_applicant_money: 'The job seeker must pay something: an application, registration, form, exam, training, uniform, medical, visa, ticket or placement fee, or a deposit or guarantee, before or in order to get the job.',
      abroad_recruitment: 'Offers work in another country (for example the Gulf, the Middle East or Europe) or recruits people to travel for work, through an agent, broker or recruitment office.',
      other_red_flags: 'No real employer and other scam signs: pay far above normal for easy work, earn per day from home, commission-only selling to your own contacts, contact only through a private phone, Telegram or WhatsApp, urgency and no job details.' } },
};

async function ask(state, tries = 9) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(API, { method: 'POST',
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions: QUESTIONS }) });
    const d = await r.json().catch(() => null);
    if (r.status === 200 && d && d.answers) return d;
    if (!(r.status === 429 || r.status >= 500) || i === tries - 1) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 120));
    await sleep(Math.min(30000, 2500 * Math.pow(1.7, i)) + Math.random() * 1200);
  }
}

const mask = s => String(s || '')
  .replace(/[\w.+-]+@([\w-]+\.[\w.-]+)/g, '[email at $1]')
  .replace(/(?:\+?251|\b0)[\s-]?[1-9](?:[\s-]?\d){7,8}\b/g, '[phone number]')
  .replace(/(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?(?:[\s-]?\d{2,4}){2,4}/g, m => m.replace(/\D/g, '').length >= 9 ? '[phone number]' : m)
  .replace(/(^|\s)@[A-Za-z0-9_]{4,}/g, '$1[telegram handle]');
const text = h => String(h || '').replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

function stateOf(j) {
  const body = mask(text(j.bodyHtml) || j.summary).slice(0, 1400);
  return [
    'Job title: ' + j.title, 'Employer: ' + (j.employer ? j.employer.name : 'not given'), j.city && 'City: ' + j.city,
    j.salary && 'Salary: ' + mask(j.salary), j.howToApply && 'How to apply: ' + mask(text(j.howToApply)).slice(0, 400),
    'Advert text:\n' + body,
  ].filter(Boolean).join('\n');
}

(async () => {
  if (!KEY) throw new Error('JEV_API_KEY missing - run with --env-file=.env');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.job.findMany({ where: { published: true, ...openJobsWhere(Date.now()) },
      include: { employer: { select: { name: true, verified: true } } }, orderBy: { publishedAt: 'desc' } });
    const all = j => [j.title, j.summary, j.salary, j.howToApply, text(j.bodyHtml)].join(' ');
    const risky = rows.filter(j => RISK.test(all(j)));
    const posted = rows.filter(j => EMPLOYER_POSTED.has(j.sourceName) || !j.sourceName);
    const rest = rows.filter(j => !risky.includes(j) && !posted.includes(j));
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // same control set every run
    const control = rest.map(j => [rnd(), j]).sort((a, b) => a[0] - b[0]).slice(0, 150).map(x => x[1]);
    let set = [...risky.map(j => [j, 'risk_word']), ...posted.filter(j => !risky.includes(j)).map(j => [j, 'employer_posted']), ...control.map(j => [j, 'control'])];
    console.log('open ' + rows.length + ' · risk-word ' + risky.length + ' · employer-posted ' + posted.length + ' · control ' + control.length + ' -> checking ' + set.length);
    if (N) set = set.slice(0, N);

    const out = []; let tokens = 0, failed = 0;
    for (let i = 0; i < set.length; i++) {
      const [j, why] = set[i];
      let d;
      try { d = await ask(stateOf(j)); } catch (e) { failed++; console.log('  !! ' + j.slug + ' ' + e.message.slice(0, 90)); continue; }
      tokens += (d.usage || {}).input_tokens || 0;
      const a = d.answers.scam || {};
      out.push({ slug: j.slug, title: j.title, employer: j.employer && j.employer.name, employerVerified: !!(j.employer && j.employer.verified),
        source: j.sourceName, sourceUrl: j.sourceUrl, why, verdict: a.choice, conf: a.confidence, flag: a.choice && a.choice !== 'normal_job' });
      console.log('  ' + (i + 1) + '/' + set.length + ' ' + why.padEnd(15) + ' ' + String(a.choice).padEnd(20) + ' ' + (a.confidence || 0).toFixed(2) + ' ' + j.title.slice(0, 50));
      if ((i + 1) % 50 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
      await sleep(150);
    }
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    const c = (f) => out.filter(f).length;
    console.log('\n' + out.length + ' checked, ' + failed + ' failed. input tokens ' + tokens + ' ~ $' + (tokens / 1e6 * PRICE_PER_M_IN).toFixed(4));
    for (const w of ['risk_word', 'employer_posted', 'control'])
      console.log(w.padEnd(16) + c(x => x.why === w) + ' checked, flagged ' + c(x => x.why === w && x.flag) + '  ' +
        JSON.stringify(out.filter(x => x.why === w && x.flag).reduce((m, x) => (m[x.verdict] = (m[x.verdict] || 0) + 1, m), {})));
    console.log('\nflagged, most confident first:');
    for (const x of out.filter(x => x.flag).sort((a, b) => b.conf - a.conf).slice(0, 80))
      console.log('  ' + Math.round(x.conf * 100) + '%  ' + x.verdict.padEnd(20) + ' ' + (x.source || '').slice(0, 14).padEnd(15) + x.title.slice(0, 50) + '  /jobs/' + x.slug);
    console.log('\nreport ' + OUT + ' - nothing was changed');
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[jev-scams] ' + e.message); process.exit(1); });
