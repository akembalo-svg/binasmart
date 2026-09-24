'use strict';
// The @binasmart channel: two posts a day (Ibrahim, 2026-09-24). The channel had fallen from 843 to 736
// subscribers while posting 17 times a day (four job batches, foreign AI news, reminders) at 4-10 views
// a post. Now:
//   morning (07:30 Addis)  ቢና ጠዋት — new jobs, tenders closing soon, the day's top story (or a tip)
//   evening (18:30 Addis)  ቢኒ መለሰ — one common question, answered from a sourced BinaSmart guide
// Every post carries buttons back to bina.et. Totals and public listings only; nothing about any person.
//
//   node ops/channel/digest.js morning            print it
//   node ops/channel/digest.js evening --send     print it and post it (once a day per slot)
const fs = require('fs');
const path = require('path');
const { gregToEth } = require('../../assistant/dates');

const ETH_MONTHS = ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];
const ETH_DAYS = ['እሑድ', 'ሰኞ', 'ማክሰኞ', 'ረቡዕ', 'ሐሙስ', 'ዓርብ', 'ቅዳሜ'];
const ADDIS_MS = 3 * 3600 * 1000;
const QA = JSON.parse(fs.readFileSync(path.join(__dirname, 'qa.json'), 'utf8'));
const SKIP_CATEGORIES = ['ቴክኖሎጂ'];   // foreign tech and AI news goes to LinkedIn, not the channel

const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cut = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };

// A date as an Addis reader says it: Ethiopian calendar, ዓ.ም. only on the long form.
function addisDay(now) { const d = new Date(now + ADDIS_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() }; }
function ethLong(now) {
  const a = addisDay(now), e = gregToEth(a.y, a.m, a.d);
  return ETH_DAYS[a.wd] + ' ' + ETH_MONTHS[e.m - 1] + ' ' + e.d + ' ቀን ' + e.y + ' ዓ.ም';
}
function ethShort(date) {
  const a = addisDay(new Date(date).getTime()), e = gregToEth(a.y, a.m, a.d);
  return ETH_MONTHS[e.m - 1] + ' ' + e.d;
}
function dayIndex(now) { return Math.floor((now + ADDIS_MS) / 86400000); }

// "Hosea Real Estate for fresh graduates" is how the source names the advert; say it once, in Amharic.
function jobLine(j) {
  const fresh = /fresh\s*graduates?/i.test((j.employer || '') + ' ' + j.title);
  const who = String(j.employer || '').replace(/\s*[-–—]?\s*for fresh\s*graduates?/i, '').trim();
  return '• ' + esc(cut(j.title, 60)) + (who ? ' — ' + esc(cut(who, 40)) : '')
    + (j.deadline ? ' (እስከ ' + ethShort(j.deadline) + ')' : '') + (fresh ? ' · ለአዲስ ምሩቃን' : '');
}
function tenderLine(t) {
  return '• ' + esc(cut(t.title, 70)) + (t.org ? ' — ' + esc(cut(t.org, 45)) : '') + ' (' + ethShort(t.deadline) + ')';
}

function morningText({ now, jobsNew, jobsOpen, jobs, tendersOpen, closing, story, tip }) {
  const L = ['☀️ <b>ቢና ጠዋት</b> · ' + ethLong(now), ''];
  if (jobs.length) {
    L.push('💼 <b>' + (jobsNew ? 'ዛሬ ' + jobsNew + ' አዲስ ሥራ' : 'አዳዲስ ሥራዎች') + '</b> — ከ' + jobsOpen.toLocaleString('en-US') + ' ክፍት ቦታዎች');
    jobs.forEach(j => L.push(jobLine(j)));
    L.push('');
  }
  if (closing.length) {
    L.push('📋 <b>በቅርቡ የሚዘጉ ጨረታዎች</b> (ከ' + tendersOpen + ' ክፍት)');
    closing.forEach(t => L.push(tenderLine(t)));
    L.push('');
  }
  if (story) L.push('📰 ' + esc(cut(story.title, 110)) + '\n' + story.url);
  else if (tip) L.push('💡 <b>የዛሬ ጥቆማ፦</b> ' + esc(tip.tip));
  // Once a week, Monday: companies can put their own address and map pin on their page (jobs/claim.js). Weekly,
  // not daily - the channel lost subscribers when it posted too much (2026-09-23), and a line every morning is noise.
  if (addisDay(now).wd === 1) L.push('', '🏢 <b>ድርጅትዎ በቢና ላይ አለ?</b> ገጽዎን በ bina.et/employers ያግኙና «ይህ የእርስዎ ድርጅት ነው?» በመጫን ትክክለኛ አድራሻዎንና የካርታ ቦታዎን በነጻ ያክሉ — ሥራ ፈላጊዎች ትክክለኛው በር ላይ ይደርሳሉ።');
  return L.join('\n').trim();
}
function morningButtons() {
  return [[{ text: '💼 ሁሉም ሥራዎች', url: 'https://bina.et/jobs' }, { text: '📋 ሁሉም ጨረታዎች', url: 'https://bina.et/tenders' }],
          [{ text: '🔔 የሥራ ማሳወቂያ', url: 'https://bina.et/jobs/alert/all' }, { text: '💬 ቢኒን ይጠይቁ', url: 'https://bina.et/go' }]];
}

