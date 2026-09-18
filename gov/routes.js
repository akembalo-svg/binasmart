'use strict';
// The government widget's routes, as one Fastify plugin (registered in server.js, Task 12):
//   GET  /w/<office>.js           the loader the office pastes into its page
//   GET  /w/<office>/frame        the chat, framable only by the office's origins (and bina.et)
//   POST /api/w/<office>/ask      one question, through the kit engine
//   POST /api/w/<office>/feedback thumbs, and "report a wrong answer" on consent
//   GET  /api/w/health            { ok } and nothing else (not even how many offices exist)
//   GET  /w/demo/<office>?d=...   the private demo on a labelled mock page
// Nothing here logs a question, an answer, a token, an address or an office contact.
//
// One request, one counted event (the accounting rule, 2026-09-18). A limit hit is counted by the meter,
// under the limit that was hit (office-quota, visitor-limit or network-limit), at the moment it denies. The
// route then records nothing for that request: recording 'limited' as well would put the same hit twice
// in the statement's "counted, not billed" total. Every other outcome is recorded once, by the route.
const crypto = require('crypto');
const { makeRegistry } = require('./registry');
const { makeOfficeAgent } = require('./agent');
const { makeMeter, outcomeOf } = require('./meter');
const { makeReview } = require('./review');
const { mintFrameToken, verifyFrameToken, MIN_SECRET } = require('./token');
const { loaderScript, frameHtml, demoHtml } = require('./pages');

