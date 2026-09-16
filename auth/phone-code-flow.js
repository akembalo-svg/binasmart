'use strict';
// Signing in with a code, with every outside thing injected: the verification rows, the account rows,
// the SMS sender, the phone normaliser, the two limiters and the clock. better-auth is not imported
// here — auth/phone-code-plugin.mjs is the only file that knows about it — which is what lets the
// whole door be tested without a database, a network or a session cookie.
//
//   send({ phone, ip })     → { ok: true } | { ok: false, error: 'not_configured' | 'not_reachable' | 'rate_limited' }
//   verify({ phone, code })  → { ok: true, isRegister, user } | { ok: false, error: 'not_configured' | 'bad_code' }
//
// Two rules run through all of it:
//
// 1. Whether a number belongs to an account is never visible from outside. A working number, a number
//    nobody has ever used, a number whose SMS the provider refused and a number that already has a
//    live code all get { ok: true }. Only two things are said out loud, and neither is about an
//    account: the number cannot be reached by SMS at all (a property of the digits that were typed),
//    and you are asking too often.
// 2. Every way a code can fail is one answer, 'bad_code'. Never asked for, expired, wrong, locked out,
//    the wrong number — telling them apart is telling an attacker how far a guess got.
//
// store { find(id), create({identifier,value,expiresAt}), remove(id), findUserByPhone(e164),
//         createUser({email,name,role}), deleteUser(id) }
const pc = require('./phone-code');

function makePhoneCodeFlow({ store, sender, linkPhone, normalise, pepper, now = () => new Date(), log = () => {},
  perPhone = null, perIp = null, newCode = pc.newCode } = {}) {
  // Built once and kept: a limiter that is rebuilt per request limits nothing. The plugin keeps one
  // flow for the life of the process for exactly this reason.
  const phoneLimit = perPhone || pc.makeCodeLimiter({ windowMs: pc.PHONE_WINDOW_MS, max: pc.PHONE_MAX, now: () => now().getTime() });
  const ipLimit = perIp || pc.makeCodeLimiter({ windowMs: pc.IP_WINDOW_MS, max: pc.IP_MAX, now: () => now().getTime() });

  const ready = () => !!sender && sender.configured === true && String(pepper == null ? '' : pepper).length >= pc.MIN_PEPPER;

  async function send({ phone, ip } = {}) {
    if (!ready()) return { ok: false, error: 'not_configured' };
    const e164 = normalise(phone);
    // Not an Ethiopian mobile, or a prefix the provider cannot reach (+2517 — GeezSMS only carries
    // +2519). This is a property of the number that was typed, not of any account, so saying so leaks
    // nothing — and saying nothing would leave the person waiting for an SMS that can never arrive.
    if (!e164 || !sender.supports(e164)) return { ok: false, error: 'not_reachable' };
    // The address first, so a flood is cut off before it costs a query.
    if (!ipLimit(String(ip == null ? '' : ip))) return { ok: false, error: 'rate_limited' };
    const id = pc.identifierFor(e164);
    const at = now();
    const row = await store.find(id);
    // A code from less than a minute ago, or a lock. No new code, no SMS, and the same answer as a
    // real send — and no budget spent, because the budget is three CODES, not three requests.
    if (pc.tooSoon(row, at.getTime())) return { ok: true };
    if (!phoneLimit(e164)) return { ok: false, error: 'rate_limited' };
    if (row) await store.remove(id);                       // one number, one live code
    const code = newCode();
    await store.create({ identifier: id, value: pc.packValue(pc.hashCode(code, e164, pepper), 0), expiresAt: new Date(at.getTime() + pc.TTL_MS) });
    const r = await sender.send({ phone: e164, code });
    // The kind of failure, and nothing else: not the number, not the code, not the provider's words.
    if (!r || !r.ok) log('[phone-code] send ' + String((r && r.errorKind) || 'failed'));
    return { ok: true };
  }

  // Spending a code. Everything that can go wrong is one answer; see the note at the top of the file.
  async function verify({ phone, code } = {}) {
    if (!ready()) return { ok: false, error: 'not_configured' };
    const e164 = normalise(phone);
    // Shape first: a request that cannot possibly be right costs one regular expression, not a query.
    if (!e164 || !/^\d{6}$/.test(String(code == null ? '' : code))) return { ok: false, error: 'bad_code' };
    const id = pc.identifierFor(e164);
    const at = now();
    const row = await store.find(id);
    const r = pc.checkCode({ row, code: String(code), phone: e164, pepper, now: at });
    // Spent or expired: the row goes. A counted wrong guess: the row is replaced, which is also what
    // makes a code single-use — the old row is gone before the new one is written.
    if (r.clear) await store.remove(id);
    if (r.next) { await store.remove(id); await store.create({ identifier: id, value: r.next.value, expiresAt: r.next.expiresAt }); }
    if (!r.ok) return { ok: false, error: 'bad_code' };

    // The number is now PROVEN — an SMS to it was answered. One account, many doors: if some other
    // door already proved this number, that is the account. Otherwise a new one, with the role every
    // new account gets. 'admin', and 'owner' with a building, are granted by hand and never here.
    let user = await store.findUserByPhone(e164);
    let isRegister = false;
    if (!user) {
      user = await store.createUser({ email: pc.phonePlaceholderEmail(e164), name: pc.maskPhone(e164), role: 'user' });
      isRegister = true;
    }
    // auth/identity.js writes phone + phoneVerifiedAt and attaches the Rider and Driver rows that
    // carry the same number. It refuses to move a number another account holds; if it refuses, nobody
    // is signed in — a half-linked account is worse than a failed sign-in.
    let linked = null;
    try {
      linked = await linkPhone(user.id, e164);
    } catch (e) {
      linked = { ok: false, error: 'threw' };   // one word, like every other refusal
    }
    if (!linked || linked.ok !== true) {
      // The account was made a moment ago, for a number that could then not be proven on it.
      // Leaving it is worse than never having made it: it is a row with a placeholder address,
      // no phone and nobody who can reach it -- and because that address is derived from the
      // number and the e-mail column is unique, the orphan is exactly what the NEXT attempt on
      // the same number collides with, locking that number out of the site for good. So it is
      // taken back. Only the account THIS call created is ever removed: an account that already
      // held the number is somebody's, refusal or not.
      if (isRegister && store.deleteUser) {
        try { await store.deleteUser(user.id); }
        catch (e) { log('[phone-code] orphan account not removed'); }
      }
      log('[phone-code] link ' + String((linked && linked.error) || 'failed'));
      return { ok: false, error: 'bad_code' };
    }
    return { ok: true, isRegister, user };
  }

  return { send, verify, ready };
}

module.exports = { makePhoneCodeFlow };
