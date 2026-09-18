'use strict';
// Retention (design §5.10). The customs item is the whole argument: on 17 September it is the most useful
// thing in the survey, and on 11 October it is a false statement about opening hours.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { endDateIn, expiresFor, sweep, linkedUrls, curatedUrls } = require('../ops/watch/channels/retention');
const { readSources } = require('../knowledge/index');

const CUSTOMS_AM = 'ሁሉም የጉምሩክ ቅርንጫፍ ጽ/ቤቶች ከመስከረም 7 ቀን 2019 ዓ.ም እስከ መስከረም 30 ቀን 2019 ዓ.ም ድረስ '
  + 'ከሰኞ እስከ አርብ እስከ ምሽቱ 1፡00 ሰዓት አገልግሎት ይሰጣሉ።';

test('an item that names its own end date takes it, in either calendar', () => {
  // Meskerem 30, 2019 EC is 10 October 2026 — not a date in December, which is what ninety days would have given
  assert.equal(endDateIn(CUSTOMS_AM, { reportedAt: '2026-09-17' }), '2026-10-10');
  assert.equal(expiresFor(CUSTOMS_AM, { reportedAt: '2026-09-17' }), '2026-10-10');
  assert.equal(endDateIn('Branch offices will serve until 19:00 until 10 October 2026.', { reportedAt: '2026-09-17' }), '2026-10-10');
  assert.equal(endDateIn('The offer runs from 2026-09-20 to 2026-09-30.', { reportedAt: '2026-09-17' }), '2026-09-30',
    'the end of a range is its later date');
});

test('a year in a document number is not an end date, and neither is a date already past', () => {
  assert.equal(endDateIn('Regulation 394/2016 on the work permit fee.', { reportedAt: '2026-09-17' }), '');
  assert.equal(endDateIn('መመሪያ ቁጥር 44/2013 ተፈጻሚ ይሆናል።', { reportedAt: '2026-09-17' }), '');
  assert.equal(endDateIn('The directive was signed on 3 March 2024.', { reportedAt: '2026-09-17' }), '',
    'an end date is in the future, not the past');
  assert.equal(endDateIn('Applications are open until 1 January 2029.', { reportedAt: '2026-09-17' }), '',
    'and not two years off — that is a policy horizon, not this notice');
});

test('with no date of its own, an item lasts ninety days', () => {
  assert.equal(expiresFor('NOTICE OF FOREIGN EXCHANGE AUCTION NO. 28', { reportedAt: '2026-09-11' }), '2026-12-10');
  assert.equal(expiresFor('x', { reportedAt: '2026-09-11', ttlDays: 7 }), '2026-09-18');
});

// ---- the sweep ----
const fm = meta => ['---', ...Object.entries(meta).map(([k, v]) => k + ': "' + v + '"'), '---', ''].join('\n');
const BASE = { url: 'https://t.me/nbethiopia/412', title: 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 28',
  source_name: 'National Bank of Ethiopia', office: 'nbe', reported_by: 'National Bank of Ethiopia',
  channel: '@nbethiopia', reported_at: '2026-09-11', lang: 'en', status: 'live',
  expires_at: '2026-12-10', fetchedAt: '2026-09-12', lastChecked: '2026-09-12' };

function root(watch = {}, curated = {}) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'wret-'));
  fs.mkdirSync(path.join(r, 'knowledge', 'watch'), { recursive: true });
  for (const [f, t] of Object.entries(watch)) fs.writeFileSync(path.join(r, 'knowledge', 'watch', f), t);
  for (const [rel, t] of Object.entries(curated)) {
    fs.mkdirSync(path.join(r, 'knowledge', path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(r, 'knowledge', rel), t);
  }
  return r;
}

