'use strict';
// Document check, version 1 (2026-09-17). Not "real or fake" — a consistency check a person can act on.
//
// What it does: it reads what a document CLAIMS (which law it stands on, which fees it quotes, which office
// issued it, which dates it carries) and holds each claim against the official knowledge base — the same
// proclamations, directives and ministry notices Bini answers from. It reports three kinds of finding:
//   ok        the claim matches an official source, and the passage is shown
//   warning   the claim contradicts an official source: a repealed law, a fee that does not match
//   unknown   nothing official found; the citizen is told to confirm with the issuing office
//
// What it is NOT: it cannot see paper, ink, a seal or a signature, and it never says "genuine". A forged
// document that quotes the right law passes these checks. Final authenticity is the issuing office's word.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Photographs are how people actually hold a document. Tesseract with the Amharic and English models is
// already on this server, so a picture costs nothing extra and never leaves the machine.
const OCR_LANGS = process.env.VERIFY_OCR_LANGS || 'amh+eng';
const OCR_TIMEOUT_MS = 120000;
const MAX_PAGES = 5;

function run(cmd, args, { timeout = OCR_TIMEOUT_MS, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout, maxBuffer }, (err, out) => err ? reject(new Error(cmd + ': ' + err.message)) : resolve(String(out))));
}

const IMAGE_MAGIC = [[0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff]];  // png, jpeg
function looksLikeImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true;
  return IMAGE_MAGIC.some(sig => sig.every((b, i) => buf[i] === b));
}

// One temporary directory per call, removed whatever happens: a citizen's document never stays on disk.
async function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-verify-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function ocrImage(buf) {
  if (!looksLikeImage(buf)) throw Object.assign(new Error('not a PNG, JPEG or WebP image'), { status: 400 });
  return withTemp(async dir => {
    const img = path.join(dir, 'page.img');
    fs.writeFileSync(img, buf);
    return (await run('tesseract', [img, 'stdout', '-l', OCR_LANGS, '--psm', '6'])).trim();
  });
}

// A scanned PDF has no text layer: pdftotext returns almost nothing, so the pages are rendered and read.
async function ocrPdf(buf) {
  return withTemp(async dir => {
    const pdf = path.join(dir, 'in.pdf');
    fs.writeFileSync(pdf, buf);
    await run('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', String(MAX_PAGES), pdf, path.join(dir, 'p')]);
    const pages = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
    const out = [];
    for (const f of pages) out.push((await run('tesseract', [path.join(dir, f), 'stdout', '-l', OCR_LANGS, '--psm', '6'])).trim());
    return out.join('\n\n').trim();
  });
}

const AM_DIGITS = { '፩': 1, '፪': 2, '፫': 3, '፬': 4, '፭': 5, '፮': 6, '፯': 7, '፰': 8, '፱': 9, '፲': 10, '፳': 20, '፴': 30, '፵': 40, '፶': 50, '፷': 60, '፸': 70, '፹': 80, '፺': 90, '፻': 100, '፼': 10000 };

// "Proclamation No. 1333/2024", "አዋጅ ቁጥር 1333/2016", "Regulation 550/2024", "Directive No. 1073/2025"
const LAW_RE = /(proclamation|regulation|directive|አዋጅ|ደንብ|መመሪያ)\s*(?:no\.?|number|ቁጥር|ቁ\.?)?\s*(\d{1,4})\s*[\/\-]\s*(\d{4})/gi;
// "13,000 birr", "ብር 13,000", "ETB 13000"
const FEE_RE = /(?:(?:etb|birr|ብር)\s*([\d,]{2,12}(?:\.\d{1,2})?))|(?:([\d,]{2,12}(?:\.\d{1,2})?)\s*(?:etb|birr|ብር))/gi;
const DATE_RE = /\b(20\d{2}|19\d{2})\b/g;
const EC_RE = /(\d{4})\s*(?:ዓ\.?ም|ዓ\/ም)/g;
const PHONE_RE = /(?:\+251|0)(?:\d[\s-]?){8,9}\d/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const GOV_URL = /\.gov\.et(\/|$|:)/i;

