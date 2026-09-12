'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mintScanKey, hashScanKey, scanKeyFrom, pubScanVenue, pubOpsVenue, scanLink, PREFIX } = require('../../cinema/scanKey');

test('a minted key is 192 bits of randomness, and no two are the same', () => {
  const k = mintScanKey();
  assert.ok(k.startsWith(PREFIX));
  assert.equal(k.length, PREFIX.length + 32, 'BSCAN- plus 24 bytes as base64url');
  const many = new Set(); for (let i = 0; i < 500; i++) many.add(mintScanKey());
  assert.equal(many.size, 500);
});

test('only the hash is storable, and the key cannot be read back out of it', () => {
  const k = mintScanKey();
  const h = hashScanKey(k);
  assert.equal(h.length, 64);
  assert.equal(hashScanKey(k), h, 'the same key always hashes the same, so a lookup finds the venue');
  assert.ok(!h.includes(k.slice(PREFIX.length)), 'the hash carries none of the key');
  assert.notEqual(hashScanKey(mintScanKey()), h);
});

// A malformed key must be refused BEFORE a query, so junk at the door never touches the database.
test('anything that is not a well-formed key hashes to null and never reaches the database', () => {
  for (const bad of ['', null, undefined, 'BSCAN-', 'hello', 'BSCAN-short', mintScanKey().slice(0, -1),
    mintScanKey() + 'x', 'BSCAN-' + '!'.repeat(32), crypto.randomBytes(24).toString('base64url')]) {
    assert.equal(hashScanKey(bad), null, JSON.stringify(bad) + ' must not produce a lookup');
  }
});

test('a key pasted with surrounding whitespace still works — phones add it', () => {
  const k = mintScanKey();
  assert.equal(hashScanKey('  ' + k + '\n'), hashScanKey(k));
});

// The header is preferred: a query string is written to the access log, the address bar and any
// outgoing Referer. The parameter stays because the scanner is opened by navigating to a link.
test('the header is read before the query parameter', () => {
  const k = mintScanKey(), other = mintScanKey();
  assert.equal(scanKeyFrom({ headers: { 'x-scan-key': k }, query: { scan: other } }), k);
  assert.equal(scanKeyFrom({ headers: {}, query: { scan: k } }), k);
  assert.equal(scanKeyFrom({ headers: {}, query: {} }), '');
  assert.equal(scanKeyFrom({}), '');
});

test('the door is told which cinema it is and nothing else about it', () => {
  const v = { id: 'v1', slug: 'alem', name: 'Alem Cinema', nameAm: 'ዓለም', address: 'Bole Rd', phone: '+251911000111',
    lat: 9.01, lng: 38.76, notes: 'four halls, 2024 refit', scanKeyHash: 'a'.repeat(64), scanKeyAt: new Date() };
  const p = pubScanVenue(v);
  assert.deepEqual(Object.keys(p).sort(), ['id', 'name', 'nameAm', 'slug']);
  assert.equal(JSON.stringify(p).includes('a'.repeat(64)), false, 'the stored hash never leaves the server');
  assert.equal(pubScanVenue(null), null);
});

// Same shape as pubOpsDriver: every column of a real row is either published or withheld on purpose,
// so a field added to Venue later cannot auto-publish itself through ops.
test('ops is told a key exists and when it was made — never the key or its hash', () => {
  const row = { id: 'v1', slug: 'alem', name: 'Alem Cinema', nameAm: 'ዓለም', address: 'Bole Rd', phone: '+251911000111',
    lat: 9.01, lng: 38.76, website: 'https://alem.et', notes: 'four halls', active: true,
    scanKeyHash: 'b'.repeat(64), scanKeyAt: new Date('2026-09-12T06:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z') };
  const p = pubOpsVenue(row);
  assert.equal(p.hasScanKey, true);
  assert.equal(p.scanKeyAt.toISOString(), '2026-09-12T06:00:00.000Z');
  assert.equal(JSON.stringify(p).includes('b'.repeat(64)), false);
  assert.equal('scanKeyHash' in p, false);

  const WITHHELD = ['scanKeyHash', 'createdAt'];
  for (const col of Object.keys(row)) {
    assert.ok(col in p || WITHHELD.includes(col), 'Venue.' + col + ' is neither published nor withheld on purpose');
  }
  assert.equal(pubOpsVenue({ id: 'v2', scanKeyHash: null }).hasScanKey, false);
});

test('the link handed to door staff carries the key and points at the scanner', () => {
  const k = mintScanKey();
  assert.equal(scanLink('https://bina.et/', k), 'https://bina.et/scan?scan=' + encodeURIComponent(k));
  assert.ok(scanLink(null, k).startsWith('https://bina.et/scan?scan='));
});
