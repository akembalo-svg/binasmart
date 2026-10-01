'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { stem, rankJobs } = require('../jobs/searchRank');

const J = (title, employer, titleAm) => ({ title, employer: { name: employer }, titleAm });
const rows = [
  J('Receptionist', 'HH Consulting Architects Engineering'),
  J('Human Resource Officer', 'HH Consulting Architects Engineering'),
  J('Office Engineer', 'HH Consulting Architects Engineering'),
  J('Drafts Man', 'Hosea Real Estate'),
  J('Site Engineer - Data Collector', 'Temer Properties'),
  J('Junior / Fresh Graduate Electrical Engineers', 'Tibeb Design & Build PLC'),
];

test('plural searches use the singular', () => {
  assert.strictEqual(stem('engineers'), 'engineer');
  assert.strictEqual(stem('Nurses'), 'Nurse');
  assert.strictEqual(stem('business'), 'business');
  assert.strictEqual(stem('sales'), 'sales');
  assert.strictEqual(stem('bus'), 'bus');
});

test('jobs with the word in the title come first, and only they when there are enough', () => {
  const out = rankJobs(rows, 'engineers', 6).map(j => j.title);
  assert.deepStrictEqual(out, ['Office Engineer', 'Site Engineer - Data Collector', 'Junior / Fresh Graduate Electrical Engineers']);
});

test('with fewer than three title matches the others fill the list, titles first', () => {
  const few = [J('Plumber', 'X Engineering'), J('Mechanical Engineer', 'Y'), J('Driver', 'Z Engineering')];
  assert.deepStrictEqual(rankJobs(few, 'engineer', 6).map(j => j.title), ['Mechanical Engineer', 'Plumber', 'Driver']);
});

test('an Amharic title counts as a title match', () => {
  const am = [J('Staff', 'A', 'የሂሳብ ሰራተኛ'), J('Clerk', 'B'), J('Officer', 'C', 'የሂሳብ ሰራተኛ'), J('Aide', 'D', 'የሂሳብ ሰራተኛ')];
  assert.deepStrictEqual(rankJobs(am, 'የሂሳብ ሰራተኛ', 6).map(j => j.title), ['Staff', 'Officer', 'Aide']);
});

test('no keyword keeps the deadline order', () => {
  assert.deepStrictEqual(rankJobs(rows, '', 2).map(j => j.title), ['Receptionist', 'Human Resource Officer']);
});
