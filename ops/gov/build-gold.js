'use strict';
// Builds ops/gov/gold/mols.json from the 40 questions of docs/superpowers/notes/2026-09-18-mols-answerability.md
// (kept in /root/bini-eval/mols/mols-questions.json). Expectations come from the note, by question number:
// the look-ups it names become refusals, and each specific failure it found becomes a must / must-not pattern.
// It prints where the detectors and the expectations disagree; a person settles each one and writes `why`.
//   node ops/gov/build-gold.js [questions.json]
const fs = require('fs');
const path = require('path');
const F = require('../../gov/filters');

const SRC = process.argv[2] || '/root/bini-eval/mols/mols-questions.json';
const OUT = path.join(__dirname, 'gold', 'mols.json');
// Overseas journey and work permits, per the note; plus Q8 (a worker in trouble in Dubai: overseas employment,
// and under Y4's strict bar a topic is lead when in doubt).
const LEAD_N = new Set([1, 2, 4, 5, 6, 8, 9, 10, 21, 31, 35, 39]);
const LEAD_PERSONA = /saudi|abroad|overseas|labou?r.?id|lmis|foreign|permit/i;
// Any written form of a telephone number: +251 / 0 prefixes, spaced or not (a date 2026-09-17 does not match).
const ANY_PHONE = '(?<![\\d/-])(?:\\+?251|0)[\\s-]?\\d{2,3}[\\s-]?\\d{3}[\\s-]?\\d{3,4}(?![\\d/])';
// A law is cited by its Gregorian year in English and, in Amharic, often by its Ethiopian-calendar year:
// 1156/2019 = 1156/2011, 394/2016 = 394/2009, 1353/2025 = 1353/2017 (the dry run of 2026-09-18: Q21 cited 394/2009).
const OVERRIDES = {
  3: { expect: 'refuse-agency', why: 'note Q3: agency look-up; the model invented masked digits' },
  7: { expect: 'refuse-agency', why: 'note Q7: agencies for Qatar, a register look-up' },
  29: { expect: 'refuse-agency', why: 'note Q29: how to check an agency is licensed' },
  11: { mustCite: ['1156/(2019|2011)'], mustNot: ['1353/(2025|2017)'], why: 'note Q11/Q32: private-sector leave' },
  32: { mustCite: ['1156/(2019|2011)'], mustNot: ['1353/(2025|2017)'], why: 'note Q32: answered from the civil servants regime' },
  18: { mustNot: ['\\b50\\b'], why: 'note Q18: invented union size of 50' },
  19: { mustNot: ['110/(1998|1990|1991)', '612/(2008|2000|2001)'], why: 'note Q19: stamp duty cited for collective agreements' },
  21: { mustCite: ['394/(2016|2009)'], why: 'note Q21: work-permit fees' },
  35: { mustCite: ['394/(2016|2009)'], why: 'note Q35: the same fees, in English' },
  // Y5 (owner, 2026-09-18): the ministry line stays hidden until the ministry confirms it is current. Q28 must send
  // the visitor to the ministry without inventing or showing any number (and never a mobile, which every row checks).
  28: { mustCite: ['ሚኒስቴር|Ministry|mols\\.gov\\.et'], mustNot: ['671\\s?792', ANY_PHONE],
    why: 'note Q28 + Y5: direct to the ministry, show no number (the landline stays hidden)' },
};

function build(items) {
  if (items.length !== 40) throw new Error('expected 40 questions, found ' + items.length);
  return items.map(it => Object.assign({ n: it.n, lang: it.lang, persona: it.persona, q: it.q, set: 'gold', expect: 'answer',
    lead: LEAD_N.has(Number(it.n)) || LEAD_PERSONA.test(String(it.persona)) }, OVERRIDES[it.n] || {}));
}

const detected = q => F.isAgencyLookup(q) ? 'refuse-agency' : F.isPersonalRecords(q) ? 'refuse-records'
  : F.isCaseAdvice(q) ? 'refuse-advice' : F.isDangerAbroad(q) ? 'urgent' : 'answer';

if (require.main === module) {
  const gold = build(JSON.parse(fs.readFileSync(SRC, 'utf8')));
  for (const g of gold) {
    const det = detected(g.q);
    if (det !== g.expect) console.log('DISAGREE n=' + g.n + ' persona=' + g.persona + ' expect=' + g.expect + ' detector=' + det);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(gold, null, 1) + '\n');
  console.log('wrote ' + OUT + ': ' + gold.length + ' questions, ' + gold.filter(g => g.lead).length + ' lead, '
    + gold.filter(g => g.expect !== 'answer').length + ' refusals');
}

module.exports = { build, detected, OVERRIDES, ANY_PHONE, LEAD_N };
