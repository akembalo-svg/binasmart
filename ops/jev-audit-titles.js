#!/usr/bin/env node
'use strict';
// Read every title on the board the way a stranger would, and report the ones that are not jobs.
//
//   node --env-file=.env ops/jev-audit-titles.js --validate   check batching against one-at-a-time first
//   node --env-file=.env ops/jev-audit-titles.js              audit every open vacancy
//   node --env-file=.env ops/jev-audit-titles.js --n 500      a slice of it
//
// Why this exists. On 22 Sep a 60-title sample found 529 vacancies titled "Vacancy announcement —
// 21 Sept 2026". The rules that let them through are mine, and a rule cannot see its own blind spot.
// This asks a second opinion about every open vacancy and prints only what it disputes.
//
// It writes nothing. The output is a list for a person to read; fixing anything is a separate, deliberate
// act. A model that decides what disappears off the board without a human reading it first is a model
// deciding which Ethiopian companies get applicants.
//
// On batching. The API evaluates every declared question against one shared state in a single pass, so
// 10 titles can travel in one request instead of 10. That is 10x cheaper and 10x faster - and it is also
// a different measurement from asking one at a time, because the researcher who probed Jev found answers
// can shift with position and with what else is in the request. So --validate runs both ways over the
// same rows and prints how often they differ. Trust the batch only if that number is ~0.
const { PrismaClient } = require('@prisma/client');
const { openSince, isClosed } = require('../tenders/deadline');

const API = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.JEV_MODEL || 'jev-latest';
const KEY = process.env.JEV_API_KEY || '';
const PRICE_PER_M_IN = 0.042;
const BATCH = 10;
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const nRaw = Number(arg('--n')) || 0;
const N = nRaw > 0 ? Math.max(10, nRaw) : 0;   // 0 = every open vacancy
const VALIDATE = process.argv.includes('--validate');

const CRITERIA = {
  job_title: 'The name of a post somebody is hired into: "Senior Accountant", "Driver", "Sales Officer", "Head of Human Resources", "Junior Logistics & Import/Export Officer".',
  requirement_line: 'A sentence from the requirements or conditions of an advert rather than the name of a post: "Fluency in Amharic is required.", "Applicants must have 3 years experience.", "Qualification and Experience".',
  not_a_vacancy: 'Neither: a heading, a count, a date, a company name alone, a document title. "Vacancy announcement — 21 Sept 2026", "1 position.", "Terms of Reference", "Breakthrough Trading".',
};

let usageShape = null;
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
    if (!retryable || i === tries - 1) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 120));
    await sleep(Math.min(30000, 2500 * Math.pow(1.7, i)) + Math.random() * 1200);
  }
}

const one = async title => {
  const d = await ask({ model: MODEL, state: title, questions: {
    kind: { type: 'choice', instructions: 'This line was taken out of an Ethiopian job advert. What is it?', criteria: CRITERIA } } });
  const a = d.answers.kind || {};
  return { choice: a.choice, confidence: a.confidence, tokens: (d.usage || {}).input_tokens || 0 };
};

// Ten titles, one request. The state is the numbered list; each question points at one line of it.
const ten = async titles => {
  const state = titles.map((t, i) => (i + 1) + '. ' + t).join('\n');
  const questions = {};
  titles.forEach((t, i) => {
    questions['t' + (i + 1)] = {
      type: 'choice',
      instructions: 'Line ' + (i + 1) + ' of the list ("' + String(t).slice(0, 80) + '") was taken out of an Ethiopian job advert. What is it?',
      criteria: CRITERIA,
    };
  });
  const d = await ask({ model: MODEL, state, questions });
  if (!usageShape) { usageShape = Object.keys(d.usage || {}).join(',') || 'none'; console.log('  (usage fields: ' + usageShape + ')'); }
  return titles.map((t, i) => {
    const a = d.answers['t' + (i + 1)] || {};
    const u = d.usage || {};
    return { choice: a.choice, confidence: a.confidence, tokens: i === 0 ? (u.input_tokens || u.inputTokens || u.promptTokens || 0) : 0 };
  });
};

