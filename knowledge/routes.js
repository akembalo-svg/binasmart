'use strict';
// HTTP surface of the knowledge index: public search (rate-limited, never returns the internal skill
// chunks to the public), health, and owner-only reload / reindex.
module.exports = function knowledgeRoutes(fastify, { knowledge, OWNER_KEY }) {
  const hits = new Map();
  const rl = (ip, max = 60) => { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 60000); if (a.length >= max) return false; a.push(now); hits.set(ip, a); if (hits.size > 5000) hits.clear(); return true; };
  const ip = req => String(req.headers['x-real-ip'] || req.ip);
  const owner = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };

  fastify.get('/api/knowledge/search', async (req, reply) => {
    if (!rl(ip(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const q = String(req.query.q || '').slice(0, 500);
    if (!q.trim()) return reply.code(400).send({ ok: false, error: 'q required' });
    const k = Math.max(1, Math.min(8, Number(req.query.k) || 4));
    const sources = req.query.sources ? String(req.query.sources).split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const results = await knowledge.search(q, { k, sources, isPublic: req.query.public !== '0' || (req.headers['x-owner-key'] !== OWNER_KEY) });
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
