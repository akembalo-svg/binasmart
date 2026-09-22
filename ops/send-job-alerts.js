#!/usr/bin/env node
'use strict';
// Every morning: send each subscriber the vacancies in their field that they have not seen.
//
//   node --env-file=.env ops/send-job-alerts.js --dry-run     print the messages, send nothing
//   node --env-file=.env ops/send-job-alerts.js               send
//
// Runs after the harvest (jobs/daily.sh at 04:40 UTC), so the morning's new vacancies are already in.
// Nobody receives the archive: a subscription starts counting from the moment it is made.
const { PrismaClient } = require('@prisma/client');
const { openSince, isClosed } = require('../tenders/deadline');
const { makeJobAlerts } = require('../jobs/alerts');

const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.BINA_RIDER_BOT_TOKEN;   // @bina_smart_bot — the chat people already use

const api = {
  async sendMessage(chatId, text, opts = {}) {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...opts }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(JSON.stringify(j.description || j).slice(0, 120));
    return j.result;
  },
};

(async () => {
  if (!TOKEN && !DRY) { console.error('[alerts] no bot token'); process.exit(1); }
  const prisma = new PrismaClient();
  try {
    const alerts = makeJobAlerts({ prisma, api, openSince, isClosed });
    const out = await alerts.sendDue({ dry: DRY });
    console.log('[alerts] subscribers ' + out.alerts + ' · sent ' + out.sent
      + ' · nothing new ' + out.quiet + ' · failed ' + out.failed);
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[alerts] failed: ' + e.message); process.exit(1); });
