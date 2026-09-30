'use strict';
// The registry of channels and feeds the daily watch reads (design §2.1, §2.3, §3).
//
// It is a list of claims about who owns a handle, and the survey of 18 September 2026 showed how easily that
// claim goes wrong: @addisstandard is a satire channel called "Addis not Standard", @EthiopianAirlinesOfficial
// is a vacancies board, and a handle that does not exist answers HTTP 200. So every active entry has to say
// HOW we know it is the office's own channel, and the five impostors are named in the file itself so that no
// later helper re-discovers one of them and adds it back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops', 'watch', 'channels', 'registry.json'), 'utf8'));

const sources = reg.sources;
const active = sources.filter(s => s.active);

test('every active entry says how we know it is official', () => {
  for (const s of active) {
    assert.ok(String(s.evidence || '').trim().length > 10, s.id + ' has no evidence');
    assert.ok(s.id && s.name, s.id + ' is missing a field');
    assert.ok(s.kind === 'office' || s.kind === 'outlet', s.id + ' has no kind');
    // an outlet belongs to no office: it is read only as a net for the offices in `uncovered`
    if (s.kind === 'office') assert.ok(s.office, s.id + ' names no office');
    else assert.equal(s.office, null, s.id + ' is an outlet and must claim no office');
    assert.ok(s.handle || s.feed, s.id + ' has neither a handle nor a feed');
    assert.equal(typeof s.verified, 'boolean', s.id + ' has no verified flag');
  }
});

test('no active handle is one of the impostors', () => {
  const bad = new Set(reg.blacklist.map(b => b.handle.toLowerCase()));
  assert.ok(bad.size >= 5, 'the five known impostors are named');
  for (const b of reg.blacklist) assert.ok(String(b.what || '').trim(), b.handle + ' does not say what it really is');
  for (const s of active) {
    if (!s.handle) continue;
    assert.ok(!bad.has(s.handle.toLowerCase()), s.handle + ' is blacklisted and still active');
  }
});

test('every pack names a real directory under knowledge/', () => {
  for (const s of sources) {
    if (!s.pack) continue;
    const d = path.join(ROOT, 'knowledge', s.pack);
    assert.ok(fs.existsSync(d) && fs.statSync(d).isDirectory(), s.id + ' names a pack that does not exist: ' + s.pack);
  }
});

test('handles are unique, and a handle is written with its @', () => {
  const seen = new Set();
  for (const s of sources) {
    if (!s.handle) continue;
    assert.match(s.handle, /^@[A-Za-z0-9_]{4,32}$/, s.id + ' has a malformed handle');
    assert.ok(!seen.has(s.handle.toLowerCase()), 'duplicate handle ' + s.handle);
    seen.add(s.handle.toLowerCase());
  }
});

// 2026-09-19: Ibrahim added two outlets (Tikvah, the Prime Minister's channel) and two offices whose
// channels exist but cannot be read without an account (ICS, the Supreme Court execution office).
test('the registry holds fifteen office channels, eight outlet channels and five feeds', () => {
  const offices = sources.filter(s => s.kind === 'office' && s.handle);
  const outlets = sources.filter(s => s.kind === 'outlet' && s.handle);
  const feeds = sources.filter(s => s.feed);
  assert.equal(offices.length, 15);
  assert.equal(outlets.length, 8);
  assert.equal(feeds.length, 5);
});

test('the two entries Ibrahim has not cleared ship held back', () => {
  const air = sources.find(s => s.handle === '@ethiopian_airlines');
  assert.equal(air.verified, false, 'the airline handle is not linked from ethiopianairlines.com');
  assert.equal(air.active, false, 'an unverified handle is not read until he says yes');
  const etrade = sources.find(s => s.handle === '@etrade_gov_et');
  assert.equal(etrade.active, false, 'dormant since 2025-01-23');
  assert.match(etrade.note, /dormant/);
});

test('the eight offices with no readable channel are recorded, with the handle counts tried', () => {
  assert.equal(reg.uncovered.length, 8);
  for (const u of reg.uncovered) {
    assert.ok(u.office && u.name, 'an uncovered office is missing a name');
    assert.ok(Number.isInteger(u.handlesTried) && u.handlesTried > 0, u.office + ' does not say how many handles were tried');
    assert.ok(String(u.result || '').trim(), u.office + ' does not say what was found');
  }
});
