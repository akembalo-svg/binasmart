'use strict';
// The non-interactive import of the owner's verdicts (the text block the review page copies):
// it applies only to the run it was written for, only to gold rows, only with the four verdicts,
// a note on every thin or wrong, never touches the suggestions file, and the gate reads what it writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { loadSets, rowFor, reportFor, verdictsTemplate } = require('../../ops/gov/eval');
const V = require('../../ops/gov/verdicts');

const ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'ops', 'gov', 'verdicts.js');
const GATE = path.join(ROOT, 'ops', 'gov', 'gate.js');
const SRC = [{ title: 'Labour Proclamation No. 1156/2019', url: 'https://bina.et/x', fetched: '2026-09-17' }];

function outFor(item) {
  if (item.expect === 'emergency') return { reply: 'Call an ambulance now: 907.', emergency: true };
  if (item.expect === 'urgent') return { reply: 'Federal Police 991.', urgent: true };
  if (item.expect.startsWith('refuse-')) return { reply: 'Amharic and English only; I cannot do that.', redirected: true, refused: item.expect.slice(7) };
  return { reply: 'BinaSmart, not the Ministry: I cannot submit it. Proclamation 1389/2025, Regulation 394/2016, Proclamation 1156/2019.', answered: true, sources: SRC };
}

// A fresh fixture run in a temp dir, laid out like /root/bini-eval: report, empty verdicts template, suggestions.
function fixture(at = new Date().toISOString()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-imp-'));
  const { items, partial } = loadSets({ office: 'mols' });
  const rows = items.map(it => rowFor(it, outFor(it), { ms: 5, finish: it.expect === 'answer' ? 'stop' : '' }));
  const report = reportFor({ office: 'mols', at, via: 'direct', model: 'm', maxTokens: 1600, partial, rows });
  const reportPath = path.join(dir, 'gov-mols-latest.json');
  fs.writeFileSync(reportPath, JSON.stringify(report));
  const f = V.files(reportPath);
  fs.writeFileSync(f.verdicts, JSON.stringify(verdictsTemplate(rows), null, 1) + '\n');
  fs.writeFileSync(f.suggested, '{"rows":{"1":{"suggest":"good"}}}\n');
  return { dir, report, reportPath, f };
}

// Every gold row good, or refused-correctly where the expected path is a refusal.
function fullBlock(report, at = report.at) {
  return ['BINA-VERDICTS mols ' + at].concat(report.rows.filter(r => r.set === 'gold')
    .map(r => r.n + ' ' + (r.expect === 'answer' ? 'g' : 'r'))).join('\n') + '\n';
}

const run = (args, dir) => spawnSync(process.execPath, [TOOL].concat(args), { encoding: 'utf8', cwd: dir });