const OFFICES = [
  // One entry per body we hold official documents for (the 46-sector library). A name recognised here is not
  // proof of anything by itself — it only tells the reader we know the office and could check its rules.
  ['Immigration and Citizenship Service', /immigration|ኢሚግሬሽን|ዜግነት/i],
  ['National ID Program (Fayda)', /fayda|ፋይዳ|national id/i],
  ['Ministry of Revenue', /ministry of revenue|ገቢዎች ሚኒስቴር|ገቢዎች ሚ/i],
  ['Ethiopian Customs Commission', /customs|ጉምሩክ/i],
  ['Ministry of Trade and Regional Integration', /ministry of trade|ንግድ ሚኒስቴር|ንግድና ቀጣናዊ/i],
  ['Ethiopian Investment Commission', /investment commission|ኢንቨስትመንት ኮሚሽን/i],
  ['Document Authentication and Registration Service', /document authentication|ሰነዶች ማረጋገጫ|ሰነድ ማረጋገጫ/i],
  ['Ministry of Justice', /ministry of justice|ፍትሕ ሚኒስቴር|ፍትህ ሚኒስቴር/i],
  ['Federal courts', /federal (first instance|high|supreme) court|ፌዴራል (የመጀመሪያ ደረጃ|ከፍተኛ|ጠቅላይ) ፍርድ ቤት/i],
  ['Federal Police', /federal police|ፌደራል ፖሊስ|ፌዴራል ፖሊስ/i],
  ['Ministry of Health', /ministry of health|ጤና ሚኒስቴር/i],
  ['Ethiopian Food and Drug Authority', /food and drug|efda|ምግብና መድኃኒት|ምግብና መድሃኒት/i],
  ['Ethiopian Health Insurance Service', /health insurance service|ጤና መድን አገልግሎት/i],
  ['Ministry of Education', /ministry of education|ትምህርት ሚኒስቴር/i],
  ['Educational Assessment and Examinations Service', /examinations service|eaes|የትምህርት ምዘናና ፈተናዎች/i],
  ['Education and Training Authority', /education and training authority|ትምህርትና ሥልጠና ባለስልጣን/i],
  ['Ministry of Labour and Skills', /ministry of lab(our|or) and skills|ሠራተኛና ክህሎት ሚኒስቴር|ሰራተኛና ክህሎት/i],
  ['Public Servants Social Security / POESSA', /social security (agency|administration)|poessa|psssa|ማኅበራዊ ዋስትና/i],
  ['Public Procurement Authority', /procurement authority|የመንግሥት ግዥ|የመንግስት ግዥ/i],
  ['Ministry of Agriculture', /ministry of agriculture|ግብርና ሚኒስቴር/i],
  ['Ethiopian Coffee and Tea Authority', /coffee and tea authority|ቡናና ሻይ/i],
  ['Ministry of Mines', /ministry of mines|ማዕድን ሚኒስቴር/i],
  ['Ministry of Water and Energy', /ministry of water and energy|ውሃና ኢነርጂ ሚኒስቴር/i],
  ['Ethiopian Electric Utility', /electric utility|eeu|ኤሌክትሪክ አገልግሎት/i],
  ['Addis Ababa Water and Sewerage Authority', /water and sewerage|aawsa|ውሃና ፍሳሽ/i],
  ['Ethiopian Communications Authority', /communications authority|ኮሙኒኬሽን ባለስልጣን/i],
  ['Ethiopian Media Authority', /media authority|ሚዲያ ባለስልጣን/i],
  ['National Election Board of Ethiopia', /election board|nebe|ምርጫ ቦርድ/i],
  ['Authority for Civil Society Organizations', /civil society organi[sz]ations|acso|የሲቪል ማኅበረሰብ ድርጅቶች/i],
  ['Ethiopian Environmental Protection Authority', /environmental protection|አካባቢ ጥበቃ/i],
  ['Ethiopian Cooperative Commission', /cooperative (commission|agency)|ኅብረት ሥራ ኮሚሽን|ህብረት ስራ/i],
  ['Ministry of Tourism', /ministry of tourism|ቱሪዝም ሚኒስቴር/i],
  ['Ministry of Innovation and Technology', /innovation and technology|ኢኖቬሽንና ቴክኖሎጂ/i],
  ['Ministry of Women and Social Affairs', /women and social affairs|ሴቶችና ማኅበራዊ|ሴቶችና ማህበራዊ/i],
  ['Refugees and Returnees Service', /refugees and returnees|rrs\b|ስደተኞችና ተመላሾች/i],
  ['Disaster Risk Management Commission', /disaster risk management|edrmc|የአደጋ ስጋት ሥራ አመራር/i],
  ['Civil Service Commission', /civil service commission|ሲቪል ሰርቪስ ኮሚሽን/i],
  ['Ethiopian Standards Institute / ECAE', /standards (institute|agency)|conformity assessment|ደረጃዎች ኢንስቲትዩት/i],
  ['National Bank of Ethiopia', /national bank of ethiopia|ብሔራዊ ባንክ/i],
  ['Ministry of Transport and Logistics', /transport and logistics|ትራንስፖርትና ሎጂስቲክስ/i],
  ['Driver and Vehicle Licensing Authority', /driver and vehicle licens|መንጃ ፈቃድ ባለስልጣን|ሾፌርና ተሽከርካሪ/i],
  ['Addis Ababa City Administration', /addis ababa city|የአዲስ አበባ ከተማ አስተዳደር/i],
  ['Addis Ababa land administration', /land (development and )?administration|የመሬት ልማትና አስተዳደር|ካርታ/i],
  ['Kebele / woreda administration', /kebele|woreda|ቀበሌ|ወረዳ/i],
];

