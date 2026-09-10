'use strict';
// Numbers an assistant made up are the dangerous kind. Asked what a driver earns, Bini answered with a
// 4.4 km trip, 12 minutes and a 239 birr fare, having called no tool at all — and a fare is the one thing
// BinaRide promises is fixed and shown before you book.
//
// The rule here is simple and checkable: a figure carrying a unit may only be said if those digits appear in
// what the assistant was actually given — the retrieved documents and the results of the tools that ran.
// Anything else was invented, and the sentence carrying it is dropped.
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

function findUngrounded(text, grounding) {
  const have = groundedNumbers(grounding);
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
  return bad;
}

// Drop only the sentences that carry an invented figure. A reply is never blanked: if nothing survives the
// caller supplies a safe line instead.
function dropUngrounded(text, grounding) {
  const bad = findUngrounded(text, grounding);
  if (!bad.length) return { text: String(text || ''), dropped: [] };
  const parts = String(text).split(/(?<=[.!?።])\s+/);
  const kept = parts.filter(p => !bad.some(b => p.includes(b.text)));
  return { text: kept.join(' ').replace(/\s{2,}/g, ' ').trim(), dropped: bad };
}

module.exports = { findUngrounded, dropUngrounded, FIGURE, TRIVIAL };
