'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const { excludeFor } = require('../../gov/registry');
const { mintFrameToken } = require('../../gov/token');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(t => t.id === 'mols');
const SECRET = 'f'.repeat(40), SALT = 's'.repeat(40), DEMO = 'd'.repeat(24);

function fakes(status = 'trial') {
  const ops = { id: 'mols', status, origins: ['https://mols.gov.et'], publicKey: 'pk_0123456789abcdef', quotaPerDay: 500,
    trialStart: '2026-01-01', trialEnd: '2099-01-01' };
  const office = { tenant, exclude: excludeFor(tenant), ops };
  const registry = { get: id => (id === 'mols' ? office : null), status: () => status,
    servable: () => ['demo', 'trial', 'paid'].includes(status), version: () => 'v1', ids: () => ['mols'] };
  const rec = { records: [], allows: [], reviews: [] };
  const meter = { allow: o => { rec.allows.push(o); return true; }, allowVisitor: () => true, record: (id, k) => rec.records.push(k) };
  const review = { add: (id, item) => { rec.reviews.push(item); return true; } };
  return { office, registry, meter, review, rec };
}

async function app({ status = 'trial', env = { GOV_FRAME_SECRET: SECRET, API_KEY_PEPPER: SALT, GOV_DEMO_TOKEN: DEMO }, runAgent, evalAllowed } = {}) {
  const f = fakes(status);
  const fastify = Fastify();
  fastify.register(require('../../gov/routes'), {
    env, registry: f.registry, meter: f.meter, review: f.review, evalAllowed: evalAllowed || (() => false),
    runAgent: runAgent || (async (agent, req, reply, opts) => { f.rec.agent = agent.name; f.rec.limit = opts.limit; return { reply: 'ok', answered: true }; }),
  });
  await fastify.ready();
  return { fastify, rec: f.rec };
}
const token = () => mintFrameToken('mols', { secret: SECRET });

test('the loader is JavaScript for a servable office and a harmless comment otherwise', async () => {
  let { fastify } = await app();
  let r = await fastify.inject('/w/mols.js');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /javascript/);
  assert.ok(r.body.includes('/w/mols/frame?k=pk_'));
  r = await fastify.inject('/w/nope.js');
  assert.match(r.body, /not enabled/);
  ({ fastify } = await app({ status: 'suspended' }));
  assert.match((await fastify.inject('/w/mols.js')).body, /not enabled/);
});

test('the frame needs the public key, sets frame-ancestors to the office origins, and refuses a foreign Referer', async () => {
  const { fastify } = await app();
  assert.equal((await fastify.inject('/w/mols/frame')).statusCode, 404);
  const ok = await fastify.inject({ url: '/w/mols/frame?k=pk_0123456789abcdef', headers: { referer: 'https://mols.gov.et/am/' } });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['content-security-policy'], /frame-ancestors 'self' https:\/\/mols\.gov\.et;/);
  assert.match(ok.headers['x-robots-tag'], /noindex/);
  const bad = await fastify.inject({ url: '/w/mols/frame?k=pk_0123456789abcdef', headers: { referer: 'https://evil.example/' } });
  assert.equal(bad.statusCode, 403);
});

test('in demo status only bina.et may frame it', async () => {
  const { fastify } = await app({ status: 'demo' });
  const r = await fastify.inject({ url: '/w/mols/frame?k=pk_0123456789abcdef' });
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'self';/);
  const fromOffice = await fastify.inject({ url: '/w/mols/frame?k=pk_0123456789abcdef', headers: { referer: 'https://mols.gov.et/' } });
  assert.equal(fromOffice.statusCode, 403);
});

test('ask: no token 401, foreign Origin 403, good token runs the office agent with a limit and records the outcome', async () => {
  const { fastify, rec } = await app();
  const body = { message: 'hello there friend', user: { uid: 'u1' } };
  assert.equal((await fastify.inject({ method: 'POST', url: '/api/w/mols/ask', payload: body })).statusCode, 401);
  assert.equal((await fastify.inject({ method: 'POST', url: '/api/w/mols/ask', payload: body,
    headers: { origin: 'https://evil.example', 'x-bina-frame': token() } })).statusCode, 403);
  const r = await fastify.inject({ method: 'POST', url: '/api/w/mols/ask', payload: body,
    headers: { origin: 'https://bina.et', 'x-bina-frame': token() } });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).reply, 'ok');
  assert.equal(rec.agent, 'gov-mols');
  assert.equal(typeof rec.limit, 'function');
  assert.deepEqual(rec.records, ['answered']);
});

test('ask: evaluation traffic skips token, limit and ledger', async () => {
  const { fastify, rec } = await app({ status: 'demo', evalAllowed: () => true });
  const r = await fastify.inject({ method: 'POST', url: '/api/w/mols/ask', payload: { message: 'a question here' } });
  assert.equal(r.statusCode, 200);
  assert.equal(rec.limit, null);
  assert.deepEqual(rec.records, []);
});

test('nothing is served when the secrets are not configured', async () => {
  const { fastify } = await app({ env: {} });
  assert.match((await fastify.inject('/w/mols.js')).body, /not enabled/);
  assert.equal((await fastify.inject('/w/mols/frame?k=pk_0123456789abcdef')).statusCode, 404);
  assert.deepEqual(JSON.parse((await fastify.inject('/api/w/health')).body), { ok: false }, 'health reveals nothing about offices');
});

test('feedback: votes are counted, a report needs consent, and nothing else is accepted', async () => {
  const { fastify, rec } = await app();
  const h = { origin: 'https://bina.et', 'x-bina-frame': token() };
  const post = payload => fastify.inject({ method: 'POST', url: '/api/w/mols/feedback', payload, headers: h });
  assert.equal((await post({ vote: 'up' })).statusCode, 200);
  assert.equal((await post({ vote: 'report', question: 'q', answer: 'a' })).statusCode, 400, 'no consent');
  assert.equal((await post({ vote: 'report', consent: true, question: 'q', answer: 'a' })).statusCode, 200);
  assert.equal((await post({ vote: 'sideways' })).statusCode, 400);
  assert.deepEqual(rec.records, ['fb-up', 'report']);
  assert.equal(rec.reviews.length, 1);
});

test('the demo is 404 without the token and a page with it', async () => {
  const { fastify } = await app({ status: 'demo' });
  assert.equal((await fastify.inject('/w/demo/mols')).statusCode, 404);
  assert.equal((await fastify.inject('/w/demo/mols?d=wrong')).statusCode, 404);
  const r = await fastify.inject('/w/demo/mols?d=' + DEMO);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /MOCK/);
  assert.match(r.headers['x-robots-tag'], /noindex/);
});
