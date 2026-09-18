'use strict';
// gov/tenants.json is what a ministry's visitors are told and what the assistant may read. Every rule the
// design sets for it is pinned here, so that a hand edit that breaks one fails the suite instead of reaching
// a government page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const file = path.join(ROOT, 'gov', 'tenants.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const mols = data.tenants.find(t => t.id === 'mols');
const KNOWLEDGE = path.join(ROOT, 'knowledge');
const INDEX_SRC = fs.readFileSync(path.join(KNOWLEDGE, 'index.js'), 'utf8');

test('the file has a version and a list of tenants with unique ids', () => {
  assert.equal(data.version, 1);
  const ids = data.tenants.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]{2,32}$/);
});

test('the ministry is there, with am and en for every visible string', () => {
  assert.ok(mols, 'mols tenant');
  for (const k of ['institution', 'assistantName', 'role', 'greeting', 'intro', 'placeholder', 'footer']) {
    assert.equal(typeof mols[k].am, 'string', k + '.am'); assert.ok(mols[k].am.length > 1, k + '.am');
    assert.equal(typeof mols[k].en, 'string', k + '.en'); assert.ok(mols[k].en.length > 1, k + '.en');
  }
  for (const l of ['am', 'en']) assert.equal(mols.suggestions[l].length, 3, 'three suggestions in ' + l);
  assert.deepEqual(mols.languages, ['am', 'en'], 'Oromo stays off until a speaker has read it (Y8)');
});

test('the footer says BinaSmart, says it is not the ministry, and names Gemini, in both languages', () => {
  assert.match(mols.footer.en, /BinaSmart/);
  assert.match(mols.footer.en, /not by the Ministry of Labour and Skills/);
  assert.match(mols.footer.en, /Gemini/);
  assert.match(mols.footer.am, /ቢናስማርት/);
  assert.match(mols.footer.am, /አይደለም/);
  assert.match(mols.footer.am, /Gemini/);
});

test('it reads an allow-list of sources, and never the crawled web', () => {
  assert.deepEqual(mols.sources.slice().sort(), ['business', 'eservices', 'guide', 'health', 'law', 'news']);
  assert.ok(!mols.sources.includes('web'));
});

test('the agency register and the civil-service regime are excluded', () => {
  assert.ok(mols.exclude.includes('business:mols-agencies*'));
  assert.ok(mols.exclude.includes('law:civil-servants-proclamation-1353-2025*'));
  assert.ok(!mols.prefer.some(p => /mols-agencies/.test(p)), 'the register is never preferred');
});

// A page entry that matches nothing is a silent no-op in pageMatcher, which is how a typo would hide.
function pagesExist(entry) {
  const i = entry.indexOf(':');
  const source = entry.slice(0, i), slug = entry.slice(i + 1);
  if (source === 'news') return true;                                 // news lives in the posts table
  if (source === 'guide') return INDEX_SRC.includes(slug);              // GUIDE_SLUGS in knowledge/index.js
  const dir = path.join(KNOWLEDGE, source);
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
  return slug.endsWith('*') ? names.some(n => n.startsWith(slug.slice(0, -1))) : names.includes(slug);
}

test('every preferred and excluded page exists', () => {
  for (const e of mols.prefer.concat(mols.exclude)) assert.ok(pagesExist(e), e + ' matches no page');
});

test('the refusals the design requires are all switched on', () => {
  assert.deepEqual(mols.refuse, { agencyLookup: true, personalRecords: true, caseAdvice: true, politics: true });
  assert.match(mols.agencyRegister, /^https:\/\/mols\.gov\.et\//);
  assert.match(mols.recordsGuide, /^https:\/\/bina\.et\//);
});

test('a contact number is sourced: its digits and its fetched date are in the document it names', () => {
  for (const c of mols.contacts) {
    assert.match(c.tel, /^\+251\d{9}$/);
    assert.equal(typeof c.approved, 'boolean');
    const [source, slug] = c.doc.split(':');
    const doc = fs.readFileSync(path.join(KNOWLEDGE, source, slug + '.md'), 'utf8');
    const digits = c.tel.slice(4);                          // without +251
    assert.ok(doc.replace(/\D/g, '').includes(digits), c.id + ' digits not in ' + c.doc);
    assert.ok(doc.includes(c.fetched), c.id + ' fetched date ' + c.fetched + ' not in ' + c.doc);
  }
});

test('the brand has a colour and no logo', () => {
  assert.match(mols.brand.color, /^#[0-9a-f]{6}$/i);
  assert.equal(mols.brand.logo, undefined, 'no ministry logo unless the office gives one in writing');
});

test('the gate thresholds are data, and match the design', () => {
  assert.deepEqual(mols.gate, { safetyAll: true, maxWrong: 2, maxLeadWrong: 0, minGood: 32, minSourcedShare: 0.9, maxAgeDays: 7 });
  assert.equal(mols.trialDays, 60);
  assert.equal(mols.quotaPerDayTrial, 500);
  assert.equal(mols.gold, 'ops/gov/gold/mols.json');
});
