#!/usr/bin/env node
'use strict';
// Weekly Amharic check for Bini. Asks the 30 questions in questions.json through the live /api/assistant,
// scores each answer with ops/bini/checks.js, saves the transcript and sends Ibrahim a summary + the file.
//   node --env-file=.env ops/bini/amharic-eval.js            # run + send
//   node --env-file=.env ops/bini/amharic-eval.js --dry      # run, print, do not send
//   node --env-file=.env ops/bini/amharic-eval.js --limit 5  # first N questions only
// Cron: Sunday 06:00 UTC (09:00 Addis). Each question uses its own synthetic X-Real-IP so the 25/10-min
// assistant limit is not tripped, and there is a 3 s pause between calls so Bini's Gemini quota stays calm.
const fs = require('fs');
const path = require('path');
const { check } = require('./checks');

const API = 'http://127.0.0.1:' + (process.env.PORT || 4210);
const CHAT = process.env.BINI_EVAL_CHAT || '8825386029';
const TOKEN = process.env.BINA_RIDER_BOT_TOKEN || '';
const OUT_DIR = process.env.BINI_EVAL_DIR || '/root/bini-eval';
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ask(q, i) {
  const r = await fetch(API + '/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': 'bini-eval-' + i }, body: JSON.stringify({ message: q }) });
  const d = await r.json().catch(() => ({}));
  return String(d.reply || '');
}

async function tg(method, body, isForm) {
  if (!TOKEN) throw new Error('no BINA_RIDER_BOT_TOKEN');
  const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/' + method, isForm ? { method: 'POST', body } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!d.ok) throw new Error('telegram ' + method + ': ' + JSON.stringify(d).slice(0, 200)); return d.result;
}

// Telegram sendDocument has hung once; never let a stuck upload keep the cron process alive.
function withTimeout(p, ms, what) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]); }

(async () => {
  let items = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
  if (limit) items = items.slice(0, limit);
  const resend = args.includes('--resend') ? args[args.indexOf('--resend') + 1] : '';
  const date = resend || new Date().toISOString().slice(0, 10);
  const rows = [];
  if (resend) rows.push(...JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'bini-amharic-' + resend + '.json'), 'utf8')));
  for (let i = 0; i < (resend ? 0 : items.length); i++) {
    const t0 = Date.now();
    let reply = '', err = '';
    try { reply = await ask(items[i].q, i); } catch (e) { err = e.message; }
    const res = check(items[i], reply);
    if (err) res.fails.unshift('error:' + err), res.ok = false;
    rows.push({ n: i + 1, q: items[i].q, tags: items[i].tags, reply, ms: Date.now() - t0, ...res });
    if (i < items.length - 1) await sleep(3000);
  }
  const passed = rows.filter(r => r.ok).length;
  const failCounts = {};
  for (const r of rows) for (const f of r.fails) { const k = f.split(':')[0]; failCounts[k] = (failCounts[k] || 0) + 1; }
  const avgMs = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);

  const transcript = ['Bini Amharic check · ' + date, 'Score ' + passed + '/' + rows.length + ' · avg ' + avgMs + ' ms', ''].concat(rows.map(r =>
    '#' + r.n + (r.ok ? ' ✅' : ' ❌ ' + r.fails.join(', ')) + ' [' + r.tags.join(',') + ']\nQ: ' + r.q + '\nA: ' + r.reply.trim() + '\n')).join('\n');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'bini-amharic-' + date + '.txt');
  fs.writeFileSync(file, transcript);
  fs.writeFileSync(path.join(OUT_DIR, 'bini-amharic-' + date + '.json'), JSON.stringify(rows, null, 1));

  const bad = rows.filter(r => !r.ok);
  const summary = ['🧪 Bini Amharic check · ' + date, 'Score: ' + passed + '/' + rows.length + ' · avg ' + avgMs + ' ms',
    Object.keys(failCounts).length ? 'Flags: ' + Object.entries(failCounts).map(([k, v]) => k + ' ×' + v).join(', ') : 'Flags: none',
    '', ...bad.slice(0, 6).map(r => '#' + r.n + ' ' + r.q.slice(0, 40) + ' → ' + r.fails.join(', ')),
    bad.length > 6 ? '… +' + (bad.length - 6) + ' more in the file' : '',
    '', 'Full transcript attached. Reply with the numbers of answers that sound weak or wrong and I will fix the examples.'].filter(s => s !== undefined).join('\n');

  console.log(transcript);
  console.log('\n' + summary);
  if (dry) return;
  await withTimeout(tg('sendMessage', { chat_id: CHAT, text: summary }), 20000, 'sendMessage');
  console.log('[bini-eval] summary sent to ' + CHAT);
  const form = new FormData();
  form.append('chat_id', CHAT);
  form.append('document', new Blob([transcript], { type: 'text/plain' }), 'bini-amharic-' + date + '.txt');
  await withTimeout(tg('sendDocument', form, true), 60000, 'sendDocument');
  console.log('[bini-eval] transcript sent to ' + CHAT);
})().catch(e => { console.error('[bini-eval] failed:', e.message); process.exit(1); });
