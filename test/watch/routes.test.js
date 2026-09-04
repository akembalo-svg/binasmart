'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const registerWatch = require('../../watch');

const KEY = 'owner-secret';
function fakeDb() {
  const T = { film: [], rental: [] }; let seq = 0;
  const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' });
  const cmp = (v, c) => { if (c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)) { if ('in' in c && !c.in.includes(v)) return false; if ('gt' in c && !(v > c.gt)) return false; if ('lt' in c && !(v < c.lt)) return false; return true; } return v === c; };
  const match = (row, where) => Object.entries(where || {}).every(([k, c]) => k === 'OR' ? c.some(w => match(row, w)) : k === 'NOT' ? !match(row, c) : cmp(row[k], c));
  const inc = (name, row, include) => { if (!row) return null; const r = { ...row }; if (name === 'rental' && include && include.film) r.film = T.film.find(f => f.id === r.filmId) || null; return r; };
  const model = name => ({
    create: async ({ data }) => { if (data.slug && T[name].some(r => r.slug === data.slug)) throw p2002(); if (data.code && T[name].some(r => r.code === data.code)) throw p2002(); const row = { id: name[0] + (++seq), createdAt: new Date(), views: 0, status: name === 'film' ? 'draft' : 'PENDING', ...data }; T[name].push(row); return { ...row }; },
    findUnique: async ({ where, include }) => inc(name, T[name].find(r => match(r, where)) || null, include),
    findFirst: async ({ where, include }) => inc(name, T[name].find(r => match(r, where)) || null, include),
    findMany: async ({ where, include, orderBy, take } = {}) => { let rows = T[name].filter(r => match(r, where)); if (orderBy) { const [[k, d]] = Object.entries(orderBy); rows = rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (d === 'desc' ? -1 : 1)); } if (take) rows = rows.slice(0, take); return rows.map(r => inc(name, r, include)); },
    update: async ({ where, data }) => { const r = T[name].find(r => match(r, where)); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }) => { let n = 0; for (const r of T[name]) if (match(r, where)) { for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? (r[k] || 0) + v.increment : v; n++; } return { count: n }; },
  });
  const db = { _: T }; for (const n of Object.keys(T)) db[n] = model(n); return db;
}
const sent = []; const tgApi = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); } };
let chapaPaid = false; const chapaCalls = [];
const chapa = { enabled: true, mode: 'test', init: async p => { chapaCalls.push(p); return 'https://checkout.chapa.co/w/' + p.ref; }, verify: async () => chapaPaid };
let NOW = 1_800_000_000_000;
async function app(opts) {
  const f = Fastify({ logger: false });
  f.decorateReply('sendFile', function (name) { this.type('text/html').send('<!-- ' + name + ' -->'); });
  const db = fakeDb();
  const w = registerWatch(f, { prisma: db, OWNER_KEY: KEY, BASE_URL: 'https://bina.et', riderBotToken: '111:T', tgApi, chapa: opts && 'chapa' in opts ? opts.chapa : chapa, force: true, now: () => NOW });
  await f.ready(); return { f, db, w };
}
const OPS = { 'x-owner-key': KEY, 'content-type': 'application/json' };
const FREE = { title: 'Big Buck Bunny', titleAm: 'ቢግ ባክ ባኒ', year: 2008, runtimeMin: 10, sourceKind: 'mp4', sourceUrl: 'https://cdn.example.com/bbb.mp4', rights: 'CC BY 3.0 Blender Foundation', status: 'public', descr: 'demo' };
const PAID = { title: 'Lamb', titleAm: 'ላምብ', year: 2015, sourceKind: 'youtube', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ', priceEtb: 80, rights: 'Licence from Producer X', status: 'public' };

test('ops: films need the key; public needs a rights note; bad sources refused; list shows only public+rights films', async () => {
  const { f } = await app();
  assert.equal((await f.inject({ method: 'POST', url: '/api/watch/ops/films', payload: FREE })).statusCode, 401);
  const noRights = await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: { ...FREE, rights: '' } });
  assert.equal(noRights.statusCode, 400); assert.match(noRights.json().error, /rights/);
  assert.equal((await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: { ...FREE, sourceUrl: 'http://x/y.mp4' } })).statusCode, 400);
  const a = (await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: FREE })).json();
  assert.equal(a.film.slug, 'big-buck-bunny');
  const draft = (await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: { ...PAID, status: 'draft' } })).json();
  assert.equal(draft.film.status, 'draft');
  const list = (await f.inject({ method: 'GET', url: '/api/watch/films' })).json();
  assert.deepEqual(list.films.map(x => x.slug), ['big-buck-bunny']); assert.equal(list.films[0].free, true);
  assert.equal((await f.inject({ method: 'GET', url: '/api/watch/films/lamb' })).statusCode, 404, 'draft is invisible');
  const pub = (await f.inject({ method: 'POST', url: '/api/watch/ops/films/lamb', headers: OPS, payload: { status: 'public' } })).json();
  assert.equal(pub.film.public, true);
  assert.equal((await f.inject({ method: 'GET', url: '/api/watch/films' })).json().films.length, 2);
  await f.close();
});

