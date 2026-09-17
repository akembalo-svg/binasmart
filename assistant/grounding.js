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

const MONEY = 'ብር|birr|birrii|ETB';
const DISTANCE = 'ኪሎ ?ሜትር|ኪ\\.?ሜ|km|kilomet\\w*|ሜትር|met(?:er|re)s?';
const PERCENT = 'በመቶ|percent|%';
const TIME = 'ደቂቃ|minutes?|mins?|ሰዓት|hours?|ቀናት?|days?|ወራት?|months?';

// number + unit
const FIGURE = new RegExp('(\\d[\\d,.٬\']*)\\s*(' + MONEY + '|' + DISTANCE + '|' + PERCENT + '|' + TIME + ')', 'gi');
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

function digitsOf(s) { return String(s).replace(/[,٬'\s]/g, '').replace(/\.0+$/, ''); }

// Every number in the grounding, normalised the same way, so "1,500" in a document matches "1500" in a reply.
function groundedNumbers(grounding) {
  const out = new Set();
  for (const m of String(grounding || '').matchAll(/\d[\d,.٬']*/g)) {
    const d = digitsOf(m[0]);
    out.add(d);
    if (d.includes('.')) out.add(d.split('.')[0]);
  }
  return out;
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
  for (const m of String(text || '').matchAll(FIGURE)) {
    const d = digitsOf(m[1]);
    const n = Number(d);
    if (!Number.isFinite(n)) continue;
    const unit = m[2].trim();
    if (!ALWAYS.test(unit) && n <= TRIVIAL) continue;
    if (have.has(d)) continue;
    if (d.includes('.') && have.has(d.split('.')[0])) continue;
    bad.push({ value: m[1], unit, text: m[0] });
  }
  // The same test for a bare year. A fetched date ("fetched 2026-09-16", "የተወሰደበት ቀን 2026-09-16") is on the
  // Source line of every page in the context, so 2026 is grounded and a dated citation survives; a year the
  // model brought with it from somewhere else is not, and the sentence carrying it goes.
  for (const m of String(text || '').matchAll(YEAR)) {
    if (have.has(m[1])) continue;
    bad.push({ value: m[1], unit: 'year', text: m[1] });
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
const EC_MARKER = /((?:20[2-9]\d|2[1-9]\d\d))([^\n\d]{0,12}?)(?:ዓ\/ም|ዓ\.ም)\.?/g;

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
  const out = String(text || '').replace(EC_MARKER, (whole, year, gap) => {
    if (src.has(year)) return whole;      // the source says Ethiopian year; leave it exactly as the source has it
    fixed++;
    return year + gap + '(እ.ኤ.አ.)';
  });
  return { text: out, fixed };
}

// Drop only the sentences that carry an invented figure. A reply is never blanked: if nothing survives the
// caller supplies a safe line instead.
function dropUngrounded(text, grounding, question) {
  const bad = findUngrounded(text, grounding, question);
  if (!bad.length) return { text: String(text || ''), dropped: [] };
  const parts = String(text).split(/(?<=[.!?።])\s+/);
  const kept = parts.filter(p => !bad.some(b => p.includes(b.text)));
  return { text: kept.join(' ').replace(/\s{2,}/g, ' ').trim(), dropped: bad };
}

module.exports = { findUngrounded, dropUngrounded, fixCalendarMarker, FIGURE, YEAR, EC_MARKER, TRIVIAL };
