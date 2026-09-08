'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, chunkDoc, htmlToText, readSources, DIMS, toBuf } = require('../knowledge/index');

test('chunkDoc: heading-aware, bounded, carries the title into every chunk', () => {
  const md = '# Addis\n\nintro para that is long enough to count as a chunk of text for the index.\n\n## Bole\n\n' + 'Bole is the airport district. '.repeat(60) + '\n\n## Piassa\n\nOld town with St George Cathedral and the Taitu Hotel near Arada.';
  const cs = chunkDoc(md, 'Addis Ababa');
  assert.ok(cs.length >= 3);
  assert.ok(cs.every(c => c.text.startsWith('Addis Ababa')));
  assert.ok(cs.every(c => c.text.length <= 1500));
  assert.ok(cs.some(c => /› Bole/.test(c.text)) && cs.some(c => /› Piassa/.test(c.text)));
});

test('htmlToText strips chrome and keeps headings and list items', () => {
  const t = htmlToText('<html><head><title>X | BinaSmart</title></head><body><nav>menu</nav><h2>Steps</h2><ul><li>One &amp; two</li></ul><script>x()</script><p>Done.</p></body></html>');
  assert.equal(t.includes('menu'), false); assert.equal(t.includes('x()'), false);
  assert.ok(/## Steps/.test(t) && /- One & two/.test(t) && /Done\./.test(t));
});

test('readSources finds the skill, the Addis notes, llms.txt and guide pages in this repo', () => {
  const docs = readSources(path.join(__dirname, '..'));
  const by = Object.fromEntries(docs.map(d => [d.source + '/' + d.slug, d]));
  assert.ok(by['skill/binasmart-system'] && by['skill/binasmart-system'].internal === true);
  assert.equal(by['skill/binasmart-system'].text.startsWith('---'), false, 'frontmatter stripped');
  assert.ok(by['addis/addis-ababa'] && /Megenagna/.test(by['addis/addis-ababa'].text));
  assert.ok(by['llms/llms']);
  assert.ok(by['guide/fayda'] && by['guide/fayda'].url === 'https://bina.et/fayda');
  assert.ok(docs.filter(d => d.source === 'page').length >= 10);
});

// in-memory prisma for the store + a fake Gemini that embeds by hashing tokens into DIMS buckets
function world({ withKey = true, failEmbed = false } = {}) {
  const rows = []; let seq = 0;
  const prisma = { knowledgeChunk: {
    findMany: async ({ where, select, orderBy, take }) => rows.filter(r => !where || Object.keys(where).every(k => { const w = where[k]; if (w === null) return r[k] == null; if (w && typeof w === 'object' && 'notIn' in w) return !w.notIn.includes(r[k]); return r[k] === w; })).slice(0, take || 1e9).map(r => ({ ...r })),
    create: async ({ data }) => { const r = { id: 'c' + (++seq), embedding: null, ...data }; rows.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    deleteMany: async ({ where }) => { const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (r.source === where.source && r.slug === where.slug && !where.hash.notIn.includes(r.hash)) rows.splice(i, 1); } return { count: before - rows.length }; },
  } };
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/\W+/)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url.split('?')[0].split(':').pop());
    if (failEmbed) return { status: 503, text: async () => 'down', json: async () => ({}) };
    const body = JSON.parse(opts.body);
    if (/batchEmbedContents/.test(url)) return { status: 200, json: async () => ({ embeddings: body.requests.map(r => ({ values: fakeVec(r.content.parts[0].text) })) }) };
    return { status: 200, json: async () => ({ embedding: { values: fakeVec(body.content.parts[0].text) } }) };
  };
  const k = makeKnowledge({ prisma, apiKey: withKey ? 'k' : '', fetchImpl, root: path.join(__dirname, '..'), sleep: async () => {} });
  return { k, rows, calls };
}

test('ingest is idempotent, embeds only new chunks, and search finds the pool fare rule and Megenagna', async () => {
  const w = world();
  const a = await w.k.ingest({ only: ['skill', 'addis'] });
  assert.ok(a.inserted > 10); assert.equal(a.embedded, a.inserted);
  const b = await w.k.ingest({ only: ['skill', 'addis'] });
  assert.equal(b.inserted, 0); assert.equal(b.embedded, 0); assert.equal(b.deleted, 0);
  const r = await w.k.search('BinaPool fare ladder bonus driver earns more', { k: 3 });
  assert.ok(r.length); assert.equal(r[0].source, 'skill'); assert.match(r[0].text, /bonus/i);
  const m = await w.k.search('Megenagna transport hub light rail', { k: 3 });
  assert.equal(m[0].source, 'addis'); assert.match(m[0].text, /Megenagna/);
  const pub = await w.k.search('never invent a fare', { k: 5, isPublic: true });
  assert.ok(pub.every(x => x.source !== 'skill'), 'public search hides the skill');
  assert.ok(w.k.health().embedded === w.k.health().chunks);
});

test('without Gemini (no key, or the API down) search still works on keywords, and Bini context skips greetings', async () => {
  const w = world({ withKey: false });
  await w.k.ingest({ only: ['addis'] });
  const r = await w.k.search('emergency numbers police ambulance', { k: 2 });
  assert.ok(r.length && /991/.test(r[0].text));
  assert.equal(w.k.health().keywordOnly, 1);
  assert.equal(await w.k.contextFor('hello'), '');
  assert.equal(await w.k.contextFor('ሰላም'), '');
  const ctx = await w.k.contextFor('what time is 1 o clock Ethiopian time');
  assert.match(ctx, /Relevant BinaSmart knowledge/); assert.match(ctx, /Ethiopian time/);
  const down = world({ failEmbed: true });
  const res = await down.k.ingest({ only: ['addis'] });
  assert.equal(res.embedded, 0, 'embedding failure is logged, not fatal');
  assert.ok((await down.k.search('Merkato market', { k: 1 })).length, 'keyword search survives');
});
