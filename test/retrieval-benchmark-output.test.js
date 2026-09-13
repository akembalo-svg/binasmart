'use strict';
// The retrieval benchmark named its output retrieval-<UTC date>.json. Addis is UTC+3, so a run after
// 21:00 UTC and one the next morning in Addis shared a UTC date, and the second silently replaced the
// first: the 14 September "before the news source" run was overwritten by the "after" run ten minutes
// later. A measurement a public page quotes must not be destroyable by the next measurement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resultName, writeResult } = require('../ops/bini/rerun-retrieval-benchmark');

test('the file name carries the UTC date and time to the second', () => {
  assert.equal(resultName(new Date('2026-09-13T22:09:55.990Z')), 'retrieval-20260913-220955.json');
});

test('two runs never overwrite each other, even in the same second', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  const at = new Date('2026-09-13T22:18:25Z');
  const a = writeResult(dir, { run: 'before' }, at);
  const b = writeResult(dir, { run: 'after' }, at);
  assert.notEqual(a, b);
  assert.equal(JSON.parse(fs.readFileSync(a, 'utf8')).run, 'before');
  assert.equal(JSON.parse(fs.readFileSync(b, 'utf8')).run, 'after');
});

test('retrieval-latest.json is a copy of the newest run, and a dated file is never it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  writeResult(dir, { run: 1 }, new Date('2026-09-12T21:57:41Z'));
  const second = writeResult(dir, { run: 2 }, new Date('2026-09-13T22:09:55Z'));
  const latest = path.join(dir, 'retrieval-latest.json');
  assert.equal(JSON.parse(fs.readFileSync(latest, 'utf8')).run, 2);
  assert.equal(fs.lstatSync(latest).isSymbolicLink(), false);
  assert.notEqual(second, latest);
  const dated = fs.readdirSync(dir).filter(f => f !== 'retrieval-latest.json');
  assert.deepEqual(dated.sort(), ['retrieval-20260912-215741.json', 'retrieval-20260913-220955.json']);
});

test('a partial (--limit) run is kept but does not become latest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  writeResult(dir, { run: 'full' }, new Date('2026-09-13T22:09:55Z'));
  const partial = writeResult(dir, { run: 'partial' }, new Date('2026-09-13T22:30:00Z'), { latest: false });
  assert.equal(JSON.parse(fs.readFileSync(partial, 'utf8')).run, 'partial');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'retrieval-latest.json'), 'utf8')).run, 'full');
});

test('requiring the script does not run the benchmark', () => {
  // it would open a DB connection and spend Gemini calls just by being tested
  const mod = require('../ops/bini/rerun-retrieval-benchmark');
  assert.equal(typeof mod.writeResult, 'function');
});
