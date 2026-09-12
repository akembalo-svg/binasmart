'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { closesAt, isClosed, openSince, isDateOnly, OPEN_GRACE_MS } = require('../tenders/deadline');

// "Bids close 20 September" as it is stored, and the Ethiopian working day it refers to.
const DL = new Date('2026-09-20T00:00:00Z');
const addis = iso => new Date(iso);   // written with +03:00 so the intent is readable

test('a bare date is recognised as a date and not as midnight', () => {
  assert.equal(isDateOnly(DL), true);
  assert.equal(isDateOnly(new Date('2026-09-20T14:00:00Z')), false);
  assert.equal(isDateOnly(new Date('nonsense')), false);
});

// The bug, stated as the day it happened on.
test('a tender is open through the whole of its deadline day in Addis', () => {
  assert.equal(isClosed(DL, addis('2026-09-19T23:00:00+03:00')), false, 'the night before');
  assert.equal(isClosed(DL, addis('2026-09-20T03:01:00+03:00')), false,
    'three in the morning — where the old comparison already said closed');
  assert.equal(isClosed(DL, addis('2026-09-20T09:00:00+03:00')), false, 'the office opens');
  assert.equal(isClosed(DL, addis('2026-09-20T17:00:00+03:00')), false, 'bids close at the counter');
  assert.equal(isClosed(DL, addis('2026-09-20T23:59:00+03:00')), false, 'still the deadline day');
  assert.equal(isClosed(DL, addis('2026-09-21T00:00:00+03:00')), true, 'midnight in Addis: now it is closed');
  assert.equal(isClosed(DL, addis('2026-09-21T09:00:00+03:00')), true);
});

test('the old naive comparison was wrong for 21 hours, and here is the number', () => {
  const open = closesAt(DL).getTime();
  assert.equal(open - DL.getTime(), OPEN_GRACE_MS);
  assert.equal(OPEN_GRACE_MS, 21 * 3600000);
  assert.equal(closesAt(DL).toISOString(), '2026-09-20T21:00:00.000Z', 'which is midnight in Addis');
});

// If a source ever gives a real time, that is an instant and it means it.
test('a deadline with a time of day is left exactly alone', () => {
  const at2pm = new Date('2026-09-20T14:00:00Z');
  assert.equal(closesAt(at2pm).getTime(), at2pm.getTime());
  assert.equal(isClosed(at2pm, new Date('2026-09-20T13:59:00Z')), false);
  assert.equal(isClosed(at2pm, new Date('2026-09-20T14:01:00Z')), true);
});

// 38 of 244 tenders carry no deadline; the document has the date and the page says to read it.
test('no deadline is not a closed tender', () => {
  assert.equal(isClosed(null), false);
  assert.equal(isClosed(undefined), false);
  assert.equal(closesAt(null), null);
  assert.equal(isClosed('not a date'), false, 'and neither is an unparseable one');
});

// The database filter fetches generously and lets isClosed decide, so no query models a timezone.
test('openSince fetches everything that could still be open, and never less', () => {
  const now = addis('2026-09-20T09:00:00+03:00');
  assert.equal(openSince(now).getTime(), now.getTime() - OPEN_GRACE_MS);
  assert.ok(DL >= openSince(now), 'a tender open in Addis is inside the window the query asks for');

  const yesterday = new Date('2026-09-19T00:00:00Z');
  assert.equal(isClosed(yesterday, now), true, 'and one that truly closed is rejected by isClosed');
  assert.ok(yesterday < openSince(now), 'having already fallen outside the window');
});

test('accepts what Prisma hands back and what a request body carries', () => {
  assert.equal(closesAt('2026-09-20').toISOString(), '2026-09-20T21:00:00.000Z');
  assert.equal(closesAt('2026-09-20T00:00:00.000Z').toISOString(), '2026-09-20T21:00:00.000Z');
  assert.equal(isClosed(DL, Date.now()) , isClosed(DL, new Date()), 'a number and a Date agree');
});

// ---- and that the pages actually use it ---------------------------------------------------------
// Four places compared a deadline to now, and a fifth — the browser countdown — compared to a
// different moment again. A rule only helps if every one of them asks it.
const fs = require('node:fs');
const path = require('node:path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('no page compares a deadline to the clock by hand any more', () => {
  const naive = SRC.split('\n').filter(l =>
    /deadline/.test(l) && /new Date\(\)/.test(l) && !/openSince|closesAt|tenderClosedAt/.test(l));
  assert.deepEqual(naive, [], 'a raw deadline comparison is back:\n  ' + naive.map(l => l.trim()).join('\n  '));
});

test('the countdown in the browser is given the same moment the server used', () => {
  const attrs = SRC.match(/data-deadline="\$\{[^}]*\}"/g) || [];
  assert.ok(attrs.length >= 2, 'expected the hub card and the detail page');
  for (const a of attrs) assert.match(a, /closesAt\(/, 'the browser was handed a different moment: ' + a);
});

// sourceUrl is rendered as an href, and escH says nothing about the scheme.
test('a source url is checked for being a link before it is stored', () => {
  // The whole line: the arrow body contains semicolons of its own, so stopping at the first one
  // captures a fragment that will not parse.
  const line = SRC.split(/\n/).find(l => l.trim().startsWith('const httpUrl ='));
  assert.ok(line, 'httpUrl not found');
  const httpUrl = eval('(' + line.trim().replace(/^const httpUrl = /, '').replace(/;$/, '') + ')');   // eslint-disable-line no-eval
  for (const good of ['http://x.et', 'https://ppa.gov.et/t/1', 'https://a.b/c?d=e&f=g']) assert.equal(httpUrl(good), true, good);
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'JavaScript:alert(1)', 'file:///etc/passwd', '', null, 'not a url', '//evil.example']) {
    assert.equal(httpUrl(bad), false, JSON.stringify(bad) + ' must not become an href');
  }
  for (const route of ["fastify.post('/api/admin/tender'", "fastify.post('/api/admin/tender-queue/publish'"]) {
    const at = SRC.indexOf(route);
    assert.ok(at > 0, route + ' not found');
    assert.match(SRC.slice(at, at + 1800), /httpUrl\(/, route + ' does not check its source url');
  }
});
