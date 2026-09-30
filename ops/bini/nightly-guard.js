#!/usr/bin/env node
'use strict';
// Nightly guard for Bini: 30 questions across every service (rides, hotels, property, cars, tenders, jobs,
// banking, telecom, IDs, identity, politics) in Amharic and English, asked through the live /api/assistant in
// eval mode (no memory, no handover). Each answer must pass ops/bini/checks.js (house rules: language, no
// invented birr, no vendor named, real links only) AND this file's own test: the tool the question needs
// ("tool"), a tool it must not use ("noTool"), words the answer must carry ("want") or never say ("never").
//
//   node --env-file=.env ops/bini/nightly-guard.js           run, save, alert only on a real drop
//   node --env-file=.env ops/bini/nightly-guard.js --dry     run and print; never message anyone
//
// Quiet by design: the weekly Amharic check (amharic-eval.js) is the report; this one speaks only when Bini got
// worse - a score 3 or more below the last run, or under 70%, or 2+ empty answers - so a message means act.
// Cron 02:15 UTC (05:15 Addis), before the morning traffic. Results: /root/bini-eval/nightly-<date>.json
// Cost (29 Sep 2026): 30 questions a night cost more than all real users together (~$7.50 a month at list price), so
// each night asks ONE THIRD of the set (question n where n % 3 == day % 3): every question still runs every 3 nights,
// and a night is compared with the last run of the same third. --all asks all 30.
const fs = require('fs');
const path = require('path');
const { check } = require('./checks');

const API = 'http://127.0.0.1:' + (process.env.PORT || 4210);
const CHAT = process.env.BINI_EVAL_CHAT || '';
const TOKEN = process.env.BINA_RIDER_BOT_TOKEN || '';
const OUT = process.env.BINI_EVAL_DIR || '/root/bini-eval';
const dry = process.argv.includes('--dry');
const MOBILE = /(?:\+?251[\s-]?|\b0)[79](?:[\s-]?\d){8}/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function judge(item, reply, tools) {
  const res = check(item, reply, { tools });
  // "too_long" is a style note (a list of 6 hotels is long), not a broken answer: counted as a warning below.
  const fails = res.fails.filter(f => f !== 'too_long');
  const used = tools.map(t => t.replace(/\*$/, ''));
  if (item.tool && !used.includes(item.tool)) fails.push('tool_missing:' + item.tool);
  if (item.noTool && used.includes(item.noTool)) fails.push('wrong_tool:' + item.noTool);
  if (item.want && !new RegExp(item.want, 'i').test(reply)) fails.push('answer_missing');
  if (item.never && new RegExp(item.never, 'i').test(reply)) fails.push('said_forbidden');
  // A flat or a car answer carries the selling company's own published contact; anywhere else a mobile is a leak.
  if (MOBILE.test(reply) && !item.mobileOk) fails.push('mobile_number');
  return fails;
}

(async () => {
  const every = JSON.parse(fs.readFileSync(path.join(__dirname, 'nightly-questions.json'), 'utf8'));
  const part = Math.floor(Date.now() / 864e5) % 3;
  const items = process.argv.includes('--all') ? every : every.filter((_, i) => i % 3 === part);
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i], t0 = Date.now();
    let reply = '', tools = [], err = '';
    try {
      const r = await fetch(API + '/api/assistant', { method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'content-type': 'application/json', 'x-binasmart-eval': '1', 'x-real-ip': 'bini-nightly-' + i },
        body: JSON.stringify({ message: it.q, channel: 'web', user: { uid: 'e2e-nightly-guard' } }) });
      const d = await r.json(); reply = String(d.reply || ''); tools = Array.isArray(d.tools) ? d.tools : [];
    } catch (e) { err = e.message; }
    const fails = err ? ['error:' + err] : judge(it, reply, tools);
    rows.push({ n: i + 1, q: it.q, ok: !fails.length, fails, long: reply.length > 900, tools, ms: Date.now() - t0, reply: reply.slice(0, 600) });
    if (i < items.length - 1) await sleep(3000);
  }
  const passed = rows.filter(r => r.ok).length, empty = rows.filter(r => r.fails.some(f => f === 'empty' || f.startsWith('error'))).length;
  const date = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(OUT, { recursive: true });
  // The last run that asked the same questions (older runs asked all 30: compare on the shared questions only).
  const sameQs = new Set(rows.map(r => r.q));
  let prev = null;
  for (const f of fs.readdirSync(OUT).filter(f => /^nightly-\d{4}-\d\d-\d\d\.json$/.test(f) && f !== 'nightly-' + date + '.json').sort().reverse()) {
    const old = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    const shared = old.rows.filter(r => sameQs.has(r.q));
    if (shared.length >= rows.length) { prev = { passed: shared.filter(r => r.ok).length, total: shared.length, rows: shared }; break; }
  }
  const result = { date, part: process.argv.includes('--all') ? 'all' : part, passed, total: rows.length, empty, avgMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length), rows };
  console.log('Bini nightly guard ' + date + ': ' + passed + '/' + rows.length + (prev ? ' (last run ' + prev.passed + '/' + prev.total + ')' : ' (first run)') + ' · avg ' + result.avgMs + ' ms · long answers ' + rows.filter(r => r.long).length);
  for (const r of rows.filter(r => !r.ok)) console.log('  ❌ #' + r.n + ' ' + r.q.slice(0, 50) + ' -> ' + r.fails.join(', '));
  if (dry) return;
  fs.writeFileSync(path.join(OUT, 'nightly-' + date + '.json'), JSON.stringify(result, null, 1));

  const newlyBroken = prev ? rows.filter(r => !r.ok && (prev.rows.find(p => p.q === r.q) || {}).ok) : [];
  const alarm = (prev && passed <= prev.passed - Math.max(2, Math.round(rows.length / 10))) || passed < rows.length * 0.7 || empty >= 2;
  if (!alarm) return;
  if (!TOKEN || !CHAT) { console.error('alarm, but no BINA_RIDER_BOT_TOKEN / BINI_EVAL_CHAT to send it'); process.exitCode = 1; return; }
  const text = ['⚠️ Bini got worse overnight: ' + passed + '/' + rows.length + (prev ? ' (was ' + prev.passed + '/' + prev.total + ')' : ''),
    empty ? empty + ' questions got no answer at all.' : '',
    ...(newlyBroken.length ? newlyBroken : rows.filter(r => !r.ok)).slice(0, 6).map(r => '• ' + r.q.slice(0, 45) + ' → ' + r.fails.join(', ')),
    '', 'Details: /root/bini-eval/nightly-' + date + '.json'].filter(Boolean).join('\n');
  const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }) }).then(x => x.json()).catch(e => ({ ok: false, description: e.message }));
  console.log(r.ok ? 'alert sent' : 'alert FAILED: ' + r.description);
})().catch(e => { console.error(e.message); process.exit(1); });
