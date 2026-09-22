#!/usr/bin/env node
'use strict';
// Does the jobs section still work? Asked every morning, by using it.
//
//   node --env-file=.env ops/selftest-jobs.js            run the checks, speak only if something broke
//   node --env-file=.env ops/selftest-jobs.js --loud     print every check, pass or fail
//
// Why a script and not a browser agent. The owner asked about Jev Ultrafast, which drives a real browser
// with a model deciding each click. That is the right tool for a page nobody has seen before. It is the
// wrong tool here: these flows are OURS and we know exactly what they should do, so a scripted check is
// faster, free, deterministic, and cannot invent a pass. An AI agent that "thinks" the form submitted is
// worse than no test at all.
//
// The checks go through the PUBLIC urls, not through the code, so they fail the way a user would: nginx,
// the bot guard, the app, the database, all of it. Anything this script creates, it deletes.
const https = require('https');

const BASE = 'https://bina.et';
const LOUD = process.argv.includes('--loud');
const UA = 'BinaSmartSelfTest/1.0 (+https://bina.et; internal monitor)';

const fails = [];
const notes = [];

function get(path) {
  return new Promise(resolve => {
    const req = https.request(BASE + path, { method: 'GET', headers: { 'user-agent': UA }, timeout: 25000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });
}

function post(path, payload) {
  const data = JSON.stringify(payload);
  return new Promise(resolve => {
    const req = https.request(BASE + path, { method: 'POST', timeout: 45000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'user-agent': UA } }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(body); } catch (e) {} resolve({ status: res.statusCode, json: j, body }); });
    });
    req.on('error', e => resolve({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.write(data); req.end();
  });
}

function check(name, ok, detail) {
  if (ok) { if (LOUD) console.log('  ok   ' + name); return true; }
  fails.push(name + (detail ? ' — ' + detail : ''));
  console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  return false;
}

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const testPhone = '0915550042';               // one number, so a failed run leaves nothing new behind
  const testCompany = 'BinaSmart Self Test PLC';

  try {
    // 1. the board itself
    const board = await get('/jobs');
    check('board loads', board.status === 200, 'HTTP ' + board.status);
    const cards = (board.body.match(/class="t-card jc"/g) || []).length;
    check('board has vacancies', cards >= 5, cards + ' cards');
    check('board shows the apply button', /ያመልክቱ|Apply/.test(board.body));
    check('board share card is the jobs one', /og-section-jobs\.png/.test(board.body));

    // 2. a category page, and a real vacancy from it
    const cat = await get('/jobs/category/banking');
    check('category page loads', cat.status === 200, 'HTTP ' + cat.status);
    const slug = (cat.body.match(/href="\/jobs\/([a-z0-9-]{6,})"/) || [])[1];
    if (check('category page links a vacancy', !!slug)) {
      const job = await get('/jobs/' + slug);
      check('vacancy page loads', job.status === 200, 'HTTP ' + job.status);
      check('vacancy has an apply route', /id="apply"|ሲቪዎን ይላኩ|ማመልከቻዎን/.test(job.body));
      check('vacancy carries JobPosting data', /"@type":"JobPosting"/.test(job.body));
    }

    // 3. the search endpoint Bini uses
    const search = await get('/api/jobs/search?field=banking&limit=3');
    let sj = null; try { sj = JSON.parse(search.body); } catch (e) {}
    check('job search answers', search.status === 200 && sj && Array.isArray(sj.jobs), 'HTTP ' + search.status);
    check('job search returns vacancies', sj && sj.jobs && sj.jobs.length > 0, sj && sj.jobs ? sj.jobs.length + ' rows' : 'none');

    // 4. a real CV application, end to end, then removed
    const pdf = Buffer.from('%PDF-1.4 self test ' + 'x'.repeat(400)).toString('base64');
    const apply = await post('/api/jobs/apply', { name: 'Self Test', phone: testPhone, city: 'Addis Ababa',
      category: 'Testing', cv: pdf, cvMime: 'application/pdf', shareWider: false });
    const applied = check('CV upload accepted', apply.status === 200 && apply.json && apply.json.ok,
      'HTTP ' + apply.status + ' ' + (apply.json ? JSON.stringify(apply.json).slice(0, 80) : apply.body.slice(0, 80)));
    if (applied) {
      const row = await prisma.candidate.findUnique({ where: { id: apply.json.id } }).catch(() => null);
      check('CV stored on disk and in the table', !!row && !!row.cvPath);
      // The page the applicant is sent to next: "12 vacancies match your CV" (jobs/matches.js).
      const mx = await get('/jobs/matches/' + apply.json.id);
      check('match page answers for a new CV', mx.status === 200, 'HTTP ' + mx.status);
      if (row) {
        try { require('fs').unlinkSync(row.cvPath); } catch (e) {}
        await prisma.candidate.delete({ where: { id: row.id } }).catch(() => {});
        notes.push('test CV removed');
      }
    }

    // 5. a submitted vacancy reaches the queue, then removed
    const sub = await post('/api/jobs/submit', { employerName: testCompany, title: 'Self Test Position',
      city: 'Addis Ababa', summary: 'Automated daily check of the submission queue.', source: 'selftest' });
    const submitted = check('vacancy submission accepted', sub.status === 200 && sub.json && sub.json.ok,
      'HTTP ' + sub.status);
    if (submitted) {
      const row = await prisma.jobSubmission.findUnique({ where: { id: sub.json.id } }).catch(() => null);
      check('submission waits for a person', !!row && row.status === 'pending', row ? row.status : 'missing');
      await prisma.jobSubmission.deleteMany({ where: { employerName: testCompany } }).catch(() => {});
      notes.push('test submission removed');
    }

    // 6. the board is being fed
    const { openSince, isClosed } = require('../tenders/deadline');
    const now = new Date();
    const open = (await prisma.job.findMany({ where: { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      select: { deadline: true } })).filter(j => !isClosed(j.deadline, now)).length;
    check('enough open vacancies', open >= 200, open + ' open');
    const fresh = await prisma.job.count({ where: { publishedAt: { gte: new Date(Date.now() - 3 * 86400000) } } });
    check('new vacancies in the last 3 days', fresh > 0, fresh + ' added');

    // 7. nothing left behind by earlier runs
    const leftovers = await prisma.candidate.count({ where: { phone: { contains: '91555004' } } })
      + await prisma.jobSubmission.count({ where: { employerName: testCompany } });
    check('no test rows left behind', leftovers === 0, leftovers + ' found');

    const line = fails.length
      ? '🔴 <b>jobs self-test failed</b>\n\n' + fails.map(f => '• ' + f).join('\n') + '\n\n' + BASE + '/jobs'
      : null;
    if (line) {
      const tok = process.env.BINASMART_TG_TOKEN;
      const chat = process.env.BINA_OWNER_TG_CHAT || process.env.BINASMART_ADMIN_TG_CHAT;
      if (tok && chat) {
        await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text: line, parse_mode: 'HTML', disable_web_page_preview: true }),
        }).catch(() => {});
      }
      console.log('\n[selftest] ' + fails.length + ' failed — owner told');
      process.exitCode = 1;
    } else {
      console.log('[selftest] all checks passed' + (notes.length ? ' (' + notes.join(', ') + ')' : ''));
    }
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[selftest] crashed: ' + e.message); process.exit(2); });
