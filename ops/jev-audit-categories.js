#!/usr/bin/env node
'use strict';
// A second opinion on the categories our own rules already assigned.
//
//   node --env-file=.env ops/jev-audit-categories.js                 report; writes nothing
//   node --env-file=.env ops/jev-audit-categories.js --n 200         a slice, to see the shape first
//   node --env-file=.env ops/jev-audit-categories.js --apply         change the confident disagreements
//   node --env-file=.env ops/jev-audit-categories.js --min 0.9       raise the bar
//
// Why this and not the empty ones. ops/jev-categorise.js filled what the rules left blank — the honest
// gap. This is the harder question: are the 4,173 the rules DID fill actually right? A blank category
// is a gap a reader can see. A wrong one is invisible and worse: the category decides who gets the job
// alert and whose CV is matched, so a nurse filed under construction never hears about the job, and
// nobody ever finds out.
//
// The precedent is not theoretical. On 22 September a 60-title sample found 529 vacancies my own rules
// had titled "Vacancy announcement". A rule cannot see its own blind spot; that is the whole reason to
// pay a hundredth of a cent for a different opinion.
//
// Reporting is the default and --apply is deliberate. Where it does write, it writes only above the
// confidence bar, and it never blanks a category: a disagreement we are not sure about leaves the
// existing one alone, because "possibly wrong" is not a reason to make a vacancy invisible.
//
// Progress is written to the report file as it goes, so a run that dies at 3,000 rows is not wasted.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { openSince, isClosed } = require('../tenders/deadline');

const API = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const KEY = process.env.JEV_API_KEY || '';
const PRICE_PER_M_IN = 0.042;
const BATCH = 10;
const REPORT = '/root/jev-category-audit.json';

const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const N = Number(arg('--n')) || 0;
const MIN = Number(arg('--min')) || 0.85;

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

const describe = j => {
  const bits = [j.title];
  if (j.employer && j.employer.name) bits.push('at ' + j.employer.name);
  const s = (j.summary || '').replace(/\s+/g, ' ').trim();
  if (s) bits.push('— ' + s.slice(0, 140));
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
    return { choice: a.choice, confidence: a.confidence, tokens: i === 0 ? (u.input_tokens || u.inputTokens || u.promptTokens || 0) : 0 };
  });
};

(async () => {
  if (!KEY) { console.error('No JEV_API_KEY in the environment.'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const rows = (await prisma.job.findMany({
      where: { published: true, category: { not: null }, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      select: { id: true, slug: true, title: true, summary: true, category: true, deadline: true, employer: { select: { name: true } } },
      orderBy: { publishedAt: 'desc' },
    })).filter(j => !isClosed(j.deadline, now));

    const work = N ? rows.slice(0, N) : rows;
    console.log('auditing ' + work.length + ' categorised vacancies, ' + BATCH + ' per request' +
      (APPLY ? '  (--apply: confident disagreements WILL be written)' : '  (reporting only)'));
    console.log('bar for a disagreement to count: ' + MIN + '\n');

    const disputes = [];
    let tokens = 0, agreed = 0, lowconf = 0, failed = 0, written = 0, seen = 0;

    for (let i = 0; i < work.length; i += BATCH) {
      const slice = work.slice(i, i + BATCH);
      let out;
      try { out = await askBatch(slice); }
      catch (e) { failed += slice.length; console.log('  !! ' + e.message.slice(0, 100)); continue; }

      for (let k = 0; k < slice.length; k++) {
        const j = slice[k], a = out[k] || {};
        seen++;
        tokens += a.tokens || 0;
        const conf = typeof a.confidence === 'number' ? a.confidence : 0;
        if (a.choice === j.category) { agreed++; continue; }
        // It says something else. Only a confident, nameable field counts as a dispute — 'unclear' is
        // not a reason to take a category away that a reader is already using.
        if (!SLUGS.includes(a.choice) || conf < MIN) { lowconf++; continue; }
        disputes.push({ slug: j.slug, title: j.title, employer: j.employer && j.employer.name, ours: j.category, theirs: a.choice, confidence: Number(conf.toFixed(2)) });
        if (APPLY) { await prisma.job.update({ where: { id: j.id }, data: { category: a.choice } }); written++; }
      }

      if ((i / BATCH) % 10 === 0) {
        fs.writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), seen, agreed, lowconf, failed, disputes }, null, 1));
        process.stdout.write('  ' + Math.min(i + BATCH, work.length) + '/' + work.length + '  disputes ' + disputes.length + '\r');
      }
      await sleep(120);
    }

    fs.writeFileSync(REPORT, JSON.stringify({ at: new Date().toISOString(), seen, agreed, lowconf, failed, disputes }, null, 1));
    const byMove = {};
    disputes.forEach(d => { const k = d.ours + ' -> ' + d.theirs; byMove[k] = (byMove[k] || 0) + 1; });

    console.log('\n\n--- ' + seen + ' checked: ' + agreed + ' agree, ' + disputes.length + ' disputed, ' +
      lowconf + ' differ but below the bar' + (failed ? ', ' + failed + ' failed' : ''));
    Object.entries(byMove).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, n]) => console.log('  ' + String(n).padStart(4) + '  ' + k));
    console.log('\nfirst 30 disputes:');
    disputes.slice(0, 30).forEach(d => console.log('  ' + d.confidence.toFixed(2) + ' ' + (d.ours + '->' + d.theirs).padEnd(24) + d.title.slice(0, 60)));
    console.log('\nfull report: ' + REPORT);
    console.log('input tokens ' + tokens + '  ≈ $' + (tokens / 1e6 * PRICE_PER_M_IN).toFixed(4));
    if (APPLY) console.log('written: ' + written);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
