#!/usr/bin/env node
'use strict';
// Does Jev judge a job title better than the rules I wrote? Asked in the dark.
//
//   JEV_API_KEY=… node --env-file=.env ops/jev-shadow-titles.js            60 titles, shows every disagreement
//   JEV_API_KEY=… node --env-file=.env ops/jev-shadow-titles.js --n 200    a bigger sample
//
// Shadow mode, in the strict sense: this script READS job titles, asks Jev what they are, and prints a
// comparison. It writes nothing to the database, changes nothing on the site and nobody sees its output
// but us. If Jev is wrong about everything, no job seeker is affected.
//
// What is being tested, and why this question. On 22 Sep ten rows reached the live board with titles
// like "Fluency in Amharic is required." and "1 position." - lines lifted out of an advert's body by a
// splitter that trusted a "Position 2:" marker. I fixed it with a hand-written rule (a title containing
// a finite verb is not a title). That rule is free, instant and mine, and it will be wrong about
// something I have not thought of. This is the cheapest honest way to find out how often.
//
// What leaves this server: job titles. They are published adverts, already public on the board and on
// the source site. No CV, no phone number, no name, nothing a person gave us in confidence - the rule
// about BinaSmart user data staying on this machine is not bent for a benchmark.
const { PrismaClient } = require('@prisma/client');
const { cleanPositionTitle } = require('../jobs/sites/ethiojobshub');

const API = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';
const KEY = process.env.JEV_API_KEY || '';
const N = Number((process.argv.find(a => a.startsWith('--n')) || '').split('=')[1] || process.argv[process.argv.indexOf('--n') + 1] || 60);
const PRICE_PER_M_IN = 0.042;     // TypeSafe's published price; output is free

// The three things a line taken out of an advert can be. Written as plainly as the adverts are - the
// researcher who pulled Jev apart found that a sloppy option list moves the odds between the good
// options, so these are worded to be distinct rather than exhaustive.
const CRITERIA = {
  job_title: 'The name of a post somebody is hired into. "Senior Accountant", "Driver", "Sales Officer", "Head of Human Resources".',
  requirement_line: 'A sentence from the requirements or conditions of an advert, not the name of a post. "Fluency in Amharic is required.", "Applicants must have 3 years experience.", "Qualification and Experience".',
  not_a_vacancy: 'Neither - a count, a heading, a date, a fragment. "1 position.", "Vacancy announcement", "Terms of employment".',
};

async function askJev(title) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: title,
      questions: {
        kind: {
          type: 'choice',
          instructions: 'This line was taken out of an Ethiopian job advert. What is it?',
          criteria: CRITERIA,
        },
      },
    }),
  });
  const d = await r.json().catch(() => null);
  if (r.status !== 200 || !d || !d.answers) {
    throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 200));
  }
  const a = d.answers.kind || {};
  return { choice: a.choice, confidence: a.confidence, tokens: (d.usage || {}).input_tokens || 0 };
}

(async () => {
  if (!KEY) {
    console.error('No JEV_API_KEY. Get one at console.typesafe.ai, then:\n  JEV_API_KEY=… node --env-file=.env ops/jev-shadow-titles.js');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    // A deliberately unfair sample: everything the rules have ALREADY rejected or corrected, plus a
    // random slice of ordinary titles. An agreement rate measured only on easy rows means nothing.
    const bad = await prisma.job.findMany({
      where: { OR: [{ published: false }, { title: { contains: ' is required' } }, { title: { contains: 'Qualification' } }] },
      select: { title: true }, take: 20,
    });
    const good = await prisma.job.findMany({
      where: { published: true }, select: { title: true },
      orderBy: { publishedAt: 'desc' }, take: Math.max(10, N - bad.length),
    });
    const rows = [...bad, ...good].slice(0, N);

    let agree = 0, disagree = 0, tokens = 0, failed = 0;
    const clashes = [];
    for (const row of rows) {
      const title = row.title;
      // What the rule says today: null means "this is not a job title".
      const mine = cleanPositionTitle(title) ? 'job_title' : 'not_a_title';
      let jev;
      try { jev = await askJev(title); } catch (e) { failed++; console.log('  !! ' + title.slice(0, 50) + ' — ' + e.message); continue; }
      tokens += jev.tokens;
      const theirs = jev.choice === 'job_title' ? 'job_title' : 'not_a_title';
      if (theirs === mine) agree++;
      else { disagree++; clashes.push({ title, mine, jev: jev.choice, confidence: jev.confidence }); }
    }

    console.log('\n' + rows.length + ' titles · agreed ' + agree + ' · disagreed ' + disagree + (failed ? ' · failed ' + failed : ''));
    console.log('input tokens ' + tokens + ' ≈ $' + (tokens / 1e6 * PRICE_PER_M_IN).toFixed(5) + ' (output free)');
    if (clashes.length) {
      console.log('\nWhere we disagree — read these by hand, they are the whole point:\n');
      clashes.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      for (const c of clashes) {
        console.log('  ' + String(Math.round((c.confidence || 0) * 100)).padStart(3) + '%  jev:' + c.jev.padEnd(17) + ' rule:' + c.mine.padEnd(12) + ' ' + c.title.slice(0, 70));
      }
      console.log('\nA row where Jev is confident and the rule is wrong is a reason to use it.');
      console.log('A row where Jev is confident and WRONG is a reason not to - count both before deciding.');
    } else {
      console.log('\nNo disagreements. On this sample the rules are already doing the job.');
    }
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[jev] ' + e.message); process.exit(1); });
