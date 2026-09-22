'use strict';
// "Tell me when a job in my field opens."
//
// The board holds thousands of vacancies and almost nobody comes back: a job seeker searches once and
// forgets the site exists. This is the other direction — they choose a field once, and the vacancies
// that matter to them arrive every morning in Telegram.
//
// Two rules the design turns on:
//   · A new subscriber never receives the archive. lastSentAt starts at the moment they subscribe, so
//     the first message they get is genuinely new work, not a dump of everything we hold.
//   · A closed vacancy is never sent. An alert that wastes somebody's morning teaches them to mute us,
//     and then nothing reaches them at all.
//
// Subscribing happens in @bina_smart_bot (ride/binaBot.js): the jobs page links to
// t.me/bina_smart_bot?start=jobs_<field>, which is a normal Telegram deep link — no login, no form.
const { CATEGORIES, BY_SLUG, label } = require('./categories');

const MAX_PER_MESSAGE = 8;
const SITE = 'https://bina.et';
const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function makeJobAlerts({ prisma, api, openSince, isClosed }) {
  // `api` is the rider bot's Telegram client (ride/index.js passes it), so alerts arrive in the same
  // chat the person already uses for rides, cinema and Bini.

  async function subscribe({ chatId, field, city, lang }) {
    const f = String(field || 'all').toLowerCase().trim();
    if (f !== 'all' && !BY_SLUG.get(f)) return { ok: false, error: 'unknown_field' };
    const row = await prisma.jobAlert.upsert({
      where: { chatId_field: { chatId: String(chatId), field: f } },
      update: { active: true, city: city || null, lang: lang || 'am', lastSentAt: new Date() },
      create: { chatId: String(chatId), field: f, city: city || null, lang: lang || 'am' },
    });
    return { ok: true, field: f, id: row.id };
  }

  async function stop(chatId) {
    const n = await prisma.jobAlert.updateMany({ where: { chatId: String(chatId), active: true }, data: { active: false } });
    return n.count;
  }

  async function listFor(chatId) {
    return prisma.jobAlert.findMany({ where: { chatId: String(chatId), active: true }, orderBy: { createdAt: 'asc' } });
  }

  // What this subscriber has not been sent yet, still open, newest first.
  async function dueFor(alert, now = new Date()) {
    const where = {
      published: true,
      publishedAt: { gt: alert.lastSentAt },
      OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }],
    };
    if (alert.field !== 'all') where.category = alert.field;
    if (alert.city) where.city = { contains: alert.city, mode: 'insensitive' };
    const rows = await prisma.job.findMany({
      where, include: { employer: { select: { name: true } } },
      orderBy: { publishedAt: 'desc' }, take: MAX_PER_MESSAGE * 3,
    });
    return rows.filter(j => !isClosed(j.deadline, now)).slice(0, MAX_PER_MESSAGE);
  }

  function compose(alert, jobs, total) {
    const am = alert.lang !== 'en';
    const name = alert.field === 'all' ? (am ? 'ሁሉም ዘርፎች' : 'all fields') : label(alert.field, am ? 'am' : 'en');
    const head = am
      ? '🔔 <b>' + jobs.length + ' አዲስ ክፍት የሥራ ቦታ</b> — ' + esc(name)
      : '🔔 <b>' + jobs.length + ' new ' + esc(name) + ' vacanc' + (jobs.length === 1 ? 'y' : 'ies') + '</b>';
    const lines = jobs.map(j => {
      const t = (j.title || j.titleAm || '').replace(/\s+/g, ' ').trim();
      const title = esc(t.length > 70 ? t.slice(0, 67) + '…' : t);
      const where = j.city && j.city !== 'Addis Ababa' ? ' · ' + esc(j.city) : '';
      return '• <a href="' + SITE + '/jobs/' + j.slug + '">' + title + '</a> — ' + esc(j.employer.name) + where;
    });
    const more = total > jobs.length ? (am ? '\n\n… እና ሌሎች ' + (total - jobs.length) : '\n\n… and ' + (total - jobs.length) + ' more') : '';
    const foot = alert.field === 'all'
      ? SITE + '/jobs'
      : SITE + '/jobs/category/' + alert.field;
    return [head, '', lines.join('\n') + more, '',
      (am ? '📋 ሁሉንም ይመልከቱ፦ ' : '📋 See them all: ') + foot,
      (am ? '🔕 ለማቆም /stopjobs' : '🔕 /stopjobs to stop')].join('\n');
  }

  // Sends one batch to everyone due. Returns what happened, for the cron log.
  async function sendDue({ now = new Date(), limit = 500, dry = false, log = console.log } = {}) {
    const alerts = await prisma.jobAlert.findMany({ where: { active: true }, orderBy: { lastSentAt: 'asc' }, take: limit });
    let sent = 0, quiet = 0, failed = 0;
    for (const a of alerts) {
      const jobs = await dueFor(a, now);
      if (!jobs.length) { quiet++; continue; }
      const text = compose(a, jobs, jobs.length);
      if (dry) { log('--- to ' + a.chatId + ' (' + a.field + ')\n' + text + '\n'); sent++; continue; }
      const ok = await api.sendMessage(a.chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true })
        .then(() => true).catch(e => { log('  !! ' + a.chatId + ': ' + String(e.message).slice(0, 80)); return false; });
      if (ok) {
        await prisma.jobAlert.update({ where: { id: a.id }, data: { lastSentAt: now, sentCount: { increment: 1 } } });
        sent++;
      } else {
        // A blocked bot or a deleted chat should stop costing us a call every morning.
        failed++;
        await prisma.jobAlert.update({ where: { id: a.id }, data: { active: false } }).catch(() => {});
      }
    }
    return { alerts: alerts.length, sent, quiet, failed };
  }

  return { subscribe, stop, listFor, dueFor, compose, sendDue, CATEGORIES };
}

module.exports = { makeJobAlerts, MAX_PER_MESSAGE };
