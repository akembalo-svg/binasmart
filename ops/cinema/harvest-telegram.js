#!/usr/bin/env node
'use strict';
// What is showing in Addis tonight, read from the cinema's own Telegram channel.
//
//   node --env-file=.env ops/cinema/harvest-telegram.js --dry            read and print, write nothing
//   node --env-file=.env ops/cinema/harvest-telegram.js                  every channel below
//   node --env-file=.env ops/cinema/harvest-telegram.js --venue alem-cinema
//
// Until now every programme on bina.et was typed in by hand from a Facebook post somebody forwarded
// (ops/cinema/seed-alem-programme.js). That works once and then stops: the last programme we hold ran
// 4-10 September, and the cinema section has been empty since, not because anything broke but because
// nobody retyped it.
//
// The cinemas publish daily, in one place, to their own Telegram channel — and the schedule usually
// lives INSIDE the poster image, which is why Google cannot read it and why a person cannot find out
// what is on without opening Telegram. So this reads the picture too.
//
// Three rules it keeps, because a wrong showtime sends somebody across Addis for nothing:
//   · Only what is printed. The model returns the times as printed AND in 24-hour form; a pair that
//     does not agree with the Ethiopian clock is dropped rather than guessed at.
//   · Dates are never invented. A poster naming its days is trusted for those days; one that does not
//     is held for a week from the day it was posted and then expires by itself.
//   · Every row carries the post it came from, so a person can check what we read against the picture.
//
// It is information, not booking: the cinema sells its own tickets. The value we add is that what they
// published to 3,000 Telegram subscribers becomes a page Google can index.
const { PrismaClient } = require('@prisma/client');

const MODEL = 'gemini-2.5-flash';
const KEY = process.env.GEMINI_API_KEY || '';
const DRY = process.argv.includes('--dry');
const ONLY = (() => { const i = process.argv.indexOf('--venue'); return i > -1 ? process.argv[i + 1] : null; })();
const UA = 'Mozilla/5.0 (compatible; BinaSmartBot/1.0; +https://bina.et)';
const MAX_AGE_DAYS = 10;          // a poster older than this is last week's programme
const HOLD_DAYS = 7;              // how long a programme with no printed dates is shown for
const EARLIEST_HOUR = 10;         // the earliest hour an Addis cinema actually screens anything

// The cinemas that publish a programme to a public Telegram channel. Slug is the Venue in our database.
const CHANNELS = [
  { venue: 'alem-cinema', channel: 'alem_cinema', name: 'Alem Cinema Telegram channel' },
  { venue: 'gast-cinema', channel: 'gastcinema', name: 'Gast Cinema Telegram channel' },
];

