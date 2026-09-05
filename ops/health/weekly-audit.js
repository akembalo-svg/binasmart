#!/usr/bin/env node
'use strict';
// Weekly site audit: the four checks that were run by hand on 5–6 Sep 2026, run every Sunday night
// and reported to the admin chats in one message. Sites rot — a partner moves a page, a script gains
// a second askAI(), a Google Fonts link creeps back — and each of these is invisible until a
// customer complains. This makes the next regression cost a week, not a month.
//
//   node ops/health/weekly-audit.js            run and send
//   node ops/health/weekly-audit.js --dry-run  run and print, send nothing
//
// Checks (each is its own script, runnable alone):
//   ops/link-audit.js       dead links across the sitemap (bot-blocked hosts reported separately)
//   ops/button-audit.js     buttons and handlers that cannot reach any code
//   ops/js-clash-audit.js   two top-level declarations sharing a name on one page
//   + a grep that no served file points at fonts.googleapis.com / fonts.gstatic.com again
//
// Sends via the same bot the notifications use (@bina_smart_bot) to BINASMART_ADMIN_TG_CHAT and
// BINASMART_OPS_TG_CHAT. Message says ✅ when everything is clean, ⚠️ with the counts otherwise.
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const ROOT = path.join(__dirname, '..', '..');
const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.BINA_RIDER_BOT_TOKEN || '';
const CHATS = [...new Set([process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT || '8096525984'].filter(Boolean))];

function run(cmd, timeoutMs) {
  try { return { ok: true, out: execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '')) || e.message }; }
}
const last = (s, re) => { const m = [...String(s).matchAll(re)]; return m.length ? m[m.length - 1] : null; };

(async () => {
  const lines = [], problems = [];

  // 1. links (the long one: ~10 min, one host at a time on purpose)
  const l = run('node ops/link-audit.js', 25 * 60 * 1000);
  const lm = last(l.out, /checked (\d+) links on (\d+) pages across (\d+) hosts: (\d+) broken, (\d+) refused the crawler, (\d+) redirecting/g);
  if (lm) {
    const broken = Number(lm[4]);
    lines.push((broken ? '⚠️' : '✅') + ' Links: ' + lm[1] + ' checked, ' + broken + ' broken, ' + lm[5] + ' refused the crawler');
    if (broken) { problems.push('links'); const sect = l.out.split('=== BROKEN')[1] || ''; lines.push(sect.split('\n').slice(1, 7).filter(x => x.trim()).map(x => '   ' + x.trim().slice(0, 90)).join('\n')); }
  } else { lines.push('⚠️ Links: audit did not finish'); problems.push('links'); }

  // 2. buttons
  const b = run('node ops/button-audit.js', 5 * 60 * 1000);
  const bm = last(b.out, /checked (\d+) controls on (\d+) pages: (\d+) with no way to work/g);
  if (bm) { const dead = Number(bm[3]); lines.push((dead ? '⚠️' : '✅') + ' Buttons: ' + bm[1] + ' controls, ' + dead + ' dead'); if (dead) { problems.push('buttons'); lines.push(b.out.split('\n').filter(x => /--/.test(x)).slice(0, 5).map(x => '   ' + x.trim().slice(0, 90)).join('\n')); } }
  else { lines.push('⚠️ Buttons: audit did not finish'); problems.push('buttons'); }

  // 3. duplicate declarations
  const j = run('node ops/js-clash-audit.js', 5 * 60 * 1000);
  const jm = last(j.out, /scanned (\d+) pages: (\d+) clashing name\(s\) on (\d+) page\(s\), (\d+) handler\(s\) with no local declaration/g);
  if (jm) { const bad = Number(jm[2]) + Number(jm[4]); lines.push((bad ? '⚠️' : '✅') + ' Scripts: ' + jm[1] + ' pages, ' + jm[2] + ' name clashes, ' + jm[4] + ' undefined handlers'); if (bad) { problems.push('scripts'); lines.push(j.out.split('\n').filter(x => /!!|\?/.test(x)).slice(0, 5).map(x => '   ' + x.trim().slice(0, 90)).join('\n')); } }
  else { lines.push('⚠️ Scripts: audit did not finish'); problems.push('scripts'); }

  // 4. fonts stay on bina.et
  const f = run('grep -rlE "fonts\\.(googleapis|gstatic)\\.com" public/*.html public/*.js public/*/*.js server.js business/*.js 2>/dev/null | wc -l', 60000);
  const nf = Number((f.out || '').trim()) || 0;
  lines.push((nf ? '⚠️' : '✅') + ' Fonts: ' + (nf ? nf + ' file(s) point at Google Fonts again' : 'all served from bina.et'));
  if (nf) problems.push('fonts');

  const head = problems.length ? '⚠️ BinaSmart weekly audit — ' + problems.length + ' area(s) need a look' : '✅ BinaSmart weekly audit — all clean';
  const text = head + '\n\n' + lines.filter(Boolean).join('\n') + '\n\n' + new Date().toISOString().slice(0, 10) + ' · ops/health/weekly-audit.js';
  console.log(text);
  if (DRY) return console.log('\n(dry run — not sent)');
  if (!TOKEN || !CHATS.length) return console.error('no bot token or admin chat configured');
  for (const chat of CHATS) {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
    const d = await r.json().catch(() => ({}));
    console.log('sent to ' + chat + ': ' + (d.ok ? 'ok' : (d.description || 'failed')));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