(async () => {
  if (!KEY) { console.error('No JEV_API_KEY — see ops/jev-shadow-titles.js for the two doors.'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const all = (await prisma.job.findMany({
      where: { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      select: { id: true, slug: true, title: true, sourceName: true, deadline: true },
      orderBy: { publishedAt: 'desc' },
    })).filter(j => !isClosed(j.deadline, now));
    const rows = N ? all.slice(0, N) : all;

    if (VALIDATE) {
      // Does asking ten at a time give the same answers as asking one at a time?
      const sample = rows.slice(0, 20);
      const singles = [];
      for (const r of sample) { singles.push(await one(r.title)); await sleep(200); }
      const batched = [];
      for (let i = 0; i < sample.length; i += BATCH) batched.push(...await ten(sample.slice(i, i + BATCH).map(r => r.title)));
      let differ = 0;
      sample.forEach((r, i) => {
        if (singles[i].choice !== batched[i].choice) {
          differ++;
          console.log('  differs: ' + r.title.slice(0, 60) + '  one:' + singles[i].choice + '  ten:' + batched[i].choice);
        }
      });
      console.log('\nvalidation: ' + sample.length + ' titles, ' + differ + ' answers changed when batched.');
      console.log(differ === 0 ? 'Batching is safe here — running the full audit with it.\n'
                               : 'Batching CHANGES answers. The full audit below is one at a time.\n');
      if (differ !== 0) process.env.JEV_NO_BATCH = '1';
    }

    const useBatch = !process.env.JEV_NO_BATCH;
    console.log('auditing ' + rows.length + ' open vacancies' + (useBatch ? ' (' + BATCH + ' per request)' : ' (one per request)') + '…');

    const flagged = [];
    let tokens = 0, done = 0, failed = 0;
    for (let i = 0; i < rows.length; i += (useBatch ? BATCH : 1)) {
      const slice = rows.slice(i, i + (useBatch ? BATCH : 1));
      let out;
      try { out = useBatch ? await ten(slice.map(r => r.title)) : [await one(slice[0].title)]; }
      catch (e) { failed += slice.length; console.log('  !! ' + e.message.slice(0, 90)); continue; }
      slice.forEach((r, k) => {
        const a = out[k] || {};
        tokens += a.tokens || 0;
        if (a.choice && a.choice !== 'job_title') flagged.push({ ...r, jev: a.choice, confidence: a.confidence || 0 });
      });
      done += slice.length;
      if (done % 200 < BATCH) console.log('  … ' + done + '/' + rows.length + ' (' + flagged.length + ' flagged so far)');
      await sleep(150);
    }

    flagged.sort((a, b) => b.confidence - a.confidence);
    console.log('\n' + done + ' audited · ' + flagged.length + ' flagged as not a job title' + (failed ? ' · ' + failed + ' failed' : ''));
    console.log('input tokens ' + tokens + ' ≈ $' + (tokens / 1e6 * PRICE_PER_M_IN).toFixed(4));

    const byName = {};
    for (const f of flagged) byName[f.sourceName || '?'] = (byName[f.sourceName || '?'] || 0) + 1;
    console.log('by source: ' + JSON.stringify(byName));

    console.log('\nFlagged at 80% confidence or higher — read before touching anything:\n');
    for (const f of flagged.filter(x => x.confidence >= 0.8).slice(0, 80)) {
      console.log('  ' + Math.round(f.confidence * 100) + '%  ' + (f.jev === 'requirement_line' ? 'req ' : 'not ') + f.title.slice(0, 72) + '   /jobs/' + f.slug);
    }
    const out = '/root/storage/jev-title-audit.json';
    require('fs').writeFileSync(out, JSON.stringify(flagged, null, 1));
    console.log('\nfull list: ' + out + ' (' + flagged.length + ' rows) — nothing was changed');
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[audit] ' + e.message); process.exit(1); });
