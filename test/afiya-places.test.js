'use strict';
// Dr Afiya and bina.et/health (30 Sep 2026). Before this, "I need a dentist in Bole" got five real dental clinics and
// the warning that they were demonstration data (the demo hospital has a department called "Dental"), and "which hospital
// near Piassa for my child with a fever" got "I cannot name a specific hospital".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../agents/afiya/rules');
const { findHealthPlaces, healthArgsFromText } = require('../assistant/health-args');

const ROWS = [{ name: 'Dental', nameAm: 'የጥርስ ህክምና', nameOm: 'Kutaa Yaala Ilkaanii', floor: 2, room: '2-06', fee: 150 },
  { name: 'Emergency', nameAm: 'ድንገተኛ ክፍል', nameOm: 'Kutaa Hatattamaa', floor: 0, room: 'E-01', fee: null }];
const prisma = { department: { findMany: async () => ROWS } };
const PLACES = { total: 2, near: 'Piassa', more: 'https://bina.et/health?q=hospital',
  results: [{ name: 'Near Hospital', kind: 'Hospital', area: 'Arada', km: 0.9, phone: '+251 11 000 0000', url: 'https://bina.et/health/near-hospital-w1' },
    { name: 'Second Hospital', kind: 'Hospital', area: 'Arada', km: 1.1, url: 'https://bina.et/health/second-hospital-w2' }] };

test('a place question is answered from the directory: places in the prompt, no demo departments, the pages kept', async () => {
  const real = rules.findPlaces; rules.findPlaces = async () => PLACES;
  try {
    const c = { msg: 'My child has fever, which hospital near Piassa is open at night?', l: 'en' };
    const ctx = await rules.context(c, { prisma });
    assert.match(ctx.prompt, /Places from BinaSmart Health/); assert.match(ctx.prompt, /Near Hospital .*0\.9 km.*near-hospital-w1/);
    assert.doesNotMatch(ctx.prompt, /demo hospital|DEMO DATA|2-06/); assert.match(ctx.grounding, /\+251 11 000 0000/);
    assert.match(rules.instruct(c), /WHERE TO GO/);
    const done = rules.finish(c, 'Near Hospital is 0.9 km away. Call first.', ctx.state);
    assert.match(done, /🏥 Near Hospital: https:\/\/bina\.et\/health\/near-hospital-w1/);   // named, so its page is added
    assert.doesNotMatch(done, /second-hospital/);                                              // not named, not added
    assert.doesNotMatch(done, /All hospitals/);                                               // a page is linked already
    assert.match(rules.finish(c, 'Please call a nearby hospital first.', ctx.state), /All hospitals, clinics and dentists: https:\/\/bina\.et\/health/);
    assert.doesNotMatch(done, /demonstration data/);
  } finally { rules.findPlaces = real; }
});

test('a question that is not about a place keeps the old path: demo departments, and the warning when they are used', async () => {
  const real = rules.findPlaces; let asked = false; rules.findPlaces = async () => { asked = true; return PLACES; };
  try {
    const c = { msg: 'which department should I go to for a toothache?', l: 'en' };
    const ctx = await rules.context(c, { prisma });
    assert.equal(asked, false); assert.match(ctx.prompt, /DEMO DATA/); assert.equal(rules.instruct(c).includes('WHERE TO GO'), false);
    assert.match(rules.finish(c, 'The Dental department is on floor 2, room 2-06.', ctx.state), /demonstration data/);
  } finally { rules.findPlaces = real; }
});

test('a health word alone is not a place search; a where is (Afiya\'s regression check, 30 Sep 2026)', () => {
  const { isHealthSearch } = require('../assistant/force');
  for (const m of ['just tell me roughly, I will check with a doctor', 'የጥርስ ሕክምና ክፍያ ስንት ነው?', 'I already saw a doctor yesterday', 'what does a dentist do for a cavity'])
    assert.equal(isHealthSearch(m), false, m);
  for (const m of ['I need a dentist', 'any hospital open now near Megenagna?', 'ፒያሳ አካባቢ ሆስፒታል', 'ሆስፒታል የት አለ?', 'dentist in Bole'])
    assert.equal(isHealthSearch(m), true, m);
});

