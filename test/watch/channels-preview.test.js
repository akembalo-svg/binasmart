'use strict';
// The t.me/s/ preview reader, against pages captured from the live previews on 2026-09-18.
//
// The trap this test exists for: a handle that does not exist answers HTTP 200 with a page of about 9.7 KB
// (19,927 bytes when these fixtures were captured) and no message bubbles at all. A reader that trusts the
// status code reports a healthy channel with nothing new, every day, for ever. Liveness here is a channel
// title AND at least one dated bubble, and the fixture below asserts exactly that.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readPreview } = require('../../ops/watch/channels/preview');

const FIX = path.join(__dirname, '..', 'fixtures', 'watch');
const fx = n => fs.readFileSync(path.join(FIX, n), 'utf8');

test('a handle that does not exist is not a live channel, even at HTTP 200', () => {
  const r = readPreview(fx('tme-missing-handle.html'));
  assert.equal(r.live, false);
  assert.equal(r.posts.length, 0);
  assert.equal(r.title, '');
  // and the shape a careless reader would produce is explicitly not this one
  assert.notDeepEqual({ live: r.live, posts: r.posts }, { live: true, posts: [] });
});

test('the customs preview yields its title, its eight bubbles and their ISO dates', () => {
  const r = readPreview(fx('tme-ethiopiancustomscommission.html'));
  assert.equal(r.live, true);
  assert.equal(r.title, 'Ethiopian Customs Commission');
  assert.equal(r.handle, '@EthiopianCustomsCommission');
  assert.equal(r.posts.length, 8);
  const first = r.posts[0];
  assert.equal(first.id, 187);
  assert.match(first.at, /^2025-07-31T\d\d:\d\d:\d\d/);
  assert.equal(first.date, '2025-07-31');
  assert.equal(first.url, 'https://t.me/EthiopianCustomsCommission/187');
  for (const p of r.posts) assert.match(p.at, /^\d{4}-\d{2}-\d{2}T/);
  // ascending by id, as the preview serves them
  const ids = r.posts.map(p => p.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('bubble text is plain text: no tags, no entities, line breaks kept', () => {
  const r = readPreview(fx('tme-ethiopiancustomscommission.html'));
  const withText = r.posts.filter(p => p.text.length > 40);
  assert.ok(withText.length >= 6, 'most customs bubbles carry text');
  for (const p of r.posts) {
    assert.ok(!/<[a-z/]/i.test(p.text), 'no markup in ' + p.id);
    assert.ok(!/&(quot|amp|lt|gt|nbsp|#\d+);/.test(p.text), 'no entities in ' + p.id);
  }
  assert.ok(withText.some(p => p.text.includes('\n')), 'a br becomes a line break');
});

test('Amharic is detected, and English is not called Amharic', () => {
  const ecc = readPreview(fx('tme-ethiopiancustomscommission.html'));
  const am = ecc.posts.filter(p => p.lang === 'am').length;
  assert.ok(am >= 6, 'the customs channel is Amharic: ' + am + ' of ' + ecc.posts.length);
  const nbe = readPreview(fx('tme-nbethiopia.html'));
  assert.equal(nbe.posts.length, 16);
  const en = nbe.posts.filter(p => p.lang === 'en').length;
  assert.ok(en >= 12, 'the NBE channel is English: ' + en + ' of 16');
});

test('links are the ones the post points at, with Telegram is own plumbing stripped', () => {
  const r = readPreview(fx('tme-ethiopiancustomscommission.html'));
  const all = r.posts.flatMap(p => p.links);
  assert.ok(all.length > 0);
  for (const u of all) {
    assert.ok(!/^https?:\/\/(t\.me|telegram\.org|telegram\.me)\b/i.test(u), u + ' is Telegram plumbing');
    assert.match(u, /^https?:\/\//);
  }
  assert.ok(all.some(u => /ecc\.gov\.et/i.test(u)), 'the commission links its own host');
});

test('the busiest fixtures parse to the counts the survey measured', () => {
  assert.equal(readPreview(fx('tme-fanatelevision.html')).posts.length, 19);
  assert.equal(readPreview(fx('tme-ethio_telecom.html')).posts.length, 20);
});

test('the module is pure: it reads HTML and never the network', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'watch', 'channels', 'preview.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(src), 'no fetch');
  assert.ok(!/require\(['"](https?|node:https?|net|dns)['"]\)/.test(src), 'no transport');
});
