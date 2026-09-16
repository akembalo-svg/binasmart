'use strict';
// Read-only: whether the phone sign-in door is open, and what it has done this month. Sends nothing,
// writes nothing, and prints no secret — a token, a pepper, a code and a phone number never appear,
// only whether each switch is there and how many rows there are.
//
//   node ops/auth/phone-code-status.js
//
// The month is the Addis Ababa calendar month, the same one the SMS limit and ops/messaging/
// sms-status.js use, so two reports about the same SMS never disagree about which month it was in.
const { addisMonthStart } = require('../../messaging/delivery');
const pc = require('../../auth/phone-code');

// The sign-in door depends on SMS_MODE only: a code is transactional, not a tenant message, so SMS_TENANT_MODE
// neither opens nor closes it. It is named here all the same, because somebody reading one line about SMS should not
// have to guess what the other switch is doing.
function doorLine(env) {
  const token = !!env.SMS_API_TOKEN;
  const live = env.SMS_MODE === 'live';
  const tenantLive = live && env.SMS_TENANT_MODE === 'live';
  const pepper = String(env.AUTH_PHONE_CODE_PEPPER || '').length >= pc.MIN_PEPPER;
  const ready = token && live && pepper;
  return { ready, line: 'phone sign-in · ' + (ready ? 'OPEN' : 'closed')
    + ' · sms mode ' + (live ? 'live' : 'test')
    + ' · tenant sms ' + (tenantLive ? 'live' : 'test')
    + ' · provider token ' + (token ? 'yes' : 'no')
    + ' · pepper ' + (pepper ? 'yes' : 'no') };
}

// rows: an OutboundMessage groupBy on status, for kind 'signin'.
function codesLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { total: 0, line: 'codes this month · none' };
  const total = list.reduce((n, r) => n + (Number(r._count) || 0), 0);
  return { total, line: 'codes this month · ' + list.map(r => r.status + ' ' + (Number(r._count) || 0)).join(' · ') + ' · ' + total + ' in all' };
}

async function run({ prisma, env, out = console.log, now = () => new Date() } = {}) {
  const door = doorLine(env || {});
  out(door.line);

  const rows = await prisma.outboundMessage.groupBy({
    by: ['status'], where: { kind: 'signin', createdAt: { gte: addisMonthStart(now()) } }, _count: true });
  const codes = codesLine(rows);
  out(codes.line);

  // A row is either a code somebody can still type or a number still locked out; both are "in play".
  const live = await prisma.authVerification.count({ where: { identifier: { startsWith: 'phonecode:' }, expiresAt: { gt: now() } } });
  out('codes or locks in play right now · ' + live);

  const accounts = await prisma.authUser.count({ where: { email: { endsWith: '@' + pc.PLACEHOLDER_DOMAIN } } });
  out('accounts created by a phone code · ' + accounts);

  return { ready: door.ready, codes: codes.total, live, accounts };
}

if (require.main === module) {
  require('dotenv/config');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run({ prisma, env: process.env })
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { run, doorLine, codesLine };
