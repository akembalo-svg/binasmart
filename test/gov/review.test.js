'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeReview, RETAIN_DAYS } = require('../../gov/review');

const DAY = 86_400_000;

test('a report is written scrubbed, one line, mode 600', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-rev-'));
  const t = Date.UTC(2026, 9, 1, 12);
  const r = makeReview({ root, now: () => t });
  r.add('mols', { consent: true, q: 'my number is 0900000017, mail x@y.org', a: 'Proclamation 1156/2019, fetched 2026-09-17', lang: 'en',
    sources: [{ title: 'T', url: 'https://example.org', fetched: '2026-09-17', extra: 'dropped' }, 'junk'], note: 'wrong fee' });
  const file = path.join(root, 'mols', '2026-10-01.jsonl');
  const row = JSON.parse(fs.readFileSync(file, 'utf8').trim());
  assert.equal(row.q, 'my number is [number], mail [email]');
  assert.equal(row.a, 'Proclamation 1156/2019, fetched 2026-09-17');
  assert.deepEqual(row.sources, [{ title: 'T', url: 'https://example.org', fetched: '2026-09-17' }]);
  assert.equal(row.note, 'wrong fee');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('an unknown office id or a path trick writes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-rev-'));
  const r = makeReview({ root });
  assert.equal(r.add('../etc', { consent: true, q: 'x' }), false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('files older than 90 days are deleted, newer ones kept', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-rev-'));
  let t = Date.UTC(2026, 0, 1, 12);
  const r = makeReview({ root, now: () => t });
  r.add('mols', { consent: true, q: 'old' });
  t += (RETAIN_DAYS - 1) * DAY; r.add('mols', { consent: true, q: 'recent' });
  t += 2 * DAY; r.prune(true);
  assert.deepEqual(fs.readdirSync(path.join(root, 'mols')).sort(), [new Date(t - 2 * DAY).toISOString().slice(0, 10) + '.jsonl']);
});

// Added 2026-09-18: consent is enforced here as well as in the route, so no future caller can skip it.
test('without the visitor ticking consent nothing is stored', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-rev-'));
  const r = makeReview({ root });
  for (const consent of [undefined, false, 'true', 1, 'yes', null]) {
    assert.equal(r.add('mols', { consent, q: 'what is the fee', a: 'answer' }), false, 'consent ' + String(consent));
  }
  assert.equal(r.add('mols'), false);
  assert.deepEqual(fs.readdirSync(root), [], 'not even a directory');
});

test('with consent the report is stored, in a private directory, and the flag itself is not written', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-rev-'));
  const t = Date.UTC(2026, 9, 2, 8);
  const r = makeReview({ root, now: () => t });
  assert.equal(r.add('mols', { consent: true, q: 'what is the work permit fee', a: 'an answer', lang: 'en' }), true);
  const rows = fs.readFileSync(path.join(root, 'mols', '2026-10-02.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].q, 'what is the work permit fee');
  assert.ok(!('consent' in rows[0]));
  assert.equal(fs.statSync(path.join(root, 'mols')).mode & 0o777, 0o700);
});

test('the prune runs by itself on a later report: a 91-day-old report is gone without anyone forcing it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-rev-'));
  let t = Date.UTC(2026, 0, 1, 12);
  const r = makeReview({ root, now: () => t });
  r.add('mols', { consent: true, q: 'old question' });
  t += (RETAIN_DAYS + 1) * DAY;
  r.add('mols', { consent: true, q: 'new question' });
  const left = fs.readdirSync(path.join(root, 'mols'));
  assert.deepEqual(left, [new Date(t).toISOString().slice(0, 10) + '.jsonl']);
  assert.ok(!fs.readFileSync(path.join(root, 'mols', left[0]), 'utf8').includes('old question'));
});
