'use strict';
// Numbers an assistant made up are the dangerous kind. Asked what a driver earns, Bini answered with a
// 4.4 km trip, 12 minutes and a 239 birr fare, having called no tool at all — and a fare is the one thing
// BinaRide promises is fixed and shown before you book.
//
// The rule here is simple and checkable: a figure carrying a unit may only be said if those digits appear in
// what the assistant was actually given — the retrieved documents, the results of the tools that ran, and the
// question the user just asked. Anything else was invented, and the sentence carrying it is dropped.
//
// Which units are policed is decided by what a reader would act on, not by size. Money, distance and
// percentages are claims however small; a duration or a count is ordinary speech until it gets specific.
//
// This is deliberately domain-neutral. The same guard is what any adviser built on this stack needs, where
// an invented dose, deadline or figure is not a nuisance but a harm.

// Dollars and euros are here since 2026-09-23. Asked what a shed costs in an industrial park, Bini wrote
// "Years 8-10: US$3.25 per square meter per month" twice, from a table whose Year 8-10 cells are $3.5 and
// $2.75. 3.25 is in no source. It reached the reader because the only currencies this list knew were birr,
// so a dollar price was not a figure at all — and a currency written BEFORE the number ($3.25, US$1.5,
// USD 4.34) matched no pattern, whatever the currency. Investment, airline and visa pages price in dollars.
const MONEY = 'ብር|birr|birrii|ETB|USD|US ?dollars?|dollars?|ዶላር|EUR|euros?|ዩሮ';
const DISTANCE = 'ኪሎ ?ሜትር|ኪ\\.?ሜ|km|kilomet\\w*|ሜትር|met(?:er|re)s?';
const PERCENT = 'በመቶ|percent|%';
const TIME = 'ደቂቃ|minutes?|mins?|ሰዓት|hours?|ቀናት?|days?|ወራት?|months?';

