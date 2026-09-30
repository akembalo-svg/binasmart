// Afaan Oromoo query rendering (KNOWLEDGE_BILINGUAL_OM / makeKnowledge({ bilingualOm })).
// Oromo is Latin script, so only the caller's lang ('om') can switch it on. Measured 30 Sep 2026: an Oromo-only
// Amharic rendering lifted a 30-question draft Oromo set from 86.7% to 96.7% Page@3, while the global switches cost
// Amharic and English (see knowledge/index.js). These tests pin that the new path touches nothing but Oromo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, DIMS, toBuf, bilingualOmEnabled } = require('../knowledge/index');

const ROOT = path.join(__dirname, '..');
const DOCS = [
  { source: 'guide', slug: 'fayda', title: 'Fayda National ID', lang: 'en', text: 'Fayda national ID registration is free of charge ፋይዳ ምዝገባ ነጻ ነው' },
  { source: 'telecom', slug: 'telecom-om', title: 'Ethio telecom (Oromo)', lang: 'om', text: 'kaffaltii tajaajila interneetii bilbilaa' },
];
function store(opts = {}) {
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  let id = 0;
  const rows = DOCS.map(d => ({ id: 'r' + (++id), source: d.source, slug: d.slug, url: 'https://example.et/' + d.slug, title: d.title, lang: d.lang, ord: 0, text: d.text, embedding: toBuf(fakeVec(d.text)) }));
  const prisma = { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } };
  const fetchImpl = async (url, o) => ({ status: 200, json: async () => ({ embedding: { values: fakeVec(JSON.parse(o.body).content.parts[0].text) } }) });
  const calls = [];
  const translateQuery = async (text, to) => { calls.push(to); return 'ፋይዳ ምዝገባ ክፍያ አለው'; };
  const k = makeKnowledge({ prisma, apiKey: 'k', fetchImpl, root: ROOT, sleep: async () => {}, localFallback: false, queryLog: () => {},
    bilingual: opts.bilingual ?? false, bilingualEn2Am: opts.bilingualEn2Am ?? false, bilingualOm: opts.bilingualOm, translateQuery });
  return { k, calls };
}
const OM = "Faydaaf galmaa'uuf kaffaltiin jiraa?";

test('the switch is off unless asked for', () => {
  assert.equal(bilingualOmEnabled({}), false);
  assert.equal(bilingualOmEnabled({ KNOWLEDGE_BILINGUAL_OM: '1' }), true);
  assert.equal(bilingualOmEnabled({ KNOWLEDGE_BILINGUAL_OM: 'off' }), false);
});

test('Oromo question + switch on -> one Oromo-to-Amharic rendering', async () => {
  const { k, calls } = store({ bilingualOm: true });
  await k.search(OM, { k: 3, lang: 'om' });
  assert.deepEqual(calls, ['om2am']);
});

test('Oromo question + switch off -> no rendering (today\'s behaviour)', async () => {
  const { k, calls } = store({ bilingualOm: false });
  await k.search(OM, { k: 3, lang: 'om' });
  assert.deepEqual(calls, []);
});

test('English and unlabelled questions are untouched by the Oromo switch', async () => {
  const { k, calls } = store({ bilingualOm: true });
  await k.search('Is Fayda registration free?', { k: 3, lang: 'en' });
  await k.search('Is Fayda registration free?', { k: 3 });
  assert.deepEqual(calls, []);
});

test('Amharic text is never sent down the Oromo path, even if mislabelled om', async () => {
  const { k, calls } = store({ bilingualOm: true });
  await k.search('ፋይዳ ለማውጣት ክፍያ አለ?', { k: 3, lang: 'om' });
  assert.deepEqual(calls, []);
});

test('contextFor passes the user\'s lang down to search', async () => {
  const { k, calls } = store({ bilingualOm: true });
  await k.contextFor(OM, { lang: 'om' });
  assert.ok(calls.includes('om2am'), 'expected an om2am rendering from contextFor, got ' + JSON.stringify(calls));
});

test('the benchmark passes a question\'s lang to search only when it has one', () => {
  const { searchOptionsFor } = require('../ops/bini/rerun-retrieval-benchmark');
  const deps = { contextSearchOptions: () => { throw new Error('not called'); }, knowledgeOf: () => { throw new Error('not called'); } };
  const om = searchOptionsFor({ qid: 'O12', lang: 'om' }, deps);
  assert.equal(om.plain.lang, 'om'); assert.equal(om.shipped.lang, 'om');
  const none = searchOptionsFor({ qid: 'q1' }, deps);
  assert.equal('lang' in none.plain, false); assert.equal('lang' in none.shipped, false);
});
