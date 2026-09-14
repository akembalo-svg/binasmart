#!/usr/bin/env node
'use strict';
// The government eServices portal's service directory, as knowledge documents.
//
// eservices.gov.et (run by the Ministry of Innovation and Technology) lists what each federal office and a few city
// administrations let people apply for online. Its API cannot be reached from this server (blocked from abroad), so
// the directory is fetched elsewhere and saved as JSON: { Count, data: [ { ID, Name, Description, HasRedirectURL,
// RedirectURL, OrganizationName, EstimatedFee (-1 = unknown), EstimatedProcessingTimeString, ... } ] }.
//
// This turns that file into one markdown document per office under knowledge/eservices/, which knowledge/index.js
// indexes as source `eservices`. What it will and will not say:
//   - every service by name, with its description on one line unless the description only repeats the name;
//   - where it is applied for: on eservices.gov.et, or at the office's own link (the link the portal gives);
//   - a fee or a processing time ONLY when the portal states one. -1 and "N/A" are "not stated", never a figure;
//   - descriptions the portal wrote in Afaan Oromoo or Amharic are kept and labelled, not translated;
//   - nothing else: no documents, steps or fees that the portal does not list.
// The portal's own test entries (its support centre's "payment test" services) are left out.
//
//   node ops/knowledge/eservices-to-md.js /root/storage/eservices/eservices-services-20260914.json [--out knowledge/eservices] [--fetched 2026-09-14]
// The output directory belongs to this script: a .md file it did not produce this run is removed, so an office that
// leaves the portal leaves the index at the next ingest (the ingest collects the orphaned chunks).

const fs = require('fs');
const path = require('path');

const PORTAL = 'https://www.eservices.gov.et/en/services';
const SOURCE_NAME = 'Ethiopian Government eServices portal (eservices.gov.et, Ministry of Innovation and Technology)';

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const key = s => norm(s).toLowerCase();

// Entries the portal lists that are not services for the public.
const SKIP_OFFICES = new Set(['system(e-service) support center']);
const TEST_ENTRY = /\b(payment )?test service\b|\bfor (payment )?test\b|it'?s for test/i;

// One office can appear under two names. The Amharic-named EFDA entry is the same authority as the English one
// (same eRIS link, same services), so it is folded into it.
const SAME_OFFICE = { 'የኢትዮጵያ ምግብና መድሀኒት ቁጥጥር ባለስልጣን': 'Ethiopian Food and Drug Authority' };

// How an office is shown, where the portal's own spelling is broken. The portal spelling stays in the document.
const DISPLAY = {
  'f.d.r.e authority for civil society organizations': 'Authority for Civil Society Organizations',
  'ics immigration and citizenship service': 'Immigration and Citizenship Service (ICS)',
  'ministry of revenu': 'Ministry of Revenues',
  'ethiopian custom commission': 'Ethiopian Customs Commission',
  'commercial bank of ethiopia': 'Commercial Bank of Ethiopia',
  'ministry of foreign affairs': 'Ministry of Foreign Affairs',
  'ministry of trade and regional integration': 'Ministry of Trade and Regional Integration',
  'ethiotelecom': 'Ethio telecom',
  'ministry of labor and skill': 'Ministry of Labor and Skills',
  'ethiopian shipping and logistics': 'Ethiopian Shipping and Logistics',
  'ethiopian coffee and tea authority': 'Ethiopian Coffee and Tea Authority',
  'sheger city administration': 'Sheger City Administration',
};