// What the paper says it is. Only for the reader: a licence and a certificate carry different expectations.
const DOC_TYPES = [
  ['business licence', /business licen[cs]e|trade licen[cs]e|የንግድ ሥራ ፈቃድ|የንግድ ፈቃድ/i],
  ['certificate', /certificate|ምስክር ወረቀት|ሰርተፍኬት/i],
  ['permit', /permit|ፈቃድ/i],
  ['court document', /summons|judgment|judgement|ክስ|የፍርድ|መጥሪያ/i],
  ['receipt or invoice', /receipt|invoice|ደረሰኝ|ክፍያ ደረሰኝ/i],
  ['official letter', /letter|ደብዳቤ/i],
];

// Reference numbers an Ethiopian document usually carries. A wrong shape is worth a second look, never a verdict.
const ID_SHAPES = [
  ['TIN', /\bTIN\b[^0-9]{0,12}(\d[\d\s-]{2,18}\d)|ቲን[^0-9]{0,12}(\d[\d\s-]{2,18}\d)/i, d => d.replace(/\D/g, '').length === 10],
  ['Fayda number', /fayda[^0-9]{0,16}(\d[\d\s-]{4,22}\d)|ፋይዳ[^0-9]{0,16}(\d[\d\s-]{4,22}\d)/i, d => [12, 16].includes(d.replace(/\D/g, '').length)],
];

const num = s => Number(String(s).replace(/,/g, ''));
function amNumber(s) {
  // Ethiopic numerals, enough for a year or a small figure: ፳፻፲፰ style is rare on documents, ፲፪ is not.
  let total = 0, group = 0;
  for (const ch of String(s)) {
    const v = AM_DIGITS[ch]; if (!v) return null;
    if (v === 100) { group = (group || 1) * 100; }
    else if (v === 10000) { total += (group || 1) * 10000; group = 0; }
    else group += v;
  }
  return total + group;
}