const PROMPT = [
  'This is a post from an Addis Ababa cinema\'s own Telegram channel: the text of the post, and the',
  'poster image it carried. Read BOTH and return the films and plays it announces.',
  '',
  'Return ONLY JSON: { "isProgramme": true|false, "dateNote": "", "shows": [ … ] }',
  '',
  '"isProgramme" is false for anything that is not a schedule — a sold-out notice, a greeting, an advert',
  'for the buffet, a single reminder with no times. When it is false, return an empty "shows".',
  '',
  'Each entry in "shows":',
  '  "titleAm"   — the title exactly as printed in Amharic, if it is in Amharic. "" otherwise.',
  '  "title"     — the title in Latin letters (transliterate the Amharic if there is no English title).',
  '  "kind"      — "film" or "theatre", only if the post says which; "" if it does not.',
  '  "printed"   — the showtimes exactly as printed, e.g. ["12:00", "2:30 ምሽት"].',
  '  "clock"     — "ethiopian" if those times are in the Ethiopian clock (the normal case for these',
  '                posters), "international" if they are already 24-hour times.',
  '  "times24"   — the same times converted to 24-hour international time, e.g. ["18:00", "20:30"].',
  '  "note"      — director, cast or genre as printed, in one short line. "" if none.',
  '',
  '"dateNote" — the days the programme covers, exactly as printed ("ከመስከረም 04 - 07", "ከአርብ እስከ እሁድ",',
  '"ሐሙስ"). "" if the post does not say.',
  '"dateFrom", "dateTo" — those same days as YYYY-MM-DD in the Gregorian calendar, worked out from the',
  'date the post was published, which is given below. Ethiopian months: መስከረም starts 11 September,',
  'ጥቅምት 11 October, and so on. Leave both "" if the post does not name its days.',
  '',
  'These are evening entertainment: a cinema in Addis screens from late morning to late night, never at',
  '6, 7 or 8 in the morning. An Ethiopian-clock "1:10" on such a poster is 19:10, not 07:10.',
  '',
  'Never invent a title, a time or a date. If the poster is unreadable, return isProgramme false.',
  'Do not include the cinema\'s phone number or its ticketing instructions as a show.',
].join('\n');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// The Ethiopian clock runs six hours behind the international one, and turns again in the evening:
// 1:00 is 07:00, 12:00 is 18:00, and an evening 2:30 is 20:30. A printed time and a converted one that
// cannot be reconciled by either rule is a reading we do not trust, so it is dropped.
function reconcile(printed, hhmm, clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  const p = /(\d{1,2})[:.](\d{2})/.exec(String(printed || ''));
  if (!m || !p) return null;
  const H = Number(m[1]), M = Number(m[2]);
  if (H > 23 || M > 59) return null;
  if (clock !== 'ethiopian') return String(H).padStart(2, '0') + ':' + m[2];
  const eh = Number(p[1]) % 12;
  if (Number(p[2]) !== M) return null;                       // the minutes must survive the conversion
  const day = (eh + 6) % 24, night = (eh + 18) % 24;         // morning/afternoon, or evening
  if (H !== day && H !== night) return null;
  // Nobody in Addis screens a film at seven in the morning. When the reading lands there, the poster
  // meant the evening turn of the same Ethiopian hour - 1:10 is 19:10, not 07:10.
  const fixed = (H < EARLIEST_HOUR && night >= EARLIEST_HOUR) ? night : H;
  if (fixed < EARLIEST_HOUR) return null;
  return String(fixed).padStart(2, '0') + ':' + m[2];
}

async function fetchChannel(channel) {
  const r = await fetch('https://t.me/s/' + channel, { headers: { 'user-agent': UA } });
  if (r.status !== 200) throw new Error('t.me/s/' + channel + ' HTTP ' + r.status);
  return r.text();
}

// Telegram's public preview page: one block per post, with its text, its photo and its time.
function parsePosts(html) {
  const out = [];
  const blocks = html.split('<div class="tgme_widget_message_wrap');
  for (const b of blocks.slice(1)) {
    const link = (/data-post="([^"]+)"/.exec(b) || [])[1];
    const when = (/<time datetime="([^"]+)"/.exec(b) || [])[1];
    const img = (/background-image:url\('([^']+\.jpg[^']*)'\)/.exec(b) || [])[1];
    const raw = (/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b) || [])[1] || '';
    const text = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&laquo;|&raquo;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (link && when) out.push({ link: 'https://t.me/' + link, postedAt: new Date(when), text, img });
  }
  return out;
}

