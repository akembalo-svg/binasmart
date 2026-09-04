'use strict';
// Load programme entries from a JSON file (one cinema, one post). Times are INTERNATIONAL clock —
// convert Ethiopian-clock posts before writing the file (7:00 -> 13:00, 12:00 -> 18:00, evening 1:10 -> 19:10).
// Replaces any active entry with the same venue + title + dateFrom, so re-running a corrected file is safe.
//   node ops/cinema/add-programme.js ops/cinema/programmes/alem-2026-09-05.json
// File shape: { "venue": "alem-cinema", "sourceName": "...", "sourceUrl": "https://...", "postedAt": "2026-09-04",
//   "entries": [{ "titleAm": "ሐምራዊት", "title": "Hamrawit", "notes": "...", "dateFrom": "2026-09-05", "dateTo": "2026-09-06",
//                 "times": ["14:00","16:10"], "trailerUrl": null, "hallName": null, "priceText": null }] }
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { youtubeId } = require('../../watch/rules');
const prisma = new PrismaClient();
const file = process.argv[2]; if (!file) { console.error('usage: add-programme.js <file.json>'); process.exit(2); }
const J = JSON.parse(fs.readFileSync(file, 'utf8'));
const day = s => new Date(s + 'T00:00:00+03:00');
(async () => {
  const venue = await prisma.venue.findUnique({ where: { slug: J.venue } });
  if (!venue) throw new Error('venue ' + J.venue + ' missing');
  if (!/^https?:\/\//.test(J.sourceUrl || '') || !J.sourceName) throw new Error('sourceName + sourceUrl required');
  const postedAt = new Date(J.postedAt || Date.now());
  let added = 0, replaced = 0;
  for (const e of J.entries) {
    const times = [...new Set(e.times.map(t => String(t).padStart(5, '0')))].sort();
    if (!times.every(t => /^\d{2}:\d{2}$/.test(t))) throw new Error('bad time in ' + e.title);
    const dateFrom = day(e.dateFrom), dateTo = new Date(day(e.dateTo || e.dateFrom).getTime() + 86400000 - 1);
    replaced += (await prisma.programme.updateMany({ where: { venueId: venue.id, title: e.title, dateFrom, active: true }, data: { active: false } })).count;
    const tid = e.trailerUrl ? youtubeId(e.trailerUrl) : null;
    await prisma.programme.create({ data: { venueId: venue.id, title: e.title, titleAm: e.titleAm || null, notes: e.notes || null, hallName: e.hallName || null, priceText: e.priceText || null, times, dateFrom, dateTo,
      trailerUrl: tid ? 'https://www.youtube.com/watch?v=' + tid : null, posterUrl: e.posterUrl || (tid ? 'https://i.ytimg.com/vi/' + tid + '/hqdefault.jpg' : null), sourceName: J.sourceName, sourceUrl: J.sourceUrl, postedAt } });
    added++;
  }
  console.log(J.venue + ': added ' + added + ', replaced ' + replaced);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
