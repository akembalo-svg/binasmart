'use strict';
// Seeds the Addis Ababa cinema venues (idempotent: upsert by slug). No halls are created here —
// a hall's seat template must come from the cinema itself, never guessed. Phones and areas are
// from public directories (AddisBiz, Ethiopian Films blog, Cinema Treasures, EBR, Fana, EthioFind,
// Modern Addis, Sinema Focus); `notes` names the source so ops can re-verify before a show goes on sale.
//   node ops/cinema/seed-addis-cinemas.js          -> upserts, prints a table
//   node ops/cinema/seed-addis-cinemas.js --dry    -> prints only
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const V = [
  ['matti-multiplex', 'Matti Multiplex (Edna Mall)', 'ማቲ መልቲፕሌክስ (ኤድና ሞል)', 'Edna Mall, Bole Medhanealem, Bole', null, null, '3 halls · 735 seats · Hollywood, Bollywood + local films (EBR 2019; Tripadvisor 2026)'],
  ['century-cinema', 'Century Cinema (Century Mall)', 'ሴንቸሪ ሲኒማ (ሴንቸሪ ሞል)', 'Century Mall, Gurd Shola, Bole', '+251987202020', 'https://centuryaddismall.com/', 'Modern multiplex, blockbusters, VR game zone (EthioFind)'],
  ['abyssinia-cineplex', 'Abyssinia Cineplex', 'አቢሲኒያ ሲኒፕሌክስ', 'Bole, near Bole Medhanealem Church', null, 'http://abyssiniacineplex.com', '4K digital projection, digital 3D, 7.1 surround · Noah Real Estate (Modern Addis)'],
  ['gast-cinema', 'Gast Cinema (Gast Entertainment Mall)', 'ጋስት ሲኒማ (ጋስት ሞል)', 'Gast Entertainment Mall, CMC Boulevard, in front of St. Michael Church, Bole', null, 'https://t.me/gastcinema', '2 halls + rooftop cinema on the 10th floor · recliner seats, Dolby (EBR 2019; Gast TikTok 2024)'],
  ['vamdas-cinema', 'Vamdas Cinema', 'ቫምዳስ ሲኒማ', 'Megenagna, next to Panorama Hotel', '+251931152544', null, '5 halls · about 1,000 seats · main hall with stage and luxury seating (Cinema Treasures)'],
  ['birsh-cinema', 'Birsh Cinema', 'ብርሽ ሲኒማ', 'Arada', null, null, '2 halls · 526 seats (48 VIP + 478 standard) (EBR 2019)'],
  ['adot-multiplex', 'Adot Multiplex', 'አዶት መልቲፕሌክስ', 'Bisrate Gabriel, Nifas Silk-Lafto', null, null, 'Mall multiplex: shopping, dining, cinema (Yandex Maps / Facebook)'],
  ['alem-cinema', 'Alem Cinema', 'ዓለም ሲኒማ', 'Africa Avenue (Bole Road), behind Alem Building, Bole', '+251116636718', null, 'Haile & Alem International · film, theatre and events (Ethiopian Films blog; AddisBiz)'],
  ['ambassador-theatre', 'Ambassador Theatre', 'አምባሳደር ቴአትር', 'In front of the EBC (Ethiopian Radio & Television) building', null, null, 'About 1,400 seats · foreign and local films, theatre (Ethiopian Films blog; Cinema Treasures)'],
  ['cinema-empire', 'Cinema Empire', 'አምፒር ሲኒማ', 'Piassa, at the start of Adwa Road, Arada', '+251111565029', null, 'Historic single-screen · local and international films (Ethiopian Films blog; Cinema Treasures)'],
  ['cinema-ethiopia', 'Cinema Ethiopia', 'ኢትዮጵያ ሲኒማ', 'Piassa, next to Ethiopian Electric Power, Arada', '+251111116690', null, 'Historic single-screen (Ethiopian Films blog; Cinema Treasures)'],
  ['cinema-yoftahe', 'Cinema Yoftahe', 'ዮፍታሄ ሲኒማ', 'Kazanchis, near the InterContinental, above AYU Restaurant', '+251115555361', null, '1 hall · 330 seats · Ethiopian films (Ethiopian Films blog)'],
  ['agona-cinema', 'Agona Cinema', 'አጎና ሲኒማ', 'Debre Zeit Road, near Concord Restaurant', '+251114661763', null, '1 hall · 600 seats · Ethiopian films (Ethiopian Films blog)'],
  ['sebastopol-cinema', 'Sebastopol Cinema', 'ሴባስቶፖል ሲኒማ', 'Exhibition Center area, Meskel Square', null, null, '2 halls · Ethiopian films (Ethiopian Films blog; Wikipedia)'],
  ['sebastopol-lafto', 'Sebastopol Cinema — Lafto', 'ሴባስቶፖል ሲኒማ — ላፍቶ', 'Lafto, Nifas Silk-Lafto', null, null, 'Second Sebastopol branch (map.et)'],
  ['ras-theatre', 'Ras Theatre', 'ራስ ቴአትር', 'Merkato, between Teklehaimanot Church and Anwar Mosque', '+251112763509', null, 'Theatre and cinema (Ethiopian Films blog; AddisBiz)'],
  ['city-hall-cinema', 'Addis Ababa City Hall Cinema', 'የአዲስ አበባ ማዘጋጃ ቤት ሲኒማ', 'City Hall, Piassa, in front of St. George Church, Arada', '+251111559873', null, 'Inside the municipality building (Ethiopian Films blog; AddisBiz)'],
  ['embilta-cinema', 'Embilta Cinema (Embilta Hotel)', 'እምቢልታ ሲኒማ', 'Embilta Hotel, between Ras Desta Hospital and the Pasteur Institute', '+251112758787', null, 'Hotel cinema (Ethiopian Films blog)'],
  ['eyoha-cinema', 'Eyoha Cinema', 'እዮሃ ሲኒማ', 'Kirkos', null, null, 'Eyoha Entertainment (map.et; AddisBiz)'],
  ['addis-cinema-complex', 'Addis Cinema Complex', 'አዲስ ሲኒማ ኮምፕሌክስ', 'Addis Ababa City Administration complex (opened 14 Oct 2025)', null, null, '2 halls · 1,479 seats (592 children + 887 adults) · 15-storey cultural complex (Fana, Oct 2025)'],
  ['videobet-cinema', 'Videobet Cinema', 'ቪዲዮቤት ሲኒማ', "Red Terror Martyrs' Memorial Museum building, Meskel Square", null, null, 'Independent arthouse cinema, opened 6 Feb 2026 (Sinema Focus)'],
  ['national-theatre', 'Ethiopian National Theatre', 'ብሔራዊ ቴአትር', 'Gambia Street, Arada', null, null, 'About 1,500 seats · theatre, concerts, premieres (Wikipedia)'],
];

(async () => {
  const dry = process.argv.includes('--dry');
  let created = 0, updated = 0;
  for (const [slug, name, nameAm, address, phone, website, notes] of V) {
    const data = { name, nameAm, address, phone, website, notes, active: true };
    if (!dry) {
      const ex = await prisma.venue.findUnique({ where: { slug } });
      if (ex) { await prisma.venue.update({ where: { slug }, data }); updated++; }
      else { await prisma.venue.create({ data: { slug, ...data } }); created++; }
    }
    console.log((slug + '                              ').slice(0, 24), name, '|', address, '|', phone || '—');
  }
  console.log(dry ? 'dry run: ' + V.length + ' venues' : 'created ' + created + ', updated ' + updated + ' of ' + V.length);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