test('an item past its last day is retired from the index and stays on disk, word for word', () => {
  const r = root({ 'a.md': fm({ ...BASE, expires_at: '2026-10-10' }) + 'The hours applied until Meskerem 30.\n' });
  try {
    const before = fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8');
    assert.deepEqual(sweep({ root: r, today: '2026-10-10' }).expired, [], 'the last day is still a day it is true');
    const s = sweep({ root: r, today: '2026-10-11' });
    assert.deepEqual(s.expired.map(x => x.slug), ['a']);
    assert.equal(s.live, 0);
    const after = fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8');
    assert.match(after, /status: "expired"/);
    assert.match(after, /lastChecked: "2026-10-11"/);
    assert.ok(after.includes('The hours applied until Meskerem 30.'), 'the announcement itself is untouched');
    assert.equal(before.replace(/status: "live"/, 'status: "expired"').replace(/lastChecked: "2026-09-12"/, 'lastChecked: "2026-10-11"'), after);
    assert.deepEqual(readSources(r, ['watch']).map(d => d.slug), [], 'and it is out of the index');
    assert.ok(fs.existsSync(path.join(r, 'knowledge', 'watch', 'a.md')), 'nothing is deleted, ever');
  } finally { fs.rmSync(r, { recursive: true, force: true }); }
});

test('when the curated document lands, the announcement steps aside and says which one replaced it', () => {
  const pdf = 'https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf';
  const r = root(
    { 'a.md': fm(BASE) + 'On 11 September 2026, the National Bank announced an auction.\n\nLinked: ' + pdf + '\n' },
    { 'banking/nbe-foreign-exchange-auction-28.md': fm({ url: pdf, title: 'Foreign exchange auction no. 28', lang: 'en' }) + 'The auction terms.\n' });
  try {
    assert.deepEqual([...curatedUrls(r).keys()], [pdf]);
    assert.deepEqual(linkedUrls('Linked: ' + pdf + ' https://t.me/nbethiopia/412'), [pdf], 'the Telegram post is not a curated document');
    const s = sweep({ root: r, today: '2026-09-20' });
    assert.deepEqual(s.superseded, [{ slug: 'a', by: 'banking/nbe-foreign-exchange-auction-28' }]);
    const after = fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8');
    assert.match(after, /status: "superseded"/);
    assert.match(after, /superseded_by: "banking\/nbe-foreign-exchange-auction-28"/);
    assert.deepEqual(readSources(r, ['watch']).map(d => d.slug), [], 'out of the index');
    assert.deepEqual(readSources(r, ['banking']).map(d => d.slug), ['nbe-foreign-exchange-auction-28'], 'and the curated one answers instead');
    assert.ok(fs.existsSync(path.join(r, 'knowledge', 'watch', 'a.md')));
  } finally { fs.rmSync(r, { recursive: true, force: true }); }
});

test('a live item inside its days, with no curated document yet, is left exactly alone', () => {
  const r = root({ 'a.md': fm(BASE) + 'Linked: https://nbe.gov.et/uploads/auction-28.pdf\n' });
  try {
    const before = fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8');
    const s = sweep({ root: r, today: '2026-09-20' });
    assert.deepEqual([s.expired, s.superseded, s.live], [[], [], 1]);
    assert.equal(fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8'), before);
    assert.deepEqual(readSources(r, ['watch']).map(d => d.slug), ['a']);
  } finally { fs.rmSync(r, { recursive: true, force: true }); }
});

test('a dry sweep reads everything and writes nothing', () => {
  const r = root({ 'a.md': fm({ ...BASE, expires_at: '2026-09-15' }) + 'x\n' });
  try {
    const before = fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8');
    const s = sweep({ root: r, today: '2026-09-18', dryRun: true });
    assert.deepEqual(s.expired.map(x => x.slug), ['a'], 'it still says what it would retire');
    assert.equal(fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8'), before);
  } finally { fs.rmSync(r, { recursive: true, force: true }); }
});

test('an item already retired is not swept twice, and an empty watch directory is not an error', () => {
  const r = root({ 'a.md': fm({ ...BASE, status: 'superseded', superseded_by: 'law/x', expires_at: '2020-01-01' }) + 'x\n' });
  try {
    const before = fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8');
    assert.deepEqual(sweep({ root: r, today: '2026-09-18' }), { expired: [], superseded: [], live: 0 });
    assert.equal(fs.readFileSync(path.join(r, 'knowledge', 'watch', 'a.md'), 'utf8'), before);
  } finally { fs.rmSync(r, { recursive: true, force: true }); }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wret-'));
  try { assert.deepEqual(sweep({ root: empty, today: '2026-09-18' }), { expired: [], superseded: [], live: 0 }); }
  finally { fs.rmSync(empty, { recursive: true, force: true }); }
});
