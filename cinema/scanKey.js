'use strict';
// The door key. One per venue, so putting a cinema's staff on the scanner does not mean handing
// them the key to every owner route on the platform.
//
// Before this, /api/cinema/ops/checkin was gated by the global OWNER_KEY — the same key that creates
// venues, cancels shows, reads every buyer's phone number and reloads the knowledge base. The schema
// had reserved Venue.scanKey for "per-venue door staff (Phase C)" and 24 venues had none, so the only
// way to staff a door was to give away everything.
//
// WHAT IS STORED. The sha256 of the key, never the key. The key is shown once, at mint, and cannot be
// recovered afterwards — if it is lost, Ibrahim mints a new one, which retires the old one in the same
// write. A stolen database therefore yields no working door key.
//
// WHY sha256 AND NOT scrypt. scrypt exists to make guessing a LOW-entropy secret expensive. This key
// is 192 bits from crypto.randomBytes; there is nothing to guess, and scrypt would put ~100ms of work
// on the critical path of every scan at a door that is trying to move a queue.
//
// WHY NOT AN HMAC LIKE building/visit.js. That one is a short-lived stateless proof and a per-venue
// door key is neither. An HMAC would also mean one leaked server secret forges a key for every venue;
// a hash of an independent random per venue has no such shared root.
//
// WHY THE KEY DOES NOT NAME ITS VENUE. The door is found BY the key — one lookup on the unique hash.
// So a key is an opaque string that cannot be edited to point at another cinema, and the venue a
// scanner acts as is never taken from anything the client sends.
const crypto = require('crypto');

const PREFIX = 'BSCAN-';
// 24 random bytes as base64url: 32 characters, 192 bits.
const KEY_RE = /^BSCAN-[A-Za-z0-9_-]{32}$/;

// A new door key. Returned to the owner once; only its hash is kept.
function mintScanKey(randomBytes = crypto.randomBytes) {
  return PREFIX + randomBytes(24).toString('base64url');
}

// The stored form. null for anything that is not a well-formed key, so junk never reaches the
// database — a malformed key is refused before a query, not by one.
function hashScanKey(key) {
  const s = String(key == null ? '' : key).trim();
  if (!KEY_RE.test(s)) return null;
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Header first: a query string is written to the access log, the address bar and any outgoing
// Referer. The parameter stays because the scanner is opened from a link or a bookmark on a phone at
// a door, and a browser sends no custom header for a document navigation.
function scanKeyFrom(req) {
  const h = req && req.headers ? req.headers['x-scan-key'] : null;
  const q = req && req.query ? req.query.scan : null;
  return String(h || q || '').trim();
}

// What the door is handed. Deliberately a list and not a spread of the row: a Venue carries notes,
// coordinates and — until this commit — the door key itself, none of which a scanner needs.
const SCAN_VENUE_FIELDS = ['id', 'slug', 'name', 'nameAm'];
function pubScanVenue(v) {
  return v ? { id: v.id, slug: v.slug, name: v.name, nameAm: v.nameAm || null } : null;
}

// What ops is told about a key: that there is one and when it was made. Never the key.
function pubOpsVenue(v) {
  return { id: v.id, slug: v.slug, name: v.name, nameAm: v.nameAm, address: v.address, phone: v.phone,
    lat: v.lat, lng: v.lng, website: v.website, notes: v.notes, active: v.active,
    hasScanKey: !!v.scanKeyHash, scanKeyAt: v.scanKeyAt || null };
}

const scanLink = (base, key) => String(base || 'https://bina.et').replace(/\/$/, '') + '/scan?scan=' + encodeURIComponent(key);

module.exports = { mintScanKey, hashScanKey, scanKeyFrom, pubScanVenue, pubOpsVenue, scanLink, KEY_RE, PREFIX, SCAN_VENUE_FIELDS };
