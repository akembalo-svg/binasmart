'use strict';
// The rule: no full Ethiopian mobile number is committed to this repository, which is public. Twice a helper
// copied real numbers from the Ministry of Labour agency register into test fixtures (fixed in 49af9d9, and
// again on 2026-09-18, when 29 full numbers had to be rewritten out of unpushed history before a push). A
// fixture never needs a real subscriber: it needs a number of the right shape, and an invented one does that.
//
// So every tracked file is scanned as it stands on disk. `git ls-files` decides what is tracked, so an
// untracked scratch file is not judged, but a tracked file is judged with whatever it holds right now, which
// is the state about to be committed. knowledge/ is skipped: institutional numbers are published there
// legitimately, and the ingest masking (test/knowledge-mask-ingest.test.js, test/business/mask-phones.test.js)
// already guards the personal ones in it.
//
// Allowed: BinaSmart's own published line (OWN_NUMBERS in assistant/grounding.js), and the invented ranges
// 2519000000xx, 2517000000xx, 09000000xx, 07000000xx. Anything else fails with the file, the line and the
// number masked to its last four digits.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { OWN_NUMBERS } = require('../assistant/grounding');

const ROOT = path.join(__dirname, '..');

// 251 or 0, then 9 (Ethio telecom) or 7 (Safaricom), then eight digits; spaces or hyphens may separate them.
// Not inside a longer digit or ASCII word run, so an ID or a hash is not read as a phone.
const MOBILE = /(?<![0-9A-Za-z_])(?:\+?251[ -]?[79](?:[ -]?[0-9]){8}|0[79](?:[ -]?[0-9]){8})(?![0-9A-Za-z_])/g;

// The subscriber part: nine digits, 9xxxxxxxx or 7xxxxxxxx, however the number was written.
function subscriber(s) {
  const d = String(s).replace(/\D/g, '');
  return d.startsWith('251') ? d.slice(3) : d.replace(/^0/, '');
}
function masked(s) {
  const d = String(s).replace(/\D/g, '');
  return (d.startsWith('251') ? '251' : '0') + '•'.repeat(5) + d.slice(-4);
}

// Invented ranges: 900000000-900000099 and 700000000-700000099. No real subscriber holds these.
const INVENTED = /^[79]000000[0-9]{2}$/;

// Explicit exceptions, each with its reason. Keep this short; every entry is a number in a public repo.
const EXTRA_ALLOWED = new Map([
  // test/grounding-masked.test.js, the date-collision case: the fixture's tail has to be 0917 because the
  // point of the test is that the fetched date 2026-09-17 ends in the same four digits as a masked row.
  // The 2519000000xx range cannot end in 0917, so this one invented number sits just outside it.
  ['900000917', 'date-collision fixture in test/grounding-masked.test.js'],
]);

// TEMPORARY, owner to decide. Full mobiles that were already on origin/main (pushed, public) on 2026-09-18,
// when this test was introduced. Rewriting pushed history is the owner's call, not a helper's, so they are
// listed by file and last four digits only. Most look like placeholders (0000, 0001, 1111, 3344, 1234...) but
// sit outside the invented ranges, so any of them could belong to a real subscriber. Replace each with an
// invented number and delete its entry; the test then holds the line. Do NOT add new entries here.
const LEGACY_ON_ORIGIN_BY_FILE = {
  'agents/owner/access.js': ['4567'],
  'docs/superpowers/plans/2026-09-02-binasmart-ride-phase1.md': ['0000', '0001'],
  'docs/superpowers/plans/2026-09-03-binasmart-mcp-server.md': ['0000', '4344', '4345'],
  'docs/superpowers/plans/2026-09-03-binasmart-ride-phase2.md': ['0000', '0001', '0002', '0099', '2333'],
  'docs/superpowers/plans/2026-09-03-binasmart-telegram-miniapp.md': ['1111', '3444'],
  'docs/superpowers/plans/2026-09-04-binasmart-cinema-seat-booking.md': ['0000', '3344', '3355'],
  'docs/superpowers/plans/2026-09-04-binasmart-events-general-admission.md': ['3344'],
  'docs/superpowers/plans/2026-09-16-phone-code-signin.md': ['1234', '4567'],
  'mcp-server/test/directory.test.mjs': ['0000', '0106', '0813', '6821'],
  'mcp-server/test/idem.test.mjs': ['4345'],
  'mcp-server/test/phone.test.mjs': ['4344'],
  'mcp-server/test/ride-tools.test.mjs': ['3444'],
  'ops/business/mark-demo-shops.js': ['0100'],
  'ops/cinema/demo.js': ['0000'],
  'ops/cinema/seed-addis-cinemas.js': ['2020', '2544'],
  'ops/cinema/seed-gast-programme.js': ['3377'],
  'ops/cinema/sim.js': ['0000', '3344', '3355', '3366', '3377', '3388'],
  'public/flights-poster.html': ['1274'],
  'public/index.html': ['1111', '3528'],
  'public/login.html': ['4567'],
  'public/ride/drivedemo.js': ['3344'],
  'public/static-guide.html': ['7814'],
  'seed-abenezer.js': ['0001'], 'seed-adams.js': ['0001'], 'seed-ambassador.js': ['0001'], 'seed-bole.js': ['0001'],
  'seed-cbe.js': ['0001'], 'seed-century.js': ['0001'], 'seed-centurycity.js': ['0001'], 'seed-dembel.js': ['0001'],
  'seed-edna.js': ['0001'], 'seed-ednatower.js': ['0001'], 'seed-flamingo.js': ['0001'], 'seed-friendship.js': ['0001'],
  'seed-friendshipcc.js': ['0001'], 'seed-getu.js': ['0001'], 'seed-hilton.js': ['0001'], 'seed-lafto.js': ['0001'],
  'seed-marathon.js': ['0001'], 'seed-medhanealem.js': ['0001'], 'seed-morningstar.js': ['0001'],
  'seed-radisson.js': ['0001'], 'seed-sarbet.js': ['0001'], 'seed-sheraton.js': ['0001'], 'seed-skylight.js': ['0001'],
  'seed-unity.js': ['0001'], 'seed-zefmesh.js': ['0001'], 'seed.js': ['0001'],
  'test/assistant.test.js': ['0001'],
  'test/auth/phone-code.test.js': ['1234'],
  'test/business/business-routes.test.js': ['0100', '0813', '3344', '9313'],
  'test/business/claimed.test.js': ['0111'],
  'test/business/owners.test.js': ['0000', '3344', '3377', '5666'],
  'test/cinema/routes.test.js': ['0000', '3344', '3355', '3377'],
  'test/cinema/scanKey.test.js': ['0111'],
  'test/cinema/tickets.test.js': ['0000', '3344', '3355'],
  'test/driverApi.test.js': ['1111', '2222', '3333'],
  'test/driverBot.test.js': ['4355'],
  'test/identity.test.js': ['3344'],
  'test/notify/notify.test.js': ['1274'],
  'test/offers.test.js': ['0000'],
  'test/owner/access.test.js': ['4567'],
  'test/phone-key.test.js': ['3052'],
  'test/ride/pool.test.js': ['0077', '0999', '9999'],
  'test/ride/poolGroups.test.js': ['0111', '0222'],
  'test/ride/poolRoutes.test.js': ['0001', '9999'],
  'test/ride/pubDriver.test.js': ['0111'],
  'test/ride/telegram.test.js': ['0000'],
  'test/tgRoutes.test.js': ['1111', '3444'],
  'test/watch/routes.test.js': ['3344', '3355'],
};
const LEGACY_ON_ORIGIN = new Set(Object.entries(LEGACY_ON_ORIGIN_BY_FILE)
  .flatMap(([file, tails]) => tails.map(t => file + ':' + t)));

