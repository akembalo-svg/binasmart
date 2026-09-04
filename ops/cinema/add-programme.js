'use strict';
// Load programme entries from a JSON file (one cinema, one post/document). Times are INTERNATIONAL
// clock — convert Ethiopian-clock posts before writing the file (7:00 -> 13:00, 12:00 -> 18:00).
// Replaces any active entry with the same venue + title + dateFrom, so re-running a corrected file is safe.
//   node ops/cinema/add-programme.js ops/cinema/programmes/alem-2026-09-05.json
//
// Two file shapes:
//  A) entries:  { venue, sourceName, sourceUrl?, postedAt, entries: [{ titleAm, title, notes, dateFrom, dateTo?, times[], trailerUrl?, hallName?, priceText? }] }
//  B) grid (the city enterprise's weekly sheet):
//     { venue, sourceName, sourceUrl?, postedAt, films: { "ሐምራዊት": { title, notes } },
//       grid: { columns: ["14:00","16:00","18:00"], days: { "2026-09-04": ["ሐምራዊት","ሳላያት",null] } } }
//     -> one entry per film per day with that day's slots.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { youtubeId } = require('../../watch/rules');
const prisma = new PrismaClient();
const file = process.argv[2]; if (!file) { console.error('usage: add-programme.js <file.json>'); process.exit(2); }
const J = JSON.parse(fs.readFileSync(file, 'utf8'));
const day = s => new Date(s + 'T00:00:00+03:00');

function expandGrid(J) {
  const out = [];
  for (const [date, slots] of Object.entries(J.grid.days)) {
    const byFilm = {};
    slots.forEach((name, i) => { if (name) (byFilm[name] = byFilm[name] || []).push(J.grid.columns[i]); });
    for (const [name, times] of Object.entries(byFilm)) {
      const f = (J.films || {})[name] || {};
      out.push({ titleAm: name, title: f.title || name, notes: f.notes || null, trailerUrl: f.trailerUrl || null, posterUrl: f.posterUrl || null, dateFrom: date, dateTo: date, times });
    }
  }
  return out;
}

(async () => {
  const venue = await prisma.venue.findUnique({ where: { slug: J.venue } });
  if (!venue) throw new Error('venue ' + J.venue + ' missing');
  if (!J.sourceName) throw new Error('sourceName required');
  if (J.sourceUrl && !/^https?:\/\//.test(J.sourceUrl)) throw new Error('sourceUrl must be a link');
  const postedAt = new Date(J.postedAt || Date.now());
  const entries = J.grid ? expandGrid(J) : J.entries;
  let added = 0, replaced = 0;
  for (const e of entries) {
    const times = [...new Set(e.times.map(t => String(t).padStart(5, '0')))].sort();
    if (!times.every(t => /^\d{2}:\d{2}$/.test(t))) throw new Error('bad time in ' + e.title);
    const dateFrom = day(e.dateFrom), dateTo = new Date(day(e.dateTo || e.dateFrom).getTime() + 86400000 - 1);
    replaced += (await prisma.programme.updateMany({ where: { venueId: venue.id, title: e.title, dateFrom, active: true }, data: { active: false } })).count;
    const tid = e.trailerUrl ? youtubeId(e.trailerUrl) : null;
    await prisma.programme.create({ data: { venueId: venue.id, title: e.title, titleAm: e.titleAm || null, notes: e.notes || null, hallName: e.hallName || null, priceText: e.priceText || null, times, dateFrom, dateTo,
      trailerUrl: tid ? 'https://www.youtube.com/watch?v=' + tid : null, posterUrl: e.posterUrl || (tid ? 'https://i.ytimg.com/vi/' + tid + '/hqdefault.jpg' : null), sourceName: J.sourceName, sourceUrl: J.sourceUrl || '', postedAt } });
    added++;
  }
  console.log(J.venue + ': added ' + added + ', replaced ' + replaced);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
