'use strict';
// ---------- the date a date is ----------
// fixCalendarMarker (assistant/grounding.js) repairs a date written with the wrong calendar MARKER. This file
// repairs a wrong DATE. Measured 2026-09-18 on the Ministry of Labour demo: every source pairs
// "ነሐሴ 8 ቀን 2017 ዓ.ም." with "14 August 2025" (Overseas Employment Proclamation 1389/2025), and asked in Amharic
// the model answered "እ.ኤ.አ. ነሐሴ 8 ቀን 2025 (… ነሐሴ 8 ቀን 2017 ዓ.ም.)" — it took the Ethiopian month name ነሐሴ for
// August and carried the Ethiopian DAY (8) into a date it marked Gregorian. The Ethiopian date was right; the
// Gregorian one was invented. A prompt cannot make a model do calendar arithmetic reliably; this does it.
//
// THE RULE. A date the answer marks as Gregorian must (a) appear in the retrieved context, the tool output or
// the user's question, or (b) be the exact conversion of an Ethiopian date that appears there. Otherwise:
//   - the same sentence carries a grounded Ethiopian date -> the Gregorian date is REPLACED by its conversion;
//   - no Ethiopian date beside it, but the date has the defect's own shape — an Ethiopian month and day under
//     a Gregorian year — and the sources print exactly that month and day 7 or 8 years earlier -> REPLACED
//     by that date's conversion (the model's "ነሐሴ 8 ቀን 2025" can only mean ነሐሴ 8 2017 = 14 August 2025);
//   - nothing to convert from -> the Gregorian part alone is DROPPED (an Ethiopian date beside it is kept).
// A Gregorian date the answer pairs with an Ethiopian date it is the exact conversion of is left alone.
// A sentence is never dropped for a date, and nothing is ever invented: every date this writes is computed
// from an Ethiopian date the sources printed.
//
// THE CONVERTER. Julian Day Number arithmetic. The Ethiopian (Amete Mihret) epoch is JDN 1723856; the year has
// twelve 30-day months and a 13th, Pagume, of 5 days, 6 in a year Y with Y mod 4 == 3 (the year BEFORE the
// Gregorian leap year, which is why Meskerem 1 then falls on 12 September instead of 11). Checked against
// en.wikipedia.org/wiki/Ethiopian_calendar (fetched 2026-09-18): "It occurs on 11 September in the Gregorian
// calendar; except for the year preceding a leap year, when it occurs on 12 September" and "The Ethiopian
// calendar years 1992 and 1996 ... began on the Gregorian dates of 12 September in 1999 and 2003"; and against
// the corpus's own pairs, ነሐሴ 8 2017 = 14 August 2025 (knowledge/law/returnee-migrants-reintegration-support.md).
// test/grounding-dates.test.js pins all of them, and the 2019/2020 E.C. boundary (Pagume 6 2019 = 11 Sep 2027,
// Meskerem 1 2020 = 12 Sep 2027).

const EPOCH = 1723856;

function gregToJdn(y, m, d) {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}
function jdnToGreg(j) {
  const a = j + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d / 4), m = Math.floor((5 * e + 2) / 153);
  return { y: 100 * b + d - 4800 + Math.floor(m / 10), m: m + 3 - 12 * Math.floor(m / 10), d: e - Math.floor((153 * m + 2) / 5) + 1 };
}
function ethToJdn(y, m, d) { return EPOCH + 365 + 365 * (y - 1) + Math.floor(y / 4) + 30 * m + d - 31; }
function jdnToEth(j) {
  const r = (j - EPOCH) % 1461, n = (r % 365) + 365 * Math.floor(r / 1460);
  return { y: 4 * Math.floor((j - EPOCH) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460), m: Math.floor(n / 30) + 1, d: (n % 30) + 1 };
}
function validEth(y, m, d) { return m >= 1 && m <= 13 && d >= 1 && (m < 13 ? d <= 30 : d <= (y % 4 === 3 ? 6 : 5)); }
function validGreg(y, m, d) { if (m < 1 || m > 12 || d < 1) return false; const g = jdnToGreg(gregToJdn(y, m, d)); return g.m === m && g.d === d; }
function ethToGreg(y, m, d) { return validEth(y, m, d) ? jdnToGreg(ethToJdn(y, m, d)) : null; }
function gregToEth(y, m, d) { return validGreg(y, m, d) ? jdnToEth(gregToJdn(y, m, d)) : null; }

