'use strict';
// SMS for tenant messages (and, in Plan D, sign-in codes). One provider interface; GeezSMS is the first provider.
//
//   provider = { name, send({ to, text, sender, callbackUrl }) → { ok, providerId, error }, balance(), supports(e164) }
//   makeSms({ mode, tenantMode, provider, supports, sender, callbackUrl, log }).send({ to, text, sender, live })
//     → { status: 'test' } | { status: 'sent', providerId } | { status: 'failed', errorKind }
//
// TWO SWITCHES, not one. SMS_MODE is the provider switch: nothing at all leaves the server unless it is 'live', a
// provider token is configured, AND the caller passes live: true. SMS_TENANT_MODE is the second, narrower switch, read
// by messaging/delivery.js: it decides whether a message to a TENANT may be one of those live: true calls. A sign-in
// code (sendTransactionalSms) is not a tenant message and does not read it. This layer only reports `tenantMode`;
// it never sends differently because of it. Credentials come only from the environment:
//   SMS_PROVIDER=geezsms  SMS_API_TOKEN  SMS_SHORTCODE_ID (optional)  SMS_MODE=test|live (default test)
//   SMS_TENANT_MODE=test|live (default test) - tenant-facing SMS, and only while SMS_MODE is live
// Logs never carry a phone number, a token or the text.

// GeezSMS: msg must be shorter than 335 characters.
const SMS_MAX_CHARS = 334;
const GEEZ_BASE = 'https://api.geezsms.com';

// +2519XXXXXXXX (Ethio Telecom) and +2517XXXXXXXX (Safaricom Ethiopia); anything else is not a mobile.
function normalizeEtMobile(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[\s\-.()]/g, '');
  if (/^0[79]\d{8}$/.test(s)) s = '+251' + s.slice(1);
  else if (/^00251[79]\d{8}$/.test(s)) s = '+' + s.slice(2);
  else if (/^251[79]\d{8}$/.test(s)) s = '+' + s;
  return /^\+251[79]\d{8}$/.test(s) ? s : null;
}

// GeezSMS documents phone numbers starting 2519. Whether it reaches 2517 (Safaricom) is an open fact: until it is
// confirmed, those tenants count as not reachable by SMS.
const geezSupports = e164 => /^\+2519\d{8}$/.test(String(e164 || ''));

// Until a sender name is approved every SMS goes out under GeezSMS's default shortcode, so the text itself must say who
// is writing. labelled() is the only way the delivery layer builds an SMS: no label, no SMS.
function labelled(label, body) {
  const l = String(label == null ? '' : label).trim();
  if (!l) throw new Error('sms: a label (the service or building) is required at the start of every SMS');
  return l + '፦ ' + String(body == null ? '' : body);
}
const buildingSmsLabel = name => { const n = String(name == null ? '' : name).trim().slice(0, 40); return n ? 'BinaSmart · ' + n : 'BinaSmart'; };
// GeezSMS: a sender name is at most 11 characters. Anything else means the provider's default shortcode.
const validSender = v => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .-]{0,10}$/.test(v) ? v : '');

// ETB per SMS including 15% VAT, by SMS count in the month (GeezSMS account, 15 Sep 2026): [up to, price], null = above.
// For estimates only (previews, ops report); SMS_PRICE_TIERS in the environment replaces it.
const DEFAULT_PRICE_TIERS = [[10000, 0.7475], [50000, 0.4025], [null, 0.2875]];
function parsePriceTiers(raw) {
  try {
    const t = JSON.parse(raw);
    if (Array.isArray(t) && t.length && t.every(x => Array.isArray(x) && x.length === 2 && (x[0] === null || Number.isFinite(x[0])) && Number.isFinite(x[1]) && x[1] >= 0)) return t;
  } catch (e) { /* fall through */ }
  return DEFAULT_PRICE_TIERS;
}
function smsUnitPrice(monthlyCount, tiers = DEFAULT_PRICE_TIERS) {
  for (const [upTo, price] of tiers) if (upTo === null || monthlyCount <= upTo) return price;
  return tiers[tiers.length - 1][1];
}

// Parts, as operators count them: GSM-7 160 / 153, otherwise UCS-2 70 / 67. GeezSMS's own counting is an open fact;
// this is the planning estimate used for the monthly limit.
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
function smsParts(text) {
  const s = String(text == null ? '' : text);
  if (!s) return 0;
  let septets = 0;
  for (const ch of s) {
    if (GSM.includes(ch)) septets += 1;
    else if (GSM_EXT.includes(ch)) septets += 2;
    else { septets = -1; break; }
  }
  if (septets >= 0) return septets <= 160 ? 1 : Math.ceil(septets / 153);
  return s.length <= 70 ? 1 : Math.ceil(s.length / 67);   // UTF-16 code units = UCS-2 units
}

// digit runs of 6+ (phone numbers) are cut out of anything logged
const clean = v => String(v == null ? '' : v).replace(/\+?\d[\d\s-]{4,}\d/g, '…').slice(0, 80);

