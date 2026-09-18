'use strict';
// gov/routes.js against the REAL meter, review queue and statement, in a temp storage dir, with a fake agent
// runner that behaves like assistant/kit/engine.js (limit after the gates, then the answer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Fastify = require('fastify');
const { excludeFor } = require('../../gov/registry');
const { mintFrameToken } = require('../../gov/token');
const { makeMeter } = require('../../gov/meter');
const { makeReview } = require('../../gov/review');
const { statement } = require('../../ops/gov/statement');
const { TEXT } = require('../../gov/agent');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(t => t.id === 'mols');
const SECRET = 'f'.repeat(40), SALT = 's'.repeat(40), DEMO = 'd'.repeat(24);
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const MONTH = '2026-10';
const Q = 'QZMARKER how much is the zebra permit fee';
const A = 'AZMARKER the zebra permit answer text';
const FIVE = [1, 2, 3, 4, 5].map(n => ({ title: 'Doc ' + n, url: 'https://example.gov.et/d' + n, publisher: 'Pub ' + n, fetched: '2026-09-0' + n, extra: 'x' }));

function allFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? allFiles(path.join(dir, e.name)) : [fs.readFileSync(path.join(dir, e.name), 'utf8')]);
}

async function live({ visitorPerHour = 20, quotaPerDay = 500 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-routes-'));
  const ops = { id: 'mols', status: 'trial', origins: ['https://mols.gov.et'], publicKey: 'pk_0123456789abcdef',
    quotaPerDay, visitorPerHour, trialStart: '2026-01-01', trialEnd: '2099-01-01' };
  const office = { tenant, exclude: excludeFor(tenant), ops };
  const registry = { get: id => (id === 'mols' ? office : null), status: () => 'trial', servable: () => true, version: () => 'v1', ids: () => ['mols'] };
  const meter = makeMeter({ root, salt: SALT, now: () => T, timer: false });
  const review = makeReview({ root: path.join(root, 'review'), now: () => T });
  const fastify = Fastify();
  fastify.register(require('../../gov/routes'), {
    env: { GOV_FRAME_SECRET: SECRET, API_KEY_PEPPER: SALT, GOV_DEMO_TOKEN: DEMO }, now: () => T, registry, meter, review,
    runAgent: async (agent, req, reply, opts) => {
      const msg = String(req.body.message || '');
      const c = { msg, l: /[ሀ-፿]/.test(msg) ? 'am' : 'en', user: req.body.user || {} };
      if (opts.limit && !opts.limit(c)) return { reply: agent.limited(c), limited: true };
      return Object.assign({ reply: A }, agent.okFlags, { sources: FIVE });
    },
  });
  await fastify.ready();
  const h = { origin: 'https://bina.et', 'x-bina-frame': mintFrameToken('mols', { secret: SECRET, now: () => T }) };
  const ask = (message, uid = 'u1', headers = h) => fastify.inject({ method: 'POST', url: '/api/w/mols/ask', payload: { message, user: { uid } }, headers });
  const flush = () => { meter.ledger.flush(T); meter.limits.flush(T); };
  return { fastify, root, meter, ask, h, flush };
}

test('an answer carries at most three sources, each with publisher, url and fetched date, and the fixed footer', async () => {
  const { ask } = await live();
  const r = await ask('What is the work permit fee?');
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.equal(b.reply, A);
  assert.equal(b.sources.length, 3);
  for (const s of b.sources) {
    assert.deepEqual(Object.keys(s).sort(), ['fetched', 'publisher', 'title', 'url']);
    assert.match(s.fetched, /^\d{4}-\d{2}-\d{2}$/);
  }
  for (const l of tenant.languages) assert.equal(b.footer[l], tenant.footer[l]);
  assert.match(b.footer.en, /BinaSmart, not by the Ministry/);
  assert.match(b.footer.en, /Gemini/, 'Y1: the footer names Gemini');
  assert.equal(b.footer.om, undefined, 'Y8: om is off');
});

test('ask: a Referer that is not bina.et is refused, even with a good token', async () => {
  const { ask, h } = await live();
  const r = await ask('hello there friend', 'u1', Object.assign({}, h, { referer: 'https://evil.example/page' }));
  assert.equal(r.statusCode, 403);
});

test('ask: an office-origin page cannot post directly; only the bina.et frame may', async () => {
  const { ask, h } = await live();
  assert.equal((await ask('hello there friend', 'u1', Object.assign({}, h, { origin: 'https://mols.gov.et' }))).statusCode, 403);
});

test('over the limit: a clear message in the language of the question', async () => {
  const { ask } = await live({ visitorPerHour: 1 });
  assert.equal(JSON.parse((await ask('first question here', 'u9')).body).reply, A);
  const en = JSON.parse((await ask('second question here', 'u9')).body);
  assert.equal(en.limited, true);
  assert.equal(en.reply, TEXT.limited.en());
  const am = JSON.parse((await ask('የሥራ ፈቃድ ስንት ነው?', 'u9')).body);
  assert.equal(am.limited, true);
  assert.equal(am.reply, TEXT.limited.am());
  assert.equal(am.sources, undefined);
});

test('accounting: one over-limit request adds exactly 1 to counted-not-billed, and nothing to billable', async () => {
  const { ask, root, flush } = await live({ visitorPerHour: 1 });
  await ask('first question here', 'u7');
  flush();
  const before = statement({ dir: path.join(root, 'ledger'), office: 'mols', month: MONTH });
  assert.equal(before.billable, 1);
  const r = JSON.parse((await ask('second question here', 'u7')).body);
  assert.equal(r.limited, true);
  flush();
  const after = statement({ dir: path.join(root, 'ledger'), office: 'mols', month: MONTH });
  const total = s => Object.values(s.notBilled).reduce((a, b) => a + b, 0);
  assert.equal(total(after) - total(before), 1, 'one limit hit, one counted event');
  assert.equal(after.notBilled['visitor-limit'], 1);
  assert.equal(after.notBilled.limited, 0, 'the route does not record limited on top of the meter denial');
  assert.equal(after.billable, 1);
});

test('accounting: the office quota is one counted event too', async () => {
  const { ask, root, flush } = await live({ quotaPerDay: 1 });
  await ask('first question here', 'a1');
  await ask('second question here', 'a2');
  flush();
  const s = statement({ dir: path.join(root, 'ledger'), office: 'mols', month: MONTH });
  assert.equal(s.notBilled['office-quota'], 1);
  assert.equal(Object.values(s.notBilled).reduce((a, b) => a + b, 0), 1);
});

test('no question or answer text is written anywhere; a report is stored only with consent', async () => {
  const { fastify, ask, h, root, flush } = await live();
  assert.equal((await ask(Q)).statusCode, 200);
  const fb = payload => fastify.inject({ method: 'POST', url: '/api/w/mols/feedback', payload, headers: h });
  assert.equal((await fb({ vote: 'down' })).statusCode, 200);
  assert.equal((await fb({ vote: 'report', consent: 'yes', question: Q, answer: A })).statusCode, 400, 'consent must be true, not truthy');
  flush();
  let text = allFiles(root).join('\n');
  assert.ok(text.length > 0, 'the ledger was written');
  assert.ok(!text.includes('QZMARKER') && !text.includes('AZMARKER') && !/zebra/i.test(text), 'no question or answer text on disk');
  assert.ok(!allFiles(path.join(root, 'review')).length, 'no review file without consent');
  assert.equal((await fb({ vote: 'report', consent: true, question: Q, answer: A, lang: 'en' })).statusCode, 200);
  const rows = allFiles(path.join(root, 'review')).join('').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(rows.length, 1, 'the consented report reached the real review queue');
  assert.match(rows[0].q, /QZMARKER/);
  flush();
  const ledger = allFiles(path.join(root, 'ledger')).join('\n');
  assert.ok(!/ZMARKER|zebra/.test(ledger), 'the ledger still holds no text');
  assert.match(ledger, /office:mols\|fb-down/);
  assert.match(ledger, /office:mols\|report/);
});

test('health says ok and nothing about offices', async () => {
  const { fastify } = await live();
  assert.deepEqual(JSON.parse((await fastify.inject('/api/w/health')).body), { ok: true });
});

test('the loader holds no secret, points at bina.et, and an unknown office frame is 404', async () => {
  const { fastify } = await live();
  const js = (await fastify.inject('/w/mols.js')).body;
  for (const s of [SECRET, SALT, DEMO, 'GOV_', 'PEPPER']) assert.ok(!js.includes(s), s);
  assert.match(js, /https:\/\/bina\.et\/w\/mols\/frame\?k=pk_/);
  assert.match(js, /createElement\('iframe'\)/);
  assert.equal((await fastify.inject('/w/nope/frame?k=pk_0123456789abcdef')).statusCode, 404);
  assert.equal((await fastify.inject('/w/mols/frame?k=pk_wrong')).statusCode, 404);
});

test('the demo is refused with a wrong token, and leads with overseas employment then work permits', async () => {
  const { fastify } = await live();
  assert.equal((await fastify.inject('/w/demo/mols?d=' + 'e'.repeat(24))).statusCode, 404);
  const html = (await fastify.inject('/w/demo/mols?d=' + DEMO)).body;
  const first = html.indexOf('<section>');
  assert.ok(first > 0);
  assert.ok(html.indexOf('Overseas employment', first) < html.indexOf('Work permits', first));
  assert.ok(html.indexOf('Overseas employment') < html.indexOf('Work permits'));
  assert.ok(!/<img|logo|emblem|\.png|\.svg/i.test(html), 'no ministry logo or image');
});
