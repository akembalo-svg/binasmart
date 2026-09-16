'use strict';
// Sign-in codes: everything that can be decided without a database, a network or better-auth.
//
// A code is a password that lives five minutes, so it is kept the way a password is kept. What goes
// into auth_verification.value is SHA-256(pepper, phone, code) — a dump of that table, or a backup of
// it, is not a list of working codes. There is no way back from the stored value to the code, which is
// also why sending one again always means a NEW code and never a repeat of the old one.
//
//   identifier  phonecode:+251900000001
//   value       <64 hex>:<wrong attempts so far>
//
// The pepper (AUTH_PHONE_CODE_PEPPER) is what makes the stored hash useless to anyone holding only the
// database: six digits are a million guesses, which a laptop walks through instantly without it. It is
// set by hand, it is never logged, and hashCode refuses to work if it is short.
const crypto = require('crypto');

const CODE_LEN = 6;
const TTL_MS = 5 * 60 * 1000;                                 // a code lives five minutes
const MAX_ATTEMPTS = 5;                                       // five wrong codes ...
const LOCK_MS = 15 * 60 * 1000;                               // ... then fifteen minutes of nothing
const RESEND_MS = 60 * 1000;                                  // no second code inside a minute
const PHONE_WINDOW_MS = 15 * 60 * 1000, PHONE_MAX = 3;        // codes per number
const IP_WINDOW_MS = 60 * 60 * 1000, IP_MAX = 20;             // codes per X-Real-IP
const MIN_PEPPER = 32;
const SMS_LABEL = 'BinaSmart';
const PLACEHOLDER_DOMAIN = 'phone.bina.et';

function newCode(randomInt) {
  const r = randomInt || ((lo, hi) => crypto.randomInt(lo, hi));
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += String(r(0, 10));
  return s;
}

// The newlines are the point: without a separator, ('+25190000000', '1483920') and
// ('+251900000001', '483920') would hash to the same thing, and a code would work on a second number.
function hashCode(code, phone, pepper) {
  const p = String(pepper == null ? '' : pepper);
  if (p.length < MIN_PEPPER) throw new Error('phone-code: AUTH_PHONE_CODE_PEPPER must be at least ' + MIN_PEPPER + ' characters');
  return crypto.createHash('sha256').update(p + '\n' + String(phone) + '\n' + String(code)).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(String(a == null ? '' : a), 'utf8'), y = Buffer.from(String(b == null ? '' : b), 'utf8');
  return x.length === y.length && (x.length === 0 || crypto.timingSafeEqual(x, y));
}

function packValue(hash, attempts) {
  const n = Math.floor(Number(attempts));
  return String(hash) + ':' + String(Number.isFinite(n) && n > 0 ? n : 0);
}
function unpackValue(value) {
  const s = String(value == null ? '' : value), i = s.indexOf(':');
  if (i === -1) return { hash: s, attempts: 0 };
  const n = Math.floor(Number(s.slice(i + 1)));
  return { hash: s.slice(0, i), attempts: Number.isFinite(n) && n > 0 ? n : 0 };
}

// auth_verification is shared with e-mail verification and password resets; the prefix keeps a code row
// from ever being found — or consumed — by something that was looking for one of those.
function identifierFor(phone) { return 'phonecode:' + String(phone == null ? '' : phone); }

// A Date, a number of milliseconds or an ISO string, as milliseconds.
const ms = d => (d instanceof Date ? d.getTime() : new Date(d).getTime());

// Locked means: five wrong codes were tried, and the row that recorded them has not run out yet. The
// row IS the lock. There is no second place where a lock is kept, and no way to clear it by asking for
// another code, because tooSoon() refuses a new code while it exists.
function isLocked(row, nowMs) { return !!row && unpackValue(row.value).attempts >= MAX_ATTEMPTS && ms(row.expiresAt) > nowMs; }

// Whether a NEW code must be refused. A live code was issued at (expiresAt - TTL_MS); if that was less
// than RESEND_MS ago, the person already has one and a second SMS would only cost money. An expired
// code is not a recent one. A lock always is.
function tooSoon(row, nowMs) {
  if (!row) return false;
  if (isLocked(row, nowMs)) return true;
  if (ms(row.expiresAt) <= nowMs) return false;
  return ms(row.expiresAt) - TTL_MS > nowMs - RESEND_MS;
}

