'use strict';
// The RSS half of the watch. Five feeds exist and no more: Fana in two languages, The Reporter in two, and
// Addis Fortune weekly. Everything else the design tried answers 403, 404, a timeout, or a page that is not a
// feed at all — and that last one is the dangerous answer, because it arrives as HTTP 200 with a body. A
// reader that parses "no <item> elements" as "no news today" reports a healthy feed for ever.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readFeed } = require('../../ops/watch/channels/feeds');

const FIX = path.join(__dirname, '..', 'fixtures', 'watch');
const fx = n => fs.readFileSync(path.join(FIX, n), 'utf8');

test('a 403 challenge page is not a feed, and is not an empty success', () => {
  const r = readFeed(fx('feed-addisstandard-403.html'));
  assert.equal(r.live, false);
  assert.equal(r.posts.length, 0);
  assert.match(r.error, /not a feed/i);
  assert.notDeepEqual({ live: r.live, posts: r.posts }, { live: true, posts: [] });
});

test('an HTML error page served in a feed is place is not a feed either', () => {
  const r = readFeed(fx('feed-addisfortune-notafeed.html'));
  assert.equal(r.live, false);
  assert.match(r.error, /not a feed/i);
});

test('an empty body, a short body and a lone SPA shell are all refused', () => {
  for (const body of ['', '   ', '<!doctype html><html><body><div id="root"></div></body></html>']) {
    const r = readFeed(body);
    assert.equal(r.live, false);
    assert.equal(r.posts.length, 0);
  }
});

test('Fana Amharic parses to ten dated items in the watch is item shape', () => {
  const r = readFeed(fx('feed-fana-am.xml'), { id: 'fana-feed-am', lang: 'am' });
  assert.equal(r.live, true);
  assert.equal(r.posts.length, 10);
  assert.match(r.title, /Fana/i);
  for (const p of r.posts) {
    assert.match(p.at, /^\d{4}-\d{2}-\d{2}T/, 'reported_at comes from pubDate');
    assert.equal(p.date, p.at.slice(0, 10));
    assert.match(p.url, /^https?:\/\//);
    assert.ok(p.text.length > 10, 'an item carries its title as text');
    assert.ok(!/<[a-z/]/i.test(p.text), 'the description is plain text');
    assert.ok(Array.isArray(p.links));
    assert.equal(p.id, p.url);
  }
  const first = r.posts[0];
  assert.equal(first.date, '2026-09-18');
  assert.equal(first.lang, 'am');
});

test('the English feeds are read as English, and the tracking query is off the link', () => {
  const r = readFeed(fx('feed-reporter-en.xml'), { id: 'reporter-feed-en', lang: 'en' });
  assert.equal(r.posts.length, 10);
  assert.ok(r.posts.filter(p => p.lang === 'en').length >= 8);
  for (const p of r.posts) assert.ok(!/utm_source/.test(p.url), 'no utm on ' + p.url);
});

test('both Fana feeds and both Reporter feeds parse', () => {
  for (const f of ['feed-fana-am.xml', 'feed-fana-en.xml', 'feed-reporter-am.xml', 'feed-reporter-en.xml']) {
    const r = readFeed(fx(f));
    assert.equal(r.live, true, f);
    assert.equal(r.posts.length, 10, f);
  }
});

test('the module is pure: it reads XML and never the network', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'watch', 'channels', 'feeds.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(src), 'no fetch');
  assert.ok(!/require\(['"](https?|node:https?|net|dns)['"]\)/.test(src), 'no transport');
});
