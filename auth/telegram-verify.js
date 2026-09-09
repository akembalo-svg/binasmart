'use strict';
// Telegram sign-in, both flavours. They sign the same data_check_string but derive the key differently,
// which is the trap: reuse the wrong one and every login silently fails the HMAC.
//
//   Login Widget (bina.et in a normal browser)
//     secret = SHA256(botToken)                       <- plain digest of the token
//   Mini App initData (inside Telegram)
//     secret = HMAC_SHA256(key="WebAppData", botToken)
//
// data_check_string = every field except `hash`, as "k=v", sorted by k, joined with "\n".
const crypto = require('crypto');

const MAX_AGE_S = 86400;   // Telegram's own guidance for the widget
const SKEW_S = 300;        // tolerate a clock a few minutes ahead

function dcs(entries) {
  return entries
    .filter(([k]) => k !== 'hash')
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => k + '=' + v)
    .join('\n');
}

function sameHash(calc, given) {
  const a = Buffer.from(String(calc), 'utf8'), b = Buffer.from(String(given), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function freshEnough(authDate, nowMs, maxAgeS) {
  const n = Number(authDate);
  if (!Number.isFinite(n)) return false;
  const nowS = nowMs / 1000;
  return !(nowS - n > maxAgeS || n - nowS > SKEW_S);
}

// Login Widget: the callback hands us a plain object of fields.
function verifyWidget(data, botToken, opts) {
  const o = opts || {};
  if (!data || typeof data !== 'object' || !botToken) return null;
  const hash = String(data.hash || '');
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const entries = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [String(k), String(v)]);
  if (entries.length > 24) return null;
  const secret = crypto.createHash('sha256').update(String(botToken)).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs(entries)).digest('hex');
  if (!sameHash(calc, hash)) return null;
  if (!freshEnough(data.auth_date, o.now || Date.now(), o.maxAgeS || MAX_AGE_S)) return null;
  const id = Number(data.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id: String(id),
    firstName: data.first_name ? String(data.first_name) : '',
    lastName: data.last_name ? String(data.last_name) : '',
    username: data.username ? String(data.username) : '',
    photoUrl: /^https:\/\//.test(String(data.photo_url || '')) ? String(data.photo_url) : '',
    authDate: Number(data.auth_date)
  };
}

// Mini App: initData is a query string; the user is JSON inside it.
function verifyInitData(initData, botToken, opts) {
  const o = opts || {};
  if (!initData || typeof initData !== 'string' || initData.length > 4096 || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = String(params.get('hash') || '');
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs([...params.entries()])).digest('hex');
  if (!sameHash(calc, hash)) return null;
  if (!freshEnough(params.get('auth_date'), o.now || Date.now(), o.maxAgeS || MAX_AGE_S)) return null;
  let u = null;
  try { u = JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
  if (!u || typeof u.id !== 'number') return null;
  return {
    id: String(u.id),
    firstName: u.first_name ? String(u.first_name) : '',
    lastName: u.last_name ? String(u.last_name) : '',
    username: u.username ? String(u.username) : '',
    photoUrl: /^https:\/\//.test(String(u.photo_url || '')) ? String(u.photo_url) : '',
    authDate: Number(params.get('auth_date'))
  };
}

// Telegram accounts have no email, but better-auth requires one. This address is deterministic,
// unique per Telegram id, and on a domain we own so it can never collide with a real mailbox.
function placeholderEmail(tgId) { return 'tg' + String(tgId) + '@telegram.bina.et'; }
function isPlaceholderEmail(email) { return /^tg\d+@telegram\.bina\.et$/.test(String(email || '')); }

function displayName(u) {
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return n || (u.username ? '@' + u.username : 'Telegram user');
}

// Test helper: sign fields the way Telegram does, for both flavours.
function signWidget(fields, botToken) {
  const entries = Object.entries(fields).map(([k, v]) => [String(k), String(v)]);
  const secret = crypto.createHash('sha256').update(String(botToken)).digest();
  return { ...fields, hash: crypto.createHmac('sha256', secret).update(dcs(entries)).digest('hex') };
}

module.exports = { verifyWidget, verifyInitData, placeholderEmail, isPlaceholderEmail, displayName, signWidget, MAX_AGE_S };
