'use strict';
// The rules half of the classifier, scored against the survey's hand labels.
//
// The regression set is real data: every bubble of the four channels the survey of 2026-09-18 classified by
// hand, joined to test/fixtures/watch/hand-labels.json by post id so that the text stays exactly as the
// captured preview holds it. 55 items, 13 of them pack-grade, 4 perishable, 3 weak, 35 excluded.
//
// What is asserted is not an accuracy number for its own sake. It is: the nine NBE notices and the customs
// opening-hours item — the two findings that justify the whole watch — are admitted; the TPLF item and the
// Siinqee Bank advertorial are refused; and the rules alone settle at least the 22 exclusions the survey
// settled by hand.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readPreview } = require('../../ops/watch/channels/preview');
const { classifyByRules, ADMITTED } = require('../../ops/watch/channels/classify');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, 'test', 'fixtures', 'watch');
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'ops', 'watch', 'channels', 'registry.json'), 'utf8'));
const hand = JSON.parse(fs.readFileSync(path.join(FIX, 'hand-labels.json'), 'utf8')).labels;

const FILES = {
  '@nbethiopia': 'tme-nbethiopia.html',
  '@EthiopianCustomsCommission': 'tme-ethiopiancustomscommission.html',
  '@ethio_telecom': 'tme-ethio_telecom.html',
  '@fanatelevision': 'tme-fanatelevision.html',
};
const byChannel = new Map();
for (const [handle, file] of Object.entries(FILES)) {
  byChannel.set(handle, readPreview(fs.readFileSync(path.join(FIX, file), 'utf8')));
}
const source = handle => registry.sources.find(s => s.handle === handle);
// every labelled post, with the registry entry it came from
const CASES = Object.entries(hand).map(([key, [label, why]]) => {
  const handle = key.slice(0, key.lastIndexOf('/'));
  const id = Number(key.slice(key.lastIndexOf('/') + 1));
  const post = byChannel.get(handle).posts.find(p => p.id === id);
  assert.ok(post, 'no such post in the fixture: ' + key);
  return { key, label, why, post, src: source(handle) };
});
const run = c => classifyByRules(c.post, { source: c.src, registry });
const goldAdmit = c => ADMITTED.has(c.label);

test('the regression set is the survey, joined to the captured pages', () => {
  assert.equal(CASES.length, 55);
  const n = l => CASES.filter(c => c.label === l).length;
  assert.deepEqual([n('pack-grade'), n('perishable'), n('weak'), n('excluded')], [13, 4, 3, 35]);
});

test('all nine NBE notices are admitted, and nothing else on that channel is', () => {
  const nbe = CASES.filter(c => c.key.startsWith('@nbethiopia/'));
  const admitted = nbe.filter(c => run(c).admit);
  assert.equal(admitted.length, 9, 'admitted: ' + admitted.map(c => c.key).join(' '));
  for (const c of nbe.filter(c => c.label === 'pack-grade')) {
    const r = run(c);
    assert.equal(r.admit, true, c.key + ' — ' + c.why + ' — ' + r.reason);
    assert.equal(r.office, 'nbe');
  }
});

test('the customs opening-hours item is admitted, and the other seven are not', () => {
  const ecc = CASES.filter(c => c.key.startsWith('@EthiopianCustomsCommission/'));
  const admitted = ecc.filter(c => run(c).admit);
  assert.deepEqual(admitted.map(c => c.key), ['@EthiopianCustomsCommission/205']);
  const r = run(admitted[0]);
  assert.equal(r.label, 'pack-grade');
  assert.equal(r.office, 'ecc');
});

test('the TPLF item and the Siinqee Bank advertorial are refused, by rule and without a model', () => {
  for (const key of ['@fanatelevision/111517', '@fanatelevision/111518']) {
    const c = CASES.find(x => x.key === key);
    const r = run(c);
    assert.equal(r.admit, false, key);
    assert.equal(r.label, 'excluded', key);
    assert.equal(r.settled, true, key + ' must not reach the model');
  }
});

test('the rules settle at least the 22 exclusions the survey settled by hand', () => {
  const thirty = CASES.filter(c => c.key.startsWith('@fanatelevision/') || c.key.startsWith('@ethio_telecom/'));
  const settledExclusions = thirty.filter(c => c.label === 'excluded' && run(c).label === 'excluded' && run(c).settled);
  assert.ok(settledExclusions.length >= 22, 'settled ' + settledExclusions.length + ' of the survey is 22');
});

test('no outlet item is admitted unless it names one of the six uncovered offices', () => {
  const uncovered = new Set(registry.uncovered.map(u => u.office));
  for (const c of CASES.filter(c => c.src && c.src.kind === 'outlet')) {
    const r = run(c);
    if (r.admit) assert.ok(uncovered.has(r.office), c.key + ' admitted for ' + r.office);
  }
});

test('the whole set: every admitted item is one the hand labelled admitted', () => {
  const wrong = [];
  for (const c of CASES) {
    const r = run(c);
    if (r.admit !== goldAdmit(c)) wrong.push(c.key + ' rules=' + r.label + '/' + r.reason + ' hand=' + c.label);
  }
  assert.deepEqual(wrong, [], wrong.length + ' disagreements');
});

test('the classifier is deterministic and reaches no network', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ops', 'watch', 'channels', 'classify.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(src), 'the rules half never calls a model');
  const c = CASES[0];
  assert.deepEqual(run(c), run(c));
});
