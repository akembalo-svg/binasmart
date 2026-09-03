'use strict';
// DNav is browser code, but plan()/update() are pure geometry and pure language mapping — exactly the
// parts that must not be checked by eye. A minimal window is enough to load it.
const { test } = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('../public/ride/drivenav.js');
const DNav = global.window.DNav;

// A straight run east along a line of latitude, then the plan turns right.
// 0.001 degrees of longitude at this latitude is about 110 m.
const GEOM = [
  [38.7500, 9.0100], // 0
  [38.7510, 9.0100], // 1  ~110 m
  [38.7520, 9.0100], // 2  ~220 m
  [38.7530, 9.0100], // 3  ~330 m
  [38.7530, 9.0110], // 4  ~441 m (after turning left/north)
];
const STEPS = [
  { sign: 0, distanceM: 330, interval: [0, 3], street: 'Bole Road', text: 'Continue' },
  { sign: 2, distanceM: 111, interval: [3, 4], street: 'Cameroon St', text: 'Turn right' },
  { sign: 4, distanceM: 0, interval: [4, 4], street: '', text: 'Arrive' },
];
const at = i => ({ lat: GEOM[i][1], lng: GEOM[i][0] });

test('plan() measures the line and counts the manoeuvres', () => {
  const p = DNav.plan(STEPS, GEOM);
  assert.equal(p.points, 5);
  assert.equal(p.steps, 3);
  assert.equal(DNav.ready(), true);
});

test('the next manoeuvre is announced in Amharic with the distance to it', () => {
  DNav.plan(STEPS, GEOM);
  const nav = DNav.update(at(0));
  assert.equal(nav.offRoute, false);
  assert.equal(nav.sign, '2', 'the turn ahead, not the leg being driven');
  assert.equal(nav.icon, '➡');
  assert.match(nav.amharic, /ወደ ቀኝ ይታጠፉ/, 'turn right, in Amharic');
  assert.match(nav.amharic, /^በ3[23]0 ሜትር/, 'and how far, in Amharic');
  assert.match(nav.amharic, /Cameroon St/, 'named street');
  assert.match(nav.english, /^in 3[23]0 m · Turn right onto Cameroon St$/);
  assert.ok(nav.metresToTurn > 300 && nav.metresToTurn < 345, 'metres to the turn: ' + nav.metresToTurn);
});

test('the distance counts down as the driver approaches the turn', () => {
  DNav.plan(STEPS, GEOM);
  const far = DNav.update(at(0)).metresToTurn;
  const mid = DNav.update(at(1)).metresToTurn;
  const near = DNav.update(at(2)).metresToTurn;
  assert.ok(far > mid && mid > near, far + ' > ' + mid + ' > ' + near);
  assert.ok(near > 100 && near < 125, 'one segment left: ' + near);
});

test('at the turn the wording switches to "now" and the banner is flagged urgent', () => {
  DNav.plan(STEPS, GEOM);
  const nav = DNav.update(at(3));
  assert.ok(nav.metresToTurn < 30, 'metresToTurn ' + nav.metresToTurn);
  assert.match(nav.amharic, /^አሁን /, 'Amharic for "now"');
  assert.match(nav.english, /^now · /);
});

test('the last step reads as arrival, not as another turn', () => {
  DNav.plan(STEPS, GEOM);
  const nav = DNav.update(at(4));
  assert.equal(nav.arrived, true);
  assert.equal(nav.sign, '4');
  assert.match(nav.amharic, /ደረሱ$/, 'Amharic for arrived');
  assert.equal(nav.spokenAm, 'ደረሱ', 'spoken without a distance prefix');
  assert.ok(nav.metresToTurn <= 2, 'metresToTurn ' + nav.metresToTurn);
});

test('remaining distance to the end of the leg shrinks along the route', () => {
  DNav.plan(STEPS, GEOM);
  assert.ok(DNav.update(at(0)).remainingM > 430, 'start: ' + DNav.update(at(0)).remainingM);
  assert.ok(DNav.update(at(4)).remainingM <= 2, 'end of the line: ' + DNav.update(at(4)).remainingM);
});

test('leaving the road reports off-route instead of a stale instruction', () => {
  DNav.plan(STEPS, GEOM);
  const off = DNav.update({ lat: 9.0200, lng: 38.7500 }); // ~1.1 km north of the line
  assert.equal(off.offRoute, true);
  assert.ok(off.offBy > 500, 'offBy ' + off.offBy);
  assert.equal(off.amharic, undefined, 'no instruction is offered while off route');

  const on = DNav.update({ lat: 9.0101, lng: 38.7505 }); // ~11 m off — still on the road
  assert.equal(on.offRoute, false);
});

test('update() is silent rather than wrong when there is no plan or no position', () => {
  DNav.plan([], []);
  assert.equal(DNav.ready(), false);
  assert.equal(DNav.update(at(0)), null);
  DNav.plan(STEPS, GEOM);
  assert.equal(DNav.update(null), null);
});

test('a roundabout names the exit in Amharic', () => {
  DNav.plan([
    { sign: 0, distanceM: 220, interval: [0, 2], street: '', text: 'Continue' },
    { sign: 6, distanceM: 60, interval: [2, 3], street: 'Meskel Sq', text: 'Enter roundabout', exitNumber: 3 },
    { sign: 4, distanceM: 0, interval: [4, 4], street: '', text: 'Arrive' },
  ], GEOM);
  const nav = DNav.update(at(0));
  assert.match(nav.amharic, /ወደ ክብ መንገዱ ይግቡ/);
  assert.match(nav.amharic, /ሦስተኛውን መውጫ ይውጡ/, 'third exit, in Amharic');
  assert.match(nav.english, /take exit 3/);
});

test('every GraphHopper sign code has Amharic wording — no driver ever sees a blank instruction', () => {
  const codes = ['-98', '-8', '-7', '-6', '-3', '-2', '-1', '0', '1', '2', '3', '4', '5', '6', '7', '8'];
  for (const c of codes) {
    const t = DNav.TURN[c];
    assert.ok(t, 'missing sign ' + c);
    assert.ok(t.am && t.am.length > 2, 'no Amharic for sign ' + c);
    assert.ok(/[ሀ-፿]/.test(t.am), 'sign ' + c + ' is not actually Amharic script');
    assert.ok(t.en && t.ic, 'sign ' + c + ' missing English or icon');
  }
});

test('distances are phrased in metres then kilometres, in both languages', () => {
  assert.equal(DNav.distAm(12), 'አሁን');
  assert.equal(DNav.distEn(12), 'now');
  assert.equal(DNav.distAm(240), 'በ240 ሜትር');
  assert.equal(DNav.distEn(240), 'in 240 m');
  assert.equal(DNav.distAm(1650), 'በ1.7 ኪሎ ሜትር');
  assert.equal(DNav.distEn(1650), 'in 1.7 km');
});

test('muting is remembered and silences speech', () => {
  assert.equal(DNav.isMuted(), false, 'sound is on by default — a driver must hear an offer');
  assert.equal(DNav.setMuted(true), true);
  assert.equal(DNav.say('ወደ ቀኝ ይታጠፉ'), false, 'muted means nothing is spoken');
  DNav.setMuted(false);
  assert.equal(DNav.isMuted(), false);
});

test('speech is refused when the phone has no Amharic voice', () => {
  const v = DNav.voiceState();
  assert.equal(v.amharic, false, 'no speechSynthesis in this environment');
  assert.equal(DNav.say('ወደ ቀኝ ይታጠፉ'), false, 'Amharic through a non-Amharic voice would be gibberish');
});
