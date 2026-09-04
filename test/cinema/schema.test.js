'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
const model = name => (schema.match(new RegExp('model ' + name + ' \\{[\\s\\S]*?\\n\\}')) || [''])[0];

test('cinema models exist', () => {
  for (const m of ['Venue', 'Hall', 'Show', 'SeatHold', 'Ticket']) assert.ok(model(m), m + ' missing');
});
test('a seat can be held by at most one person per show — enforced by the database, not the app', () => {
  assert.match(model('SeatHold'), /@@unique\(\[showId, seat\]\)/);
  assert.match(model('SeatHold'), /expiresAt\s+DateTime/);
});
test('tickets carry their seats, a unique code and a status', () => {
  const t = model('Ticket');
  assert.match(t, /code\s+String\s+@unique/);
  assert.match(t, /seats\s+String\[\]/);
  assert.match(t, /status\s+String\s+@default\("RESERVED"\)/);
  assert.match(t, /payMethod/);
  assert.match(t, /idemKey\s+String\?\s+@unique/);
});
test('Event gained the film fields and Show links Event to Hall with prices per section', () => {
  assert.match(model('Event'), /posterUrl\s+String\?/);
  assert.match(model('Event'), /shows\s+Show\[\]/);
  assert.match(model('Show'), /prices\s+Json/);
  assert.match(model('Show'), /counterCutoffMin\s+Int\s+@default\(30\)/);
});
