#!/usr/bin/env node
'use strict';
// The owner's morning driver note: who was online during the busy hours, and what riders asked for.
//
//   node --env-file=.env ops/ride/driver-morning.js           print the note, send nothing
//   node --env-file=.env ops/ride/driver-morning.js --send    print it and send it to the owner's admin chat
//
// Cron 06:30 UTC (09:30 Addis). The owner phoned drivers on 25 September 2026 to ask each for a time they would be
// online; this answers "did they?" every morning without anyone asking. Online is measured from the location
// pings the driver app stores (DriverLocation), not the online flag: a flag left on for three days while the phone
// sat in a drawer (Fetiya, 21-24 September) is not a driver waiting for riders.
// Sent to the owner only (BINASMART_ADMIN_TG_CHAT). Nothing goes to any driver or channel.
const SEND = process.argv.includes('--send');
const ADDIS_MS = 3 * 3600 * 1000;

const hhmm = d => new Date(d.getTime() + ADDIS_MS).toISOString().slice(11, 16);
function windows(now) {
  // Today's morning peak 07:00-09:00 Addis and yesterday's evening peak 17:00-20:00 Addis, in UTC.
  const addis = new Date(now.getTime() + ADDIS_MS);
  const day = Date.UTC(addis.getUTCFullYear(), addis.getUTCMonth(), addis.getUTCDate()) - ADDIS_MS;   // 00:00 Addis today, in UTC ms
  return [
    { name: 'ትናንት ማታ 11:00–2:00 (5–8 PM)', from: new Date(day - 24 * 3600e3 + 17 * 3600e3), to: new Date(day - 24 * 3600e3 + 20 * 3600e3) },
    { name: 'ዛሬ ጠዋት 1:00–3:00 (7–9 AM)', from: new Date(day + 7 * 3600e3), to: new Date(day + 9 * 3600e3) },
  ];
}

async function build(prisma, now = new Date()) {
  const W = windows(now);
  const drivers = await prisma.driver.findMany({ where: { status: 'approved' }, select: { id: true, name: true, tier: true, lastSeenAt: true }, orderBy: { createdAt: 'asc' } });
  const lines = ['🚕 <b>ቢና ራይድ — የሹፌሮች ሪፖርት</b> · ' + now.toISOString().slice(0, 10), ''];
  let anyOnline = 0;
  for (const w of W) {
    lines.push('<b>' + w.name + '</b>');
    for (const d of drivers) {
      const pings = await prisma.driverLocation.findMany({ where: { driverId: d.id, at: { gte: w.from, lt: w.to } }, select: { at: true }, orderBy: { at: 'asc' } });
      const first = (d.name || '').split(' ')[0] || 'driver';
      if (pings.length) { anyOnline++; lines.push('  ✅ ' + first + ' (' + d.tier + ') ' + hhmm(pings[0].at) + '–' + hhmm(pings[pings.length - 1].at)); }
      else lines.push('  ⚪ ' + first + ' (' + d.tier + ') — አልገባም · not online');
    }
    lines.push('');
  }
  const since = new Date(now.getTime() - 24 * 3600e3);
  const rides = await prisma.ride.findMany({ where: { requestedAt: { gte: since } }, select: { status: true, cancelledBy: true, tier: true } });
  const done = rides.filter(r => r.status === 'completed').length;
  const nodriver = rides.filter(r => r.cancelledBy === 'nodriver').length;
  lines.push('🙋 ባለፉት 24 ሰዓታት፦ ' + rides.length + ' ጉዞ ተጠይቋል · ' + done + ' ተጠናቋል' + (nodriver ? ' · ' + nodriver + ' ሹፌር ስላልተገኘ ተሰርዟል' : ''));
  lines.push(anyOnline ? '' : '👉 ማንም አልገባም — ሹፌሮቹን መደወል ያስፈልጋል። Nobody was online: the drivers need a call.');
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
}

async function tellOwner(text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN, chat = process.env.BINASMART_ADMIN_TG_CHAT;
  if (!tok || !chat) throw new Error('no bot token or admin chat configured');
  const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  return (await r.json()).ok === true;
}

if (require.main === module) (async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const text = await build(prisma);
    console.log(text);
    if (SEND) console.log(await tellOwner(text) ? 'sent' : 'send failed');
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { build, windows };
