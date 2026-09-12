'use strict';
// Building owner keys, stored as hashes.
//
// Building.ownerKey held each key in plain text and authBuildingFail compared it with ===. Anyone who
// could read that table — a backup, a stray export, a SQL console — held a working key to every owner
// dashboard, and through it every tenant's name, phone and invoices.
//
// WHY A TABLE, NOT A HASHED COLUMN. Login used to hand back the stored key for every building an owner
// has. A hash cannot be handed back, and the tempting alternative — mint a new key on each login and
// overwrite the old one — logs the owner out of every other device the moment they sign in on one,
// and strands anyone who was given a key link but has no password. So each login issues its own key,
// each is kept as a sha256 hash, and any of them authenticates. The last KEEP per building survive;
// older ones are pruned.
//
// WHY sha256 AND NOT scrypt. New keys are 192 bits from crypto.randomBytes: nothing to guess, and scrypt
// would put its cost on every owner request. The one key that predates this, Darulle's, carries 40 bits
// — still far beyond guessing a hash, but worth rotating; see the commit that introduced this file.
//
// WHY A HASH LOOKUP IS NOT A TIMING LEAK. The comparison happens inside a unique-index lookup on
// sha256(key). An attacker cannot learn a prefix of the key from how long that takes, because the
// thing being compared is a hash they cannot steer.
const crypto = require('crypto');

const KEEP = 10;                 // keys kept per building
const TOUCH_MS = 60 * 60 * 1000; // lastUsedAt is written at most hourly per key, not on every request
const MAX_LEN = 200;             // anything longer is not a key and never reaches the database

const hashKey = k => crypto.createHash('sha256').update(String(k)).digest('hex');

// <3 letters of the slug>-<24 random bytes, base64url>. The prefix lets an owner tell keys apart. The
// alphabet is [A-Za-z0-9_-] on purpose: owner-login.html puts the key inside an onclick string and the
// dashboard puts it in a ?key= link, and neither escapes it.
function mintKey(slug, randomBytes = crypto.randomBytes) {
  const prefix = String(slug || '').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  return prefix + '-' + randomBytes(24).toString('base64url');
}

function makeOwnerKeys({ prisma, now }) {
  const clock = now || Date.now;
  const lastTouch = new Map();

  // Does this key open this building? Scoped by the slug being asked for: a key for one building is
  // no key at all for another.
  async function check(slug, key) {
    const k = String(key == null ? '' : key);
    if (!k || k.length > MAX_LEN) return false;
    const row = await prisma.ownerKey.findUnique({ where: { keyHash: hashKey(k) },
      include: { building: { select: { qrSlug: true } } } });
    if (!row || !row.building || row.building.qrSlug !== slug) return false;
    const seen = lastTouch.get(row.id) || (row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0);
    if (clock() - seen > TOUCH_MS) {
      lastTouch.set(row.id, clock());
      prisma.ownerKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date(clock()) } }).catch(() => {});
    }
    return true;
  }

  // A new key for this building. Returned once, here; only its hash is stored.
  async function issue(buildingId, slug, label) {
    const key = mintKey(slug);
    await prisma.ownerKey.create({ data: { buildingId, keyHash: hashKey(key), label: label || null, createdAt: new Date(clock()) } });
    await prune(buildingId);
    return key;
  }

  // Keep the KEEP most recently used or created keys. Sorted here rather than in SQL: Postgres puts
  // NULLs FIRST in a descending order, which would rank a key nobody has ever used above one used today.
  async function prune(buildingId) {
    const rows = await prisma.ownerKey.findMany({ where: { buildingId }, select: { id: true, lastUsedAt: true, createdAt: true } });
    if (rows.length <= KEEP) return 0;
    const recency = r => Math.max(r.lastUsedAt ? new Date(r.lastUsedAt).getTime() : 0, new Date(r.createdAt).getTime());
    const drop = rows.sort((a, b) => recency(b) - recency(a)).slice(KEEP).map(r => r.id);
    const d = await prisma.ownerKey.deleteMany({ where: { id: { in: drop } } });
    return d.count;
  }

  return { check, issue, prune };
}

module.exports = { makeOwnerKeys, mintKey, hashKey, KEEP, MAX_LEN };
