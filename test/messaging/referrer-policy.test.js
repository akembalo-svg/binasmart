'use strict';
// The security-headers hook at the top of server.js ran after every route and overwrote Referrer-Policy, so the invoice
// link page (/i/:token) and the tenant poster sent strict-origin-when-cross-origin although they set no-referrer. The hook
// now keeps a Referrer-Policy a route already set. Its real code is lifted out of server.js and run on a bare Fastify.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const block = (sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at >= 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at) + end.length); };

test('the security-headers hook keeps a Referrer-Policy the route set, and sets the default everywhere else', async () => {
  const hook = block("fastify.addHook('onSend', async (req, reply, payload) => {");
  const fastify = require('fastify')({ logger: false });
  new Function('fastify', hook)(fastify);
  fastify.get('/i/:token', async (req, reply) => { reply.header('Referrer-Policy', 'no-referrer'); return 'page'; });
  fastify.get('/other', async () => ({ ok: true }));
  try {
    const own = await fastify.inject({ method: 'GET', url: '/i/abc' });
    assert.equal(own.headers['referrer-policy'], 'no-referrer');
    const other = await fastify.inject({ method: 'GET', url: '/other' });
    assert.equal(other.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    const missing = await fastify.inject({ method: 'GET', url: '/nope' });
    assert.equal(missing.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    for (const r of [own, other]) { assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.ok(r.headers['strict-transport-security']); }
  } finally { await fastify.close(); }
});

test('the invoice link page and the tenant poster set no-referrer themselves', () => {
  assert.match(block("fastify.get('/i/:token'"), /'Referrer-Policy', 'no-referrer'/);
  assert.match(block("fastify.get('/tenant-poster/:slug'"), /'Referrer-Policy', 'no-referrer'/);
});
