'use strict';
// "Tell me when a tender in my line of business opens" - the job alerts (jobs/alerts.js) for businesses.
//
// A supplier who bids for government work checks the board every day or misses the tender that closes on
// Friday. This is the other direction: they pick a kind of tender once in @bina_smart_bot, and each new open
// tender of that kind arrives in the chat the day it is published. Same two rules as the job alerts:
//   · a new subscriber never receives the archive (lastSentAt starts at the moment they subscribe);
//   · a closed tender is never sent.
//
// The board's category field is not one vocabulary: harvesters wrote "አቅርቦት Supply" and "Supply" for the same
// thing (192 and 25 open tenders on 25 September 2026). CATS maps every spelling to one slug by its words, so a
// subscriber to "supply" gets both, and a new spelling lands in the right place without a data migration.
const MAX_PER_MESSAGE = 8;
const SITE = 'https://bina.et';
const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const CATS = [
  { slug: 'supply', am: 'አቅርቦት', en: 'Supply of goods', re: /supply|አቅርቦት/i },
  { slug: 'construction', am: 'ግንባታ', en: 'Construction and works', re: /construct|works|ግንባታ/i },
  { slug: 'consultancy', am: 'ማማከር', en: 'Consultancy', re: /consult|ማማከር/i },
  { slug: 'services', am: 'አገልግሎት', en: 'Services', re: /service|አገልግሎት/i },
  { slug: 'disposal', am: 'ሽያጭ ጨረታ', en: 'Sales and disposal auctions', re: /dispos|auction|ሽያጭ/i },
  { slug: 'transport', am: 'ትራንስፖርት', en: 'Transport', re: /transport|ትራንስፖርት/i },
];
const BY_SLUG = new Map(CATS.map(c => [c.slug, c]));
const catOf = category => (CATS.find(c => c.re.test(String(category || ''))) || {}).slug || null;
const labelOf = (slug, lang) => (slug === 'all' ? (lang === 'en' ? 'all tenders' : 'ሁሉም ጨረታዎች') : (BY_SLUG.get(slug) || {})[lang === 'en' ? 'en' : 'am'] || slug);

function makeTenderAlerts({ prisma, api, openSince, isClosed }) {
  async function subscribe({ chatId, cat, lang }) {
    const c = String(cat || 'all').toLowerCase().trim();
    if (c !== 'all' && !BY_SLUG.get(c)) return { ok: false, error: 'unknown_category' };
    const row = await prisma.tenderAlert.upsert({
      where: { chatId_cat: { chatId: String(chatId), cat: c } },
      update: { active: true, lang: lang || 'am', lastSentAt: new Date() },
      create: { chatId: String(chatId), cat: c, lang: lang || 'am' },
    });
    return { ok: true, cat: c, id: row.id };
  }
  async function stop(chatId) {
    return (await prisma.tenderAlert.updateMany({ where: { chatId: String(chatId), active: true }, data: { active: false } })).count;
  }
  async function listFor(chatId) {
    return prisma.tenderAlert.findMany({ where: { chatId: String(chatId), active: true }, orderBy: { createdAt: 'asc' } });
  }

  // New since this subscriber was last sent anything, still open, of their kind, soonest closing first.
  async function dueFor(alert, now = new Date()) {
    const rows = await prisma.tender.findMany({
      where: { published: true, publishedAt: { gt: alert.lastSentAt }, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }], take: 200,
    });
    return rows.filter(t => !isClosed(t.deadline, now) && (alert.cat === 'all' || catOf(t.category) === alert.cat));
  }

  function compose(alert, tenders) {
    const am = alert.lang !== 'en';
    const shown = tenders.slice(0, MAX_PER_MESSAGE);
    const day = d => new Date(d).toISOString().slice(0, 10);
    const lines = shown.map(t => {
      const title = String(t.titleAm || t.title).replace(/\s+/g, ' ').trim();
      return '• <a href="' + SITE + '/tenders/' + t.slug + '">' + esc(title.length > 80 ? title.slice(0, 77) + '…' : title) + '</a> — ' + esc(t.org)
        + (t.deadline ? (am ? ' · እስከ ' : ' · closes ') + day(t.deadline) : '');
    });
    const more = tenders.length > shown.length ? (am ? '\n… እና ሌሎች ' : '\n… and ') + (tenders.length - shown.length) + (am ? '' : ' more') : '';
    return [(am ? '📋 <b>' + tenders.length + ' አዲስ ጨረታ</b> — ' : '📋 <b>' + tenders.length + ' new tender' + (tenders.length === 1 ? '' : 's') + '</b> — ') + esc(labelOf(alert.cat, alert.lang)),
      '', lines.join('\n') + more, '',
      (am ? '📋 ሁሉንም ይመልከቱ፦ ' : '📋 See them all: ') + SITE + '/tenders',
      (am ? '🔕 ለማቆም /stoptenders' : '🔕 /stoptenders to stop')].join('\n');
  }

  async function sendDue({ now = new Date(), limit = 500, dry = false, log = console.log } = {}) {
    const alerts = await prisma.tenderAlert.findMany({ where: { active: true }, orderBy: { lastSentAt: 'asc' }, take: limit });
    let sent = 0, quiet = 0, failed = 0;
    for (const a of alerts) {
      const due = await dueFor(a, now);
      if (!due.length) { quiet++; continue; }
      const text = compose(a, due);
      if (dry) { log('--- to ' + a.chatId + ' (' + a.cat + ')\n' + text + '\n'); sent++; continue; }
      const ok = await api.sendMessage(a.chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true })
        .then(() => true).catch(e => { log('  !! ' + a.chatId + ': ' + String(e.message).slice(0, 80)); return false; });
      if (ok) { await prisma.tenderAlert.update({ where: { id: a.id }, data: { lastSentAt: now, sentCount: { increment: 1 } } }); sent++; }
      else { failed++; await prisma.tenderAlert.update({ where: { id: a.id }, data: { active: false } }).catch(() => {}); }
    }
    return { alerts: alerts.length, sent, quiet, failed };
  }

  return { subscribe, stop, listFor, dueFor, compose, sendDue, CATS };
}

module.exports = { makeTenderAlerts, CATS, BY_SLUG, catOf, labelOf, MAX_PER_MESSAGE };
