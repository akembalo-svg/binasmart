'use strict';
// The human review of an evaluation run: shows each gold question, the answer, its sources and the machine checks,
// and records the reviewer's verdict — good | thin | wrong | refused-correctly — with a note.
// Run by the owner or a reviewer, never by a script or an agent: ops/gov/gate.js counts only these verdicts.
//
//   node ops/gov/verdicts.js --report /root/bini-eval/gov-mols-latest.json --by <name> [--all] [--status]
//
// Writes, next to the report, after every answer (so it can be stopped and resumed):
//   <report>-verdicts.json   { "<n>": "good" | "thin" | "wrong" | "refused-correctly" }   (what the gate reads)
//   <report>-notes.json      { "<n>": { verdict, note, by, at } }                         (who decided, and why)
// The machine suggestion (…-suggested.json) is shown labelled as a suggestion; it is never written as a verdict.
// Answers: g = good, t = thin, w = wrong, r = refused-correctly, s = skip, q = quit.
const fs = require('fs');
const readline = require('readline');

const CODES = { g: 'good', t: 'thin', w: 'wrong', r: 'refused-correctly' };
const VERDICTS = Object.values(CODES);

const files = report => ({
  verdicts: report.replace(/\.json$/, '-verdicts.json'),
  notes: report.replace(/\.json$/, '-notes.json'),
  suggested: report.replace(/\.json$/, '-suggested.json'),
});

// Pure: the new verdicts and notes after one decision. Anything but a known code changes nothing.
function record({ verdicts, notes }, n, code, note, by, now = new Date()) {
  const v = CODES[String(code || '').trim().toLowerCase()];
  if (!v) return { verdicts, notes, recorded: false };
  if (!String(by || '').trim()) throw new Error('a verdict needs the reviewer name (--by)');
  return {
    verdicts: Object.assign({}, verdicts, { [String(n)]: v }),
    notes: Object.assign({}, notes, { [String(n)]: { verdict: v, note: String(note || '').trim(), by: String(by).trim(), at: now.toISOString() } }),
    recorded: true,
  };
}

function progress(report, verdicts) {
  const gold = (report.rows || []).filter(r => r.set === 'gold');
  const done = gold.filter(r => VERDICTS.includes(verdicts[String(r.n)]));
  const count = v => done.filter(r => verdicts[String(r.n)] === v).length;
  return { gold: gold.length, done: done.length, left: gold.length - done.length,
    good: count('good'), thin: count('thin'), wrong: count('wrong'), refused: count('refused-correctly'),
    leadWrong: done.filter(r => r.lead && verdicts[String(r.n)] === 'wrong').length };
}

function render(row, suggestion) {
  const c = row.checks || {};
  const bad = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  const lines = [
    '='.repeat(72),
    'Q' + row.n + '  [' + row.lang + ']' + (row.lead ? '  LEAD TOPIC' : '') + '  expected: ' + row.expect + '  took: ' + row.kind,
    'Question: ' + row.q,
    '-'.repeat(72),
    row.reply || '(no reply' + (row.err ? ': ' + row.err : '') + ')',
    '-'.repeat(72),
    'Sources: ' + (row.sources && row.sources.length
      ? row.sources.map(s => '\n  - ' + (s.title || '?') + ' | ' + (s.url || '?') + ' | fetched ' + (s.fetched || 'NO DATE')).join('')
      : 'none'),
    'Machine checks: ' + (bad.length ? 'FAILED ' + bad.join(', ') : 'all passed') + '  (' + row.chars + ' chars'
      + (row.tokens != null ? ', ' + row.tokens + ' tokens' : '') + (row.finish ? ', finish ' + row.finish : '') + ')',
  ];
  if (suggestion && suggestion.suggest) lines.push('Machine SUGGESTION (not a verdict): ' + suggestion.suggest + ' — ' + suggestion.why);
  return lines.join('\n');
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

async function main(argv) {
  const arg = n => { const i = argv.indexOf('--' + n); return i > 0 ? argv[i + 1] : undefined; };
  const reportPath = arg('report'), by = arg('by');
  if (!reportPath) throw new Error('--report <path> is required');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const f = files(reportPath);
  let state = { verdicts: readJson(f.verdicts, {}), notes: readJson(f.notes, {}) };
  const sugg = (readJson(f.suggested, { rows: {} }).rows) || {};
  if (argv.includes('--status')) { console.log(JSON.stringify(progress(report, state.verdicts), null, 1)); return; }
  if (!by) throw new Error('--by <your name> is required: every verdict records who wrote it');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));
  const gold = report.rows.filter(r => r.set === 'gold')
    .filter(r => argv.includes('--all') || !VERDICTS.includes(state.verdicts[String(r.n)]));
  for (const row of gold) {
    console.log('\n' + render(row, sugg[String(row.n)]));
    const cur = state.verdicts[String(row.n)];
    if (cur) console.log('Current verdict: ' + cur);
    let code;
    for (;;) {
      code = String(await ask('Verdict [g]ood [t]hin [w]rong [r]efused-correctly, [s]kip, [q]uit: ')).trim().toLowerCase();
      if (CODES[code] || code === 's' || code === 'q') break;
    }
    if (code === 'q') break;
    if (code === 's') continue;
    const note = await ask('Note (why; Enter for none): ');
    state = record(state, row.n, code, note, by);
    fs.writeFileSync(f.verdicts, JSON.stringify(state.verdicts, null, 1) + '\n');
    fs.writeFileSync(f.notes, JSON.stringify(state.notes, null, 1) + '\n');
  }
  rl.close();
  const p = progress(report, state.verdicts);
  console.log('\n' + JSON.stringify(p) + (p.left ? '\n' + p.left + ' left: the gate refuses the report until every gold row has a verdict.'
    : '\nAll verdicts written. Check the gate: node ops/gov/gate.js --office ' + report.office + ' --report ' + reportPath));
}

if (require.main === module) main(process.argv).then(() => process.exit(0), e => { console.error(e.message || e); process.exit(1); });

module.exports = { CODES, VERDICTS, record, progress, render, files };
