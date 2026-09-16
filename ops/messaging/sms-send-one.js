'use strict';
// GO-LIVE ONLY. NOT RUN IN PLAN A. One real SMS to one number, with Ibrahim's explicit permission for that number —
// the design's go-live step 2 (the account holds a 5-SMS test balance). Before running: Ibrahim has put SMS_API_TOKEN
// and SMS_MODE=live into .env; to keep the 04:00 UTC daily checks from texting Darulle tenants during the test, set
// Darulle's smsMonthlyLimit to 0 first and back afterwards.
//   node ops/messaging/sms-send-one.js --to <his number> --approved-by-ibrahim
// Goes through the delivery layer's transactional path (label "BinaSmart", recorded, text not stored). Prints the
// status and error kind only. It is transactional, like a sign-in code, so SMS_MODE=live is the only switch it needs:
// SMS_TENANT_MODE stays test and no tenant is touched by this one SMS.
function parseArgs(argv) {
  const i = argv.indexOf('--to');
  const to = i >= 0 ? argv[i + 1] : null;
  if (!to || to.startsWith('--') || !argv.includes('--approved-by-ibrahim')) return null;
  return { to };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) { console.error('usage: node ops/messaging/sms-send-one.js --to <number> --approved-by-ibrahim'); process.exitCode = 2; return; }
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const { makeSmsFromEnv } = require('../../messaging/sms');
  const { makeDelivery, makeDeliveryStore } = require('../../messaging/delivery');
  if (!process.env.SMS_API_TOKEN) { console.error('no SMS provider token in .env: nothing sent'); process.exitCode = 2; return; }
  const sms = makeSmsFromEnv(process.env, { log: m => console.log(m) });
  if (sms.mode !== 'live') { console.error('SMS is not live (SMS_MODE and SMS_API_TOKEN): nothing sent'); process.exitCode = 2; return; }
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const d = makeDelivery({ store: makeDeliveryStore(p), sendTg: async () => false, sms });
    const r = await d.sendTransactionalSms({ to: args.to, text: 'SMS test from bina.et · የሙከራ መልእክት', label: 'BinaSmart', kind: 'test', source: 'go-live-test', live: true });
    console.log('status ' + r.status + (r.errorKind ? ' · ' + r.errorKind : ''));
  } finally { await p.$disconnect(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { parseArgs };
