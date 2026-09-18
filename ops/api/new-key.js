'use strict';
// Issue an API key for the public knowledge endpoints. Run on the server, by a person, at a terminal.
//
//   node ops/api/new-key.js --name "Addis Chamber" --org "Addis Chamber of Commerce" --per-day 20000
//   node ops/api/new-key.js --name "..." --dry-run          # shows exactly what would be written, no key
//
// The plaintext key is printed ONCE, to this terminal, and is never stored: keys.json holds only
// sha256(key + API_KEY_PEPPER). Lose it and you issue another. Do not paste it into a chat, a ticket,
// a commit or a log - anything it is pasted into becomes as sensitive as the key.
//
// --dry-run exists so this script can be tested, and read, without a key existing anywhere.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config?.({ path: path.join(__dirname, '..', '..', '.env') });

const { hashKey, DEFAULT_FILE, MIN_PEPPER } = require('../../api/keystore');

const argv = process.argv.slice(2);
const flag = (name, dflt = '') => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const has = name => argv.includes('--' + name);

const file = flag('file', process.env.API_KEYS_FILE || DEFAULT_FILE);
const dry = has('dry-run');
const name = flag('name');
const org = flag('org', name);
const tier = flag('tier', 'partner');
const quotaPerMinute = Number(flag('per-minute', '60'));
const quotaPerDay = Number(flag('per-day', '5000'));
const note = flag('note', '');
const origins = flag('origins', '').split(',').map(s => s.trim()).filter(Boolean);

function die(msg) { console.error('new-key: ' + msg); process.exit(1); }

if (!name) die('--name is required (who the key is for). Add --dry-run to see what would be written.');
const pepper = process.env.API_KEY_PEPPER || '';
if (String(pepper).length < MIN_PEPPER) {
  die('API_KEY_PEPPER is missing or shorter than ' + MIN_PEPPER + ' characters in .env. Set it first '
    + '(openssl rand -hex 32) and restart binasmart-api and bina-mcp, or every key issued here will be '
    + 'treated as unknown.');
}
if (!(quotaPerMinute > 0) || !(quotaPerDay > 0)) die('--per-minute and --per-day must be positive numbers.');

function readKeys(f) {
  try { const raw = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(raw) ? raw : (raw && Array.isArray(raw.keys) ? raw.keys : []); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

const keys = readKeys(file);
const id = 'k_' + crypto.randomBytes(5).toString('hex');
// 32 bytes base64url. The `bina_` prefix is for the person holding it, so a key found in a config file
// is recognisable as ours and can be revoked; it is not a secret and adds nothing to a guess.
// A dry run generates no key material at all, so a rehearsal can never leave one anywhere.
const key = dry ? null : 'bina_' + crypto.randomBytes(32).toString('base64url');
const entry = {
  id, name, org, keyHash: dry ? null : hashKey(key, pepper), tier,
  quotaPerMinute, quotaPerDay, origins, enabled: true, note,
  createdAt: new Date().toISOString(),
};

const shown = { ...entry, keyHash: '<sha256 of the key and the pepper>' };
console.log((dry ? 'WOULD WRITE to ' : 'WROTE to ') + file + ':');
console.log(JSON.stringify(shown, null, 2));
console.log('existing keys in that file: ' + keys.length);

if (dry) {
  console.log('\n--dry-run: nothing was written and NO key was generated for use. Re-run without --dry-run to issue one.');
  process.exit(0);
}

keys.push(entry);
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
const tmp = file + '.tmp-' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(keys, null, 2) + '\n', { mode: 0o600 });
fs.renameSync(tmp, file);
fs.chmodSync(file, 0o600);

console.log('\n================  THE KEY, SHOWN ONCE  ================');
console.log(key);
console.log('=======================================================');
console.log('Give it to ' + name + ' over a channel they already trust. It is not stored anywhere and');
console.log('cannot be shown again. Callers send it as:  Authorization: Bearer <key>   (or X-API-Key).');
console.log('Revoke by setting "enabled": false on ' + id + ' in ' + file + ' - it takes effect within 5s,');
console.log('no restart. Nothing else needs to change: binasmart-api and bina-mcp re-read the file.');
