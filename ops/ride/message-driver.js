#!/usr/bin/env node
'use strict';
// Send one message to one registered driver, through the driver bot he already talks to.
//
//   node --env-file=.env ops/ride/message-driver.js <driverId> --file message.txt
//   node --env-file=.env ops/ride/message-driver.js <driverId> --text "…"  [--dry]
//
// Why it exists: reviewing a registration often ends in "we need one more thing from you", and that
// has to reach the driver rather than sit in an ops note. It looks up the driver first, so a typo in
// an id fails instead of messaging a stranger, and it prints exactly what will be sent under --dry.
//
// One message per run, on purpose. A person waiting to be approved should not get a burst.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry');
const id = process.argv[2];
const TOKEN = process.env.BINA_DRIVER_BOT_TOKEN || '';

(async () => {
  if (!id || id.startsWith('--')) { console.error('usage: message-driver.js <driverId> --text "…" | --file f.txt [--dry]'); process.exit(1); }
  const file = arg('--file');
  const text = file ? fs.readFileSync(file, 'utf8').trim() : (arg('--text') || '').trim();
  if (!text) { console.error('nothing to send'); process.exit(1); }

  const prisma = new PrismaClient();
  try {
    const d = await prisma.driver.findUnique({ where: { id } });
    if (!d) { console.error('no driver with that id'); process.exit(1); }
    if (!d.telegramId) { console.error(d.name + ' has no telegram id — cannot message him'); process.exit(1); }

    console.log('to: ' + d.name + '  (' + d.phone + ', tg ' + d.telegramId + ', status ' + d.status + ')');
    console.log('---\n' + text + '\n---');
    if (DRY) { console.log('dry run — nothing sent.'); return; }
    if (!TOKEN) { console.error('BINA_DRIVER_BOT_TOKEN is not set'); process.exit(1); }

    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: d.telegramId, text, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => null);
    console.log(j && j.ok ? 'sent ✅  message ' + j.result.message_id : 'FAILED ❌ ' + JSON.stringify(j).slice(0, 300));
    if (!j || !j.ok) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
