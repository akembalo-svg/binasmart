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
