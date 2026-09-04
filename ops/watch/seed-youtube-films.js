'use strict';
// Catalogue seed: full-length Amharic films that their channels publish openly on YouTube, shown here
// through YouTube's own embedded player (which YouTube's terms allow). BinaSmart holds NO licence for
// any of them, so every one is FREE, carries a rights note saying exactly that, and comes down the
// moment the channel owner asks. Idempotent: upsert by slug. `--dry` prints only.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// [slug, youtubeId, titleAm, title, year, channelName, channelHandle, genre]
const FILMS = [
  ['selabiw-2024', 'Ir06sI9qfqs', 'ሰላቢው', 'Selabiw', 2024, 'Haya Hulet Cinema', '@HayaHuletCinema', null],
  ['pinel-2025', '1JsNenOmrz4', 'ጵንኤል', 'Pinel', 2025, 'Haya Hulet Cinema', '@HayaHuletCinema', null],
  ['geztehegn-2024', 'Uvi4TSaFNkE', 'ገዝተኸኝ ነው', 'Geztehegn New', 2024, 'Haya Hulet Cinema', '@HayaHuletCinema', null],
  ['lambadina-2024', 'vdne6pTm-Ug', 'ላምባዲና', 'Lambadina', 2024, 'Haya Hulet Cinema', '@HayaHuletCinema', null],
  ['remet-2024', '8hfL4OlpTRk', 'ረመጥ', 'Remet', 2024, 'Haya Hulet Cinema', '@HayaHuletCinema', 'በእውነተኛ ታሪክ · true story'],
  ['sebleye-2025', 'gaV9Q_0qnL0', 'ሰብልዬ', 'Sebleye', 2025, 'Netsebraq Media', '@NetsebraqMedia', null],
  ['mirkuze-2025', 'Fx2l3L9u-pI', 'ምርኩዜ', 'Mirkuze', 2025, 'Netsebraq TV', '@NetsebraqTV', null],
  ['hanani-2025', 'WoQ3gAwzuZ0', 'ሀናኒ', 'Hanani', 2025, 'Sekela Entertainment', '@SekelaEntertainment', null],
  ['afta-2025', 'SvfO4Chutck', 'አፍታ', 'Afta', 2025, 'Tosa Cinema', '@TosaCinema', null],
  ['fetena-2025', 'ISnrQoz8-to', 'ፈተና', 'Fetena', 2025, 'HAHU TV', '@HAHUTV', null],
  ['atse-kassa-2025', '-Mzmoqp42S4', 'አፄ ካሳ', 'Atse Kassa', 2025, 'Ephrem Multimedia', '@ephremmultimedia', 'ታሪካዊ · historical'],
  ['alazar-2025', '81AE0B8NUBA', 'አልዓዛር', 'Alazar', 2025, 'Addis Movies', '@addismoviesethiopia', null],
  ['tizta-2025', 'vLgX0t9otiI', 'ትዝታ', 'Tizta', 2025, 'Eliana Entertainment', '@Eliana_Entertainment', null],
  ['lebam-2025', 'lEEBwcK7dCk', 'ልባም', 'Lebam', 2025, 'Melona Cinema', '@MelonaCinema', 'Drama'],
  ['addis-meraf-2025', 'pEp-Hl8un0A', 'አዲስ ምእራፍ', 'Addis Meraf', 2025, 'Melona Cinema', '@MelonaCinema', null],
];

async function poster(id) {
  try { const r = await fetch('https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg', { method: 'HEAD' }); if (r.ok) return 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg'; } catch (e) {}
  return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
}
async function stillUp(id) {
  try { const r = await fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + id + '&format=json'); return r.ok ? await r.json() : null; } catch (e) { return null; }
}

(async () => {
  const dry = process.argv.includes('--dry'); let n = 0, skipped = 0;
  for (const [slug, id, titleAm, title, year, channel, handle, genre] of FILMS) {
    const meta = await stillUp(id);
    if (!meta) { console.log('skip (not embeddable / unavailable):', slug); skipped++; continue; }
    const data = {
      title, titleAm, year, language: 'Amharic', genre, sourceKind: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=' + id, posterUrl: await poster(id), priceEtb: 0, rentHours: 48,
      descr: titleAm + ' — ሙሉ ፊልም። በ' + channel + ' የዩቲዩብ ቻናል በይፋ የቀረበ፤ እዚህ በዩቲዩብ ማጫወቻ ይታያል።\n\n' + title + ' — full-length Amharic film published openly on the ' + channel + ' YouTube channel and shown here through the YouTube player.',
      rights: 'Public YouTube upload by ' + channel + ' (youtube.com/' + handle + '), video ' + id + ', embedded with the YouTube player as YouTube\'s terms allow. BinaSmart holds NO licence: free viewing only, never rented, removed on the channel owner\'s request. Added 2026-09-04.',
      status: 'public',
    };
    if (!dry) await prisma.film.upsert({ where: { slug }, update: data, create: { slug, ...data } });
    console.log((dry ? 'would add ' : 'ok ') + slug + ' | ' + titleAm + ' | ' + channel + ' | ' + meta.title.slice(0, 50));
    n++;
  }
  console.log((dry ? 'dry run: ' : 'upserted ') + n + ' films, skipped ' + skipped);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