function claims(text) {
  const t = String(text || '');
  const laws = [];
  for (const m of t.matchAll(LAW_RE)) {
    const kind = /አዋጅ|proclamation/i.test(m[1]) ? 'proclamation' : (/ደንብ|regulation/i.test(m[1]) ? 'regulation' : 'directive');
    const key = kind + ' ' + m[2] + '/' + m[3];
    if (!laws.some(l => l.key === key)) laws.push({ key, kind, number: m[2], year: m[3], text: m[0].trim() });
  }
  const fees = [];
  for (const m of t.matchAll(FEE_RE)) {
    const v = num(m[1] || m[2]);
    if (v >= 5 && v <= 100000000 && !fees.some(f => f.value === v)) fees.push({ value: v, text: m[0].trim() });
  }
  const offices = OFFICES.filter(([, re]) => re.test(t)).map(([name]) => name);
  const types = DOC_TYPES.filter(([, re]) => re.test(t)).map(([name]) => name);
  const ids = [];
  for (const [name, re, ok] of ID_SHAPES) {
    const m = re.exec(t); if (!m) continue;
    const digits = String(m[1] || m[2] || '');
    ids.push({ name, digits: digits.replace(/\D/g, ''), ok: ok(digits) });
  }
  const years = [...new Set([...t.matchAll(DATE_RE)].map(m => Number(m[1])))].filter(y => y >= 1990 && y <= 2100);
  const ecYears = [...new Set([...t.matchAll(EC_RE)].map(m => Number(m[1])))];
  const phones = [...new Set((t.match(PHONE_RE) || []).map(s => s.replace(/[\s-]/g, '')))];
  const urls = [...new Set(t.match(URL_RE) || [])];
  return { laws, fees, offices, types, ids, years, ecYears, phones, urls };
}

// The text around a match, by position rather than by sentence: a citation like "No. 1356/2024" carries the
// full stop of "No." inside it, and a sentence-bounded window would cut the replacement law out of the quote.
function window(text, needle, span) {
  const t = String(text || ''), i = t.indexOf(needle);
  if (i === -1) return t.slice(0, span * 2).replace(/\s+/g, ' ').trim();
  return (i > span ? '… ' : '') + t.slice(Math.max(0, i - span), i + needle.length + span).replace(/\s+/g, ' ').trim()
    + (i + needle.length + span < t.length ? ' …' : '');
}