test('reading the question: a neighbourhood becomes a point on the map, a sub-city a filter, a specialty only when asked', async () => {
  assert.deepEqual(healthArgsFromText('ለልጆች የሚሆን ክሊኒክ ቂርቆስ አካባቢ አለ?'), { area: 'kirkos', kind: 'clinic', q: 'children' });
  assert.deepEqual(healthArgsFromText('My child has a fever, which hospital near Piassa?'), { area: 'piassa', kind: 'hospital' });
  const seen = [];
  const search = q => { seen.push(q); return { results: [], nearest: [], more: 'x' }; };
  await findHealthPlaces('hospital near Piassa', { search, locateImpl: async () => ({ label: 'Piassa', lat: 9.0365, lng: 38.7512 }) });
  await findHealthPlaces('dentist in Bole', { search, locateImpl: async () => { throw new Error('a sub-city is not looked up'); } });
  assert.deepEqual([seen[0].lat, seen[0].lng, seen[0].area], [9.0365, 38.7512, undefined]);
  assert.deepEqual([seen[1].area, seen[1].kind, seen[1].lat], ['bole', 'dentist', undefined]);
});

// 30 Sep 2026, a real person on the demo hospital page: a dental check-up got only the demo hospital's room 2-06.
test('a department question that names a kind of place is a place question: the real dentists, not the demo rooms (1 Oct 2026)', async () => {
  const DENT = { total: 1, more: 'https://bina.et/health?q=dental%20clinic', results: [{ name: 'Sample Dental', kind: 'Dentist', area: 'Bole', url: 'https://bina.et/health/sample-dental-n1' }] };
  const real = rules.findPlaces;
  try {
    rules.findPlaces = async () => DENT;
    for (const c of [{ msg: 'Which department should I go to for a dental check-up, and what should I bring?', l: 'en' }, { msg: 'ለጥርስ ምርመራ የትኛው ክፍል?', l: 'am' }]) {
      const ctx = await rules.context(c, { prisma });
      assert.match(ctx.prompt, /Places from BinaSmart Health/, c.msg); assert.match(ctx.prompt, /Sample Dental/);
      assert.doesNotMatch(ctx.prompt, /DEMO DATA|2-06/, c.msg);
      assert.doesNotMatch(rules.finish(c, 'Sample Dental in Bole does check-ups. Bring your ID.', ctx.state), /demonstration data|ማሳያ/);
    }
    // no real place found: the old path, and the real list is still linked at the end
    rules.findPlaces = async () => null;
    const c = { msg: 'Which department should I go to for a dental check-up, and what should I bring?', l: 'en' };
    const done = rules.finish(c, 'The Dental department is on floor 2, room 2-06.', (await rules.context(c, { prisma })).state);
    assert.match(done, /demonstration data/);
    assert.match(done, /Real dental clinics in Addis Ababa: https:\/\/bina\.et\/health\?q=dental%20clinic/);
  } finally { rules.findPlaces = real; }
  const plain = { msg: 'What should I bring to my appointment?', l: 'en' };
  assert.doesNotMatch(rules.finish(plain, 'Bring your ID.', (await rules.context(plain, { prisma })).state), /bina\.et\/health/);
});

// The real-question replay of 30 Sep 2026: a child's fever (x2) and a child's vaccination named no kind of place.
test('a where-to-go question that names no kind gets the whole directory; a what-to-bring question still gets nothing', async () => {
  for (const [msg, l] of [['which department treats a child with fever?', 'en'], ['ልጄ ትኩሳት አለበት፣ የትኛው ክፍል ልሂድ?', 'am'], ['ልጄን የት ማስከተብ እችላለሁ?', 'am']]) {
    const c = { msg, l };
    assert.match(rules.finish(c, 'answer', (await rules.context(c, { prisma })).state), /https:\/\/bina\.et\/health(\s|$)/, msg);
  }
  const plain = { msg: 'What should I bring to my appointment?', l: 'en' };
  assert.doesNotMatch(rules.finish(plain, 'Bring your ID.', (await rules.context(plain, { prisma })).state), /bina\.et\/health/);
});
