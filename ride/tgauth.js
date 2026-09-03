'use strict';
// Telegram Mini App data is a query string signed with HMAC-SHA256:
//   secret = HMAC_SHA256(key="WebAppData", msg=botToken)
//   hash   = HMAC_SHA256(key=secret, msg="k1=v1\nk2=v2..." sorted by key, hash excluded)
// initData carries `user`; the requestContact response carries `contact`. Same scheme for both.
const crypto = require('crypto');

function secretFor(botToken) { return crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest(); }

function checkSigned(qs, botToken, maxAgeS, nowMs) {
  if (!qs || typeof qs !== 'string' || qs.length > 4096 || !botToken) return null;
  const params = new URLSearchParams(qs);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const calc = crypto.createHmac('sha256', secretFor(botToken)).update(dcs).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date'));
  const nowS = nowMs / 1000;
  if (!Number.isFinite(authDate) || nowS - authDate > maxAgeS || authDate - nowS > 300) return null;
  return params;
}

function verifyInitData(initData, botToken, opts) {
  const o = opts || {};
  const p = checkSigned(initData, botToken, o.maxAgeS || 86400, o.now || Date.now());
  if (!p) return null;
  let user = null;
  try { user = JSON.parse(p.get('user') || 'null'); } catch (e) { return null; }
  if (!user || typeof user.id !== 'number') return null;
  return { user, authDate: Number(p.get('auth_date')) };
}

function verifyContact(response, botToken, opts) {
  const o = opts || {};
  const p = checkSigned(response, botToken, o.maxAgeS || 86400, o.now || Date.now());
  if (!p) return null;
  let c = null;
  try { c = JSON.parse(p.get('contact') || 'null'); } catch (e) { return null; }
  if (!c || !c.phone_number) return null;
  return { phone: String(c.phone_number), userId: c.user_id, firstName: c.first_name };
}

// Test/tooling helper: build a signed query string the way Telegram does.
function sign(fields, botToken) {
  const entries = Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  const dcs = entries.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const hash = crypto.createHmac('sha256', secretFor(botToken)).update(dcs).digest('hex');
  return new URLSearchParams([...entries, ['hash', hash]]).toString();
}

module.exports = { verifyInitData, verifyContact, sign };
