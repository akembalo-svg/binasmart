'use strict';
// Read-only: how SMS is set up. Mode, whether a provider token / shortcode / report secret exist (yes or no, never the
// values), each building's monthly limit and SMS parts this month with a cost estimate from the configured price tiers,
// this month's messages by channel and status, and with --balance the GeezSMS balance (numbers only). Sends nothing.
//   node ops/messaging/sms-status.js [--balance]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { makeSmsFromEnv, makeGeezSms, parsePriceTiers, smsUnitPrice } = require('../../messaging/sms');
const { addisMonthStart } = require('../../messaging/delivery');

(async () => {
  const p = new PrismaClient();
  try {
    const sms = makeSmsFromEnv(process.env);
    const tiers = parsePriceTiers(process.env.SMS_PRICE_TIERS);
    console.log('mode ' + sms.mode + ' · provider ' + (sms.provider || 'none') + ' · token ' + (process.env.SMS_API_TOKEN ? 'yes' : 'no')
      + ' · shortcode ' + (process.env.SMS_SHORTCODE_ID ? 'yes' : 'no (provider default)') + ' · report secret ' + ((process.env.SMS_CALLBACK_SECRET || '').length >= 24 ? 'yes' : 'no'));
    const since = addisMonthStart(new Date());
    const statuses = sms.mode === 'live' ? ['queued', 'sent', 'delivered'] : ['queued', 'sent', 'delivered', 'test'];
    const byBuilding = await p.outboundMessage.groupBy({ by: ['buildingId'], where: { channel: 'sms', status: { in: statuses }, createdAt: { gte: since } }, _sum: { smsParts: true } });
    const total = byBuilding.reduce((a, r) => a + (r._sum.smsParts || 0), 0);
    const price = smsUnitPrice(total, tiers);
    const used = new Map(byBuilding.map(r => [r.buildingId, r._sum.smsParts || 0]));
    // real buildings: NOTIFY_WHITELIST in server.js (today darulle only)
    for (const b of await p.building.findMany({ where: { qrSlug: { in: ['darulle'] } }, select: { id: true, qrSlug: true, smsMonthlyLimit: true, smsSender: true } }))
      console.log(b.qrSlug + ' · limit ' + b.smsMonthlyLimit + ' · parts this month ' + (used.get(b.id) || 0) + ' · sender ' + (b.smsSender ? 'set' : 'provider default'));
    console.log('all buildings · parts this month ' + total + ' · ' + price + ' ETB/SMS · estimate ' + (Math.round(total * price * 100) / 100) + ' ETB' + (sms.mode === 'test' ? ' (test rows, nothing was sent)' : ''));
    const month = await p.outboundMessage.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: true });
    console.log('this month · ' + (month.map(r => r.channel + '/' + r.status + ' ' + r._count).join(' · ') || 'no messages'));
    if (process.argv.includes('--balance')) {
      if (!process.env.SMS_API_TOKEN) console.log('balance · no token');
      else {
        const r = await makeGeezSms({ token: process.env.SMS_API_TOKEN }).balance();
        const nums = r.body && typeof r.body === 'object' ? Object.entries(r.body).filter(([, v]) => typeof v === 'number').map(([k, v]) => k + '=' + v) : [];
        console.log('balance · http ' + r.status + ' · ' + (nums.join(' ') || 'no numeric fields; field names: ' + Object.keys(r.body || {}).join(',')));
      }
    }
  } finally { await p.$disconnect(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
