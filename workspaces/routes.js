'use strict';
// HTTP surface of the business assistants (workspaces/index.js). Registered from server.js with one call:
//   require('./workspaces/routes')(fastify, { prisma, runAgent, isMiss, limiter: hotelLimiter, staffKey: OWNER_KEY })
//
// Three kinds of caller, three kinds of key, and none is ever derived from the request body:
//   BinaSmart staff   x-owner-key: OWNER_KEY               create a workspace, set its plan and limit
//   the client        Authorization: Bearer bsk_…           its dashboard, documents and the server-to-server chat API
//   a website bubble  x-bina-site-key: bpk_… + Origin       chat only, and only from the client's listed websites
// The secret key is shown once, at creation or rotation, and stored only as a sha256 hash.

const path = require('path');
const { makeWorkspaces } = require('./index');
const verify = require('./verify');

// Replies that say the documents did not cover the question: shown to the client as "no answer" topics.
const NO_INFO = /(do not|don't|does not|doesn't) have (any |enough |that |this |the )?(information|details)|no information (about|on)|not (in|mentioned in) (the|my) (documents|knowledge)|መረጃ የለኝም|መረጃ አልተገኘም|odeeffannoo (gahaa )?hin qabu/i;
const PDF_BODY_LIMIT = 15 * 1024 * 1024;   // base64 of a ~11 MB PDF

