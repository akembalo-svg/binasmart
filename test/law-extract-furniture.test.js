'use strict';
// ops/mor/law-extract.py drops page furniture. The gazette's name used to be furniture wherever it appeared, which cut
// the body line "publication in the Federal Negarit Gazette." out of Tax Administration (Amendment) 1434/2026 Art. 3,
// leaving "shall enter into force upon Done at Addis Ababa". Only running heads and mastheads may go.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'ops', 'mor', 'law-extract.py');

const CASES = [
  // running heads and mastheads: furniture
  ['gA Ød‰L qÜ_R ›.M Federal Negarit Gazette No.48, 30 th July, 2026..page', true],
  ['Federal Negarit Gazette No.61, 21 August, 2024….page', true],
  ['‘Ti %.9° Federal Negarit Gazette No. 66 9" May, 2016......page', true],
  ['7 RG 49° Federal Negarit Gazette No. 82., 25*', true],
  ['FEDERAL NEGARIT GAZETTE', true],
  ['FEDERAL NEGARIT GAZETTE EXTRAORDINARY ISSUE', true],
  ['Federal Negarit Gazette Extraordinary Issue', true],
  ['ፌደራል ነጋሪት ጋዜጣ', true],
  ['19927', true],
  // body text that names the gazette: kept
  ['publication in the Federal Negarit Gazette.', false],
  ['Publication in the Federal Negarit Gazette.', false],
  ['This Proclamation shall enter into force on the date of its publication in the Federal Negarit Gazette.', false],
  ['Federal Negarit Gazette.', false],
  ['ይህ አዋጅ በፌዴራል ነጋሪት ጋዜጣ ታትሞ', false],
  ['ከወጣበት ቀን ጀምሮ በፌዴራል ነጋሪት ጋዜጣ ላይ ታትሞ የጸና ይሆናል።', false],
];

function python() {
  const r = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

test('law-extract: the gazette name is furniture only as a running head or masthead', { skip: !python() && 'python3 not installed' }, () => {
  const code = [
    'import importlib.util, json, sys',
    'sys.dont_write_bytecode = True',
    'spec = importlib.util.spec_from_file_location("le", sys.argv[1])',
    'le = importlib.util.module_from_spec(spec); spec.loader.exec_module(le)',
    'cases = json.loads(sys.stdin.read())',
    'print(json.dumps([bool(le.is_furniture(s)) for s, _ in cases]))',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code, SCRIPT], { input: JSON.stringify(CASES), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  CASES.forEach(([line, want], i) => assert.strictEqual(got[i], want, line));
});

test('law-extract output: 1434/2026 Art. 3 keeps the publication clause', () => {
  const md = fs.readFileSync(path.join(ROOT, 'knowledge', 'law', 'tax-administration-amendment-1434-2026.md'), 'utf8');
  const art3 = md.slice(md.lastIndexOf('3. Effective Date'));
  assert.match(art3, /shall enter into force upon\s+publication in the Federal Negarit Gazette\./);
  assert.doesNotMatch(art3, /upon\s+Done at/);
});
