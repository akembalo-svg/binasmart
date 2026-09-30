// Candidate replacement for deadlineFrom() in jobs/sites/ethiojobshub.js
const WORDNUM = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,
  fourteen:14,fifteen:15,twenty:20,thirty:30 };
const DAY = '\\d{1,2}\\s*(?:st|nd|rd|th)?';
const MON = '[A-Za-z]{3,9}\\.?';
const YEAR = '20\\d\\d';
const DATE = [
  `${MON}\\s+${DAY}\\s*,?\\s*${YEAR}`,   // June 8th, 2026 / May 18 , 2026
  `${DAY}\\s+${MON}\\s*,?\\s*${YEAR}`,   // 8 June 2026
  `\\d{4}-\\d{2}-\\d{2}`,
  `\\d{1,2}\\/\\d{1,2}\\/${YEAR}`,
].join('|');
const KEY = '(?:application|registration|submission)?\\s*(?:dead\\s*line|closing\\s+date|closing|last\\s+day\\s+of\\s+application|last\\s+day)(?:\\s+date)?';

function deadlineFrom(text, from = Date.now()) {
  const clean = String(text || '');
  // 1. a stated calendar date near a closing-date word
  const re = new RegExp(KEY + '\\s*[:\\-–—]?\\s*(' + DATE + ')', 'i');
  const m = re.exec(clean);
  let d = null;
  if (m) d = new Date(m[1].replace(/(\d)\s*(st|nd|rd|th)/i, '$1').replace(/\s+,/, ','));
  // 2. "within ten (10) days from the date of this announcement" — counted from the post's own date
  if (!d || isNaN(d.getTime())) {
    const w = new RegExp(KEY + '[^.\\n]{0,40}?within\\s+(?:([a-z]+)\\s+)?\\(?(\\d{1,2})?\\)?\\s*(?:consecutive|working|calendar)?\\s*days', 'i').exec(clean)
           || /within\s+(?:([a-z]+)\s+)?\(?(\d{1,2})?\)?\s*(?:consecutive|working|calendar)?\s*days\s+from\s+the\s+date\s+of\s+th(?:is|e)\s+(?:announcement|vacancy|advert)/i.exec(clean);
    if (w) {
      const n = Number(w[2]) || WORDNUM[String(w[1] || '').toLowerCase()] || 0;
      if (n > 0 && n <= 60) d = new Date(from + n * 86400000);
    }
  }
  if (!d || isNaN(d.getTime())) return null;
  // Unchanged guard: a closing date we got wrong is worse than none.
  if (d.getTime() < from - 86400000 || d.getTime() > from + 200 * 86400000) return null;
  return d;
}
module.exports = { deadlineFrom };
