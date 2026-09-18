'use strict';
// The human review of an evaluation run: shows each gold question, the answer, its sources and the machine checks,
// and records the reviewer's verdict — good | thin | wrong | refused-correctly — with a note.
// Run by the owner or a reviewer, never by a script or an agent: ops/gov/gate.js counts only these verdicts.
//
//   node ops/gov/verdicts.js --report /root/bini-eval/gov-mols-latest.json --by <name> [--all] [--status]
//   node ops/gov/verdicts.js --import <block.txt> --by <name> [--report <path>] [--partial]
//     (non-interactive: the block the owner copied from the review page, ops/gov/review-page.js; refused
//      unless its header names this report's office and timestamp and every line is a valid gold-row verdict)
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

// ---- Non-interactive import of the block the review page copies (ops/gov/review-page.js) ----
//   BINA-VERDICTS <office> <report timestamp>
//   <n> <g|t|w|r> [note]          one line per gold row; a note is required after t and w
// Pure: every problem at once, so one refusal lists everything to fix. Nothing here writes a file.
const HEADER = /^BINA-VERDICTS\s+(\S+)\s+(\S+)$/;
function parseBlock(text, report, { partial = false } = {}) {
  const errors = [], entries = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim());
  const first = lines.findIndex(l => l !== '');
  const h = first < 0 ? null : lines[first].match(HEADER);
  if (!h) return { errors: ['the first line must be the header: BINA-VERDICTS ' + report.office + ' ' + report.at], entries };
  if (h[1] !== report.office) errors.push('the block is for office ' + h[1] + ', the report is for office ' + report.office);
  if (h[2] !== report.at) errors.push('the block was written for another run (timestamp ' + h[2] + '); this report is ' + report.at
    + ': regenerate the review page and mark that run');
  const gold = new Set((report.rows || []).filter(r => r.set === 'gold').map(r => String(r.n)));
  const seen = new Set(), mentioned = new Set();
  lines.forEach((line, i) => {
    if (i <= first || line === '') return;
    const where = 'line ' + (i + 1) + ' "' + line.slice(0, 40) + '": ';
    const m = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!m) return errors.push(where + 'expected "<n> <g|t|w|r> [note]"');
    const n = m[1], code = m[2].toLowerCase(), note = (m[3] || '').trim();
    if (!gold.has(n)) return errors.push(where + n + ' is not a gold row of this report (safety rows are machine-scored)');
    mentioned.add(n);
    if (!CODES[code]) return errors.push(where + 'the letter must be one of g, t, w, r');
    if ((code === 't' || code === 'w') && !note) return errors.push(where + 'a ' + CODES[code] + ' verdict needs a note: what is missing or wrong?');
    if (seen.has(n)) return errors.push(where + 'row ' + n + ' appears twice (duplicate)');
    seen.add(n);
    entries.push({ n, code, note });
  });
  const missing = [...gold].filter(n => !mentioned.has(n));
  if (missing.length && !partial) errors.push(missing.length + ' gold row(s) missing from the block (' + missing.join(', ')
    + '); import a partial block explicitly with --partial');
  return { errors, entries, missing };
}

// Reads the block, checks it against the report, then writes verdicts and notes exactly as the interactive mode does.
// Never writes the suggestions file, never marks a safety row; on any problem it writes nothing.
function importBlock({ reportPath, text, by, partial = false, now = new Date() }) {
  if (!String(by || '').trim()) throw new Error('--by <your name> is required: every verdict records who wrote it');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const p = parseBlock(text, report, { partial });
  if (p.errors.length) throw new Error('refused, nothing written:\n  - ' + p.errors.join('\n  - '));
  const f = files(reportPath);
  let state = { verdicts: readJson(f.verdicts, {}), notes: readJson(f.notes, {}) };
  for (const e of p.entries) state = record(state, e.n, e.code, e.note, by, now);
  fs.writeFileSync(f.verdicts, JSON.stringify(state.verdicts, null, 1) + '\n');
  fs.writeFileSync(f.notes, JSON.stringify(state.notes, null, 1) + '\n');
  return { imported: p.entries.length, progress: progress(report, state.verdicts), files: f, report };
}

async function main(argv) {
  const arg = n => { const i = argv.indexOf('--' + n); return i > 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--import')) {
    const file = arg('import');
    if (!file) throw new Error('--import <file> is required');
    const text = fs.readFileSync(file, 'utf8');
    const h = (text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).find(l => l) || '').match(HEADER);
    const reportPath = arg('report') || (h ? '/root/bini-eval/gov-' + h[1].replace(/[^a-z0-9-]/gi, '') + '-latest.json' : null);
    if (!reportPath) throw new Error('refused, nothing written: the first line must be the header BINA-VERDICTS <office> <timestamp>');
    const r = importBlock({ reportPath, text, by: arg('by'), partial: argv.includes('--partial') });
    const p = r.progress;
    console.log('Imported ' + r.imported + ' verdict(s) by ' + arg('by') + ' into ' + r.files.verdicts + ' (notes: ' + r.files.notes + ')');
    console.log(p.done + ' of ' + p.gold + ' gold rows have a verdict: good ' + p.good + ', thin ' + p.thin + ', wrong ' + p.wrong
      + ' (lead ' + p.leadWrong + '), refused-correctly ' + p.refused);
    console.log(p.left ? p.left + ' gold rows left: the gate refuses the report until every gold row has a verdict.'
      : 'All verdicts written. Check the gate: node ops/gov/gate.js --office ' + r.report.office + ' --report ' + reportPath);
    return;
  }
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

module.exports = { CODES, VERDICTS, record, progress, render, files, parseBlock, importBlock };
