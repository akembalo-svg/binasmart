'use strict';
// HTTP surface of the knowledge index: public search (metered, never returns the internal skill chunks
// to the public), health, and owner-only reload / reindex.
//
// The meter is api/gate.js and is shared with the MCP server: 20 requests an hour per address across
// both doors, a key's own quota for anyone who asks for one, loopback exempt. It replaced a 60/minute
// counter that lived in a Map in this process - binasmart-api had restarted 115 times in five days, so
// that counter was empty most of the time it mattered.
const { makeGate } = require('../api/gate');

module.exports = function knowledgeRoutes(fastify, { knowledge, OWNER_KEY, gate = makeGate({ proc: 'api', proxyHeader: 'x-forwarded-for' }) }) {
  // One resolution of the key, used by the gate below and by the public/internal decision in search.
  // Header first: a query string is written to the access log and the address bar. The parameter
  // stays because some callers can only pass one.
  const keyOf = req => String(req.headers['x-owner-key'] || req.query.key || '');
  const owner = (req, reply) => { if (keyOf(req) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };

  fastify.get('/api/knowledge/search', async (req, reply) => {
    // The owner key opens the internal view of the index below; it also stands in for an API key here,
    // so the owner's own tooling is never metered as a stranger.
    const d = keyOf(req) === OWNER_KEY
      ? { allowed: true }
      : gate.check({ headers: req.headers, ip: req.ip, endpoint: 'knowledge_search' });
    if (!d.allowed) {
      reply.header('Retry-After', String(d.retryAfter));
      reply.header('Cache-Control', 'no-store');
      return reply.code(d.status).send(d.body);
    }
    const q = String(req.query.q || '').slice(0, 500);
    if (!q.trim()) return reply.code(400).send({ ok: false, error: 'q required' });
    const k = Math.max(1, Math.min(8, Number(req.query.k) || 4));
    const sources = req.query.sources ? String(req.query.sources).split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const results = await knowledge.search(q, { k, sources, isPublic: req.query.public !== '0' || keyOf(req) !== OWNER_KEY });
    reply.header('Cache-Control', 'no-store');
    return { ok: true, q, results };
  });
  fastify.get('/api/knowledge/health', async () => ({ ok: true, ...knowledge.health() }));
  fastify.post('/api/knowledge/reload', async (req, reply) => { if (!owner(req, reply)) return; return { ok: true, chunks: await knowledge.load() }; });
  fastify.post('/api/knowledge/reindex', async (req, reply) => {
    if (!owner(req, reply)) return;
    const only = req.query.sources ? String(req.query.sources).split(',') : null;
    return { ok: true, ...(await knowledge.ingest({ only, embed: req.query.embed !== '0' })) };
  });
};
