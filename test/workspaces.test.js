'use strict';
// workspaces/: key handling, website origin checks, the address guard and per-workspace isolation, against an
// in-memory prisma and a fake embedder (no database, no network, no model).
const test = require('node:test');
const assert = require('node:assert');
const { makeWorkspaces, safeUrl, privateAddress, sha256 } = require('../workspaces');

function fakePrisma() {
  const t = { workspace: [], workspaceDoc: [], workspaceChunk: [], workspaceQuestion: [] };
  let n = 0;
  const id = () => 'id' + (++n);
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('gte' in v) return row[k] >= v.gte;
      return true;
    }
    return row[k] === v;
  });
  const model = name => ({
    create: async ({ data }) => { const r = { id: id(), origins: [], active: true, dailyLimit: 100, plan: 'free', color: '#059669', lang: 'am', createdAt: new Date(), ...data };
      for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
      if (name === 'workspace' && t.workspace.some(w => w.slug === r.slug)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      t[name].push(r); return r; },
    createMany: async ({ data }) => { for (const d of data) t[name].push({ id: id(), ...d }); return { count: data.length }; },
    findUnique: async ({ where }) => t[name].find(r => match(r, where)) || null,
    findFirst: async ({ where }) => t[name].find(r => match(r, where)) || null,
    findMany: async ({ where } = {}) => t[name].filter(r => match(r, where)),
    count: async ({ where } = {}) => t[name].filter(r => match(r, where)).length,
    update: async ({ where, data }) => { const r = t[name].find(x => match(x, where)); Object.assign(r, data); return r; },
    delete: async ({ where }) => { const i = t[name].findIndex(x => match(x, where)); return t[name].splice(i, 1)[0]; },
    deleteMany: async ({ where }) => { const before = t[name].length; t[name] = t[name].filter(r => !match(r, where)); return { count: before - t[name].length }; },
  });
  return { tables: t, workspace: model('workspace'), workspaceDoc: model('workspaceDoc'), workspaceChunk: model('workspaceChunk'), workspaceQuestion: model('workspaceQuestion') };
}

// A deterministic 1024-d "embedding": one dimension per keyword bucket, normalised.
function fakeEmbedder() {
  const vec = s => { const v = new Array(1024).fill(0); for (const w of String(s).toLowerCase().split(/\W+/).filter(Boolean)) v[[...w].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1024, 7)] += 1;
    const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
  return { query: async q => vec(q), documents: async texts => texts.map(vec) };
}

const setup = () => { const prisma = fakePrisma(); return { prisma, ws: makeWorkspaces({ prisma, embedder: fakeEmbedder() }) }; };

test('create returns keys once and stores only the secret hash', async () => {
  const { prisma, ws } = setup();
  const r = await ws.create({ slug: 'acme-bank', name: 'Acme Bank', origins: ['https://acme.et/path', 'javascript:alert(1)'] });
  assert.match(r.secretKey, /^bsk_/);
  assert.match(r.siteKey, /^bpk_/);
  const row = prisma.tables.workspace[0];
  assert.strictEqual(row.secretHash, sha256(r.secretKey));
  assert.ok(!JSON.stringify(row).includes(r.secretKey));
  assert.deepStrictEqual(row.origins, ['https://acme.et']);
  assert.ok(!('secretHash' in r.workspace));
});

test('slug is validated', async () => {
  const { ws } = setup();
  await assert.rejects(ws.create({ slug: 'Bad Slug!', name: 'x' }), /slug/);
  await assert.rejects(ws.create({ slug: 'ok-slug', name: '  ' }), /name/);
});

test('secret key lookup accepts only the right key and only active workspaces', async () => {
  const { prisma, ws } = setup();
  const r = await ws.create({ slug: 'acme-bank', name: 'Acme' });
  assert.ok(await ws.bySecret(r.secretKey));
  assert.strictEqual(await ws.bySecret(r.secretKey + 'x'), null);
  assert.strictEqual(await ws.bySecret('not-a-key'), null);
  prisma.tables.workspace[0].active = false;
  assert.strictEqual(await ws.bySecret(r.secretKey), null);
});