test('play: free film returns its source and counts a view; paid film without a rental is 402 rent', async () => {
  const { f, db } = await app();
  await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: FREE });
  await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: PAID });
  const p = await f.inject({ method: 'POST', url: '/api/watch/films/big-buck-bunny/play', payload: {} });
  assert.equal(p.statusCode, 200); assert.deepEqual(p.json().source, { kind: 'mp4', url: 'https://cdn.example.com/bbb.mp4' }); assert.equal(p.json().free, true);
  assert.equal(db._.film[0].views, 1);
  const page = await f.inject({ method: 'GET', url: '/api/watch/films/lamb' });
  assert.equal(page.statusCode, 200); assert.equal(page.json().film.priceEtb, 80); assert.equal(page.json().film.sourceUrl, undefined, 'source never in the page payload');
  const locked = await f.inject({ method: 'POST', url: '/api/watch/films/lamb/play', payload: {} });
  assert.equal(locked.statusCode, 402); assert.equal(locked.json().error, 'rent'); assert.equal(locked.json().priceEtb, 80); assert.equal(locked.json().rentHours, 48);
  await f.close();
});

test('rent: gated when Chapa is off; PENDING -> verify -> ACTIVE for exactly 48 h; plays; then expires', async () => {
  const off = await app({ chapa: { enabled: false } });
  await off.f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: PAID });
  const g = await off.f.inject({ method: 'POST', url: '/api/watch/rent', payload: { slug: 'lamb', name: 'Sara', phone: '0911223344' } });
  assert.equal(g.statusCode, 409); assert.equal(g.json().error, 'chapa_off');
  await off.f.close();

  chapaPaid = false; chapaCalls.length = 0; sent.length = 0;
  const { f, db } = await app();
  await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: PAID });
  assert.equal((await f.inject({ method: 'POST', url: '/api/watch/rent', payload: { slug: 'lamb', name: 'Sara', phone: '+971501234567' } })).json().error, 'phone');
  const r = (await f.inject({ method: 'POST', url: '/api/watch/rent', payload: { slug: 'lamb', name: 'Sara', phone: '0911223344' } })).json();
  assert.equal(r.ok, true); assert.match(r.rental.code, /^BW-[A-HJ-NP-Z2-9]{6}$/); assert.equal(r.rental.status, 'PENDING'); assert.match(r.checkoutUrl, /^https:\/\/checkout\.chapa\.co/);
  assert.equal(chapaCalls[0].amount, 80); assert.match(chapaCalls[0].ref, /^bina-w-/); assert.match(chapaCalls[0].returnUrl, /\/watch\/lamb\?rental=BW-.*paid=1/);
  const notYet = await f.inject({ method: 'POST', url: '/api/watch/rentals/' + r.rental.code + '/verify' });
  assert.equal(notYet.statusCode, 402);
  assert.equal((await f.inject({ method: 'POST', url: '/api/watch/films/lamb/play', payload: { rental: r.rental.code } })).statusCode, 402, 'pending does not play');
  chapaPaid = true;
  const ok = (await f.inject({ method: 'POST', url: '/api/watch/rentals/' + r.rental.code + '/verify' })).json();
  assert.equal(ok.status, 'ACTIVE');
  const row = db._.rental[0];
  assert.equal(new Date(row.expiresAt).getTime() - new Date(row.startsAt).getTime(), 48 * 3600000);
  const play = await f.inject({ method: 'POST', url: '/api/watch/films/lamb/play', payload: { rental: r.rental.code.toLowerCase() } });
  assert.equal(play.statusCode, 200); assert.equal(play.json().source.kind, 'youtube'); assert.match(play.json().source.url, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  const again = (await f.inject({ method: 'POST', url: '/api/watch/rentals/' + r.rental.code + '/verify' })).json();
  assert.equal(again.status, 'ACTIVE', 'verify is idempotent');
  NOW += 48 * 3600000 + 1;
  const late = await f.inject({ method: 'POST', url: '/api/watch/films/lamb/play', payload: { rental: r.rental.code } });
  assert.equal(late.statusCode, 402); assert.equal(late.json().error, 'expired'); assert.equal(db._.rental[0].status, 'EXPIRED');
  NOW -= 48 * 3600000 + 1;
  await f.close();
});

test('webhook path: confirmChapa activates a pending rental and messages a Telegram renter', async () => {
  chapaPaid = true; sent.length = 0;
  const { f, w, db } = await app();
  await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: PAID });
  db._.rental.push({ id: 'rX', code: 'BW-TESTAA', filmId: db._.film[0].id, name: 'Beti', phone: '+251911223355', telegramId: '777', priceEtb: 80, chapaRef: 'bina-w-abc', status: 'PENDING', createdAt: new Date() });
  const c = await w.confirmChapa('bina-w-abc');
  assert.equal(c.ok, true); assert.equal(c.status, 'ACTIVE');
  assert.equal(sent.length, 1); assert.equal(sent[0].chat, '777'); assert.match(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, /\/watch\/lamb\?rental=BW-TESTAA/);
  assert.deepEqual(await w.confirmChapa('bina-w-nope'), { ok: false, error: 'unknown' });
  await f.close();
});

test('pages: /watch and /watch/<slug> are served; a public film gets Movie schema and its own title', async () => {
  const { f } = await app();
  await f.inject({ method: 'POST', url: '/api/watch/ops/films', headers: OPS, payload: FREE });
  for (const u of ['/watch', '/watch/big-buck-bunny', '/watch/nope', '/ops/watch']) assert.equal((await f.inject({ method: 'GET', url: u })).statusCode, 200, u);
  const p = await f.inject({ method: 'GET', url: '/watch/big-buck-bunny' });
  assert.match(p.body, /"@type":"Movie","name":"ቢግ ባክ ባኒ"/); assert.match(p.body, /<title>ቢግ ባክ ባኒ \(Big Buck Bunny\) · 2008 \| BinaSmart Watch<\/title>/);
  assert.doesNotMatch(p.body, /cdn\.example\.com/, 'source never in HTML');
  await f.close();
});
