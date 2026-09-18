#!/usr/bin/env node
'use strict';
// Build or refresh the knowledge index. Run from the repo root:
//   node --env-file=.env knowledge/ingest.js            # changed sources only (hash-based; embeds only new chunks)
//   node --env-file=.env knowledge/ingest.js --source guide,addis
//   node --env-file=.env knowledge/ingest.js --source news   # BinaSmart's own published articles (NewsPost table)
//   node --env-file=.env knowledge/ingest.js --no-embed  # chunk into the DB without calling Gemini
//   node --env-file=.env knowledge/ingest.js --check-masks  # read-only: count full personal mobiles in maskPhones sites
// Exits 1 if any chunk of a maskPhones site still holds a full personal mobile (printed as MASK VIOLATION lines).
// Safe to run any time: unchanged chunks cost nothing. Nightly cron calls it; a deploy can call it too.
const { PrismaClient } = require('@prisma/client');
const { makeKnowledge } = require('./index');

(async () => {
  const args = process.argv.slice(2);
  const src = (args.find(a => a.startsWith('--source')) || '').split('=')[1] || (args.includes('--source') ? args[args.indexOf('--source') + 1] : '');
  const only = src ? src.split(',').map(s => s.trim()).filter(Boolean) : null;
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY || '', log: m => console.log(m) });
  try {
    if (args.includes('--check-masks')) {   // read-only: is any full personal mobile left in a maskPhones site's chunks?
      const m = await k.checkMasks();
      for (const v of m.violations) console.log('[knowledge] MASK VIOLATION ' + v.source + ':' + v.slug + ' n=' + v.n);
      console.log('[knowledge] mask check: ' + m.checked + ' chunks of maskPhones sites, ' + m.violations.length + ' documents with a full mobile');
      if (m.violations.length) process.exitCode = 1;
      return;
    }
    const r = await k.ingest({ only, embed: !args.includes('--no-embed') });
    console.log(JSON.stringify(r));
    // tell the running API to reload its in-memory index (it also reloads itself every 10 minutes)
    try { await fetch('http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/knowledge/reload', { method: 'POST', headers: { 'x-owner-key': process.env.OWNER_KEY || '' } }); } catch (e) { /* API not running */ }
    // A personal mobile in a maskPhones site's chunks fails the run (the MASK VIOLATION lines are above), so the
    // weekly cron's log and exit status show it. The API is a separate process and is not affected.
    if (r.maskViolations && r.maskViolations.length) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[knowledge] ingest failed:', e.message); process.exit(1); });