function makeVerifier({ knowledge, now }) {
  const clock = now || Date.now;

  async function lawFinding(law) {
    const q = law.number + '/' + law.year;
    const hits = await knowledge.search(law.kind + ' ' + q, { k: 6, exclude: ['style', 'style-om', 'page', 'llms'] });
    const mentions = hits.filter(h => (h.text || '').includes(q) || (h.title || '').includes(q));
    if (!mentions.length) {
      return { kind: 'law', claim: law.text, status: 'unknown',
        note: 'Not found in our official library. It may exist and simply not be loaded — ask the issuing office.' };
    }
    // Is this law said to be repealed or replaced anywhere in the library?
    const repealRe = new RegExp('(repeal|replac|superseded|ተሽሯል|ተተክቷል|ተሻሽሏል)[^.።]{0,160}' + q + '|' + q + '[^.።]{0,160}(repeal|replac|superseded|ተሽሯል|ተተክቷል)', 'i');
    const repealed = mentions.find(h => repealRe.test(h.text || ''));
    if (repealed) {
      const passage = window(repealed.text, q, 180);
      return { kind: 'law', claim: law.text, status: 'warning',
        note: 'Our library says this law has been repealed or replaced. A current document should cite the new one.',
        source: { title: repealed.title, url: repealed.url, passage } };
    }
    const h = mentions[0];
    return { kind: 'law', claim: law.text, status: 'ok', note: 'Cited in our official library.',
      source: { title: h.title, url: h.url, passage: (h.text || '').replace(/\s+/g, ' ').slice(0, 240) } };
  }

  async function feeFinding(fee, context) {
    const hits = await knowledge.search(context.slice(0, 200) + ' ' + fee.value, { k: 6, exclude: ['style', 'style-om', 'llms'] });
    const exact = hits.find(h => (h.text || '').replace(/,/g, '').includes(String(fee.value)));
    if (exact) {
      const printed = (exact.text.match(new RegExp(String(fee.value).replace(/(\d)(?=(\d{3})+$)/g, '$1,?'))) || [String(fee.value)])[0];
      const passage = window(exact.text, printed, 150);
      return { kind: 'fee', claim: fee.text, status: 'ok', note: 'This figure appears in an official source.',
        source: { title: exact.title, url: exact.url, passage } };
    }
    return { kind: 'fee', claim: fee.text, status: 'unknown',
      note: 'We could not match this amount to a published fee. Fees change — confirm with the office.' };
  }

  async function check(text, { title } = {}) {
    const body = String(text || '').trim();
    if (body.length < 40) throw Object.assign(new Error('not enough text to check'), { status: 400 });
    const c = claims(body);
    const findings = [];

    for (const law of c.laws.slice(0, 8)) findings.push(await lawFinding(law));
    for (const fee of c.fees.slice(0, 6)) findings.push(await feeFinding(fee, body));

    // A document that names no issuing office and no law is not a document we can check at all.
    if (!c.offices.length) findings.push({ kind: 'office', claim: '—', status: 'unknown',
      note: 'No Ethiopian government office we know was named in the text.' });
    else findings.push({ kind: 'office', claim: c.offices.join(', '), status: 'ok', note: 'Named office(s) recognised.' });

    for (const id of c.ids) findings.push(id.ok
      ? { kind: 'number', claim: id.name + ' ' + id.digits, status: 'ok', note: 'The number has the expected length.' }
      : { kind: 'number', claim: id.name + ' ' + id.digits, status: 'warning',
          note: 'This number does not have the length an Ethiopian ' + id.name + ' normally has.' });

    // Dates: a Gregorian year in the future, or an Ethiopian year written as a Gregorian one.
    const thisYear = new Date(clock()).getUTCFullYear();
    for (const y of c.years) if (y > thisYear) findings.push({ kind: 'date', claim: String(y), status: 'warning',
      note: 'This year is in the future. Check whether an Ethiopian-calendar year was written as a Gregorian one.' });
    for (const y of c.ecYears) if (y > thisYear - 7) findings.push({ kind: 'date', claim: y + ' ዓ.ም', status: 'warning',
      note: 'An Ethiopian year this high does not exist yet — the calendar marker may be wrong.' });

    // Links: an official document should not point at a lookalike domain.
    for (const u of c.urls.slice(0, 6)) {
      const host = (u.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
      findings.push(GOV_URL.test(host) || /(^|\.)bina\.et$/i.test(host)
        ? { kind: 'link', claim: host, status: 'ok', note: 'Official Ethiopian government address.' }
        : { kind: 'link', claim: host, status: 'unknown', note: 'Not a .gov.et address. Check where this link really goes.' });
    }

    const counts = findings.reduce((a, f) => (a[f.status]++, a), { ok: 0, warning: 0, unknown: 0 });
    const verdict = counts.warning ? 'contradicts an official source'
      : (counts.ok ? 'consistent with official sources' : 'nothing could be confirmed');
    return {
      title: title || null,
      checkedAt: new Date(clock()).toISOString(),
      verdict, counts, findings,
      claims: { documentType: c.types, laws: c.laws.map(l => l.text), fees: c.fees.map(f => f.text), offices: c.offices, numbers: c.ids, phones: c.phones, urls: c.urls },
      disclaimer: 'This is a consistency check against published official sources, not proof that a document is genuine. '
        + 'It cannot see paper, seals or signatures. Confirm authenticity with the issuing office.',
    };
  }

  return { check, claims, _amNumber: amNumber };
}

module.exports = { makeVerifier, claims, ocrImage, ocrPdf, looksLikeImage, LAW_RE, FEE_RE };
