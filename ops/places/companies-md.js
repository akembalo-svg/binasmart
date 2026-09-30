// Bini's knowledge of the Addis real estate companies and car sellers directory (companies/directory.js):
// writes knowledge/places/addis-real-estate-companies.md and addis-car-sellers.md from
// /root/storage/directory/addis-companies.json minus exclude.json. Not committed: it carries office landlines.
// Like hotels-md.js it refuses to write if anything shaped like a mobile number reaches the output.
//   node ops/places/companies-md.js [--dry-run]      then: node --env-file=.env knowledge/ingest.js --source places
const fs = require('fs');
const path = require('path');
const MOBILE = /(?:\+?251[\s-]?|\b0)[79](?:[\s-]?\d){8}/;
const md = s => String(s || '').replace(/[*_`[\]<>]/g, '');
const data = JSON.parse(fs.readFileSync('/root/storage/directory/addis-companies.json', 'utf8'));
let ex = []; try { ex = JSON.parse(fs.readFileSync('/root/storage/directory/exclude.json', 'utf8')); } catch (e) { /* none */ }
const all = data.companies.filter(c => !ex.includes(c.name) && !ex.includes(c.key) && !ex.includes(c.slug));
const day = new Date().toISOString().slice(0, 10);
const SETS = {
  real_estate: { file: 'addis-real-estate-companies.md', url: 'https://bina.et/real-estate-companies',
    title: 'Real estate companies in Addis Ababa (በአዲስ አበባ የሚገኙ የሪል እስቴት ኩባንያዎች)', h1: '# Real estate companies in Addis Ababa · የሪል እስቴት ኩባንያዎች',
    what: 'real estate developers, agencies/brokers and property management companies', listings: 'Homes for sale and rent listed on BinaSmart are at https://bina.et/property.' },
  car_seller: { file: 'addis-car-sellers.md', url: 'https://bina.et/car-dealers',
    title: 'Car dealers and car sellers in Addis Ababa (በአዲስ አበባ የሚገኙ የመኪና ሻጮች)', h1: '# Car dealers and car sellers in Addis Ababa · የመኪና ሻጮች',
    what: 'brand dealers, car importers, assemblers, used-car dealers and car markets', listings: 'Cars for sale listed on BinaSmart are at https://bina.et/cars.' },
};
for (const [kind, S] of Object.entries(SETS)) {
  const list = all.filter(c => c.kind === kind);
  const groups = {};
  for (const c of list) (groups[c.sub || 'Addis Ababa (sub-city not known)'] ||= []).push(c);
  const lines = ['---', 'title: "' + S.title + '"', 'url: "' + S.url + '"', 'lang: "en"',
    'source_name: "BinaSmart company directory: OpenStreetMap contributors (ODbL), BinaSmart job board, company websites"', 'fetched: "' + day + '"', 'count: "' + list.length + '"', '---', '',
    S.h1, '', list.length + ' ' + S.what + ' in Addis Ababa, as of ' + day + ', grouped by sub-city. The full list with search is at ' + S.url + '. '
    + 'Each entry comes from the city map, job adverts the company placed on BinaSmart, or the company\'s own website and news reports. This is a directory, not a licence register: '
    + 'tell people to call and check before they pay anyone. ' + S.listings + ' A company claims its listing free on its bina.et page, and a missing company can be added from ' + S.url + '.', ''];
  for (const sub of Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length)) {
    const rows = groups[sub].sort((a, b) => a.name.localeCompare(b.name));
    lines.push('## ' + sub + (rows[0].subAm ? ' · ' + rows[0].subAm + ' ክፍለ ከተማ' : '') + ' — ' + rows.length, '');
    for (const c of rows) {
      const parts = ['- **' + md(c.name) + '**' + (c.nameAm ? ' (' + md(c.nameAm) + ')' : '')];
      if (c.type) parts.push(md(c.type));
      if (c.brands) parts.push('brands: ' + md(c.brands));
      if (c.address) parts.push(md(c.address));
      if (c.phones && c.phones.length) parts.push('office phone ' + c.phones.join(', '));
      if (c.website) parts.push('website ' + c.website);
      if (c.employer) parts.push('has job openings on BinaSmart: https://bina.et/employer/' + c.employer);
      parts.push('https://bina.et/companies/' + c.slug);
      lines.push(parts.join(' · '));
    }
    lines.push('');
  }
  const text = lines.join('\n');
  const hits = lines.filter(l => MOBILE.test(l));
  if (hits.length) { hits.forEach(l => console.error('  mobile-like in: ' + l.slice(0, 160))); console.error('MOBILE NUMBER IN OUTPUT - nothing written'); process.exit(1); }
  const out = path.join(__dirname, '../../knowledge/places', S.file);
  console.log(kind + ': ' + list.length + ' in ' + Object.keys(groups).length + ' groups · ' + text.length + ' chars');
  if (!process.argv.includes('--dry-run')) { fs.writeFileSync(out, text); console.log('written ' + out); }
}