// Amharic names only where they are the office's established Amharic name; anything not listed stays English.
const AMHARIC = {
  'ethiopian food and drug authority': 'የኢትዮጵያ ምግብና መድሀኒት ቁጥጥር ባለስልጣን',
  'ics immigration and citizenship service': 'የኢሚግሬሽንና ዜግነት አገልግሎት',
  'ministry of foreign affairs': 'የውጭ ጉዳይ ሚኒስቴር',
  'document authentication and registration service': 'የሰነዶች ማረጋገጫና ምዝገባ አገልግሎት',
  'ministry of labor and skill': 'የሥራና ክህሎት ሚኒስቴር',
  'ministry of revenu': 'የገቢዎች ሚኒስቴር',
  'ethiopian custom commission': 'የኢትዮጵያ ጉምሩክ ኮሚሽን',
  'ministry of trade and regional integration': 'የንግድና ቀጠናዊ ትስስር ሚኒስቴር',
  'ethiopian investment commission': 'የኢትዮጵያ ኢንቨስትመንት ኮሚሽን',
  'national bank of ethiopia': 'የኢትዮጵያ ብሔራዊ ባንክ',
  'ministry of justice': 'የፍትሕ ሚኒስቴር',
  'ethiotelecom': 'ኢትዮ ቴሌኮም',
  'commercial bank of ethiopia': 'የኢትዮጵያ ንግድ ባንክ',
  'ethiopian airlines': 'የኢትዮጵያ አየር መንገድ',
  'ministry of transport and logistics': 'የትራንስፖርትና ሎጂስቲክስ ሚኒስቴር',
  'ministry of innovation and technology': 'የኢኖቬሽንና ቴክኖሎጂ ሚኒስቴር',
  'addis ababa city administration water and sewerage authority': 'የአዲስ አበባ ውሃና ፍሳሽ ባለሥልጣን',
  'ethiopian construction authority': 'የኢትዮጵያ ኮንስትራክሽን ባለሥልጣን',
  'ministry of industry': 'የኢንዱስትሪ ሚኒስቴር',
  'ministry of peace': 'የሰላም ሚኒስቴር',
  'ministry of tourism': 'የቱሪዝም ሚኒስቴር',
  'ministry of water and energy': 'የውሃና ኢነርጂ ሚኒስቴር',
  'ministry of women and social affairs': 'የሴቶችና ማኅበራዊ ጉዳይ ሚኒስቴር',
  'ethiopian media authority': 'የኢትዮጵያ መገናኛ ብዙኃን ባለሥልጣን',
  'ethiopian diaspora service': 'የኢትዮጵያ ዲያስፖራ አገልግሎት',
  'adama city administration': 'የአዳማ ከተማ አስተዳደር',
  'sheger city administration': 'የሸገር ከተማ አስተዳደር',
};

// Afaan Oromoo is recognised by its function words and common service vocabulary; two distinct hits.
const OM_WORDS = /\b(tajaajila|tajaajilli|tajaajilaa|kun|kuni|kan|fi|irratti|keessaa|keessatti|waraqaa|kaffaltii|kafaltii|heyyama|hojii|galmee|ibsuu|qaama|iddoo|abbaan|dhimmaa|komii|xalayaa|bishaanii|enyummaa|maqaa|kaartaa|mana|lafaa|lafti|ulaagaalee|sadarkaa|gosa|barnootaa|muuxannoo|waggaa|ykn|dha|dhaabbata|leenjii|afaanii|hin|waliigaltee|haaraa|kennuu|kennamuuf|jijjiiruu|beeksisaa|magaalaa|oddeefannoo|hordofuu|isaanii|isaa|barbaaduuf|barbaadeefi)\b/gi;
function descLang(s) {
  if (/[ሀ-፿]/.test(s)) return 'am';
  const hits = new Set((String(s).match(OM_WORDS) || []).map(w => w.toLowerCase()));
  return hits.size >= 2 ? 'om' : 'en';
}