function makeSms({ mode = 'test', tenantMode = 'test', provider = null, supports = geezSupports, sender = '', callbackUrl = '', log = () => {} } = {}) {
  const live = mode === 'live' && !!provider;
  // Tenant SMS is live only when BOTH switches are: the provider switch can be on for sign-in codes alone.
  const tenantLive = live && tenantMode === 'live';
  async function send({ to, text, sender: s = '', live: mayGoLive = false } = {}) {
    const e164 = normalizeEtMobile(to);
    if (!e164) return { status: 'failed', errorKind: 'no_mobile' };
    if (!supports(e164)) return { status: 'failed', errorKind: 'sms_unsupported_number' };
    const body = String(text == null ? '' : text);
    if (!body) return { status: 'failed', errorKind: 'empty' };
    if (body.length > SMS_MAX_CHARS) return { status: 'failed', errorKind: 'too_long' };
    if (!live || mayGoLive !== true) return { status: 'test' };
    try {
      const r = await provider.send({ to: e164, text: body, sender: validSender(s) || validSender(sender), callbackUrl });
      if (r && r.ok) return { status: 'sent', providerId: r.providerId || null };
      log('[sms] refused by ' + (provider.name || 'provider') + ': ' + clean(r && r.error));
      return { status: 'failed', errorKind: 'sms_refused' };
    } catch (e) {
      log('[sms] ' + (provider.name || 'provider') + ' error: ' + clean(e && e.message));
      return { status: 'failed', errorKind: 'provider_error' };
    }
  }
  const canReach = raw => { const e = normalizeEtMobile(raw); return !!e && !!supports(e); };
  // The owner dashboard shows the account balance when a token is configured (design §4). null means no provider
  // and therefore no balance to show — never a guess, never the token, never the provider's URL. Reading it is a GET
  // and is independent of SMS_MODE: the account exists even while sending is switched off.
  return { send, supports: canReach, mode: live ? 'live' : 'test', tenantMode: tenantLive ? 'live' : 'test', provider: provider ? provider.name : null,
    balance: provider && typeof provider.balance === 'function' ? () => provider.balance() : null };
}

function makeGeezSms({ token, shortcodeId = '', fetchImpl = fetch, baseUrl = GEEZ_BASE, timeoutMs = 15000 } = {}) {
  if (!token) throw new Error('makeGeezSms: token required');
  async function call(url, init) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { ...init, signal: ctl.signal });
      let body = null;
      try { body = await r.json(); } catch (e) { body = null; }
      return { status: r.status, body };
    } finally { clearTimeout(timer); }
  }
  async function send({ to, text, sender, callbackUrl }) {
    const form = new URLSearchParams();
    form.set('token', token);
    form.set('phone', String(to).replace(/^\+/, ''));
    form.set('msg', String(text));
    const sc = sender || shortcodeId;
    if (sc) form.set('shortcode_id', sc);
    if (callbackUrl) form.set('callback', callbackUrl);
    const { status, body } = await call(baseUrl + '/api/v1/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    // Two reply shapes: the old one ({message_status:'success', api_log_id}) and the one the account returns today
    // ({error:false, msg:'SMS has been sent successfully.', data}). The new shape counts only when error is the boolean
    // false AND the message says success; anything else, including {error:true}, stays a failure.
    const okOld = !!body && body.message_status === 'success';
    const okNew = !!body && body.error === false && /success/i.test(String(body.msg || ''));
    if (status >= 200 && status < 300 && (okOld || okNew)) {
      const d = body.data && typeof body.data === 'object' ? body.data : {};
      const id = body.api_log_id != null ? body.api_log_id : (d.api_log_id != null ? d.api_log_id : (d.id != null ? d.id : null));
      return { ok: true, providerId: id != null ? String(id) : (body.log ? String(body.log) : null) };
    }
    return { ok: false, error: 'http ' + status + ' ' + String((body && (body.message_status || body.msg || body.error)) || '') };
  }
  async function balance() {
    const { status, body } = await call(baseUrl + '/api/v1/balance?token=' + encodeURIComponent(token), { method: 'GET', headers: { 'X-GeezSMS-Key': token } });
    return { ok: status >= 200 && status < 300 && !!body, status, body };
  }
  return { name: 'geezsms', send, balance, supports: geezSupports };
}

function makeSmsFromEnv(env = process.env, { fetchImpl, log, callbackUrl } = {}) {
  const name = String(env.SMS_PROVIDER || 'geezsms').toLowerCase();
  const provider = name === 'geezsms' && env.SMS_API_TOKEN
    ? makeGeezSms({ token: env.SMS_API_TOKEN, shortcodeId: env.SMS_SHORTCODE_ID || '', ...(fetchImpl ? { fetchImpl } : {}) })
    : null;
  return makeSms({ mode: env.SMS_MODE === 'live' ? 'live' : 'test', tenantMode: env.SMS_TENANT_MODE === 'live' ? 'live' : 'test', provider, supports: geezSupports,
    sender: env.SMS_SHORTCODE_ID || '', callbackUrl: callbackUrl || '', log: log || (() => {}) });
}

module.exports = { normalizeEtMobile, smsParts, SMS_MAX_CHARS, GEEZ_BASE, labelled, buildingSmsLabel, validSender, DEFAULT_PRICE_TIERS, parsePriceTiers, smsUnitPrice,
  geezSupports, makeSms, makeGeezSms, makeSmsFromEnv };