test('a valid block imports: the verdicts file is what the interactive mode writes, notes carry who and when', () => {
  const { dir, report, reportPath, f } = fixture();
  const sugBefore = fs.readFileSync(f.suggested, 'utf8');
  const block = fullBlock(report).replace(/^2 g$/m, '2 t no fee given\r').replace(/^5 g$/m, '5 w   says 30 days, the law says 60  ');
  const bf = path.join(dir, 'block.txt'); fs.writeFileSync(bf, block);
  const r = run(['--import', bf, '--by', 'Tester', '--report', reportPath], dir);
  assert.equal(r.status, 0, r.stderr);
  const verdicts = JSON.parse(fs.readFileSync(f.verdicts, 'utf8'));
  const notes = JSON.parse(fs.readFileSync(f.notes, 'utf8'));
  assert.equal(Object.keys(verdicts).length, 40);
  assert.equal(verdicts['1'], 'good'); assert.equal(verdicts['2'], 'thin'); assert.equal(verdicts['5'], 'wrong');
  assert.ok(Object.values(verdicts).every(v => V.VERDICTS.includes(v)));
  assert.equal(notes['2'].note, 'no fee given'); assert.equal(notes['5'].note, 'says 30 days, the law says 60');
  assert.equal(notes['5'].by, 'Tester'); assert.match(notes['5'].at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(notes['5'].verdict, 'wrong');
  // Same serialisation as the interactive mode (V.record + JSON.stringify(x, null, 1) + newline).
  assert.equal(fs.readFileSync(f.verdicts, 'utf8'), JSON.stringify(verdicts, null, 1) + '\n');
  assert.equal(fs.readFileSync(f.suggested, 'utf8'), sugBefore, 'the suggestions file is never written');
  assert.ok(!Object.keys(verdicts).some(k => /^s/.test(k)), 'no safety row is ever marked');
  assert.match(r.stdout, /40 of 40/);
});

test('after an import the gate reads the verdicts: all good passes, one lead wrong fails', () => {
  const { dir, report, reportPath, f } = fixture();
  const bf = path.join(dir, 'block.txt'); fs.writeFileSync(bf, fullBlock(report));
  assert.equal(run(['--import', bf, '--by', 'Tester', '--report', reportPath], dir).status, 0);
  const ok = spawnSync(process.execPath, [GATE, '--office', 'mols', '--report', reportPath], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(JSON.parse(ok.stdout).pass, true);
  const lead = report.rows.find(r => r.set === 'gold' && r.lead && r.expect === 'answer');
  fs.writeFileSync(bf, fullBlock(report).replace(new RegExp('^' + lead.n + ' g$', 'm'), lead.n + ' w wrong fee'));
  assert.equal(run(['--import', bf, '--by', 'Tester', '--report', reportPath], dir).status, 0);
  const bad = spawnSync(process.execPath, [GATE, '--office', 'mols', '--report', reportPath, '--verdicts', f.verdicts], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.ok(JSON.parse(bad.stdout).reasons.some(x => /lead topics/.test(x)));
});

// Each refusal: non-zero exit, a reason naming the problem, and nothing written.
function refused(mutate, pattern, extra = []) {
  const { dir, report, reportPath, f } = fixture();
  const before = fs.readFileSync(f.verdicts, 'utf8');
  const bf = path.join(dir, 'block.txt'); fs.writeFileSync(bf, mutate(fullBlock(report), report));
  const r = run(['--import', bf, '--by', 'Tester', '--report', reportPath].concat(extra), dir);
  assert.notEqual(r.status, 0, 'should refuse: ' + r.stdout);
  assert.match(r.stderr, pattern);
  assert.equal(fs.readFileSync(f.verdicts, 'utf8'), before, 'nothing written on a refusal');
  assert.ok(!fs.existsSync(f.notes), 'no notes file on a refusal');
}

test('a block written for another run (other timestamp) is refused', () =>
  refused((b, rep) => b.replace(rep.at, '2026-09-01T00:00:00.000Z'), /another run|timestamp/));
test('a block for another office is refused', () => refused(b => b.replace('BINA-VERDICTS mols', 'BINA-VERDICTS mor'), /office/));
test('a block without the header is refused', () => refused(b => b.split('\n').slice(1).join('\n'), /header/));
test('a bad letter is refused', () => refused(b => b.replace(/^3 \w$/m, '3 x'), /line 4.*3 x|letter/));
test('a missing note on w is refused', () => refused(b => b.replace(/^4 g$/m, '4 w'), /note/));
test('a missing note on t is refused', () => refused(b => b.replace(/^4 g$/m, '4 t   '), /note/));
test('an unknown n is refused', () => refused(b => b + '41 g\n', /41.*not a gold row/));
test('a safety row is refused', () => refused(b => b + 's01 g\n', /s01/));
test('a duplicate row is refused', () => refused(b => b + '1 w changed my mind\n', /duplicate|twice/));
test('a missing row is refused without --partial', () => refused(b => b.replace(/^7 \w\n/m, ''), /missing|1 gold row/));
test('an import without --by is refused', () => {
  const { dir, report, reportPath } = fixture();
  const bf = path.join(dir, 'block.txt'); fs.writeFileSync(bf, fullBlock(report));
  const r = run(['--import', bf, '--report', reportPath], dir);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /--by/);
});

test('--partial imports what is there, keeps earlier verdicts, and says how many remain', () => {
  const { dir, report, reportPath, f } = fixture();
  const bf = path.join(dir, 'block.txt');
  fs.writeFileSync(bf, 'BINA-VERDICTS mols ' + report.at + '\n1 g\n2 t thin on fees\n');
  const r1 = run(['--import', bf, '--by', 'Tester', '--report', reportPath, '--partial'], dir);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /38 (gold rows? )?(left|remain)/);
  fs.writeFileSync(bf, 'BINA-VERDICTS mols ' + report.at + '\n6 g\n');
  const r2 = run(['--import', bf, '--by', 'Tester', '--report', reportPath, '--partial'], dir);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /37 (gold rows? )?(left|remain)/);
  const v = JSON.parse(fs.readFileSync(f.verdicts, 'utf8'));
  assert.equal(v['1'], 'good'); assert.equal(v['2'], 'thin'); assert.equal(v['6'], 'good'); assert.equal(v['7'], '');
});

test('parseBlock is pure and reports every problem at once', () => {
  const report = { office: 'mols', at: 'T1', rows: [{ n: 1, set: 'gold' }, { n: 2, set: 'gold' }, { n: 's01', set: 'safety' }] };
  const p = V.parseBlock('BINA-VERDICTS mols T1\n1 q\n2 w\n9 g\n', report);
  assert.equal(p.errors.length, 3, p.errors.join('; '));
  const ok = V.parseBlock('  BINA-VERDICTS mols T1  \n\n1 G\n2 r\n', report);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.entries, [{ n: '1', code: 'g', note: '' }, { n: '2', code: 'r', note: '' }]);
});
