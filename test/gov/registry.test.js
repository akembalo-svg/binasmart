'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRegistry, ALL_SOURCES, excludeFor, effectiveStatus } = require('../../gov/registry');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants[0];
function files(ops) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-reg-'));
  const opsFile = path.join(dir, 'offices.json');
  if (ops !== undefined) fs.writeFileSync(opsFile, JSON.stringify({ offices: ops }));
  return { opsFile, dir };
}
const OPS = { id: 'mols', status: 'demo', origins: ['https://mols.gov.et'], publicKey: 'pk_0123456789abcdef', quotaPerDay: 500 };

test('every source the index code names is classified, so a new pack is never silently readable', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', 'index.js'), 'utf8');
  const named = new Set();
  const pack = /PACK_SOURCES\s*=\s*\[(.*)\];/.exec(src);
  assert.ok(pack, 'PACK_SOURCES line found');
  for (const m of pack[1].matchAll(/\['([a-z-]+)'\s*,/g)) named.add(m[1]);
  // `orderBy: [{ source: 'asc' }]` in the Prisma queries is a sort direction, not a source.
  const SORT = new Set(['asc', 'desc']);
  for (const m of src.matchAll(/source:\s*'([a-z-]+)'/g)) if (!SORT.has(m[1])) named.add(m[1]);
  for (const s of named) assert.ok(ALL_SOURCES.includes(s), 'knowledge/index.js names source ' + s + ': add it to ALL_SOURCES');
});

test('the exclude list is everything not allowed, plus the page-level excludes', () => {
  const ex = excludeFor(tenant);
  for (const s of ['web', 'page', 'skill', 'llms', 'docs', 'addis', 'travel', 'banking', 'mor']) assert.ok(ex.includes(s), s);
  for (const s of tenant.sources) assert.ok(!ex.includes(s), s + ' must not be excluded');
  assert.ok(ex.includes('business:mols-agencies*'));
});

test('an office with no operations record exists but is not servable', () => {
  const { opsFile } = files();
  const r = makeRegistry({ opsFile, warn: () => {} });
  const o = r.get('mols');
  assert.ok(o && o.tenant.id === 'mols');
  assert.equal(o.ops, null);
  assert.equal(r.status(o), 'off');
  assert.equal(r.servable(o), false);
});

test('demo, trial and paid are servable; suspended and an ended trial are not', () => {
  const today = '2026-10-01';
  assert.equal(effectiveStatus({ ...OPS, status: 'demo' }, today), 'demo');
  assert.equal(effectiveStatus({ ...OPS, status: 'trial', trialStart: '2026-09-20', trialEnd: '2026-11-19' }, today), 'trial');
  assert.equal(effectiveStatus({ ...OPS, status: 'trial', trialStart: '2026-07-01', trialEnd: '2026-08-30' }, today), 'expired');
  assert.equal(effectiveStatus({ ...OPS, status: 'suspended' }, today), 'suspended');
  assert.equal(effectiveStatus({ ...OPS, status: 'paid' }, today), 'paid');
  assert.equal(effectiveStatus({ ...OPS, status: 'demo', enabled: false }, today), 'off');
  const { opsFile } = files([OPS]);
  const r = makeRegistry({ opsFile, warn: () => {} });
  assert.equal(r.servable(r.get('mols')), true);
});

test('bad operations are ignored with a warning that names fields, never values', () => {
  const warns = [];
  const { opsFile } = files([{ ...OPS, origins: ['http://mols.gov.et/path'], contact: { email: 'someone@example.org' } }]);
  const r = makeRegistry({ opsFile, warn: m => warns.push(m) });
  assert.equal(r.get('mols').ops, null);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /origins/);
  assert.ok(!warns[0].includes('someone@example.org'));
});

test('a change to offices.json is seen after reloadMs, without a restart', () => {
  let t = 1_000_000;
  const { opsFile } = files([OPS]);
  const r = makeRegistry({ opsFile, reloadMs: 5000, now: () => t, warn: () => {} });
  assert.equal(r.status(r.get('mols')), 'demo');
  fs.writeFileSync(opsFile, JSON.stringify({ offices: [{ ...OPS, status: 'suspended', note: 'changed' }] }));
  t += 6000;
  assert.equal(r.status(r.get('mols')), 'suspended');
});

test('an unknown id is null', () => {
  const { opsFile } = files([OPS]);
  assert.equal(makeRegistry({ opsFile, warn: () => {} }).get('nope'), null);
});
