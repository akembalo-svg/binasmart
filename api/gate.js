'use strict';
// One place that decides whether a public knowledge request may proceed, whose allowance it spends, and
// what a refusal says. Used by knowledge/routes.js (GET /api/knowledge/search) and mcp-server/server.mjs
// (POST /mcp), which share ONE anonymous allowance because they are two doors onto the same 23,463 chunks.
//
// The policy this implements, and why it is a meter and not a lock:
//   public/llms.txt advertises both endpoints on purpose - an assistant that can call BinaSmart is the
//   whole AI-visibility strategy, and it was paid for. So the door stays open and gets a turnstile.
//
//   anonymous  20 requests per UTC hour per IP, /api/knowledge/search and /mcp together. Enough for an
//              assistant answering somebody's question and for a developer reading the shape of it; far
//              short of walking the index.
//   keyed      the key's own quotaPerMinute and quotaPerDay (api/keystore.js).
//   exempt     loopback only - the server's own scripts and the eval harnesses, which reach 127.0.0.1
//              directly. NOT "requests claiming Origin: https://bina.et": that header is one line in
//              curl, and no page on bina.et calls either endpoint from a browser (checked 2026-09-18,
//              the only mention of /api/knowledge/search under public/ is llms.txt advertising it).
//              Exempting a spoofable header would have left the door exactly as open as it was.
//
// Over quota is 429 with Retry-After and a body that names how to get a key. A refusal never says
// whether a key exists: an unknown key, a disabled key and no key at all all land on the same
// anonymous allowance and read identically from outside.

const { makeUsage } = require('./usage');
const { makeKeystore, presentedKey } = require('./keystore');
const crypto = require('crypto');

const DEFAULT_DIR = '/root/storage/api/usage';
const LOOPBACK = /^(::ffff:)?127\.\d+\.\d+\.\d+$|^::1$|^$/;
const CONTACT = 'info@gccdomestic.com';
const TERMS = 'https://bina.et/terms#api';

function makeGate({
  dir = process.env.API_USAGE_DIR || DEFAULT_DIR,
  proc = 'api',
  // The header nginx guarantees for THIS location, so a request that lacks it really did arrive on
  // loopback. bina.et's `location /` always adds X-Forwarded-For; `location ^~ /mcp` always adds
  // X-Real-IP. Both are set by nginx AFTER any client copy, so neither can be forged from outside.
  proxyHeader = 'x-forwarded-for',
  anonPerHour = Number(process.env.API_ANON_PER_HOUR || 20),
  salt = process.env.API_KEY_PEPPER || '',
  keystore = makeKeystore(),
  usage = makeUsage({ dir, proc }),
  now = Date.now,
} = {}) {

  // Anonymous callers are accounted for by a salted hash, never by their address: the day files say
  // how much one caller took and whether two endpoints saw the same one, and hold no personal data.
  const anonId = ip => 'ip:' + crypto.createHash('sha256').update(String(ip) + '|' + salt).digest('hex').slice(0, 16);
  const clientIp = (headers, fallback) =>
    String(headers['x-real-ip'] || '').trim()
    || String(headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(fallback || '');

  function refusal(kind, retryAfter) {
    return {
      ok: false,
      error: 'rate_limited',
      limit: kind === 'anon'
        ? anonPerHour + ' requests per hour per address, shared by /api/knowledge/search and /mcp'
        : 'this key has spent its ' + kind + ' quota',
      retry_after_seconds: retryAfter,
      get_a_key: 'Free. Email ' + CONTACT + ' saying what you are building and roughly how many requests a day you need.',
      terms: TERMS,
      docs: 'https://bina.et/llms.txt',
    };
  }
  const secondsLeft = (unit, t) => {
    const ms = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }[unit];
    return Math.max(1, Math.ceil((ms - (t % ms)) / 1000));
  };

  return {
    usage, keystore,
    // headers: the request headers. ip: the transport's own idea of the peer. endpoint: what to file it
    // under in the day's accounting. charge: false records the request without spending the allowance
    // (the MCP handshake - initialize, notifications, ping - costs an attacker nothing to abuse and
    // costs an honest assistant three of its twenty before it has asked anything).
    check({ headers = {}, ip = '', endpoint = 'unknown', charge = true } = {}) {
      const t = now();
      const ipStr = clientIp(headers, ip);
      // Loopback: no proxy header from nginx AND the peer really is local.
      if (!headers[proxyHeader] && LOOPBACK.test(String(ip))) {
        usage.hit('loopback', endpoint, [], t);
        return { allowed: true, caller: 'loopback', tier: 'loopback', exempt: true };
      }
      const entry = keystore.resolve(presentedKey(headers), { origin: String(headers.origin || '') });
      if (entry) {
        const caller = 'key:' + entry.id;
        for (const [unit, max] of [['minute', entry.quotaPerMinute], ['day', entry.quotaPerDay]]) {
          if (usage.count(unit, caller, t) >= max) {
            usage.deny(caller, endpoint, t);
            const retryAfter = secondsLeft(unit, t);
            return { allowed: false, caller, tier: entry.tier, status: 429, retryAfter, body: refusal(unit, retryAfter) };
          }
        }
        if (charge) usage.hit(caller, endpoint, ['minute', 'hour', 'day'], t);
        else usage.hit(caller, endpoint, [], t);
        return { allowed: true, caller, tier: entry.tier, keyId: entry.id };
      }
      const caller = anonId(ipStr);
      if (charge && usage.count('hour', caller, t) >= anonPerHour) {
        usage.deny(caller, endpoint, t);
        const retryAfter = secondsLeft('hour', t);
        return { allowed: false, caller, tier: 'anonymous', status: 429, retryAfter, body: refusal('anon', retryAfter) };
      }
      usage.hit(caller, endpoint, charge ? ['hour', 'day'] : [], t);
      return { allowed: true, caller, tier: 'anonymous' };
    },
  };
}

module.exports = { makeGate, DEFAULT_DIR, CONTACT, TERMS };
