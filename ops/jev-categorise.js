#!/usr/bin/env node
'use strict';
// The vacancies our own rules could not file, read by a second opinion.
//
//   node --env-file=.env ops/jev-categorise.js                 read and report, write nothing
//   node --env-file=.env ops/jev-categorise.js --apply         write the confident ones
//   node --env-file=.env ops/jev-categorise.js --n 100         a slice of it
//   node --env-file=.env ops/jev-categorise.js --min 0.9       raise the bar for writing
//
// Why. jobs/categories.js is a rule list, and rules are honest about their blind spot: anything they do
// not match stays null. On 23 September 2026 that was 496 of 4,467 open vacancies — around one in nine —
// and an uncategorised vacancy is close to invisible: it appears on no category page, matches no CV and
// goes out in no job alert. The advert is on the site and nobody meets it.
//
// This does NOT replace the rules. The rules stay first: they are free, instant, stable and auditable,
// and a category that changes every night breaks the very pages we want to rank. This only looks at what
// the rules left empty.
//
// Why a decision model rather than a chat model. We need "which of these sixteen, and how sure are you?"
// A calibrated confidence is the whole point: below the bar the row keeps its honest "Other" instead of
// being filed somewhere plausible and wrong. A nurse on the construction page is worse than a nurse
// under Other, because the second is a gap we can see and the first is a lie we cannot.
const { PrismaClient } = require('@prisma/client');
const { openSince, isClosed } = require('../tenders/deadline');

const API = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const KEY = process.env.JEV_API_KEY || '';
const PRICE_PER_M_IN = 0.042;
const BATCH = 8;

const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const N = Number(arg('--n')) || 0;
const MIN = Number(arg('--min')) || 0.85;

// The same sixteen the rules use, described the way an Ethiopian advert would read. 'unclear' is a real
// answer, not a failure: it is what keeps a guess off the board.
const CRITERIA = {
  banking: 'Banking, microfinance or insurance: teller, branch manager, credit analyst, loan officer, underwriter, claims.',
  accounting: 'Accounting and finance: accountant, auditor, cashier, budget, tax, payroll, book-keeping, cost control.',
  engineering: 'Engineering and technical trades: mechanical, electrical, civil, surveyor, technician, maintenance, welder, plumber.',
  it: 'IT and software: developer, programmer, database, network, systems administrator, cyber security, web, ERP, data analyst.',
  health: 'Health and medicine: nurse, doctor, pharmacist, laboratory, midwife, clinic, nutrition, public health.',
  education: 'Education and training: teacher, lecturer, instructor, tutor, school or kindergarten staff, curriculum, trainer.',
  sales: 'Sales and marketing: sales officer, marketing, brand, merchandiser, business development, shop keeper, distributor.',
  ngo: 'NGO and development work: programme or project officer, monitoring and evaluation, humanitarian, protection, livelihoods, grants, donor-funded.',
  logistics: 'Driving, transport, warehouse and supply chain: driver, store keeper, dispatcher, import and export, procurement, fleet.',
  admin: 'Administration and human resources: secretary, office administrator, HR officer, receptionist, data entry, executive assistant, clerk.',
  hospitality: 'Hotel, restaurant and tourism: waiter, chef, cook, housekeeping, front office, barista, tour guide, events.',
  construction: 'Construction and real estate: site foreman, mason, carpenter, project site work, property management, estate agent.',
  agriculture: 'Agriculture and food production: farm, agronomy, horticulture, livestock, dairy, food processing, coffee, irrigation.',
  legal: 'Law and compliance: lawyer, legal officer, attorney, contracts, compliance, paralegal.',
  security: 'Security and facilities: guard, security officer, janitor, cleaner, facility or premises maintenance.',
  media: 'Media, design and communications: graphic designer, videographer, journalist, content creator, social media, public relations, printing.',
  unclear: 'None of the above fits, or the advert does not say enough to tell. Choose this rather than guessing.',
};
const SLUGS = Object.keys(CRITERIA).filter(s => s !== 'unclear');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ask(body, tries = 9) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    if (r.status === 200 && d && d.answers) return d;
    const retryable = r.status === 429 || r.status >= 500;
    if (!retryable || i === tries - 1) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 140));
    await sleep(Math.min(30000, 2500 * Math.pow(1.7, i)) + Math.random() * 1200);
  }
}