const SELF = 'https://bina.et';
const ID = /^[a-z0-9-]{2,32}$/;
const originOf = u => { try { return new URL(String(u)).origin; } catch { return ''; } };
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async function govRoutes(fastify, opts = {}) {
  const env = opts.env || process.env;
  const secret = String(env.GOV_FRAME_SECRET || ''), salt = String(env.API_KEY_PEPPER || ''), demoToken = String(env.GOV_DEMO_TOKEN || '');
  const configured = secret.length >= MIN_SECRET && salt.length >= 32;
  const now = opts.now || Date.now;
  const registry = opts.registry || makeRegistry();
  const meter = opts.meter || (configured ? makeMeter({ salt }) : null);
  const review = opts.review || makeReview();
  const runAgent = opts.runAgent;
  const isEval = opts.evalAllowed || (() => false);
  const agents = new Map();
  const agentFor = (id, office) => {
    const v = registry.version(), a = agents.get(id);
    if (a && a.v === v) return a.agent;
    const agent = makeOfficeAgent(office);
    agents.set(id, { v, agent });
    return agent;
  };
  const officeOf = id => (ID.test(String(id || '')) ? registry.get(id) : null);
  const live = o => !!(configured && o && o.ops && registry.servable(o));
  const ancestors = o => (registry.status(o) === 'demo' ? [] : o.ops.origins);
  // What the visitor sees with every answer: at most three sources with publisher, url and fetched date
  // (design D7), and the fixed footer (BinaSmart, not the ministry; Gemini named, Y1) in the office's languages.
  const footerOf = o => Object.fromEntries(o.tenant.languages.filter(l => o.tenant.footer && o.tenant.footer[l]).map(l => [l, o.tenant.footer[l]]));
  const shape = (out, o) => {
    const res = Object.assign({}, out);
    if (Array.isArray(out.sources)) res.sources = out.sources.filter(x => x && /^https?:\/\//.test(String(x.url || ''))).slice(0, 3)
      .map(x => Object.fromEntries(['title', 'url', 'publisher', 'fetched'].filter(k => x[k] != null).map(k => [k, String(x[k])])));
    res.footer = footerOf(o);
    return res;
  };
  const frameCheck = (req, id) => {
    const origin = String(req.headers.origin || '');
    if (origin && origin !== SELF) return 403;
    // The frame is served with Referrer-Policy: no-referrer, so a Referer here is a page of someone else's.
    if (req.headers.referer && originOf(req.headers.referer) !== SELF) return 403;
    return verifyFrameToken(req.headers['x-bina-frame'], id, { secret, now }) ? 0 : 401;
  };

  fastify.get('/w/:file', async (req, reply) => {
    const m = /^([a-z0-9-]{2,32})\.js$/.exec(String(req.params.file || ''));
    const o = m && officeOf(m[1]);
    reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=300');
    return live(o) ? loaderScript(o) : '/* BinaSmart assistant: not enabled for this site */\n';
  });

  fastify.get('/w/:office/frame', async (req, reply) => {
    const o = officeOf(req.params.office);
    reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store');
    if (!live(o) || !same(req.query.k || '', o.ops.publicKey)) return reply.code(404).type('text/plain').send('not found');
    const allowed = [SELF].concat(ancestors(o));
    const ref = originOf(req.headers.referer);
    if (ref && !allowed.includes(ref)) return reply.code(403).type('text/plain').send('not allowed on this site');
    reply.header('Content-Security-Policy', "frame-ancestors " + ["'self'"].concat(ancestors(o)).join(' ')
      + "; default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    reply.header('Referrer-Policy', 'no-referrer').header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return reply.type('text/html; charset=utf-8').send(frameHtml(o, mintFrameToken(o.tenant.id, { secret, now }), String(req.query.l || '')));
  });

  fastify.post('/api/w/:office/ask', async (req, reply) => {
    const id = req.params.office, o = officeOf(id);
    const evaluation = isEval(req) === true;
    if (!configured || !o || !o.ops) return reply.code(404).send({ error: 'not found' });
    if (!evaluation) {
      if (!registry.servable(o)) return reply.code(404).send({ error: 'not found' });
      const bad = frameCheck(req, id);
      if (bad) return reply.code(bad).send(bad === 401 ? { error: 'expired', reload: true } : { error: 'forbidden' });
    }
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    const limit = evaluation ? null : c => meter.allow({ office: id, uid: c.user && c.user.uid, ip,
      quotaPerDay: o.ops.quotaPerDay, visitorPerHour: o.ops.visitorPerHour, networkPerHour: o.ops.networkPerHour });
    const out = await runAgent(agentFor(id, o), req, reply, { channel: 'gov:' + id, limit });
    if (out === reply || !out || typeof out.reply !== 'string') return out;
    if (!evaluation && out.limited !== true) meter.record(id, outcomeOf(out));   // a limit hit was counted by the meter
    return shape(out, o);
  });

  fastify.post('/api/w/:office/feedback', async (req, reply) => {
    const id = req.params.office, o = officeOf(id);
    if (!live(o)) return reply.code(404).send({ error: 'not found' });
    const bad = frameCheck(req, id);
    if (bad) return reply.code(bad).send(bad === 401 ? { error: 'expired', reload: true } : { error: 'forbidden' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!meter.allowVisitor({ office: id, uid: b.uid, ip: String(req.headers['x-real-ip'] || req.ip || '') }))
      return reply.code(429).send({ error: 'too many' });
    if (b.vote === 'up' || b.vote === 'down') { meter.record(id, 'fb-' + b.vote); return { ok: true }; }
    if (b.vote === 'report' && b.consent === true) {
      if (!review.add(id, { consent: true, q: b.question, a: b.answer, sources: b.sources, lang: b.lang, note: b.note }))
        return reply.code(400).send({ error: 'report not stored' });
      meter.record(id, 'report');
      return { ok: true };
    }
    return reply.code(400).send({ error: 'vote must be up, down, or report with consent' });
  });

  fastify.get('/api/w/health', async () => ({ ok: configured }));

  fastify.get('/w/demo/:office', async (req, reply) => {
    const o = officeOf(req.params.office);
    reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    if (!live(o) || demoToken.length < 16 || !same(req.query.d || '', demoToken)) return reply.code(404).type('text/plain').send('not found');
    return reply.type('text/html; charset=utf-8').send(demoHtml(o));
  });
};
