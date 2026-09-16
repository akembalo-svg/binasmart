'use strict';
// Read-only: how SMS is set up. Mode, whether a provider token / shortcode / report secret exist (yes or no, never the
// values), each building's monthly limit and SMS parts this month with a cost estimate from the configured price tiers,
// this month's messages by channel and status, the batches behind them by kind, and with --balance the GeezSMS balance
// (numbers only). Sends nothing, writes nothing.
//   node ops/messaging/sms-status.js [--balance]
//
// The batch line is the ops view of what the owner's Messages tab shows (design §4). It is here rather than in a second
// script because everything else about the month is already here; per-building and per-action detail belongs to
// ops/owner/actions.js list, which is not duplicated.
const KIND_ORDER = ['notice', 'reminder', 'invoice', 'receipt'];

// rows: an OutboundBatch groupBy on kind. Known kinds first in a fixed order, then anything else as it came.
function batchLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 'batches this month · none';
  const rank = k => { const i = KIND_ORDER.indexOf(k); return i === -1 ? KIND_ORDER.length : i; };
  const sorted = list.slice().sort((a, b) => rank(a.kind) - rank(b.kind));
  const total = sorted.reduce((n, r) => n + (Number(r._count) || 0), 0);
  return 'batches this month · ' + sorted.map(r => r.kind + ' ' + (Number(r._count) || 0)).join(' · ') + ' · ' + total + ' in all';
}

async function run({ prisma: p, env, out = console.log, balance = false }) {
  const { makeSmsFromEnv, makeGeezSms, parsePriceTiers, smsUnitPrice } = require('../../messaging/sms');
  const { addisMonthStart } = require('../../messaging/delivery');
  const sms = makeSmsFromEnv(env);
  const tiers = parsePriceTiers(env.SMS_PRICE_TIERS);
  out('mode ' + sms.mode + ' · provider ' + (sms.provider || 'none') + ' · token ' + (env.SMS_API_TOKEN ? 'yes' : 'no')
    + ' · shortcode ' + (env.SMS_SHORTCODE_ID ? 'yes' : 'no (provider default)')
    + ' · report secret ' + ((env.SMS_CALLBACK_SECRET || '').length >= 24 ? 'yes' : 'no'));
  const since = addisMonthStart(new Date());
  const statuses = sms.mode === 'live' ? ['queued', 'sent', 'delivered'] : ['queued', 'sent', 'delivered', 'test'];
  const byBuilding = await p.outboundMessage.groupBy({ by: ['buildingId'], where: { channel: 'sms', status: { in: statuses }, createdAt: { gte: since } }, _sum: { smsParts: true } });
  const total = byBuilding.reduce((a, r) => a + (r._sum.smsParts || 0), 0);
  const price = smsUnitPrice(total, tiers);
  const used = new Map(byBuilding.map(r => [r.buildingId, r._sum.smsParts || 0]));
  // real buildings: NOTIFY_WHITELIST in server.js (today darulle only)
  for (const b of await p.building.findMany({ where: { qrSlug: { in: ['darulle'] } }, select: { id: true, qrSlug: true, smsMonthlyLimit: true, smsSender: true } }))
    out(b.qrSlug + ' · limit ' + b.smsMonthlyLimit + ' · parts this month ' + (used.get(b.id) || 0) + ' · sender ' + (b.smsSender ? 'set' : 'provider default'));
  out('all buildings · parts this month ' + total + ' · ' + price + ' ETB/SMS · estimate ' + (Math.round(total * price * 100) / 100) + ' ETB' + (sms.mode === 'test' ? ' (test rows, nothing was sent)' : ''));
  const month = await p.outboundMessage.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: true });
  out('this month · ' + (month.map(r => r.channel + '/' + r.status + ' ' + r._count).join(' · ') || 'no messages'));
  out(batchLine(await p.outboundBatch.groupBy({ by: ['kind'], where: { createdAt: { gte: since } }, _count: true })));
  if (balance) {
    if (!env.SMS_API_TOKEN) out('balance · no token');
    else {
      const r = await makeGeezSms({ token: env.SMS_API_TOKEN }).balance();
      const nums = r.body && typeof r.body === 'object' ? Object.entries(r.body).filter(([, v]) => typeof v === 'number').map(([k, v]) => k + '=' + v) : [];
      out('balance · http ' + r.status + ' · ' + (nums.join(' ') || 'no numeric fields; field names: ' + Object.keys(r.body || {}).join(',')));
    }
  }
  return { ok: true };
}

module.exports = { batchLine, run, KIND_ORDER };

// Nothing above this line reads the environment or opens a connection, so the tests can require this file.
if (require.main === module) {
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run({ prisma, env: process.env, balance: process.argv.includes('--balance') })
    .catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
