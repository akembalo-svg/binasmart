#!/usr/bin/env node
'use strict';
// New vacancies → the BinaSmart Telegram channel.
//
//   node --env-file=.env jobs/announce.js --dry-run      print the exact post, send nothing
//   node --env-file=.env jobs/announce.js                post one batch
//
// The design decision that matters: this does NOT post one message per vacancy. The board takes 200+
// new adverts a day; a channel that fires 200 times is a channel people mute, and then the vacancies
// reach nobody. So new vacancies go out in batches - a handful of posts a day, each one a readable list
// of what is new, with the link to the board.
//
// News and tenders already post individually (server.js autopostAll) and that stays: they are a few a
// day and each one is its own event.
//
// What goes in a post: the newest open vacancies we have not announced yet, the company for each, and
// nothing we are unsure of. A vacancy whose deadline has passed is never announced - announcing a closed
// job wastes the reader's evening and teaches them the channel is stale.
const MAX_PER_POST = 12;
const CHANNEL = process.env.BINA_TG_CHANNEL;
const TOKEN = process.env.BINASMART_TG_TOKEN;
const SITE = 'https://bina.et';

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();

const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

async function sendTg(text) {
  const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHANNEL, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('telegram: ' + JSON.stringify(j).slice(0, 200));
  return j.result && j.result.message_id;
}

// One post, in both languages, because the channel is read in both.
function compose(jobs, totalOpen) {
  const lines = jobs.map(j => {
    // Some adverts carry a whole paragraph as their title ("Re-Advertised TOR for Recruitment of
    // Consultants for the Development of..."). In a channel post that buries the eleven vacancies under
    // it, so it is cut - the full title is one tap away on the page.
    const full = (j.title || j.titleAm || '').replace(/\s+/g, ' ').trim();
    const title = esc(full.length > 72 ? full.slice(0, 69).replace(/[\s,;:–-]+$/, '') + '…' : full);
    const where = j.city && j.city !== 'Addis Ababa' ? ' · ' + esc(j.city) : '';
    return '• <a href="' + SITE + '/jobs/' + j.slug + '">' + title + '</a> — ' + esc(j.employer.name) + where;
  });
  return [
    '🆕 <b>' + jobs.length + ' አዲስ ክፍት የሥራ ቦታዎች · ' + jobs.length + ' new vacancies</b>',
    '',
    lines.join('\n'),
    '',
    '📋 ሁሉም ' + totalOpen + ' ክፍት ሥራዎች · all ' + totalOpen + ' open jobs:',
    SITE + '/jobs',
    '',
    'በየቀኑ ይታደሣል · updated every day',
  ].join('\n');
}

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const { openSince, isClosed } = require('../tenders/deadline');
  try {
    if (!DRY && (!CHANNEL || !TOKEN)) { console.error('[announce] no channel or token configured'); process.exit(1); }

    const now = new Date();
    const fresh = (await prisma.job.findMany({
      where: { published: true, announcedAt: null,
        OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      include: { employer: { select: { name: true } } },
      orderBy: { publishedAt: 'desc' },
      take: (LIMIT || MAX_PER_POST) * 3,
    })).filter(j => !isClosed(j.deadline, now));

    if (!fresh.length) { console.log('[announce] nothing new to announce'); return; }

    const batch = fresh.slice(0, LIMIT || MAX_PER_POST);
    const totalOpen = (await prisma.job.findMany({
      where: { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      select: { deadline: true },
    })).filter(j => !isClosed(j.deadline, now)).length;

    const text = compose(batch, totalOpen);
    if (DRY) {
      console.log('--- would post to ' + (CHANNEL || '(no channel set)') + ' ---\n');
      console.log(text);
      console.log('\n--- ' + (fresh.length) + ' unannounced vacancies waiting, ' + batch.length + ' in this post ---');
      return;
    }

    await sendTg(text);
    // Marked only after Telegram accepted the post: a failed send must not silently swallow the
    // vacancies, or they are never announced and nobody can tell why.
    await prisma.job.updateMany({ where: { id: { in: batch.map(j => j.id) } }, data: { announcedAt: new Date() } });
    console.log('[announce] posted ' + batch.length + ' vacancies, ' + (fresh.length - batch.length) + ' still waiting');
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[announce] failed: ' + e.message); process.exit(1); });