// ---------- month names ----------
const ETH_AM = [['መስከረም'], ['ጥቅምት'], ['ኅዳር', 'ህዳር', 'ሕዳር'], ['ታኅሣሥ', 'ታህሳስ', 'ታሕሳስ', 'ታኅሳስ', 'ታህሣሥ', 'ታሕሣሥ'], ['ጥር'],
  ['የካቲት'], ['መጋቢት'], ['ሚያዝያ', 'ሚያዚያ'], ['ግንቦት'], ['ሰኔ'], ['ሐምሌ', 'ሃምሌ', 'ሀምሌ'], ['ነሐሴ', 'ነሀሴ', 'ነሃሴ'], ['ጳጉሜን', 'ጳጉሜ', 'ጷጉሜ']];
const ETH_LA = [['Meskerem', 'Meskarem'], ['Tikimt', 'Tekemt', 'Tikemt', 'Tiqimt'], ['Hidar', 'Hedar'], ['Tahsas', 'Tahesas', 'Tahisas'],
  ['Tir', 'Ter'], ['Yekatit'], ['Megabit'], ['Miyazya', 'Miazia', 'Miyazia'], ['Ginbot', 'Genbot'], ['Sene'], ['Hamle'],
  ['Nehase', 'Nehasse', 'Nehasie'], ['Pagumen', 'Pagume']];
const GRE_AM = [['ጃንዋሪ', 'ጃኑዋሪ', 'ጃንዩዌሪ'], ['ፌብሩዋሪ', 'ፌብሩወሪ', 'ፌብርዋሪ', 'ፌብሯሪ'], ['ማርች'], ['ኤፕሪል'], ['ሜይ'], ['ጁን'],
  ['ጁላይ'], ['ኦገስት', 'ኦጋስት', 'ኦገስት'], ['ሴፕቴምበር', 'ሴፕተምበር', 'ሰፕቴምበር'], ['ኦክቶበር', 'ኦክቶበር'], ['ኖቬምበር', 'ኖቨምበር'], ['ዲሴምበር', 'ዲሰምበር']];
const GRE_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GRE_EN_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept?', 'Oct', 'Nov', 'Dec'];