test('rotating the secret retires the old one', async () => {
  const { ws } = setup();
  const r = await ws.create({ slug: 'acme-bank', name: 'Acme' });
  const w = await ws.bySecret(r.secretKey);
  const fresh = await ws.rotateSecret(w);
  assert.strictEqual(await ws.bySecret(r.secretKey), null);
  assert.ok(await ws.bySecret(fresh));
});

test('site key works only from the listed websites (bina.et when none are listed)', async () => {
  const { ws } = setup();
  const a = await ws.create({ slug: 'acme-bank', name: 'Acme', origins: ['https://acme.et'] });
  assert.ok(await ws.bySiteKey(a.siteKey, 'https://acme.et'));
  assert.strictEqual(await ws.bySiteKey(a.siteKey, 'https://evil.example'), null);
  assert.strictEqual(await ws.bySiteKey(a.siteKey, undefined), null);
  const b = await ws.create({ slug: 'beta-co', name: 'Beta' });
  assert.ok(await ws.bySiteKey(b.siteKey, 'https://bina.et'));
  assert.strictEqual(await ws.bySiteKey(b.siteKey, 'https://beta.et'), null);
});

test('address guard refuses private and non-http addresses', () => {
  for (const u of ['http://127.0.0.1/', 'http://localhost:4210/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.20.0.1/', 'file:///etc/passwd', 'http://[::1]/', 'gopher://x'])
    assert.strictEqual(safeUrl(u), null, u);
  assert.ok(safeUrl('https://example.com/page'));
  assert.ok(privateAddress('::ffff:127.0.0.1'));
  assert.ok(privateAddress('100.64.1.1'));
  assert.ok(!privateAddress('93.184.216.34'));
});

test('a workspace searches only its own documents', async () => {
  const { ws } = setup();
  const a = await ws.bySecret((await ws.create({ slug: 'acme-bank', name: 'Acme' })).secretKey);
  const b = await ws.bySecret((await ws.create({ slug: 'beta-co', name: 'Beta' })).secretKey);
  await ws.addDocument(a, { kind: 'text', title: 'Cards', text: 'A replacement debit card costs 150 birr and is ready in three working days at any Acme branch.' });
  await ws.addDocument(b, { kind: 'text', title: 'Hours', text: 'Beta clinic opens from eight in the morning until five in the evening, Monday to Saturday.' });
  const hitA = await ws.search(a, 'replacement debit card cost');
  assert.ok(hitA.length && hitA.every(h => /Acme|replacement/.test(h.text)));
  const hitB = await ws.search(b, 'replacement debit card cost');
  assert.ok(hitB.every(h => !/replacement/.test(h.text)));
});

test('documents: too-short text is refused, removal clears the cache', async () => {
  const { ws, prisma } = setup();
  const a = await ws.bySecret((await ws.create({ slug: 'acme-bank', name: 'Acme' })).secretKey);
  await assert.rejects(ws.addDocument(a, { kind: 'text', text: 'hi' }), /no readable text/);
  await assert.rejects(ws.addDocument(a, { kind: 'pdf', pdf: Buffer.from('not a pdf') }), /not a PDF/);
  await assert.rejects(ws.addDocument(a, { kind: 'url', url: 'http://127.0.0.1/' }), /public/);
  const d = await ws.addDocument(a, { kind: 'text', title: 'Cards', text: 'A replacement debit card costs 150 birr and is ready in three working days.' });
  assert.ok((await ws.search(a, 'replacement card')).length);
  assert.ok(await ws.removeDocument(a, d.id));
  assert.strictEqual(prisma.tables.workspaceChunk.length, 0);
  assert.strictEqual((await ws.search(a, 'replacement card')).length, 0);
});

test('the agent definition never pages BinaSmart staff and keeps chats out of Bini\'s log', async () => {
  const { ws } = setup();
  const a = await ws.bySecret((await ws.create({ slug: 'acme-bank', name: 'Acme' })).secretKey);
  const agent = ws.agentFor(a, {});
  assert.strictEqual(agent.log, false);
  for (const g of agent.gates) assert.ok(!('handover' in g.answer({ msg: 'x', l: 'en' })));
  for (const k of ['name', 'soul', 'gates', 'inScope', 'redirect', 'finish', 'fallback']) assert.ok(agent[k] != null, k);
  assert.match(agent.soul, /Never ask for or accept passwords/);
});