function slugify(s) {
  return norm(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// The link to apply at, or null when the portal handles it itself. A link that is not a real http(s) URL with a host
// ("https://" on its own is in the file) is reported as missing rather than printed.
function applyLink(s) {
  if (!s.HasRedirectURL) return null;
  try { const u = new URL(String(s.RedirectURL || '')); if (/^https?:$/.test(u.protocol) && u.hostname) return u.toString(); } catch (e) { /* fallthrough */ }
  return '';
}

function oneLine(s, max = 300) {
  const t = norm(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max); const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + ' …';
}

// A description worth printing: not empty, not the name again (ignoring case, spacing and end punctuation), not a bare URL.
function usefulDescription(name, desc) {
  const d = norm(desc); if (!d) return false;
  const bare = x => key(x).replace(/[\s.,;:!?()-]+/g, '');
  if (bare(d) === bare(name)) return false;
  if (/^https?:\/\/\S+$/.test(d)) return false;
  return true;
}

const knownFee = f => typeof f === 'number' && Number.isFinite(f) && f >= 0;
const knownTime = t => { const s = norm(t); return !!s && !/^(n\/?a|-1|none|unknown)$/i.test(s); };

function serviceBlock(s) {
  const name = norm(s.Name);
  const lines = ['### ' + name, ''];
  if (usefulDescription(name, s.Description)) {
    const lg = descLang(s.Description);
    const label = lg === 'om' ? 'Description (in Afaan Oromoo, as the portal lists it): ' : lg === 'am' ? 'Description (in Amharic, as the portal lists it): ' : '';
    lines.push(label + oneLine(s.Description));
  }
  const link = applyLink(s);
  if (link === null) lines.push('Apply: on eservices.gov.et itself (' + PORTAL + ').');
  else if (link) lines.push("Apply: on the office's own system, linked from eservices.gov.et: " + link);
  else lines.push("Apply: the portal sends applicants to the office's own system but gives no working link; ask the office.");
  if (knownFee(s.EstimatedFee)) lines.push('Estimated fee, as the portal lists it: ' + s.EstimatedFee);
  if (knownTime(s.EstimatedProcessingTimeString)) lines.push('Estimated processing time, as the portal lists it: ' + norm(s.EstimatedProcessingTimeString));
  return lines.join('\n');
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Pure: the portal JSON -> [{ slug, office, officeAm, count, markdown }], sorted by slug.
function buildDocs(json, { fetched } = {}) {
  const data = Array.isArray(json && json.data) ? json.data : [];
  const offices = new Map();
  let skipped = 0;
  for (const s of data) {
    if (!s || !norm(s.Name)) { skipped++; continue; }
    const portalName = norm(s.OrganizationName);
    const canonical = SAME_OFFICE[portalName] || portalName;
    if (!canonical || SKIP_OFFICES.has(key(canonical))) { skipped++; continue; }
    if (TEST_ENTRY.test(norm(s.Name) + ' ' + norm(s.Description))) { skipped++; continue; }
    const k = key(canonical);
    if (!offices.has(k)) offices.set(k, { canonical, portalNames: new Set(), services: new Map() });
    const o = offices.get(k);
    o.portalNames.add(portalName);
    // the same service listed twice (I-Register / iRegister): keep the entry that says more
    const sk = key(s.Name).replace(/[^a-z0-9ሀ-፿]+/g, '');
    const prev = o.services.get(sk);
    const says = x => (usefulDescription(x.Name, x.Description) ? norm(x.Description).length : 0);
    if (prev) skipped++;
    if (!prev || says(s) > says(prev)) o.services.set(sk, s);
  }
  const date = fetched || '';
  const docs = [];
  for (const [k, o] of offices) {
    const display = DISPLAY[k] || o.canonical;
    const am = AMHARIC[k] || '';
    const slug = slugify(display);
    const services = [...o.services.values()].sort((a, b) => norm(a.Name).localeCompare(norm(b.Name)));
    const title = display + (am ? ' (' + am + ')' : '') + ' — services on eservices.gov.et';
    const portalAs = [...o.portalNames].filter(n => n !== display);
    const fm = ['---', 'title: "' + esc(title) + '"', 'source_name: "' + esc(SOURCE_NAME) + '"', 'url: "' + PORTAL + '"',
      'lang: "en"', 'fetched: "' + esc(date) + '"', 'office: "' + esc(display) + '"'];
    if (am) fm.push('office_am: "' + esc(am) + '"');
    fm.push('services: ' + services.length, 'generated_by: "ops/knowledge/eservices-to-md.js"', '---');
    const intro = [
      '# ' + display + ' — online services listed on eservices.gov.et', '',
      'The Ethiopian Government eServices portal (eservices.gov.et, run by the Ministry of Innovation and Technology) lists '
        + services.length + ' service' + (services.length === 1 ? '' : 's') + ' from ' + display
        + (date ? ', as fetched on ' + date : '') + '. Each entry says whether the application is made on eservices.gov.et itself or on the office\'s own system.'
        + ' A fee or processing time is shown only where the portal states one; where none is shown, the portal does not give it, so confirm with the office.',
    ];
    if (portalAs.length) intro.push('', 'The portal lists this office as: ' + portalAs.join('; ') + '.');
    intro.push('', 'በአማርኛ፦ ይህ ገጽ ' + (am || display) + ' በኢትዮጵያ መንግሥት የኤሌክትሮኒክ አገልግሎቶች መግቢያ (eservices.gov.et) ላይ የዘረዘራቸውን '
      + services.length + ' የኦንላይን አገልግሎቶች ይዘረዝራል። ማመልከቻው በeservices.gov.et ወይም በመሥሪያ ቤቱ የራሱ ሥርዓት ይቀርባል። '
      + 'ክፍያና የሚፈጀው ጊዜ የተጻፈው መግቢያው ሲገልጸው ብቻ ነው፤ ካልተጻፈ መሥሪያ ቤቱን ይጠይቁ።');
    const md = fm.join('\n') + '\n\n' + intro.join('\n') + '\n\n## Services\n\n' + services.map(serviceBlock).join('\n\n') + '\n';
    docs.push({ slug, office: display, officeAm: am, count: services.length, markdown: md });
  }
  docs.sort((a, b) => a.slug.localeCompare(b.slug));
  const slugs = new Set();
  for (const d of docs) { if (slugs.has(d.slug)) throw new Error('two offices share the slug ' + d.slug); slugs.add(d.slug); }
  return { docs, skipped, total: data.length };
}

// Writes the documents and removes .md files in `out` that this run did not produce.
function writeDocs(docs, out) {
  fs.mkdirSync(out, { recursive: true });
  const keep = new Set(docs.map(d => d.slug + '.md'));
  const removed = [];
  for (const f of fs.readdirSync(out)) if (f.endsWith('.md') && !keep.has(f)) { fs.rmSync(path.join(out, f)); removed.push(f); }
  for (const d of docs) fs.writeFileSync(path.join(out, d.slug + '.md'), d.markdown);
  return removed;
}

module.exports = { buildDocs, writeDocs, descLang, slugify, usefulDescription, applyLink, PORTAL };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--') && !['--out', '--fetched'].includes(args[args.indexOf(a) - 1]));
  if (!file) { console.error('usage: eservices-to-md.js <services.json> [--out knowledge/eservices] [--fetched YYYY-MM-DD]'); process.exit(2); }
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, '..', '..', 'knowledge', 'eservices');
  const m = /(\d{4})(\d{2})(\d{2})/.exec(path.basename(file));
  const fetched = args.includes('--fetched') ? args[args.indexOf('--fetched') + 1] : (m ? m[1] + '-' + m[2] + '-' + m[3] : '');
  const { docs, skipped, total } = buildDocs(JSON.parse(fs.readFileSync(file, 'utf8')), { fetched });
  const removed = writeDocs(docs, out);
  console.log('[eservices] ' + total + ' entries -> ' + docs.length + ' offices, ' + docs.reduce((n, d) => n + d.count, 0) + ' services, '
    + skipped + ' skipped (test entries, duplicates)' + (removed.length ? ', removed ' + removed.join(', ') : '') + ' -> ' + out);
}