// One advert per question, several adverts per request. The state is the numbered list; each question
// points at one entry. Title alone is often too thin here — "Officer" tells nobody anything — so the
// employer and the first line of the summary travel with it.
const describe = j => {
  const bits = [j.title];
  if (j.employer && j.employer.name) bits.push('at ' + j.employer.name);
  const s = (j.summary || '').replace(/\s+/g, ' ').trim();
  if (s) bits.push('— ' + s.slice(0, 180));
  return bits.join(' ');
};

const askBatch = async jobs => {
  const state = jobs.map((j, i) => (i + 1) + '. ' + describe(j)).join('\n');
  const questions = {};
  jobs.forEach((j, i) => {
    questions['j' + (i + 1)] = {
      type: 'choice',
      instructions: 'Entry ' + (i + 1) + ' of the list ("' + String(j.title).slice(0, 70) + '") is an Ethiopian job advert. What field of work is it in?',
      criteria: CRITERIA,
    };
  });
  const d = await ask({ model: MODEL, state, questions });
  const u = d.usage || {};
  return jobs.map((j, i) => {
    const a = d.answers['j' + (i + 1)] || {};
    return {
      choice: a.choice, confidence: a.confidence,
      tokens: i === 0 ? (u.input_tokens || u.inputTokens || u.promptTokens || 0) : 0,
    };
  });
};

(async () => {
  if (!KEY) { console.error('No JEV_API_KEY in the environment.'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const rows = (await prisma.job.findMany({
      where: { published: true, category: null, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      select: { id: true, slug: true, title: true, summary: true, deadline: true, employer: { select: { name: true } } },
      orderBy: { publishedAt: 'desc' },
    })).filter(j => !isClosed(j.deadline, now));

    const work = N ? rows.slice(0, N) : rows;
    console.log(work.length + ' open vacancies with no category' + (APPLY ? '' : '  (reporting only — pass --apply to write)'));
    console.log('writing anything below ' + MIN + ' confidence is refused.\n');

    const counts = {}, unsure = [];
    let tokens = 0, decided = 0, failed = 0, written = 0;

    for (let i = 0; i < work.length; i += BATCH) {
      const slice = work.slice(i, i + BATCH);
      let out;
      try { out = await askBatch(slice); }
      catch (e) { failed += slice.length; console.log('  !! ' + e.message.slice(0, 100)); continue; }

      for (let k = 0; k < slice.length; k++) {
        const j = slice[k], a = out[k] || {};
        tokens += a.tokens || 0;
        const conf = typeof a.confidence === 'number' ? a.confidence : 0;
        if (!SLUGS.includes(a.choice) || conf < MIN) {
          unsure.push({ title: j.title, choice: a.choice || '—', conf });
          continue;
        }
        decided++;
        counts[a.choice] = (counts[a.choice] || 0) + 1;
        if (APPLY) { await prisma.job.update({ where: { id: j.id }, data: { category: a.choice } }); written++; }
      }
      if ((i / BATCH) % 5 === 0) process.stdout.write('  ' + Math.min(i + BATCH, work.length) + '/' + work.length + '\r');
      await sleep(150);
    }

    console.log('\n--- filed ' + decided + ' of ' + work.length + (APPLY ? ' (written: ' + written + ')' : ' (nothing written)'));
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log('  ' + c.padEnd(14) + n));
    console.log('--- left under Other: ' + unsure.length + (failed ? '   (requests failed: ' + failed + ')' : ''));
    unsure.slice(0, 25).forEach(u => console.log('  ' + (u.conf ? u.conf.toFixed(2) : '----') + ' ' + String(u.choice).padEnd(12) + u.title.slice(0, 68)));
    if (unsure.length > 25) console.log('  … and ' + (unsure.length - 25) + ' more');
    console.log('\ninput tokens ' + tokens + '  ≈ $' + (tokens / 1e6 * PRICE_PER_M_IN).toFixed(4));
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
