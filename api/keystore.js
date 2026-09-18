'use strict';
// The API keys for the public knowledge endpoints, read from a JSON file OUTSIDE the repo.
//
// Not Prisma, on purpose: this must be readable by two processes with no migration, must never appear
// in a schema that is public on GitHub, and must be editable by hand at three in the morning without a
// deploy. /root/storage/api/keys.json, mode 600, the same place the packs and the private prompts live.
//
// The file holds a sha256 of (key + pepper), never a key. The pepper is API_KEY_PEPPER in .env: a stolen
// copy of keys.json is then not enough to forge a key, and the file can be backed up like anything else.
// Nothing here ever logs, returns or throws a key.
//
// Entry shape:
//   { id, name, org, keyHash, tier, quotaPerMinute, quotaPerDay, origins: [], enabled, note, createdAt }
//
// A key that does not resolve - unknown, disabled, wrong origin, or no pepper configured - is not an
// error. The caller simply falls back to the anonymous allowance, which is why a probe can never learn
// from a response whether a key exists.

const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_FILE = '/root/storage/api/keys.json';
const MIN_PEPPER = 32;

const hashKey = (key, pepper) => crypto.createHash('sha256').update(String(key) + String(pepper)).digest('hex');

// Bearer first (what an HTTP client reaches for), then the plain header some MCP clients allow instead.
function presentedKey(headers = {}) {
  const auth = String(headers.authorization || headers.Authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  return String(headers['x-api-key'] || '').trim();
}

function makeKeystore({ file = DEFAULT_FILE, pepper = process.env.API_KEY_PEPPER || '', reloadMs = 5000, now = Date.now } = {}) {
  let byHash = new Map(), checkedAt = -Infinity, stamp = '', warned = false;

  function refresh(t) {
    if (t - checkedAt < reloadMs) return;
    checkedAt = t;
    let st;
    try { st = fs.statSync(file); } catch { byHash = new Map(); stamp = ''; return; }  // no file yet: no keys, not an error
    const s = st.mtimeMs + ':' + st.size;
    if (s === stamp) return;
    stamp = s;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.keys) ? raw.keys : []);
      const next = new Map();
      for (const e of list) {
        if (!e || !e.keyHash || e.enabled === false) continue;
        next.set(String(e.keyHash).toLowerCase(), {
          id: String(e.id || ''), name: String(e.name || ''), org: String(e.org || ''),
          tier: String(e.tier || 'standard'),
          quotaPerMinute: Number(e.quotaPerMinute) > 0 ? Number(e.quotaPerMinute) : 60,
          quotaPerDay: Number(e.quotaPerDay) > 0 ? Number(e.quotaPerDay) : 5000,
          origins: Array.isArray(e.origins) ? e.origins.map(String) : [],
        });
      }
      byHash = next;
    } catch (e) {
      if (!warned) console.error('[keystore] ' + file + ' unreadable, treating every caller as anonymous: ' + (e && e.message));
      warned = true;
      byHash = new Map();
    }
  }

  return {
    // The presented key, or null. Lookup is by sha256 digest in a Map: there is no comparison against
    // the secret itself to time, and an attacker must produce the whole key to get a hit.
    resolve(key, { origin = '' } = {}) {
      if (!key) return null;
      if (String(pepper).length < MIN_PEPPER) return null;   // no pepper: every key is unknown, i.e. anonymous
      refresh(now());
      const e = byHash.get(hashKey(key, pepper));
      if (!e) return null;
      if (e.origins.length && origin && !e.origins.includes(origin)) return null;
      return e;
    },
    size() { refresh(now()); return byHash.size; },
  };
}

module.exports = { makeKeystore, presentedKey, hashKey, DEFAULT_FILE, MIN_PEPPER };
