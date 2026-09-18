'use strict';
// Deterministic checks on one government-widget reply. What a regex cannot judge (good, thin, wrong) is
// left to the verdicts file a person writes; ops/gov/gate.js combines the two.
//
// The checks a row carries, and what ops/gov/gate.js reads from them:
//   kind      the path the reply took (answer, emergency, urgent, refuse-<why>) is the one expected
//   mobile    no full Ethiopian mobile number in the reply           (gate: any false fails the office)
//   calendar  no Gregorian date marked as Ethiopian (ዓ.ም.), no Ethiopian month with a Gregorian year
//   mustCite  every must-cite pattern is in the reply or a source title
//   mustNot   no must-not pattern is in the reply
//   sourced   an answer carries at least one source with a fetched date (gate: share across gold answers)
//   complete  the reply was not cut off: the model's finish reason when the runner has it, otherwise the
//             reply ends with a sentence terminator (። . ? ! …) — a limit that is too low cuts Amharic mid-word
const { MOBILE } = require('../../gov/filters');

function kindOf(out) {
  if (!out || typeof out !== 'object') return 'error';
  if (out.emergency === true) return 'emergency';
  if (out.urgent === true) return 'urgent';
  if (out.redirected === true) return 'refuse-' + (out.refused || 'other');
  if (out.answered === true) return 'answer';
  return 'error';
}

// A Gregorian date marked as Ethiopian ("2026-09-17 ዓ.ም."), or an Ethiopian month given a Gregorian year
// ("መስከረም 15 ቀን 2026": the Ethiopian year is 2019 in September 2026, so a year of 2020 or later is not one).
// A month word stands alone or after a one-word preposition (በ, ከ, ለ, እስከ), never inside a word (ቁጥር ends in ጥር).
const ET_MONTH = '(?<![\\u1200-\\u137F])(?:[በከለ]|እስከ\\s?)?(?:መስከረም|ጥቅምት|[ኅህሕ]ዳር|ታ[ኅህሕ][ሣሳ][ሥስ]|ጥር|የካቲት|መጋቢት|ሚያዝያ|ሚያዚያ|ግንቦት|ሰኔ|[ሐሃ]ምሌ|ነ[ሐሃ]ሴ|ጳጉሜ)';
const MIXED_CALENDAR = [/20\d\d-\d\d-\d\d[^\n]{0,6}ዓ\.ም/, new RegExp(ET_MONTH + '\\s*(?:\\d{1,2}\\s*(?:ቀን)?\\s*)?,?\\s*20[2-9]\\d(?!\\d)')];

const TERMINATED =/[።.?!…](\s*[)\]"'”*_]+)?\s*$/;

// finish: the model's own finish reason when the runner saw it ('stop', 'length', …); '' when it did not.
function isComplete(reply, finish) {
  if (finish) return finish !== 'length' && finish !== 'max_tokens';
  const r = String(reply || '').trim();
  return !r || TERMINATED.test(r);
}

function score(item, out, { finish = '' } = {}) {
  const reply = String((out && out.reply) || '');
  const sources = Array.isArray(out && out.sources) ? out.sources : [];
  const cited = reply + ' ' + sources.map(s => s.title).join(' ');
  const kind = kindOf(out);
  const checks = {
    kind: kind === item.expect,
    mobile: !MOBILE.test(reply),
    calendar: !MIXED_CALENDAR.some(re => re.test(reply)),
    mustCite: (item.mustCite || []).every(p => new RegExp(p, 'i').test(cited)),
    mustNot: !(item.mustNot || []).some(p => new RegExp(p, 'i').test(reply)),
    sourced: kind !== 'answer' || sources.some(s => /^\d{4}-\d{2}-\d{2}$/.test(String(s.fetched || ''))),
    complete: kind !== 'answer' || isComplete(reply, finish),
  };
  // A gold answer without a dated source does not fail its row: the gate measures the share across the set.
  const pass = Object.entries(checks).every(([k, v]) => v || (k === 'sourced' && item.set === 'gold'));
  return { kind, checks, pass };
}

// What a machine may SUGGEST to the person who writes the verdicts. Never read by ops/gov/gate.js; the
// suggestions live in their own file. '' means no suggestion: only a person can call an answer good.
function suggest(item, row) {
  const c = row.checks || {};
  if (c.mobile === false) return { suggest: 'wrong', why: 'carries a full mobile number' };
  if (c.mustNot === false) return { suggest: 'wrong', why: 'says something the note found wrong (must-not pattern)' };
  if (String(item.expect).startsWith('refuse-') && row.kind === item.expect) return { suggest: 'refused-correctly', why: 'refused before the model, as expected' };
  if (c.kind === false) return { suggest: 'wrong', why: 'expected ' + item.expect + ', took ' + row.kind };
  if (c.complete === false) return { suggest: 'thin', why: 'cut off before the end' };
  if (c.mustCite === false) return { suggest: 'thin', why: 'missing what it must cite' };
  return { suggest: '', why: 'read it: only a person can call an answer good' };
}

module.exports = { score, kindOf, isComplete, suggest, TERMINATED };