const MONTHS = new Map();   // lower-cased spelling -> { cal: 'eth'|'greg', m, script: 'am'|'la' }
ETH_AM.forEach((v, i) => v.forEach(s => MONTHS.set(s, { cal: 'eth', m: i + 1, script: 'am' })));
ETH_LA.forEach((v, i) => v.forEach(s => MONTHS.set(s.toLowerCase(), { cal: 'eth', m: i + 1, script: 'la' })));
GRE_AM.forEach((v, i) => v.forEach(s => MONTHS.set(s, { cal: 'greg', m: i + 1, script: 'am' })));
GRE_EN.forEach((s, i) => MONTHS.set(s.toLowerCase(), { cal: 'greg', m: i + 1, script: 'la' }));
function monthInfo(word) {
  const w = String(word).replace(/\.$/, '');
  const hit = MONTHS.get(w) || MONTHS.get(w.toLowerCase());
  if (hit) return hit;
  const i = GRE_EN_ABBR.findIndex(a => new RegExp('^' + a + '$', 'i').test(w));
  return i >= 0 ? { cal: 'greg', m: i + 1, script: 'la' } : null;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLen = a => a.slice().sort((x, y) => y.length - x.length);
const AM_NAMES = byLen([...ETH_AM.flat(), ...GRE_AM.flat()]).map(esc).join('|');
// Latin names need word boundaries; Ethiopic prefixes (ከ, በ, እስከ) are glued to the month, so those do not.
const LA_NAMES = byLen([...ETH_LA.flat(), ...GRE_EN]).map(esc).join('|') + '|' + GRE_EN_ABBR.map(a => a + '\\.?').join('|');
// An Ethiopic month name must start a word, or follow only a one-letter prefix (ከ/በ/ለ) or እስከ: measured,
// "መመሪያ ቁጥር 44/2013" read as ጥር 44 — ቁጥር ("number") ends in ጥር (January's Ethiopian month).
const AM_START = '(?<=(?:^|[^\\u1200-\\u137F])(?:[ከበለ]|እስከ)?)';
const MONTH = '(?:' + AM_START + '(?:' + AM_NAMES + ')|\\b(?:' + LA_NAMES + ')\\b)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)';
const YEAR = '(?<!\\d)(\\d{4})(?!\\d)';
// "ነሐሴ 8 ቀን 2017", "August 14, 2025", "Aug. 14 2025"
const RE_MDY = new RegExp('(' + MONTH + ')\\s*' + DAY + '\\s*(?:ቀን\\s*)?[,፣]?\\s*' + YEAR, 'giu');
// "14 August 2025", "14th of August, 2025", "በ16 መስከረም 2026", "8 ቀን ነሐሴ 2017"
const RE_DMY = new RegExp('(?<!\\d)' + DAY + '\\s*(?:ቀን\\s*)?(?:of\\s+)?(' + MONTH + ')\\s*[,፣]?\\s*' + YEAR, 'giu');
// "ነሀሴ 8/2017", "ሰኔ 24/2017", "መስከረም 30/2016 ዓ.ም" — how the law pages and the gazette notes print a date.
const RE_MSLASH = new RegExp('(' + MONTH + ')\\s*' + DAY + '\\s*/\\s*' + YEAR, 'giu');
const RE_ISO = /(?<![\d/.-])(\d{4})-(\d{2})-(\d{2})(?![\d])/g;
// Only for what grounds a date, never for what the answer is held to: "14/08/2025", "14.08.2025".
const RE_NUM = /(?<![\d/.])(\d{1,2})[./](\d{1,2})[./](\d{4})(?![\d])/g;

const ETH_AFTER = /^\s*[(（]?\s*(?:ዓ\s*[.\/]?\s*ም|E\.\s?C\b|EC\b)/i;
const GRE_AFTER = /^\s*[(（]?\s*(?:እ\s*[.\/]?\s*ኤ\s*[.\/]?\s*አ\.?|G\.\s?C\.?|GC\b|A\.D\.?|Gregorian(?:\s+calendar)?)\s*[)）]?/i;
// Markdown bold may sit between the marker and the date: "እ.ኤ.አ **ነሐሴ 8 ቀን 2025**" (measured, mols-eval #4).
const GRE_BEFORE = /(?:እ\s*[.\/]?\s*ኤ\s*[.\/]?\s*አ\.?)\s*[(（]?\s*\**\s*[በከለ]?\s*$/;
const GRE_BEFORE_DROP = /[በከለ]?(?:እ\s*[.\/]?\s*ኤ\s*[.\/]?\s*አ\.?)\s*[(（]?\s*[በከለ]?\s*$/;

// Every full date in a text, each with the calendar it is in. `cal` is 'eth' for an Ethiopian date, 'greg' for
// a Gregorian one. A Gregorian-marked date written with an Ethiopian month name (the defect's shape) is 'greg'
// with the month read the way the writer meant it — ነሐሴ as August, መስከረም as September — and `ethName: true`.
function parseDates(text, { loose = false } = {}) {
  const s = String(text || '');
  const out = [];
  const push = o => { if (!out.some(x => o.start < x.end && x.start < o.end)) out.push(o); };
  const classify = (start, end, word, day, year) => {
    const mi = monthInfo(word);
    if (!mi) return;
    const after = s.slice(end, end + 16), before = s.slice(Math.max(0, start - 16), start);
    const ethMark = ETH_AFTER.test(after), greMark = !ethMark && (GRE_AFTER.test(after) || GRE_BEFORE.test(before));
    const y = +year, d = +day;
    if (d < 1 || d > 31) return;   // "ቁጥር 44/2013" is a document number, not a day
    const base = { start, end, text: s.slice(start, end), y, d, script: mi.script, hasQen: /ቀን/.test(s.slice(start, end)),
      monthFirst: s.slice(start, end).trim().search(/\d/) > 0, greMark, ethMark };
    if (mi.cal === 'greg') return push(Object.assign(base, { cal: 'greg', m: mi.m, ethName: false }));
    // Ethiopian month name. Its own marker says Ethiopian; the Gregorian marker says Gregorian. Unmarked, a
    // year the Ethiopian calendar has not reached (2020 E.C. begins 12 September 2027) can only be Gregorian.
    if (ethMark || (!greMark && y < 2020)) return push(Object.assign(base, { cal: 'eth', m: mi.m }));
    return push(Object.assign(base, { cal: 'greg', m: mi.m <= 12 ? ((mi.m + 7) % 12) + 1 : null, ethName: true, ethM: mi.m }));
  };
  for (const m of s.matchAll(RE_MSLASH)) classify(m.index, m.index + m[0].length, m[1], m[2], m[3]);
  for (const m of s.matchAll(RE_MDY)) classify(m.index, m.index + m[0].length, m[1], m[2], m[3]);
  for (const m of s.matchAll(RE_DMY)) classify(m.index, m.index + m[0].length, m[2], m[1], m[3]);
  for (const m of s.matchAll(RE_ISO)) push({ start: m.index, end: m.index + m[0].length, text: m[0], cal: 'greg', iso: true,
    y: +m[1], m: +m[2], d: +m[3], script: 'iso', ethName: false });
  if (loose) {
    for (const m of s.matchAll(RE_NUM)) {
      const end = m.index + m[0].length;
      if (ETH_AFTER.test(s.slice(end, end + 16))) push({ start: m.index, end, cal: 'eth', y: +m[3], m: +m[2], d: +m[1] });
      else {   // both readings: a grounding set that is too generous costs nothing; one too strict rewrites a right date
        out.push({ start: m.index, end, cal: 'greg', y: +m[3], m: +m[2], d: +m[1] });
        out.push({ start: m.index, end, cal: 'greg', y: +m[3], m: +m[1], d: +m[2] });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const key = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

// The dates the sources give: every Gregorian date they print, the conversion of every Ethiopian date they
// print, and today (the answer may say what today is; the server's clock is a source).
function groundedDates(grounding, question, now = new Date()) {
  const greg = new Set(), eth = new Set();
  for (const x of parseDates(String(grounding || '') + '\n' + String(question || ''), { loose: true })) {
    if (x.cal === 'eth') {
      if (!validEth(x.y, x.m, x.d)) continue;
      eth.add(key(x.y, x.m, x.d));
      const g = ethToGreg(x.y, x.m, x.d);
      greg.add(key(g.y, g.m, g.d));
    } else if (x.m) greg.add(key(x.y, x.m, x.d));
  }
  // Every Ethiopian date the sources stand for, printed as such or as the Gregorian date it converts to.
  const ethAll = new Set(eth);
  for (const k of greg) { const [y, m, d] = k.split('-').map(Number); if (validGreg(y, m, d)) { const e = gregToEth(y, m, d); ethAll.add(key(e.y, e.m, e.d)); } }
  for (const off of [0, 3 * 3600e3]) { const t = new Date(+now + off); greg.add(key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())); }
  return { greg, eth, ethAll };
}

// The corrected date, written the way the wrong one was: ISO stays ISO, English stays English in its own
// order, and Amharic gets the Gregorian month's Amharic name (ኦገስት), which cannot be read as an Ethiopian month.
function formatLike(orig, g) {
  if (orig.iso) return key(g.y, g.m, g.d);
  if (orig.script === 'la') return orig.monthFirst ? GRE_EN[g.m - 1] + ' ' + g.d + ', ' + g.y : g.d + ' ' + GRE_EN[g.m - 1] + ' ' + g.y;
  const name = GRE_AM[g.m - 1][0];
  return orig.monthFirst ? name + ' ' + g.d + (orig.hasQen ? ' ቀን ' : ' ') + g.y : g.d + (orig.hasQen ? ' ቀን ' : ' ') + name + ' ' + g.y;
}

// Sentence spans. A full stop inside a calendar marker (እ.ኤ.አ., ዓ.ም., E.C.) or an abbreviation is not an end.
function sentenceOf(s, i) {
  let a = 0, b = s.length;
  const isEnd = j => {
    const c = s[j];
    if (c === '።' || c === '!' || c === '?' || c === '\n' || (c === '፡' && s[j - 1] === '፡')) return true;
    if (c !== '.' || !/\s/.test(s[j + 1] || ' ')) return false;
    return !/(?:ዓ\s*\.\s*ም|እ\s*\.\s*ኤ\s*\.\s*አ|ኤ\.አ|E\.\s?C|G\.\s?C|\b(?:No|Art|Dr|Mr|Mrs|St|vs|e\.g|i\.e|Proc|Sept|Aug|Jan|Feb|Mar|Apr|Jun|Jul|Oct|Nov|Dec))$/i.test(s.slice(Math.max(0, j - 8), j));
  };
  for (let j = i - 1; j >= 0; j--) if (isEnd(j)) { a = j + 1; break; }
  for (let j = i; j < s.length; j++) if (isEnd(j)) { b = j + 1; break; }
  return [a, b];
}

// The span to remove when a Gregorian date has nothing to stand on: the date, its marker, the brackets round
// it, and an English preposition that would otherwise point at nothing.
function dropSpan(s, x) {
  let a = x.start, b = x.end;
  while (s.slice(a - 2, a) === '**' && s.slice(b, b + 2) === '**') { a -= 2; b += 2; }
  const after = s.slice(b).match(GRE_AFTER);
  if (after && !ETH_AFTER.test(s.slice(b, b + 16))) b += after[0].length;
  const before = s.slice(Math.max(0, a - 16), a).match(GRE_BEFORE_DROP);
  if (before) a -= before[0].length;
  // a one-letter prefix glued to the date ("በ3 መስከረም 2026") goes with it
  else if (/(?:^|[^ሀ-፿])[በከለ]$/.test(s.slice(Math.max(0, a - 2), a))) a -= 1;
  const l = s.slice(0, a).match(/[(（]\s*$/), r = s.slice(b).match(/^\s*[)）]/);
  if (l && r) { a -= l[0].length; b += r[0].length; }
  else {
    const prep = s.slice(0, a).match(/\s(?:on|from|since|as of|by|effective|dated|until)\s*$/i);
    if (prep && !l) a -= prep[0].length;
  }
  return [a, b];
}

function guardDates(text, grounding, question, opts = {}) {
  const s = String(text || '');
  const { greg, eth, ethAll } = groundedDates(grounding, question, opts.now);
  const dates = parseDates(s);
  const edits = [];
  for (const x of dates) {
    if (x.cal !== 'greg') continue;
    const valid = x.m && validGreg(x.y, x.m, x.d);
    if (valid && greg.has(key(x.y, x.m, x.d))) continue;
    const [sa, sb] = sentenceOf(s, x.start);
    const beside = dates.filter(e => e.cal === 'eth' && e.start >= sa && e.end <= sb && validEth(e.y, e.m, e.d));
    // The answer pairs it with an Ethiopian date it is the exact conversion of: the pair is consistent, and
    // the Gregorian half is not invented. Measured: "ከሐምሌ 16 ቀን 2018 ዓ.ም. (እ.ኤ.አ. July 23, 2026)" is right
    // even on a turn whose retrieval did not bring the customs page back.
    if (valid && beside.some(e => { const g = ethToGreg(e.y, e.m, e.d); return g.y === x.y && g.m === x.m && g.d === x.d; })) continue;
    const claimed = valid ? gregToJdn(x.y, x.m, x.d) : gregToJdn(x.y, 7, 1);
    let best = null;
    // (1) An Ethiopian date in the same sentence that the sources stand for: convert it.
    for (const e of beside) {
      if (!ethAll.has(key(e.y, e.m, e.d))) continue;
      const g = ethToGreg(e.y, e.m, e.d);
      const dist = Math.abs(gregToJdn(g.y, g.m, g.d) - claimed);
      if (!best || dist < best.dist) best = { g, dist };
    }
    // (2) The defect's own signature with no Ethiopian date beside it: an Ethiopian month and day under a
    // Gregorian year ("እ.ኤ.አ. ነሐሴ 8 ቀን 2025"), where the sources print that very month and day seven or eight
    // years earlier (ነሀሴ 8/2017). There is exactly one date the writer can have meant; it is the conversion.
    if (!best && x.ethName && x.ethM) {
      const hits = [...ethAll].map(k => k.split('-').map(Number))
        .filter(([y, m, d]) => m === x.ethM && d === x.d && (y === x.y - 7 || y === x.y - 8));
      if (hits.length === 1) best = { g: ethToGreg(...hits[0]) };
    }
    if (best) edits.push({ a: x.start, b: x.end, to: formatLike(x, best.g), before: x.text, after: formatLike(x, best.g) });
    else { const [a, b] = dropSpan(s, x); edits.push({ a, b, to: '', before: s.slice(a, b).trim(), after: '(dropped)' }); }
  }
  if (!edits.length) return { text: s, changes: [] };
  let out = s;
  for (const e of edits.sort((p, q) => q.a - p.a)) out = out.slice(0, e.a) + e.to + out.slice(e.b);
  if (edits.some(e => !e.to)) out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:።፣)])/g, '$1').replace(/\(\s*\)/g, '');
  return { text: out, changes: edits.reverse().map(e => ({ before: e.before, after: e.after })) };
}

// The one-line form the two answer paths call, right after fixCalendarMarker.
function fixGregorianDates(text, grounding, question, label = 'bini', warn = m => console.warn(m)) {
  const r = guardDates(text, grounding, question);
  for (const c of r.changes) warn('[' + label + '] corrected a Gregorian date: ' + c.before + ' -> ' + c.after);
  return r.text;
}

module.exports = { ethToGreg, gregToEth, parseDates, groundedDates, guardDates, fixGregorianDates, validEth, validGreg };