// number + unit
const FIGURE = new RegExp('(\\d[\\d,.٬\']*)\\s*(' + MONEY + '|' + DISTANCE + '|' + PERCENT + '|' + TIME + ')', 'gi');
// currency + number: $3.25, US$1.5, US $ 2, USD 4.34, ETB 1,000, €20, £15. Always money, so always checked.
const PREFIXED = /(?<![A-Za-z])(US ?\$|\$|USD|ETB|EUR|€|£|GBP)\s?(\d[\d,.٬']*)/gi;
// A bare four-digit year is a claim too, and it carries no unit, so the regex above never saw one. Measured on
// 2026-09-17 inside an answer that cited Banking Business Proclamation No. 1360/2025 correctly: "This change
// came about in the last quarter of 2022 with a new bill" — a date in no page of the pack, sitting inside a
// cited answer, which is the most persuasive place an invented figure can sit. A year is a date the reader
// will repeat, so it is held to the same rule as a fee: it must be in what the model was given.
//
// Only a year standing on its own is checked. The digits inside a document number — 1360/2025, FCP/01/2020,
// an upload path .../2020/03/ — are part of a name, not a date, so a slash on either side disqualifies the
// match. Those numbers are in the context whenever the answer is citing them, and would pass on grounding
// alone; excluding them here means the rule does not depend on that.
const YEAR = /(?<![\d/])((?:19|20)\d{2})(?![\d/])/g;
// these are checked no matter how small: a wrong price or distance is a wrong fact
const ALWAYS = new RegExp('^(' + MONEY + '|' + DISTANCE + '|' + PERCENT + ')$', 'i');
// a duration or count below this is normal speech ("8 minutes", "2 days"), above it is a specific claim
const TRIVIAL = 24;

// One number, one key. Separators go ("1,500" = "1500"), a full stop that ends the sentence goes ("239." =
// "239"), and a decimal is keyed by its VALUE: trailing zeros after the point go, so 3 = 3.0 = 3.00 and
// 3.5 = 3.50. Equal values are the same figure — the EIC lease table itself writes "$3" in one row and
// "$3.0" in the next. Digits that change the value never match: 3.25 is not 3, not 25, not 2.5 and not 32.5.
function digitsOf(s) {
  let d = String(s).replace(/[,٬'\s]/g, '').replace(/\.+$/, '');
  if (/^\d+\.\d+$/.test(d)) d = d.replace(/0+$/, '').replace(/\.$/, '');
  return d;
}

// Every number in the grounding, normalised the same way, so "1,500" in a document matches "1500" in a reply.
// Each number is added whole and only whole. Until 2026-09-23 a decimal also added its integer part ("3.5"
// added "3"), and a decimal in the reply was accepted when its integer part was grounded — so "3.25" passed
// because the table had a $3 somewhere. That fallback was there for a number that ends a sentence ("239.");
// digitsOf now drops that full stop itself, so the fallback has no job left except letting decimals through.
function groundedNumbers(grounding) {
  const out = new Set();
  for (const m of String(grounding || '').matchAll(/\d[\d,.٬']*/g)) out.add(digitsOf(m[0]));
  return out;
}

// ---------- a long run of digits: somebody's number ----------
// A phone number, an account number or an ID is a figure with no unit and more than four digits, so neither
// rule above ever looked at one. Measured 2026-09-18 in the Ministry of Labour and Skills audit: asked in
// Amharic how to check that an agency is licensed, Bini answered with five agency managers' mobiles in full
// — 251900000042, 251900000021, 251900000010. The register it was reading holds those rows as 251•••••0042.
// It reconstructed the five hidden digits and presented them as the ministry's published data. The masking
// was a deliberate privacy decision taken before this repository went public, and a model that completes the
// mask hands back exactly the thing the decision removed. Whether a completed number happens to reach a real
// person is worse, not better.
//
// So a run of seven or more digits, however it is spaced, is a figure that must be grounded like money is.
// Two-or-more-digit groups joined by a single space or hyphen are one number, which is how an office line is
// written ("+251 116 671792"); a row of single digits is not, or every numbered list would become a phone.
const LONGNUM = /(?<![\d])\+?\d{2,}(?:[ \-]\d{2,})*(?![\d])/g;
const LONG_MIN = 7;

function onlyDigits(s) { return String(s).replace(/\D/g, ''); }

// The forms the same Ethiopian number is written in, so a document that prints "+251 116 671792" grounds an
// answer that writes "0116671792". Only the two prefixes that mean the same subscriber are stripped, and
// only when enough digits remain for the result to still be a number rather than a fragment.
function numberKeys(d) {
  const out = new Set();
  if (!d) return out;
  out.add(d);
  if (d.length >= 11 && d.startsWith('251')) out.add(d.slice(3));
  if (d.length >= 9 && d.startsWith('0')) out.add(d.replace(/^0+/, ''));
  return out;
}

// BinaSmart's own published contact numbers. They are in the system prompt, which is part of what the model
// was given, but not in the retrieved documents — so without this the guard would delete the WhatsApp line
// from every answer that offers it, which is the one number we most want said.
const OWN_NUMBERS = ['251911244344'];

function groundedLongNumbers(grounding) {
  const out = new Set();
  for (const s of OWN_NUMBERS) for (const k of numberKeys(s)) out.add(k);
  for (const m of String(grounding || '').matchAll(LONGNUM)) {
    const d = onlyDigits(m[0]);
    if (d.length < LONG_MIN) continue;
    for (const k of numberKeys(d)) out.add(k);
  }
  return out;
}

// ---------- the mask ----------
// A masked token is digits with a run of stand-ins where the rest used to be: 251•••••0042, 251*****0042,
// 251xxxxx0042, 251…0042. All four forms occur — the packs mask with •, and pages we mirror use the others.
//
// The rule this shape buys is the one the register needs and grounding alone cannot give: if the context
// masks a number, any number in the answer that completes that mask is ungrounded NO MATTER what else the
// context contains. Grounding asks "did the model see these digits"; that question has the wrong answer here,
// because the model did see them — it saw three of twelve and guessed the rest, and a guess that lands on a
// real subscriber is the worst outcome, not an acceptable one.
const MASK_RUN = '(?:[•*]+|[xX]{2,}|…+|\\.{3,})';
const MASKED_NUMBER = new RegExp('(?<![\\d])(\\d{2,})?(' + MASK_RUN + ')(\\d{2,})?(?![\\d])', 'g');
// how much of a number a visible fragment has to be before it means anything. The head threshold is four
// because every Ethiopian number opens 251: a three-digit head would make the country code itself a match,
// and would delete the ministry's own switchboard from an answer that quoted it correctly.
const HEAD_MIN = 4;
const TAIL_MIN = 3;
// …and how long a number has to be before completing a mask is the likeliest explanation for it. An
// Ethiopian mobile is nine digits nationally and twelve internationally; a fetched date written 2026-09-17
// is eight. Without this floor, a register chunk holding fifty masked rows would give fifty four-digit tails
// for a date to collide with by accident, and the sentence it would take with it is the dated citation —
// the one sentence the other half of this work exists to put there.
const MASK_MIN = 9;

function maskedShapes(grounding) {
  const out = [];
  for (const m of String(grounding || '').matchAll(MASKED_NUMBER)) {
    const head = m[1] || '';
    const run = m[2];
    const tail = m[3] || '';
    if (!head && !tail) continue;                        // a row of asterisks is emphasis, not a number
    // `…` and `...` do not say how many digits they hide; a run of • * or x does.
    const span = /^[•*xX]+$/.test(run) ? run.length : null;
    // Either side alone is only a mask when the stand-in is countable and the visible part is long enough to
    // be a fragment of a number. Without this, "in 2026… 45 people" would register as a masked number and
    // every answer carrying a 2026 date would be read as completing it.
    if (!(head && tail) && !(span !== null && span >= 2 && (head.length >= HEAD_MIN || tail.length >= HEAD_MIN))) continue;
    out.push({ head, tail, span });
  }
  return out;
}

// Does this number complete one of those masks? Checked against every form of the number, so writing the
// reconstruction in national form ("0900000042") does not escape the rule.
function completesMask(digits, shapes) {
  if (!shapes.length) return false;
  const keys = [...numberKeys(digits)].filter(k => k.length >= MASK_MIN);
  if (!keys.length) return false;
  for (const s of shapes) {
    for (const k of keys) {
      if (s.tail && s.tail.length >= TAIL_MIN && k !== s.tail && k.endsWith(s.tail)) return true;
      if (s.head && s.head.length >= HEAD_MIN && k !== s.head && k.startsWith(s.head)) return true;
    }
  }
  return false;
}

// A figure the user typed in their own question is theirs, not something the assistant invented: asked what
// it costs to send 1,000 birr, the answer has to be able to say 1,000 back, or the sentence carrying the fee
// is dropped and the reply comes out mangled. The question is normalised exactly like the documents, so
// "1,000" in the question grounds "1000" in the reply. Nothing else is loosened: a figure that appears in
// neither the documents nor the question is still dropped. This is not a licence to repeat a figure as a
// recommendation — a dose the user types is removed by Dr Afiya's own filter, which runs before this one.
function findUngrounded(text, grounding, question) {
  const have = groundedNumbers(grounding);
  for (const d of groundedNumbers(question)) have.add(d);
  const bad = [];
  const seen = new Set();   // "$3.25 USD" is one figure, not two
  for (const m of String(text || '').matchAll(PREFIXED)) {
    const d = digitsOf(m[2]);
    if (!Number.isFinite(Number(d))) continue;
    seen.add(m.index + m[0].length - m[2].length);
    if (have.has(d)) continue;
    bad.push({ value: m[2], unit: m[1].trim(), text: m[0] });
  }
  for (const m of String(text || '').matchAll(FIGURE)) {
    if (seen.has(m.index)) continue;
    const d = digitsOf(m[1]);
    const n = Number(d);
    if (!Number.isFinite(n)) continue;
    const unit = m[2].trim();
    if (!ALWAYS.test(unit) && n <= TRIVIAL) continue;
    if (have.has(d)) continue;
    bad.push({ value: m[1], unit, text: m[0] });
  }
  // The same test for a bare year. A fetched date ("fetched 2026-09-16", "የተወሰደበት ቀን 2026-09-16") is on the
  // Source line of every page in the context, so 2026 is grounded and a dated citation survives; a year the
  // model brought with it from somewhere else is not, and the sentence carrying it goes.
  for (const m of String(text || '').matchAll(YEAR)) {
    if (have.has(m[1])) continue;
    bad.push({ value: m[1], unit: 'year', text: m[1] });
  }
  // And for a run long enough to be somebody's number. The user's own question grounds it first — a person
  // who types their phone number to ask about it must be able to see it read back. Then the mask, which no
  // amount of surrounding context can satisfy. Then the ordinary grounding test.
  const typed = groundedLongNumbers(question);
  const shapes = maskedShapes(grounding);
  const haveLong = groundedLongNumbers(grounding);
  for (const m of String(text || '').matchAll(LONGNUM)) {
    const d = onlyDigits(m[0]);
    if (d.length < LONG_MIN) continue;
    const keys = [...numberKeys(d)];
    if (keys.some(k => typed.has(k))) continue;
    if (completesMask(d, shapes)) { bad.push({ value: m[0], unit: 'number', text: m[0], reason: 'masked' }); continue; }
    if (keys.some(k => haveLong.has(k))) continue;
    bad.push({ value: m[0], unit: 'number', text: m[0] });
  }
  return bad;
}

// ---------- the calendar a date is written in ----------
// Ethiopia keeps its own calendar, seven to eight years behind the Gregorian one, and `ዓ.ም.` after a year is
// what says "this is the Ethiopian year". Measured on 2026-09-17: asked in Amharic where a rule came from,
// Bini wrote "ከመስከረም 16 ቀን 2026 ዓ.ም." — the Gregorian fetch date 2026-09-16 with the Ethiopian marker after
// it. To an Ethiopian reader that is a date seven years in the future, on an answer whose whole purpose was
// to say how current the rule is. It affects every dated Amharic citation, not one answer.
//
// The prompt now says to write `እ.ኤ.አ.`; this is the deterministic half, because a prompt is probabilistic.
// The marker is rewritten, never the sentence dropped: the date is right, only the calendar it is labelled
// with is wrong, and dropping is for a sentence that should not exist.
// The gap may not contain a digit: in "2026 እና 2018 ዓ.ም." the marker belongs to 2018, not to 2026.
//
// The Latin form is here for the same reason and was measured the same way: the Ministry of Labour audit of
// 2026-09-18 found an English answer stamping its provenance "fetched on 2011 E.C.". An English answer can
// put the Ethiopian marker on a Gregorian year exactly as an Amharic one can, and the year it labels is just
// as wrong. Only a year the Gregorian calendar is currently in is rewritten, so a genuine Ethiopian year —
// 2011 E.C., 2018 ዓ.ም. — is never touched by this rule whichever script it is written in.
const EC_MARKER = /((?:20[2-9]\d|2[1-9]\d\d))([^\n\d]{0,12}?)(?:(ዓ\/ም|ዓ\.ም)|\bE\.\s?C\b)\.?/g;

// The years the retrieved context itself writes as Ethiopian years. A document that really does print
// "2018 ዓ.ም." is quoted as it stands — the rule only rewrites a marker nothing in the context put there.
function ethiopicYears(grounding) {
  const out = new Set();
  for (const m of String(grounding || '').matchAll(EC_MARKER)) out.add(m[1]);
  return out;
}

function fixCalendarMarker(text, grounding) {
  const src = ethiopicYears(grounding);
  let fixed = 0;
  const out = String(text || '').replace(EC_MARKER, (whole, year, gap, ethiopic) => {
    if (src.has(year)) return whole;      // the source says Ethiopian year; leave it exactly as the source has it
    fixed++;
    // The correction is written in the script the mistake was written in: an Amharic reader needs እ.ኤ.አ.,
    // an English sentence reading "fetched on 2026 (እ.ኤ.አ.)" would just be a second thing to explain.
    return year + gap + (ethiopic ? '(እ.ኤ.አ.)' : '(Gregorian)');
  });
  return { text: out, fixed };
}

// Drop only the sentences that carry an invented figure. A reply is never blanked: if nothing survives the
// caller supplies a safe line instead.
function dropUngrounded(text, grounding, question) {
  const bad = findUngrounded(text, grounding, question);
  if (!bad.length) return { text: String(text || ''), dropped: [] };
  // Logged here rather than in the two callers, because this is the one line that says a privacy decision
  // was reversed rather than a figure being wrong, and it must appear on every agent's path.
  const masked = bad.filter(b => b.reason === 'masked');
  if (masked.length) console.warn('[grounding] dropped masked-number reconstruction: ' + masked.map(b => b.text).join(', '));
  // A line is a boundary as well as a full stop. A price list is written one bullet per line with no full
  // stop anywhere, so splitting on punctuation alone made the whole list one "sentence": the one invented row
  // took every true row with it, and joining the rest with spaces flattened the list. Each line is split into
  // sentences, the sentences with an invented figure go, and the lines keep their breaks and indentation.
  const lines = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) { lines.push(''); continue; }
    const kept = line.split(/(?<=[.!?።])\s+/).filter(p => !bad.some(b => p.includes(b.text)));
    if (kept.length) lines.push(kept.join(' ').replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/\s+$/, ''));
  }
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), dropped: bad };
}

// The date itself, once the marker is right: assistant/dates.js. A Gregorian date must be in the sources or be
// the exact conversion of an Ethiopian date that is; exported here so it runs wherever fixCalendarMarker does.
const { fixGregorianDates } = require('./dates');

module.exports = { findUngrounded, dropUngrounded, fixCalendarMarker, fixGregorianDates, maskedShapes, completesMask,
  FIGURE, PREFIXED, YEAR, EC_MARKER, LONGNUM, MASKED_NUMBER, TRIVIAL, LONG_MIN, OWN_NUMBERS };