// Every way a code can be wrong, decided in one place. The caller turns all of them into the same
// answer for the visitor: how far a guess got is exactly what an attacker wants to know.
//
//   clear: true            the caller deletes the row (spent, or expired)
//   next:  { value, ... }  the caller replaces the row with this one (a wrong guess, counted)
//   neither                the caller leaves the row alone (never asked for, or locked)
function checkCode({ row, code, phone, pepper, now }) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!row) return { ok: false, reason: 'no_code', clear: false, next: null };
  const { hash, attempts } = unpackValue(row.value);
  // A row with nothing in it is not a code. sameHash of two empty strings is true by design, so the
  // empty case has to be named here, before any compare can reach it; a row holding no hash is junk.
  if (!hash) return { ok: false, reason: 'no_code', clear: true, next: null };
  if (ms(row.expiresAt) <= at) return { ok: false, reason: 'expired', clear: true, next: null };
  if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked', clear: false, next: null };
  if (sameHash(hash, hashCode(code, phone, pepper))) return { ok: true, reason: 'ok', clear: true, next: null };
  const n = attempts + 1;
  // The expiry is carried over unchanged on a wrong guess: guessing must not buy a longer window. On
  // the fifth it becomes the lock instead.
  return n >= MAX_ATTEMPTS
    ? { ok: false, reason: 'locked', clear: false, next: { value: packValue(hash, MAX_ATTEMPTS), expiresAt: new Date(at + LOCK_MS) } }
    : { ok: false, reason: 'wrong', clear: false, next: { value: packValue(hash, n), expiresAt: new Date(ms(row.expiresAt)) } };
}

// One SMS part, and it has to stay that way. messaging/sms.js labelled() puts BinaSmart and an
// Ethiopic colon in front of this, which makes the whole message UCS-2 to the operator: 70 characters
// is one part, 67 per part after that. Label (11) + this text (47) = 58. Spelling out "never share"
// in English would make it 72 and buy a second SMS on every code, on every retry, for ever.
function codeText(code) { return 'የመግቢያ ኮድ · code ' + String(code) + ' · 5 ደቂቃ/min · ለማንም አይንገሩ'; }

// A number is shown back to its owner, never in full: enough to recognise, not enough to read out.
function maskPhone(e164) {
  const s = String(e164 == null ? '' : e164);
  return s.length < 4 ? '' : '+251 ••• ' + s.slice(-4);
}

// better-auth requires an e-mail on every account and it must be unique. A phone-only account gets a
// deterministic address on a domain we own, exactly as a Telegram account gets one on telegram.bina.et,
// so it can never collide with a real mailbox — and identity.me() hides it, because it is not an
// address anybody can be written to.
function phonePlaceholderEmail(e164) { return 'p' + String(e164 == null ? '' : e164).replace(/^\+/, '') + '@' + PLACEHOLDER_DOMAIN; }
const PLACEHOLDER_RE = new RegExp('^p251\\d{9}@' + PLACEHOLDER_DOMAIN.replace(/\./g, '\\.') + '$');
function isPhonePlaceholderEmail(email) { return PLACEHOLDER_RE.test(String(email == null ? '' : email)); }

// The same shape as hotelLimiter in server.js, with an injectable clock so the windows can be tested
// without waiting a quarter of an hour. It is not exported from server.js, and this code runs inside
// auth.mjs, which is a different module — so it lives here rather than being reached across.
//
// An empty key is let through rather than counted: otherwise every caller we could not identify would
// share one bucket, and the first twenty of them would lock out the twenty-first.
function makeCodeLimiter({ windowMs, max, now = () => Date.now(), maxKeys = 5000 } = {}) {
  const m = new Map();
  return key => {
    if (key == null || key === '') return true;
    const at = now();
    const hits = (m.get(key) || []).filter(t => at - t < windowMs);
    if (hits.length >= max) { m.set(key, hits); return false; }
    hits.push(at);
    m.set(key, hits);
    if (m.size > maxKeys) for (const [k, v] of m) { if (!v.length || at - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}

module.exports = { CODE_LEN, TTL_MS, MAX_ATTEMPTS, LOCK_MS, RESEND_MS, PHONE_WINDOW_MS, PHONE_MAX, IP_WINDOW_MS, IP_MAX,
  MIN_PEPPER, SMS_LABEL, PLACEHOLDER_DOMAIN,
  newCode, hashCode, sameHash, packValue, unpackValue, identifierFor, isLocked, tooSoon, checkCode,
  codeText, maskPhone, phonePlaceholderEmail, isPhonePlaceholderEmail, makeCodeLimiter };
