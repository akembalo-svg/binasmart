// One-time patch: wire Better Auth into server.js
const fs = require('fs');
const f = '/var/www/connectcare/binasmart/server.js';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('BETTER AUTH WIRING')) { console.log('already patched'); process.exit(0); }

// 1) Load auth module + session prehandler + mount /api/auth/*
const anchor = "const OWNER_KEY = process.env.OWNER_KEY || 'change-me';";
const wiring = `// ===== BETTER AUTH WIRING =====
let __auth = null;
const __authReady = import('./auth.mjs').then(m => { __auth = m; console.log('better-auth ready'); }).catch(e => console.error('better-auth load failed', e));

// resolve session once per request (only if auth cookie present)
fastify.addHook('preHandler', async (req, reply) => {
  req.authUser = null;
  const c = req.headers.cookie || '';
  if (!c.includes('better-auth')) return;
  if (!__auth) await __authReady;
  if (__auth) req.authUser = await __auth.getSessionUser(req);
});

// mount all better-auth endpoints
fastify.route({
  method: ['GET', 'POST'],
  url: '/api/auth/*',
  handler: async (req, reply) => {
    if (!__auth) await __authReady;
    if (!__auth) return reply.code(500).send({ error: 'auth unavailable' });
    return __auth.handleAuthRequest(req, reply);
  }
});

${anchor}`;
if (!s.includes(anchor)) { console.error('anchor 1 not found'); process.exit(1); }
s = s.replace(anchor, wiring);

// 2) Global guard: session admin OR legacy key
const g1 = `const authFail = (req, reply) => {
  if ((req.query.key || '') !== OWNER_KEY) { reply.code(401).send({ error: 'unauthorized' }); return true; }
  return false;
};`;
const g1new = `const authFail = (req, reply) => {
  if (req.authUser && req.authUser.role === 'admin') return false; // session-based admin
  if ((req.query.key || '') !== OWNER_KEY) { reply.code(401).send({ error: 'unauthorized' }); return true; }
  return false;
};`;
if (!s.includes(g1)) { console.error('anchor 2 not found'); process.exit(1); }
s = s.replace(g1, g1new);

// 3) Building guard: session (matching buildingSlug or admin) OR legacy keys
const g2 = `async function authBuildingFail(req, reply, slug) {
  const key = req.query.key || '';`;
const g2new = `async function authBuildingFail(req, reply, slug) {
  if (req.authUser) {
    if (req.authUser.role === 'admin') return false;
    if (req.authUser.buildingSlug && req.authUser.buildingSlug === slug) return false;
  }
  const key = req.query.key || '';`;
if (!s.includes(g2)) { console.error('anchor 3 not found'); process.exit(1); }
s = s.replace(g2, g2new);

fs.copyFileSync(f, f + '.bak-preauth');
fs.writeFileSync(f, s);
console.log('patched ok');
