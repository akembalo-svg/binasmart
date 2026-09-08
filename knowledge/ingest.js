#!/usr/bin/env node
'use strict';
// Build or refresh the knowledge index. Run from the repo root:
//   node --env-file=.env knowledge/ingest.js            # changed sources only (hash-based; embeds only new chunks)
//   node --env-file=.env knowledge/ingest.js --source guide,addis
//   node --env-file=.env knowledge/ingest.js --no-embed  # chunk into the DB without calling Gemini
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
    const r = await k.ingest({ only, embed: !args.includes('--no-embed') });
    console.log(JSON.stringify(r));
    // tell the running API to reload its in-memory index (it also reloads itself every 10 minutes)
    try { await fetch('http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/knowledge/reload', { method: 'POST', headers: { 'x-owner-key': process.env.OWNER_KEY || '' } }); } catch (e) { /* API not running */ }
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[knowledge] ingest failed:', e.message); process.exit(1); });
