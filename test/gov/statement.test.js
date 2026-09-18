'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { statement } = require('../../ops/gov/statement');
const { MOBILE } = require('../../gov/filters');

function ledger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-st-'));
  const day = (d, callers, proc = 'gov') => fs.writeFileSync(path.join(dir, 'day-' + d + '.' + proc + '.json'), JSON.stringify({ proc, day: d, callers }));
  day('2026-10-01', { 'office:mols|answered': { count: 30, denied: 0 }, 'office:mols|refused': { count: 4, denied: 0 },
    'office:mols|office-quota': { count: 0, denied: 2 }, 'office:other|answered': { count: 9, denied: 0 } });
  day('2026-10-02', { 'office:mols|answered': { count: 12, denied: 0 }, 'office:mols|fb-down': { count: 1, denied: 0 } });
  day('2026-11-01', { 'office:mols|answered': { count: 99, denied: 0 } });
  return { dir, day };
}

test('a month of ledger files becomes totals per outcome, answered is the billable line, and no price exists', () => {
  const { dir } = ledger();
  const s = statement({ dir, office: 'mols', month: '2026-10' });
  assert.equal(s.billable, 42);
  assert.deepEqual(s.totals, { answered: 42, refused: 4, 'fb-down': 1 });
  assert.deepEqual(s.denied, { 'office-quota': 2 });
  assert.equal(s.days.length, 2);
  assert.equal(s.price, null);
  assert.match(s.lines.join('\n'), /price: not set/);
});

test('every class that is counted and not billed is shown per day and in total', () => {
  const { dir, day } = ledger();
  day('2026-10-03', { 'office:mols|answered': { count: 5, denied: 0 }, 'office:mols|emergency': { count: 2, denied: 0 },
    'office:mols|urgent': { count: 3, denied: 0 }, 'office:mols|limited': { count: 1, denied: 0 }, 'office:mols|error': { count: 6, denied: 0 },
    'office:mols|visitor-limit': { count: 0, denied: 7 }, 'office:mols|network-limit': { count: 0, denied: 8 },
    'office:mols|fb-up': { count: 2, denied: 0 }, 'office:mols|report': { count: 1, denied: 0 } });
  day('2026-10-03', { 'office:mols|answered': { count: 1, denied: 0 } }, 'gov2');
  const s = statement({ dir, office: 'mols', month: '2026-10' });
  assert.equal(s.billable, 48);
  const d3 = s.days.find(d => d.day === '2026-10-03');
  assert.deepEqual(d3, { day: '2026-10-03', answered: 6, refused: 0, emergency: 2, urgent: 3, limited: 1, error: 6,
    'office-quota': 0, 'visitor-limit': 7, 'network-limit': 8, 'fb-up': 2, 'fb-down': 0, report: 1 });
  assert.deepEqual(s.notBilled, { refused: 4, emergency: 2, urgent: 3, limited: 1, error: 6, 'office-quota': 2, 'visitor-limit': 7, 'network-limit': 8 });
  const text = s.lines.join('\n');
  assert.match(text, /^2026-10-03\s+6\s+0\s+2\s+3\s+1\s+6\s+0\s+7\s+8\s+2\s+0\s+1$/m);
  assert.match(text, /^total\s+48\s+4\s+2\s+3\s+1\s+6\s+2\s+7\s+8\s+2\s+1\s+1$/m);
  assert.match(text, /billable \(answered questions\): 48/);
  assert.match(text, /counted, not billed: 33/);
});

test('the statement holds no personal data: only fixed words, dates and counts, whatever the ledger holds', () => {
  const { dir, day } = ledger();
  day('2026-10-04', { 'office:mols|0900000017 please call a@example.org': { count: 3, denied: 1 },
    'v:1f2e3d4c5b6a7980|q': { count: 9, denied: 0 }, 'n:0a1b2c3d4e5f6071|q': { count: 9, denied: 0 } });
  const s = statement({ dir, office: 'mols', month: '2026-10' });
  const text = s.lines.join('\n');
  assert.ok(!MOBILE.test(text) && !text.includes('@') && !text.includes('please'), text);
  for (const l of s.lines) assert.match(l, /^[A-Za-z0-9 :,().\-]*$/, l);
  assert.deepEqual(Object.keys(s).sort(), ['billable', 'days', 'denied', 'lines', 'month', 'notBilled', 'office', 'other', 'price', 'totals']);
  assert.equal(s.other, 4, 'an unknown key is counted as other, never printed');
  assert.ok(!JSON.stringify(s).includes('please'));
  assert.ok(!/1f2e3d4c|0a1b2c3d/.test(JSON.stringify(s)), 'visitor and network hashes are not the office');
});

test('a month with no ledger yet, a bad month, a bad office', () => {
  const s = statement({ dir: path.join(os.tmpdir(), 'gov-st-missing-' + process.pid), office: 'mols', month: '2026-10' });
  assert.deepEqual([s.billable, s.days.length], [0, 0]);
  assert.match(s.lines.join('\n'), /no ledger files[\s\S]*price: not set/);
  assert.throws(() => statement({ dir: os.tmpdir(), office: 'mols', month: '2026-13' }), /month/);
  assert.throws(() => statement({ dir: os.tmpdir(), office: 'mols', month: 'x' }), /month/);
  assert.throws(() => statement({ dir: os.tmpdir(), office: 'Mols Office', month: '2026-10' }), /office/);
});

test('the command line prints the statement', () => {
  const { dir } = ledger();
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'ops', 'gov', 'statement.js'), '--office', 'mols', '--month', '2026-10', '--dir', dir], { encoding: 'utf8' });
  assert.match(out, /Statement: mols, 2026-10/);
  assert.match(out, /billable \(answered questions\): 42\ncounted, not billed: 6 [\s\S]*\nprice: not set\n$/);
});