const OWN = new Set(OWN_NUMBERS.map(subscriber));

const SKIP_DIRS = ['knowledge/', 'node_modules/'];
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|svg|pdf|woff2?|ttf|otf|eot|pmtiles|mp3|mp4|webm|ogg|wav|zip|gz|tgz|br|db|sqlite|onnx|bin|pt|safetensors|gguf)$/i;

function isAllowed(sub, file) {
  return INVENTED.test(sub) || OWN.has(sub) || EXTRA_ALLOWED.has(sub)
    || LEGACY_ON_ORIGIN.has(file + ':' + sub.slice(-4));
}

// Returns [{file, line, number (masked)}] for every mobile in `text` that is not allowed.
function scanText(text, file) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(MOBILE)) {
      const sub = subscriber(m[0]);
      if (isAllowed(sub, file)) continue;
      out.push({ file, line: i + 1, number: masked(m[0]) });
    }
  }
  return out;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\0').filter(Boolean)
    .filter(f => !SKIP_DIRS.some(d => f.startsWith(d)) && !BINARY_EXT.test(f));
}

function readText(file) {
  let buf;
  try { buf = fs.readFileSync(path.join(ROOT, file)); } catch { return null; } // deleted in the working tree
  if (buf.subarray(0, 8000).includes(0)) return null;                         // binary
  return buf.toString('utf8');
}

function report(found) {
  return found.length + ' full Ethiopian mobile number(s) in tracked files:\n'
    + found.map(v => '  ' + v.file + ':' + v.line + '  ' + v.number).join('\n')
    + '\nUse an invented number from the allowed ranges instead: 2519000000xx, 2517000000xx, 09000000xx or'
    + ' 07000000xx (keep the last digits the test depends on). Never copy a number from a register or a'
    + ' leaked answer into the repository, not even into a test.';
}

test('the scanner catches a real-looking number in every written form, and passes the invented ones', () => {
  // Built from parts so this file itself never holds a full number.
  const real = '251' + '91' + '2' + '345' + '678';
  for (const form of [real, '+' + real, '0' + real.slice(3), '+251 ' + real.slice(3, 6) + ' ' + real.slice(6),
                      '0' + real.slice(3, 5) + '-' + real.slice(5, 8) + '-' + real.slice(8)]) {
    const found = scanText('const phone = "' + form + '";', 'scratch.js');
    assert.equal(found.length, 1, 'must catch ' + masked(form));
    assert.ok(!found[0].number.includes(real.slice(3, 8)), 'the report must be masked');
  }
  for (const ok of ['251' + '900000042', '0' + '900000042', '251' + '700000007', '0' + '700000099']) {
    assert.deepEqual(scanText('x ' + ok + ' y', 'scratch.js'), [], 'invented ' + masked(ok) + ' is allowed');
  }
  assert.deepEqual(scanText('id 170' + real.slice(3) + ' and hash a0' + real.slice(3) + 'b', 'scratch.js'), [],
    'a number inside a longer digit or word run is not a phone');
});

test('no tracked file holds a full Ethiopian mobile number', () => {
  const found = [];
  for (const f of trackedFiles()) {
    const text = readText(f);
    if (text == null) continue;
    found.push(...scanText(text, f));
  }
  assert.equal(found.length, 0, report(found));
});

module.exports = { scanText, subscriber, masked };