function eveningText(qa) {
  return ['💬 <b>ቢኒ መለሰ</b> · Bini answered', '', '❓ «' + esc(qa.q) + '»', '✅ ' + esc(qa.a), '📌 ምንጭ፦ ' + esc(qa.source), '',
    'የራስዎ ጥያቄ አለዎት? 👇'].join('\n');
}
function eveningButtons(qa) {
  const share = 'https://t.me/share/url?url=' + encodeURIComponent(qa.page) + '&text=' + encodeURIComponent('❓ ' + qa.q + '\n✅ ' + qa.a);
  return [[{ text: '💬 ቢኒን ይጠይቁ', url: 'https://bina.et/go?q=' + encodeURIComponent(qa.q) + '&s=channel' },
           { text: '📖 ሙሉ መመሪያ', url: qa.page }],
          [{ text: '↗ ለጓደኛ ያጋሩ', url: share }]];
}
// The evening answer and the morning tip never fall on the same fact on the same day.
function qaFor(now, slot) { return QA[(dayIndex(now) + (slot === 'morning' ? Math.floor(QA.length / 2) : 0)) % QA.length]; }

async function gather(prisma, now) {
  const since = new Date(now - 24 * 3600 * 1000), open = { published: true, OR: [{ deadline: null }, { deadline: { gte: new Date(now) } }] };
  const fresh = await prisma.job.findMany({ where: { ...open, publishedAt: { gte: since } }, orderBy: { publishedAt: 'desc' }, take: 40, include: { employer: { select: { name: true } } } });
  const pool = fresh.length ? fresh : await prisma.job.findMany({ where: open, orderBy: { publishedAt: 'desc' }, take: 40, include: { employer: { select: { name: true } } } });
  const seen = new Set(), jobs = [];
  for (const j of pool) {                          // three adverts from three different employers
    const who = j.employer && j.employer.name;
    if (!who || seen.has(who)) continue;
    seen.add(who); jobs.push({ title: j.title, employer: who, deadline: j.deadline });
    if (jobs.length === 3) break;
  }
  const soon = new Date(now + 3 * 86400000);
  const tenders = await prisma.tender.findMany({ where: { published: true, deadline: { gte: new Date(now), lte: soon } }, orderBy: { deadline: 'asc' }, take: 2 });
  const stories = await prisma.newsPost.findMany({ where: { published: true, publishedAt: { gte: new Date(now - 36 * 3600 * 1000) } }, orderBy: { publishedAt: 'desc' }, take: 10 });
  const s = stories.find(p => !SKIP_CATEGORIES.includes(p.category));
  return {
    jobsNew: fresh.length >= 40 ? await prisma.job.count({ where: { ...open, publishedAt: { gte: since } } }) : fresh.length,
    jobsOpen: await prisma.job.count({ where: open }), jobs,
    tendersOpen: await prisma.tender.count({ where: { published: true, deadline: { gte: new Date(now) } } }),
    closing: tenders.map(t => ({ title: t.title || t.titleAm, org: t.org || t.organization || t.buyer || t.issuer || '', deadline: t.deadline })),
    story: s ? { title: s.titleAm || s.title, url: 'https://bina.et/news/' + s.slug } : null,
  };
}

async function post(text, buttons, { token, channel }) {
  const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: channel, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('telegram refused: ' + (j.description || r.status));
  return j.result && j.result.message_id;
}

async function main() {
  const slot = process.argv[2], send = process.argv.includes('--send');
  if (!['morning', 'evening'].includes(slot)) { console.error('usage: digest.js morning|evening [--send]'); process.exit(2); }
  require('dotenv').config({ quiet: true });
  const now = Date.now();
  let text, buttons;
  if (slot === 'morning') {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try { text = morningText({ now, ...(await gather(prisma, now)), tip: qaFor(now, 'morning') }); }
    finally { await prisma.$disconnect(); }
    buttons = morningButtons();
  } else {
    const qa = qaFor(now, 'evening');
    text = eveningText(qa); buttons = eveningButtons(qa);
  }
  console.log(text + '\n[' + buttons.map(r => r.map(b => b.text).join(' | ')).join(']  [') + ']');
  if (!send) return;
  const stateFile = process.env.BINA_DIGEST_STATE || '/root/storage/growth/digest-state.json';
  let state = {}; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) {}
  const key = slot + ':' + dayIndex(now);
  if (state[key]) { console.log('already posted ' + key); return; }
  const token = process.env.BINASMART_TG_TOKEN, channel = process.env.BINA_DIGEST_CHANNEL || '@binasmart';
  if (!token) { console.error('BINASMART_TG_TOKEN missing'); process.exit(1); }
  const id = await post(text, buttons, { token, channel });
  state[key] = id; fs.writeFileSync(stateFile, JSON.stringify(state));
  console.log('posted ' + key + ' message ' + id);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { morningText, morningButtons, eveningText, eveningButtons, qaFor, jobLine, tenderLine, ethLong, ethShort, QA };
