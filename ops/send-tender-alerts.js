#!/usr/bin/env node
'use strict';
// Send each tender-alert subscriber the new open tenders of their kind (tenders/alerts.js).
//
//   node --env-file=.env ops/send-tender-alerts.js --dry-run     print the messages, send nothing
//   node --env-file=.env ops/send-tender-alerts.js               send
//
// Cron 07:30 UTC (10:30 Addis), after the 07:00 autopublish run puts the morning's tenders on the board.
// Nobody receives the archive: a subscription starts counting from the moment it is made.
const { PrismaClient } = require('@prisma/client');
const { openSince, isClosed } = require('../tenders/deadline');
const { makeTenderAlerts } = require('../tenders/alerts');

const DRY = process.argv.includes('--dry-run');
const TOKEN = process.env.BINA_RIDER_BOT_TOKEN;   // @bina_smart_bot, the chat people already use

const api = {
  async sendMessage(chatId, text, opts = {}) {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...opts }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(JSON.stringify(j.description || j).slice(0, 120));
    return j.result;
  },
};

(async () => {
  if (!TOKEN && !DRY) { console.error('[tender-alerts] no bot token'); process.exit(1); }
  const prisma = new PrismaClient();
  try {
    const out = await makeTenderAlerts({ prisma, api, openSince, isClosed }).sendDue({ dry: DRY });
    console.log('[tender-alerts] subscribers ' + out.alerts + ' · sent ' + out.sent + ' · nothing new ' + out.quiet + ' · failed ' + out.failed);
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[tender-alerts] failed: ' + e.message); process.exit(1); });