module.exports = function registerWorkspaces(fastify, deps) {
  const { prisma, runAgent, isMiss, limiter, staffKey } = deps;
  const ws = deps.workspaces || makeWorkspaces({ prisma });
  const ipOf = req => String(req.headers['x-real-ip'] || req.ip);
  const siteIpRL = limiter(600000, 30);      // 30 questions per 10 minutes per visitor address, per bubble
  const apiRL = limiter(60000, 60);          // 60 per minute per client key
  const uploadRL = limiter(3600000, 60);     // 60 uploads per hour per client

  const fail = (reply, e) => reply.code(e && e.status || 500).send({ ok: false, error: e && e.status ? e.message : 'server error' });
  const bearer = req => (/^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || '')) || [])[1] || '';

  async function client(req, reply) {
    const w = await ws.bySecret(bearer(req));
    if (!w) { reply.code(401).send({ ok: false, error: 'invalid or missing key' }); return null; }
    return w;
  }

  // ---------- staff ----------
  fastify.post('/api/ws', async (req, reply) => {
    if (!staffKey || staffKey === 'change-me' || req.headers['x-owner-key'] !== staffKey) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    try { return { ok: true, ...(await ws.create(req.body || {})) }; }
    catch (e) { if (e && e.code === 'P2002') return reply.code(409).send({ ok: false, error: 'slug already taken' }); return fail(reply, e); }
  });
  fastify.post('/api/ws/:slug/plan', async (req, reply) => {
    if (!staffKey || staffKey === 'change-me' || req.headers['x-owner-key'] !== staffKey) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    const w = await prisma.workspace.findUnique({ where: { slug: String(req.params.slug) } });
    if (!w) return reply.code(404).send({ ok: false, error: 'not found' });
    const b = req.body || {};
    return { ok: true, workspace: await ws.update(w, { plan: b.plan, dailyLimit: b.dailyLimit, active: b.active }) };
  });

  // ---------- client ----------
  fastify.get('/api/ws/me', async (req, reply) => {
    const w = await client(req, reply); if (!w) return;
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 30));
    return { ok: true, workspace: ws.publicView(w), stats: await ws.stats(w, days) };
  });
  fastify.post('/api/ws/me', async (req, reply) => {
    const w = await client(req, reply); if (!w) return;
    const b = req.body || {};
    // A client may change how its assistant looks and where it may run, never its plan or its limit.
    return { ok: true, workspace: await ws.update(w, { name: b.name, color: b.color, lang: b.lang, welcome: b.welcome, about: b.about, origins: b.origins }) };
  });
  fastify.post('/api/ws/me/rotate', async (req, reply) => {
    const w = await client(req, reply); if (!w) return;
    return { ok: true, secretKey: await ws.rotateSecret(w) };
  });
  fastify.post('/api/ws/me/docs', { bodyLimit: PDF_BODY_LIMIT }, async (req, reply) => {
    const w = await client(req, reply); if (!w) return;
    if (!uploadRL(w.id)) return reply.code(429).send({ ok: false, error: 'too many uploads, try again later' });
    const b = req.body || {};
    try {
      const pdf = b.kind === 'pdf' && typeof b.data === 'string' ? Buffer.from(b.data, 'base64') : undefined;
      return { ok: true, document: await ws.addDocument(w, { kind: b.kind, title: b.title, text: b.text, url: b.url, pdf, lang: b.lang }) };
    } catch (e) { req.log && req.log.warn({ err: e }, 'workspace upload failed'); return fail(reply, e); }
  });
  fastify.delete('/api/ws/me/docs/:id', async (req, reply) => {
    const w = await client(req, reply); if (!w) return;
    return (await ws.removeDocument(w, req.params.id)) ? { ok: true } : reply.code(404).send({ ok: false, error: 'not found' });
  });

  // ---------- chat (server API or website bubble) ----------
  fastify.post('/api/ws/chat', async (req, reply) => {
    const t0 = Date.now();
    let w = null, channel = 'api';
    const siteKey = String(req.headers['x-bina-site-key'] || '');
    if (siteKey) {
      w = await ws.bySiteKey(siteKey, req.headers.origin);
      if (!w) return reply.code(403).send({ ok: false, error: 'this website is not allowed to use this assistant' });
      if (!siteIpRL(w.id + '|' + ipOf(req))) return reply.code(429).send({ ok: false, error: 'too many questions, please wait a few minutes' });
      channel = 'site';
    } else {
      w = await client(req, reply); if (!w) return;
      if (!apiRL(w.id)) return reply.code(429).send({ ok: false, error: 'rate limit: 60 requests per minute' });
    }
    const msg = String((req.body || {}).message || '').trim();
    if (!msg) return reply.code(400).send({ ok: false, error: 'message required' });
    if (await ws.usedToday(w) >= w.dailyLimit)
      return reply.code(429).send({ ok: false, limited: true, error: 'daily limit reached for this plan',
        reply: 'This assistant has reached today\'s free limit. Please try again tomorrow.' });

    const state = {};
    // The engine reads message and user from the body; the user id is namespaced so it can never collide with
    // a BinaSmart user, and the workspace itself is never taken from the body.
    const u = (req.body && req.body.user && typeof req.body.user === 'object') ? req.body.user : {};
    const uid = /^[A-Za-z0-9_-]{6,64}$/.test(String(u.uid || '')) ? u.uid : null;
    const fakeReq = { body: { message: msg, user: uid ? { uid: ('w' + uid).slice(0, 64) } : {} },
      headers: req.headers, ip: req.ip, log: req.log };
    const out = await runAgent(ws.agentFor(w, state), fakeReq, reply, { channel: 'ws-' + channel });
    if (reply.sent) return;
    const text = out && out.reply || '';
    const answered = !!(state.hits && state.hits.length) && !NO_INFO.test(text) && !(isMiss && isMiss(text, { tools: [], message: msg }));
    ws.record(w, { channel, lang: /[ሀ-፿]/.test(msg) ? 'am' : 'en', question: msg, answered, ms: Date.now() - t0 });
    const body = { ok: true, reply: text, assistant: w.name };
    if (out && out.companySources) body.sources = out.companySources;
    if (out && out.emergency) body.emergency = true;
    return body;
  });

  // What the bubble needs to draw itself; public, but only for an allowed website.
  fastify.get('/api/ws/site', async (req, reply) => {
    const w = await ws.bySiteKey(String(req.headers['x-bina-site-key'] || ''), req.headers.origin);
    if (!w) return reply.code(403).send({ ok: false, error: 'not allowed' });
    return { ok: true, name: w.name, color: w.color, lang: w.lang, welcome: w.welcome };
  });

  // ---------- document check (workspaces/verify.js) ----------
  // Open to a client key, and to staff with the owner key; text or a PDF, never stored.
  fastify.post('/api/verify', { bodyLimit: PDF_BODY_LIMIT }, async (req, reply) => {
    if (!deps.verifier) return reply.code(503).send({ ok: false, error: 'document check not available' });
    const staff = staffKey && staffKey !== 'change-me' && req.headers['x-owner-key'] === staffKey;
    let w = null;
    if (!staff) { w = await client(req, reply); if (!w) return; if (!uploadRL(w.id)) return reply.code(429).send({ ok: false, error: 'too many checks, try again later' }); }
    const b = req.body || {};
    try {
      let text = String(b.text || ''), read = 'text';
      if (typeof b.data === 'string' && (b.kind === 'pdf' || b.kind === 'image' || b.kind === 'photo')) {
        const buf = Buffer.from(b.data, 'base64');
        if (b.kind === 'pdf') {
          text = await ws.pdfText(buf); read = 'pdf';
          // A scan has no text layer; read the pages as pictures instead.
          if (text.replace(/\s/g, '').length < 60) { text = await verify.ocrPdf(buf); read = 'pdf-scan'; }
        } else { text = await verify.ocrImage(buf); read = 'photo'; }
      }
      const result = await deps.verifier.check(text, { title: b.title });
      return { ok: true, read, chars: text.length, result };
    } catch (e) { return fail(reply, e); }
  });
  fastify.get('/verify', async (req, reply) => reply.sendFile('verify.html'));

  fastify.get('/embed.js', async (req, reply) => reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=3600').sendFile('embed.js'));
  fastify.get('/ws/dashboard', async (req, reply) => reply.sendFile('ws-dashboard.html'));

  return ws;
};
