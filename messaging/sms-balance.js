'use strict';
// The SMS provider's own balance, for the owner's Messages tab (design §4).
//
// The token and the provider's URL never leave the server: this calls the adapter built in messaging/sms.js and
// returns a number and a timestamp, nothing else. A refusal, a timeout, a thrown error or a payload with no number in
// it are all the same answer — "unavailable" — because the difference between them is the provider's business and
// telling an owner more would mean putting the provider's reply on a web page.
//
// The answer is cached for ten minutes: a dashboard is opened many times a day and a prepaid balance moves slowly.
// A FAILURE is cached for the same ten minutes, so a provider that is down is asked once, not once per page load.
// One in-flight call is shared, so two tabs opened together make one request.
//
//   makeSmsBalance({ provider, ttlMs, now, log }).read()
//     → { state: 'off' }                      no provider is configured — there is no token, so there is nothing to show
//     → { state: 'ok', value, at }            a number, and when it was read
//     → { state: 'unavailable', at }          the provider did not give one

const TTL_MS = 10 * 60 * 1000;

// GeezSMS does not document the balance payload (ops/messaging/sms-status.js copes the same way). The first field
// that is a number, or a string that is plainly a number, is the balance; anything else means there is none.
function numberIn(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const v of Object.values(body)) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

function makeSmsBalance({ provider = null, ttlMs = TTL_MS, now = Date.now, log = () => {} } = {}) {
  let cached = null, at = 0, inflight = null;

  async function fetchOnce() {
    let r = null;
    try { r = await provider.balance(); } catch (e) { r = null; }
    const value = r && r.ok === true ? numberIn(r.body) : null;
    // The status code is the only thing from the provider that is ever logged: no body, no URL, no token.
    if (value == null) log('[sms] balance unavailable · http ' + String((r && r.status) || 0));
    return value == null ? { state: 'unavailable' } : { state: 'ok', value };
  }

  async function read() {
    if (!provider || typeof provider.balance !== 'function') return { state: 'off' };
    const t = now();
    if (cached && t - at < ttlMs) return Object.assign({}, cached, { at: new Date(at).toISOString() });
    if (!inflight) inflight = fetchOnce().finally(() => { inflight = null; });
    const r = await inflight;
    cached = r; at = now();
    return Object.assign({}, r, { at: new Date(at).toISOString() });
  }

  return { read };
}

module.exports = { makeSmsBalance, numberIn, TTL_MS };
