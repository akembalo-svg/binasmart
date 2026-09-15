'use strict';
// The rules every owner action follows, with no clock, database or model: quiet hours and the day in Addis Ababa,
// what counts as bulk, who may confirm, which months, and how the owner's text is cleaned and framed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../agents/owner/actions/policy');

const at = iso => new Date(iso);

test('quiet hours are 21:00–07:00 in Addis Ababa, whatever UTC says', () => {
  assert.equal(P.isQuiet(at('2026-09-16T18:30:00Z')), true, '21:30 Addis');
  assert.equal(P.isQuiet(at('2026-09-16T03:30:00Z')), true, '06:30 Addis');
  assert.equal(P.isQuiet(at('2026-09-16T04:30:00Z')), false, '07:30 Addis');
  assert.equal(P.isQuiet(at('2026-09-16T17:30:00Z')), false, '20:30 Addis');
  assert.equal(P.addisHour(at('2026-09-16T21:30:00Z')), 0, 'past midnight in Addis');
  assert.equal(P.addisClock(at('2026-09-16T18:05:00Z')), '21:05');
});

test('the day the two bulk sends are counted in starts at midnight in Addis, not UTC', () => {
  assert.equal(P.addisDayStart(at('2026-09-16T05:00:00Z')).toISOString(), '2026-09-15T21:00:00.000Z');
  assert.equal(P.addisDayStart(at('2026-09-16T20:59:00Z')).toISOString(), '2026-09-15T21:00:00.000Z');
  assert.equal(P.addisDayStart(at('2026-09-16T21:01:00Z')).toISOString(), '2026-09-16T21:00:00.000Z');
});

test('bulk is a message or a reminder run that reaches more than one tenant', () => {
  assert.equal(P.isBulk('message', 2), true);
  assert.equal(P.isBulk('message', 1), false);
  assert.equal(P.isBulk('remind_unpaid', 12), true);
  assert.equal(P.isBulk('remind_unpaid', 1), false, 'one unit is a single send, not a bulk send');
  assert.equal(P.isBulk('send_invoice', 5), false);
  assert.equal(P.isBulk('record_payment', 1), false);
});

test('only an owner (or the dashboard session) confirms; staff only where the building switched that on', () => {
  assert.equal(P.mayConfirm('owner', false), true);
  assert.equal(P.mayConfirm('dashboard', false), true);
  assert.equal(P.mayConfirm('staff', false), false);
  assert.equal(P.mayConfirm('staff', true), true);
  assert.equal(P.mayConfirm(undefined, true), false);
});

test('invoices may be created from three months back to next month', () => {
  const now = at('2026-09-16T09:00:00Z');
  for (const m of ['2026-06', '2026-08', '2026-09', '2026-10']) assert.equal(P.monthAllowed(m, now), true, m);
  for (const m of ['2026-05', '2026-11', '2026-13', 'September', '', null]) assert.equal(P.monthAllowed(m, now), false, String(m));
});

test('the notice is the owner\'s words, tidied and bounded — and never a name token', () => {
  assert.deepEqual(P.cleanNotice('  ነገ   ውሃ ይቋረጣል \n\n\n በ3 ሰዓት '), { ok: true, text: 'ነገ ውሃ ይቋረጣል\n\nበ3 ሰዓት' });
  assert.deepEqual(P.cleanNotice('   '), { ok: false, error: 'text_required' });
  assert.deepEqual(P.cleanNotice('Dear [[P1]], pay up'), { ok: false, error: 'text_tokens' });
  assert.deepEqual(P.cleanNotice('x'.repeat(P.NOTICE_MAX + 1)), { ok: false, error: 'text_too_long' });
  assert.equal(P.cleanNotice('x'.repeat(P.NOTICE_MAX)).ok, true);
});

test('the building name and the signature are added by code, around the owner\'s text', () => {
  const text = P.noticeTelegram({ name: 'Demo Tower', nameAm: 'ዴሞ ታወር' }, 'ነገ ውሃ ይቋረጣል');
  assert.equal(text, '📢 ዴሞ ታወር\n\nነገ ውሃ ይቋረጣል\n\n— Demo Tower · BinaSmart');
});

test('unit numbers arrive as a list or as one comma-separated string, trimmed and deduplicated', () => {
  assert.deepEqual(P.unitList('211, 212 ፣ 211'), ['211', '212']);
  assert.deepEqual(P.unitList(['G-02', ' 101 ']), ['G-02', '101']);
  assert.deepEqual(P.unitList(''), []);
  assert.deepEqual(P.unitList(null), []);
});

test('a pending action id is 22 unguessable characters, and the fingerprint changes with the figures', () => {
  const id = P.newId();
  assert.match(id, P.ID_RE);
  assert.notEqual(P.newId(), id);
  assert.equal(P.fingerprint({ a: [1, 2] }), P.fingerprint({ a: [1, 2] }));
  assert.notEqual(P.fingerprint({ a: [1, 2] }), P.fingerprint({ a: [1, 3] }));
});
