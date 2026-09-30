// Jev second opinion on the /hotels directory (1,000+ places to stay built from OpenStreetMap + Wikidata by
// hotels/directory.js). READ-ONLY: it reports, it never edits the map data, hidden.json or the database.
//
//   node --env-file=.env ops/jev-audit-hotels.js --n 40     first 40, to see the shape of the answers
//   node --env-file=.env ops/jev-audit-hotels.js            the whole directory
// Report: /root/storage/jev/bina-hotels-audit.json (+ summary on stdout).
//
// Sent to Jev: only what the public /hotels/<slug> page already shows (name, Amharic name, map type, sub-city,
// street, stars, website domain, the "map marks it as a building or restaurant" caveat). Never phones - the
// directory hides mobiles on purpose - and nothing about users or claims.
//
// Why: a mapper's tourism=apartment is often a block where people live, not a flat you can rent for a night,
// and the "unsure" map extras are places whose NAME says hotel. Both are guesses a second opinion can check.
// Examples in the criteria are generic on purpose - none are names from our directory.
const fs = require('fs');
const { buildDirectory } = require('../hotels/directory');

const API = process.env.JEV_API_URL, MODEL = process.env.JEV_MODEL, KEY = process.env.JEV_API_KEY;
const PRICE_PER_M_IN = 0.042;
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const N = Number(arg('--n')) || 0;
const OUT = '/root/storage/jev/bina-hotels-audit.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const QUESTIONS = {
  stay: { type: 'choice',
    instructions: 'This entry is listed in a directory of places to stay in Addis Ababa, built from map data. Can a traveller book a room or a flat here for a night or a week?',
    criteria: {
      takes_guests: 'Yes: a hotel, pension, guest house, lodge, hostel, motel, resort, or a serviced or holiday apartment that rents by the night or week.',
      residential: 'Probably not: an apartment block, condominium or real-estate project where people live on long leases, or a company compound.',
      not_lodging: 'No: a restaurant, cafe, bar, shop, office, school, clinic, bank, church or other business that only borrowed a hotel-like word.' } },
  kind: { type: 'choice',
    instructions: 'What kind of place to stay is it most likely?',
    criteria: {
      hotel: 'A hotel or resort: a business with a reception and many rooms, often named "... Hotel", "... International Hotel", "... Resort".',
      guest_house: 'A small pension, guest house, bed and breakfast or lodge (in Amharic often ፔንሲዮን or እንግዳ ማረፊያ).',
      apartment: 'Furnished or serviced apartments, flats or suites for rent.',
      hostel_motel: 'A hostel with shared rooms or a roadside motel.' } },
};

async function ask(state, tries = 9) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(API, { method: 'POST',
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions: QUESTIONS }) });
    const d = await r.json().catch(() => null);
    if (r.status === 200 && d && d.answers) return d;
    if (!(r.status === 429 || r.status >= 500) || i === tries - 1) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(d).slice(0, 120));
    await sleep(Math.min(30000, 2500 * Math.pow(1.7, i)) + Math.random() * 1200);
  }
}

const TYPE = { hotel: 'hotel', guest_house: 'guest house', apartment: 'apartment', hostel: 'hostel', motel: 'motel' };
function stateOf(p) {
  let site = '';
  try { site = p.website ? new URL(p.website).hostname.replace(/^www\./, '') : ''; } catch (e) { /* bad url */ }
  return [
    'Name: ' + p.name, p.nameAm && 'Amharic name: ' + p.nameAm,
    'Map type: ' + (p.unsure ? 'not tagged as a place to stay - the map marks it as a building or a restaurant' : (TYPE[p.kind] || p.kind)),
    p.sub && 'Sub-city: ' + p.sub, p.street && 'Street: ' + p.street, p.stars && 'Stars: ' + p.stars, site && 'Website: ' + site,
  ].filter(Boolean).join('\n');
}

(async () => {
  if (!KEY) throw new Error('JEV_API_KEY missing - run with --env-file=.env');
  const osm = JSON.parse(fs.readFileSync(process.env.BINA_OSM_ADDIS || '/root/storage/osm-addis-latest.json', 'utf8'));
  let wd = []; try { wd = JSON.parse(fs.readFileSync('/root/storage/wikidata-addis-hotels.json', 'utf8')).hotels || []; } catch (e) { /* optional */ }
  let hidden = []; try { hidden = JSON.parse(fs.readFileSync('/root/storage/hotel-outreach/hidden.json', 'utf8')); } catch (e) { /* optional */ }
  let list = buildDirectory(osm, wd).filter(p => !hidden.includes(p.ref));
  console.log('directory: ' + list.length + ' places' + (N ? ', auditing the first ' + N : ''));
  if (N) list = list.slice(0, N);

  const out = []; let tokens = 0, failed = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    let d;
    try { d = await ask(stateOf(p)); } catch (e) { failed++; console.log('  !! ' + p.slug + ' ' + e.message.slice(0, 90)); continue; }
    tokens += (d.usage || {}).input_tokens || 0;
    const s = d.answers.stay || {}, k = d.answers.kind || {};
    const ours = p.kind === 'hostel' || p.kind === 'motel' ? 'hostel_motel' : p.kind;
    const rec = { ref: p.ref, slug: p.slug, name: p.name, nameAm: p.nameAm, kind: p.kind, sub: p.sub, unsure: !!p.unsure,
      stay: s.choice, stayConf: s.confidence, jevKind: k.choice, kindConf: k.confidence };
    rec.flag = rec.stay !== 'takes_guests' || (k.choice && k.choice !== ours && (k.confidence || 0) >= 0.8);
    out.push(rec);
    console.log('  ' + (i + 1) + '/' + list.length + ' ' + p.slug + ' ' + rec.stay + ' ' + rec.jevKind + (rec.flag ? '  FLAG' : ''));
    if ((i + 1) % 50 === 0) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));   // a dead run is not wasted
    await sleep(150);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const c = f => out.filter(f).length;
  console.log('\n' + out.length + ' checked, ' + failed + ' failed. input tokens ' + tokens + ' ~ $' + (tokens / 1e6 * PRICE_PER_M_IN).toFixed(4));
  console.log('takes_guests ' + c(x => x.stay === 'takes_guests') + ' · residential ' + c(x => x.stay === 'residential') + ' · not_lodging ' + c(x => x.stay === 'not_lodging'));
  console.log('by our map type, flagged: ' + JSON.stringify(out.reduce((a, x) => (x.flag && (a[x.unsure ? 'unsure' : x.kind] = (a[x.unsure ? 'unsure' : x.kind] || 0) + 1), a), {})));
  console.log('\nnot a place to stay, most confident first:');
  for (const x of out.filter(x => x.stay !== 'takes_guests').sort((a, b) => b.stayConf - a.stayConf).slice(0, 60))
    console.log('  ' + Math.round(x.stayConf * 100) + '%  ' + x.stay.padEnd(12) + (x.unsure ? 'unsure ' : x.kind.padEnd(7)) + ' ' + x.name.slice(0, 50) + '   /hotels/' + x.slug);
  console.log('\nreport ' + OUT + ' - nothing was changed');
})().catch(e => { console.error('[jev-hotels] ' + e.message); process.exit(1); });
