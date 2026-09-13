'use strict';
// The two routes are the engine now. If someone writes route logic back into server.js, the agent tests
// stop describing what runs in production — so the delegation itself is pinned.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

function routeBody(signature) {
  const at = src.indexOf(signature);
  assert.ok(at > 0, signature + ' not found');
  return src.slice(at, src.indexOf('\n', at));
}

test('/api/afiya and /api/asmat delegate to the agent engine in one line', () => {
  assert.equal(routeBody("fastify.post('/api/afiya'"), "fastify.post('/api/afiya', (req, reply) => runAgent(afiyaAgent, req, reply));");
  assert.equal(routeBody("fastify.post('/api/asmat'"), "fastify.post('/api/asmat', (req, reply) => runAgent(asmatAgent, req, reply));");
});

test('the engine is built from the production dependencies', () => {
  const at = src.indexOf('const runAgent = makeEngine(');
  assert.ok(at > 0, 'runAgent is not built with makeEngine');
  const block = src.slice(at, src.indexOf('});', at));
  for (const dep of ['callModel: callBini', 'knowledge.contextFor', 'lang: biniLang', 'memory: biniMemory',
                     'handover: biniHandover', 'dropUngrounded', 'isEval', 'prisma'])
    assert.ok(block.includes(dep), 'engine is missing ' + dep);
});

test('no Afiya or Asmat pipeline step is left in server.js', () => {
  for (const step of ['afiya.stripDosage(', 'asmat.stripVerdict(', 'asmat.assessmentCaution(', 'afiya.demoNotice('])
    assert.equal(src.includes(step), false, step + ' is still called from server.js');
});

test('the owner route authenticates, then hands the engine a scope taken from the key, never from the body', () => {
  const at = src.indexOf("fastify.post('/api/owner/:slug/ai'");
  assert.ok(at > 0, 'owner route not found');
  const body = src.slice(at, src.indexOf('\n});', at));
  const auth = body.indexOf('authBuildingFail(req, reply, req.params.slug)');
  const run = body.indexOf("runAgent(ownerAgent, req, reply, { scope: { buildingIds: [b.id] }, channel: 'owner-web' })");
  assert.ok(auth > 0 && run > auth, 'must authenticate before running the agent, with the key-derived scope');
  assert.equal(/req\.body/.test(body), false, 'the scope must not come from the request body');
  assert.equal(/callBini\(/.test(body), false, 'the owner route must not call the model directly any more');
  const engine = src.slice(src.indexOf('const runAgent = makeEngine('), src.indexOf('});', src.indexOf('const runAgent = makeEngine(')));
  assert.ok(engine.includes('audit'), 'the engine needs audit for the owner agent');
  assert.ok(src.includes("const ownerAgent = require('./agents/owner/rules');"));
});

test('the accounting audit trail leaves out owner Bini questions, so they cannot push payments and expenses off it', () => {
  const at = src.indexOf("fastify.get('/api/owner/:slug/accounting'");
  assert.ok(at > 0, 'accounting route not found');
  const body = src.slice(at, src.indexOf('\n});', at));
  const q = body.slice(body.indexOf('prisma.auditLog.findMany('), body.indexOf('\n', body.indexOf('prisma.auditLog.findMany(')));
  assert.ok(q.length > 0, 'the accounting route no longer reads the audit log');
  assert.ok(q.includes("action: { not: 'OWNER_BINI_Q' }"), 'the accounting audit query must exclude OWNER_BINI_Q');
  // every audit list in server.js is the accounting one; a new one must decide about OWNER_BINI_Q too
  assert.equal(src.split('prisma.auditLog.findMany(').length - 1, 1, 'a new audit list must exclude OWNER_BINI_Q where owners see it');
});

test('Bini for owners on Telegram answers through the same agent, with the scope from the access rules', () => {
  const at = src.indexOf('const ownerTelegram = {');
  assert.ok(at > 0, 'ownerTelegram not built');
  const block = src.slice(at, src.indexOf('\n};', at));
  assert.match(block, /runAgent\(ownerAgent, req, res, \{ scope, channel: 'owner-telegram' \}\)/);
  assert.match(block, /healthMessage\(/);
  assert.ok(src.indexOf('const ownerTelegram = {') < src.indexOf("require('./ride')(fastify"), 'must exist before the ride module mounts');
  const ride = src.slice(src.indexOf("require('./ride')(fastify"), src.indexOf('});', src.indexOf("require('./ride')(fastify")));
  assert.match(ride, /ownerTelegram/);
});

test('the dashboard Telegram routes authenticate first and remove only through the building check', () => {
  for (const sig of ["fastify.get('/api/owner/:slug/telegram-links'", "fastify.post('/api/owner/:slug/telegram-links/:id/remove'"]) {
    const at = src.indexOf(sig);
    assert.ok(at > 0, sig + ' missing');
    const body = src.slice(at, src.indexOf('\n});', at));
    assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') > 0, sig + ' must authenticate');
    assert.doesNotMatch(body, /req\.body/, sig + ' must never read the request body: the building comes from the owner key and the slug');
  }
  const rm = src.slice(src.indexOf("fastify.post('/api/owner/:slug/telegram-links/:id/remove'"));
  assert.match(rm.slice(0, 900), /ownerAccess\.revokeForBuilding\(b\.id, req\.params\.id\)/);
});

test('callBini logs token usage for labelled calls, without the prompt', () => {
  const at = src.indexOf('async function callBini(');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(body, /\[bini\] usage ' \+ opts\.label \+ ' prompt=' \+ d\.usage\.prompt_tokens \+ ' completion=' \+ d\.usage\.completion_tokens/);
});