async function readPost(post) {
  const parts = [];
  if (post.img) {
    const r = await fetch(post.img, { headers: { 'user-agent': UA } }).catch(() => null);
    if (r && r.status === 200) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 8 * 1024 * 1024) parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
    }
  }
  parts.push({ text: PROMPT + '\n\nThe post was published on ' + post.postedAt.toISOString().slice(0, 10) + '.'
    + '\n\n--- the text of the post ---\n' + (post.text || '(no text)') });

  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + KEY, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 1400, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' } }),
  });
  if (r.status !== 200) throw new Error('gemini ' + r.status);
  const d = await r.json();
  const out = (((d.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('').trim();
  return out ? JSON.parse(out) : null;
}

(async () => {
  if (!KEY) { console.error('[cinema] no GEMINI_API_KEY'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    for (const site of CHANNELS) {
      if (ONLY && ONLY !== site.venue) continue;
      const venue = await prisma.venue.findUnique({ where: { slug: site.venue } });
      if (!venue) { console.log('[' + site.venue + '] no such venue — skipped'); continue; }

      let posts;
      try { posts = parsePosts(await fetchChannel(site.channel)); }
      catch (e) { console.log('[' + site.venue + '] ' + e.message); continue; }

      const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
      const recent = posts.filter(p => p.postedAt.getTime() >= cutoff).reverse();   // newest first
      console.log('[' + site.venue + '] ' + posts.length + ' posts on the channel, ' + recent.length + ' from the last ' + MAX_AGE_DAYS + ' days');

      let added = 0, skipped = 0;
      for (const post of recent) {
        let read;
        try { read = await readPost(post); } catch (e) { console.log('  !! ' + post.link + ' — ' + e.message); continue; }
        await sleep(400);
        if (!read || !read.isProgramme || !Array.isArray(read.shows) || !read.shows.length) { skipped++; continue; }

        // Dates: what the poster prints, when it prints them and they sit sensibly around the post;
        // otherwise a week from the day it was posted, so an unlabelled programme expires by itself
        // instead of claiming to be this week forever.
        const midnight = d => new Date(new Date(d).setUTCHours(0, 0, 0, 0) - 3 * 3600000);   // 00:00 Addis
        let dateFrom = midnight(post.postedAt);
        let dateTo = new Date(dateFrom.getTime() + HOLD_DAYS * 86400000 - 1);
        const pf = /^\d{4}-\d{2}-\d{2}$/.test(String(read.dateFrom)) ? midnight(read.dateFrom + 'T12:00:00Z') : null;
        const pt = /^\d{4}-\d{2}-\d{2}$/.test(String(read.dateTo)) ? midnight(read.dateTo + 'T12:00:00Z') : null;
        if (pf && Math.abs(pf - midnight(post.postedAt)) <= 4 * 86400000) {
          dateFrom = pf;
          const end = pt && pt >= pf ? pt : pf;
          dateTo = new Date(Math.min(end.getTime(), pf.getTime() + 14 * 86400000) + 86400000 - 1);
        }

        for (const s of read.shows) {
          const printed = Array.isArray(s.printed) ? s.printed : [];
          const conv = Array.isArray(s.times24) ? s.times24 : [];
          const times = [...new Set(printed.map((p, i) => reconcile(p, conv[i], s.clock)).filter(Boolean))].sort();
          const title = clean(s.title, 90) || clean(s.titleAm, 90);
          if (!title || !times.length) { skipped++; continue; }                // a show with no readable time is not shown

          const note = [clean(s.kind, 20) === 'theatre' ? 'ቴአትር · theatre' : (clean(s.kind, 20) === 'film' ? 'ፊልም · film' : ''),
            clean(s.note, 120), read.dateNote ? 'እንደተለጠፈው፦ ' + clean(read.dateNote, 60) : ''].filter(Boolean).join(' · ');

          if (DRY) { console.log('  ' + title + '  ' + times.join(', ') + '  [' + note + ']'); added++; continue; }

          // One row per title per post: re-running the harvester must not double the board.
          const twin = await prisma.programme.findFirst({ where: { venueId: venue.id, title, sourceUrl: post.link } });
          if (twin) { await prisma.programme.update({ where: { id: twin.id }, data: { times, notes: note, dateFrom, dateTo, active: true } }); }
          else {
            await prisma.programme.create({ data: {
              venueId: venue.id, title, titleAm: clean(s.titleAm, 90) || null,
              times, dateFrom, dateTo, notes: note || null,
              sourceName: site.name, sourceUrl: post.link, postedAt: post.postedAt, active: true,
            } });
          }
          added++;
        }
      }
      console.log('[' + site.venue + '] ' + (DRY ? 'would add ' : 'wrote ') + added + ' shows, skipped ' + skipped + ' posts/rows');
    }
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[cinema] ' + e.message); process.exit(1); });
