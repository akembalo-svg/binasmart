// BinaSmart API v0.2 — Fastify + Prisma + invoice cron + owner dashboard
require('dotenv').config?.();
const fastify = require('fastify')({ logger: false, ignoreTrailingSlash: true });

// ---- technical-SEO: security headers + static-asset caching ----
fastify.addHook('onSend', async (req, reply, payload) => {
  reply.header('Strict-Transport-Security', 'max-age=15768000');
  reply.header('X-Content-Type-Options', 'nosniff');
  // A route that chose its own Referrer-Policy keeps it (/i/:token and the tenant poster send no-referrer).
  if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Pages may be framed only by bina.et itself and by Telegram (the mini apps open inside web.telegram.org);
  // any other site embedding a BinaSmart page is refused. Browser features stay limited to our own origin.
  if (!reply.hasHeader('Content-Security-Policy') && /text\/html/i.test(String(reply.getHeader('content-type') || '')))
    reply.header('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
  if (!reply.hasHeader('Permissions-Policy')) reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=(self), usb=()');
  const full = String(req.raw.url || ''), u = full.split('?')[0];
  if (reply.statusCode < 400) {
    if (u === '/sw.js' || u === '/offline') reply.header('Cache-Control', 'no-cache'); // the service worker must always be re-checked
    else if (/^\/static\//.test(u) && /[?&]v=/.test(full)) reply.header('Cache-Control', 'public, max-age=31536000, immutable'); // versioned: bump ?v= to change
    else if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|pmtiles)$/i.test(u)) reply.header('Cache-Control', 'public, max-age=2592000, immutable');
    else if (/\.(js|css|webmanifest|pbf)$/i.test(u)) reply.header('Cache-Control', 'public, max-age=86400');
    else if (/^\/static\/docs\/.*\.pdf$/i.test(u)) reply.header('Cache-Control', 'public, max-age=86400'); // hosted government forms: same name, refreshed when the Ministry changes them
  }
  return payload;
});

const { PrismaClient } = require('@prisma/client');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

fastify.register(require('@fastify/cors'), { origin: true });

fastify.register(require('@fastify/static'), {
  root: require('path').join(__dirname, 'public'),
  prefix: '/static/'
  // cache headers live in the onSend hook above (versioned ?v= assets are immutable for a year)
});

// ===== BETTER AUTH WIRING =====
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

// A sign-in that fails — or a callback URL opened directly, which has no sign-in to finish — used to
// dump better-auth's raw error page. Send people back to the login page with a readable reason instead.
fastify.get('/api/auth/error', async (req, reply) => {
  const code = String((req.query || {}).error || '').replace(/[^a-z_]/gi, '').slice(0, 40);
  const why = code === 'state_not_found'
    ? 'ይህ አድራሻ በቀጥታ አይከፈትም · That address only works as the last step of a sign-in. Start here.'
    : 'መግቢያው አልተሳካም · Sign-in did not complete. Please try again.';
  reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
  return '<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + '<title>Sign-in · BinaSmart</title><link rel="icon" href="/icon-32.png">'
    + '<link rel="stylesheet" href="/static/fonts/fonts.css?v=2"><style>'
    + 'body{font-family:"Plus Jakarta Sans","Noto Sans Ethiopic",system-ui,sans-serif;background:#F8FAFC;color:#081120;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}'
    + '.c{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#64748B;line-height:1.5;margin:0 0 20px}'
    + 'a{display:block;padding:14px;border-radius:12px;background:#00C896;color:#062;font-weight:800;text-decoration:none}'
    + 'small{display:block;margin-top:14px;color:#94A3B8}</style></head><body><div class="c">'
    + '<h1>መግቢያ · Sign in</h1><p>' + why + '</p>'
    + '<a href="/login">ወደ መግቢያ ገጽ ይሂዱ · Go to the sign-in page</a>'
    + '<small>' + (code || 'unknown') + '</small></div></body></html>';
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

// ===== ONE ACCOUNT =====
// /api/me is the single answer to "who is this and what may they do". Everything the site used to
// keep in four places — rider, driver, shop owner, building owner — hangs off the signed-in account.
const { makeIdentity } = require('./auth/identity');
const identity = makeIdentity({ prisma });
const tgauthSrv = require('./ride/tgauth');

fastify.get('/api/me', async (req, reply) => {
  reply.header('Cache-Control', 'no-store');
  if (!req.authUser) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
  // Reconcile once: a Telegram account whose number we already proved on a ride gets its profiles
  // attached here rather than in the sign-in path, so it is retried on every visit until it lands.
  if (req.authUser.telegramId && !req.authUser.phone) {
    try { await identity.linkFromTelegram(req.authUser.id, req.authUser.telegramId); } catch (e) { fastify.log.warn('[me] link ' + e.message); }
  }
  const me = await identity.me(req.authUser.id);
  return me ? { ok: true, me } : reply.code(404).send({ ok: false, error: 'no_account' });
});

// Prove a phone with a contact Telegram signed, then pull in the rider/driver rows that carry it.
fastify.post('/api/me/phone', async (req, reply) => {
  if (!req.authUser) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
  const contact = (req.body || {}).contact;
  const token = process.env.BINA_RIDER_BOT_TOKEN || '';
  const v = contact && token ? tgauthSrv.verifyContact(String(contact), token) : null;
  if (!v) return reply.code(400).send({ ok: false, error: 'unverified_contact' });
  const r = await identity.setVerifiedPhone(req.authUser.id, v.phone, 'telegram_contact');
  if (!r.ok) return reply.code(r.error === 'phone_taken' ? 409 : 400).send(r);
  return { ok: true, phone: r.phone, linked: r.linked, me: await identity.me(req.authUser.id) };
});

// Whether the phone door exists at all. Three switches, all of them needed, in one place: a
// provider token (messaging/sms.js), SMS actually switched on, and a pepper long enough to hash a
// code with (auth/phone-code.js MIN_PEPPER). Half a door is worse than none — a button that sends
// nothing looks like a site that is broken. The answer is a boolean and only a boolean: no value,
// no length, nothing that narrows a guess at either secret.
function authPhoneReady(env) {
  return !!(env.SMS_API_TOKEN && env.SMS_MODE === 'live' && String(env.AUTH_PHONE_CODE_PEPPER || '').length >= 32);
}

// Which sign-in doors are actually configured. /login asks this so it never shows a button that
// cannot work: a missing Google key or bot token hides that door instead of failing on the click.
fastify.get('/api/auth-methods', async (req, reply) => {
  reply.header('Cache-Control', 'public, max-age=60');
  return {
    // AUTH_GOOGLE=0 closes the Google door without deleting its keys (owner's choice, 2026-09-17: sign-in
    // is Telegram or a phone code — no password to forget, and the person is identified either way).
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) && process.env.AUTH_GOOGLE !== '0',
    telegram: !!process.env.BINA_RIDER_BOT_TOKEN,
    telegramBot: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
    email: true,
    phone: authPhoneReady(process.env)   // sign in with a code sent by SMS
  };
});

const OWNER_KEY = process.env.OWNER_KEY || 'change-me';
// The key may arrive as a header or, still, as a query parameter. The header is preferred because a
// query string is written to the access log, the address bar and any outgoing Referer; the parameter
// stays because two report links in the dashboard are document navigations, which cannot send one.
// business/index.js has read x-owner-key for its ops routes all along — same name here.
const keyOf = req => String(req.headers['x-owner-key'] || req.query.key || '');
const authFail = (req, reply) => {
  if (req.authUser && req.authUser.role === 'admin') return false; // session-based admin
  if (keyOf(req) !== OWNER_KEY) { reply.code(401).send({ error: 'unauthorized' }); return true; }
  return false;
};
// per-building owner key (scoped) OR global key
// Building owner keys live in OwnerKey as sha256 hashes — building/ownerKeys.js explains why a table and
// not a hashed column. Building.ownerKey used to hold them in plain text, compared with ===.
const { makeOwnerKeys } = require('./building/ownerKeys');
const ownerKeys = makeOwnerKeys({ prisma });
async function authBuildingFail(req, reply, slug) {
  if (req.authUser) {
    if (req.authUser.role === 'admin') return false;
    if (req.authUser.buildingSlug && req.authUser.buildingSlug === slug) return false;
  }
  const key = keyOf(req);
  if (key === OWNER_KEY) return false;
  if (key && await ownerKeys.check(slug, key)) return false;   // a hash lookup, scoped to this building
  reply.code(401).send({ error: 'unauthorized' });
  return true;
}

// ===== shared by the restaurant, hotel and owner routes below =====
// Kept here rather than beside the hotel routes because the restaurant section is ~1,000 lines
// earlier and builds its limiter at module-evaluation time, which a const declared later cannot serve.
// Both rules fail quietly - a timezone is wrong for three hours a night, a disclosure is invisible
// until it stops firing - so they live in a module with tests. See test/hotels.test.js.
const { isDemo: hotelIsDemo, addisDay: addisToday } = require('./hotels/rules');
// Booking is unauthenticated, costs nothing and takes rooms off the market: a PENDING booking counts
// against availability and nothing expires it. ride/routes.js limits ride requests the same way, but
// it is built later in this file, so the shape is repeated here rather than depending on that order.
function hotelLimiter(windowMs, max) {
  const m = new Map();
  return key => {
    const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now); m.set(key, hits);
    if (m.size > 5000) for (const [k, v] of m) { if (!v.length || now - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}
const bookRL = hotelLimiter(600000, 5);
// Behind nginx req.ip is 127.0.0.1 for everyone; X-Real-IP is set by nginx and the client cannot append to it.
const bookIp = req => String(req.headers['x-real-ip'] || req.ip);
// etMobile VALIDATES (null for anything not Ethiopian) and is what gates an outbound message;
// phoneKey only IDENTIFIES, so a foreign number is still rate limited rather than refused.
const { normPhone: etMobile, phoneKey } = require('./ride/phone');
// Both password routes below verify with scryptSync, which blocks the event loop — ten attempts
// measured at 556 ms on this server. Unthrottled, that is a denial of service before it is ever a
// brute force, and login issues an owner key for every building the account owns.
const loginRL = hotelLimiter(600000, 8);

// health
// /hotel/<anything>, /restaurant/<anything>, /hospital/<anything> and /flights/<anything> all served
// the same 200 bytes as the real page - byte-identical, with no canonical anywhere in them. So the
// number of indexable urls on this site was unbounded: one typo in one inbound link mints a new page
// that Google will crawl, find substantial, and have no way to fold back into the original.
//
// Each route now asks the same question its own API asks, and answers 404 when the slug is not a
// thing. A slug that IS a thing gets a self-referencing canonical, which these client-rendered pages
// never had.
const slugMiss = (what, back) => '<!doctype html><html lang="am"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + what + ' አልተገኘም · Not found | BinaSmart</title>'
  + '<meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;text-align:center;padding:80px 20px;color:#0f2027}'
  + 'a{color:#00a884;font-weight:700}</style></head><body><div style="font-size:52px">🔍</div>'
  + '<h1 style="font-size:22px">' + what + ' አልተገኘም · Not found</h1>'
  + '<p><a href="' + back + '">← ' + back + '</a></p></body></html>';

async function slugPage(reply, file, found, canonical, what, back) {
  if (!found) return reply.code(404).type('text/html; charset=utf-8').send(slugMiss(what, back));
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  if (!/rel="canonical"/.test(html)) html = html.replace('</head>', '<link rel="canonical" href="' + canonical + '">\n</head>');
  return reply.type('text/html; charset=utf-8').send(html);
}

fastify.get('/nav', async (req, reply) => reply.sendFile('nav.html'));
fastify.get('/airport', async (req, reply) => reply.sendFile('airport.html')); // Bina Airport transfer landing (7 Sep 2026) -> hands off to /ride
fastify.get('/pool', async (req, reply) => reply.sendFile('pool.html')); // BinaPool landing (8 Sep 2026) -> hands off to /ride?pool=1
fastify.get('/login', async (req, reply) => reply.sendFile('login.html'));
fastify.get('/account', async (req, reply) => reply.header('Cache-Control','no-store').sendFile('account.html'));
// ===== OWNER LOGIN: phone + password =====
const cryptoMod = require('crypto');
function hashPw(pw){
  const salt = cryptoMod.randomBytes(8).toString('hex');
  const h = cryptoMod.scryptSync(pw, salt, 32).toString('hex');
  return 'scrypt$' + salt + '$' + h;
}
function checkPw(pw, stored){
  try{
    const [alg, salt, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    return cryptoMod.timingSafeEqual(Buffer.from(h, 'hex'), cryptoMod.scryptSync(pw, salt, 32));
  }catch(e){ return false; }
}
// ⚠️ This FORMATS a phone number, it does not validate one: "not a phone" comes back as "+" and a
// foreign number passes through unchanged. Fine for a database lookup, wrong for deciding whether to
// send someone a message — use etMobile (ride/phone.js) for that.
function normPhone(p){
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '251' + d.slice(1);
  if (d.startsWith('9') && d.length === 9) d = '251' + d;
  return '+' + d;
}
fastify.post('/api/owner/login', async (req, reply) => {
  if (!loginRL('ip:' + bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const { phone, password } = req.body || {};
  if (!phone || !password) return reply.code(400).send({ error: 'phone_and_password_required' });
  const loginPk = phoneKey(phone);
  if (loginPk && !loginRL(loginPk)) return reply.code(429).send({ error: 'too_many' });
  const user = await prisma.user.findFirst({ where: { phone: normPhone(phone) } });
  if (!user || !user.passwordHash || !checkPw(password, user.passwordHash))
    return reply.code(401).send({ error: 'wrong_phone_or_password' });
  const buildings = await prisma.building.findMany({ where: { ownerId: user.id } });
  if (!buildings.length) return reply.code(403).send({ error: 'no_buildings_for_this_account' });
  const out = [];
  // Each login gets its own key. The stored one cannot be handed back — only its hash is kept — and
  // replacing it would sign the owner out of every other device the moment they signed in on this one.
  for (const b of buildings) {
    const key = await ownerKeys.issue(b.id, b.qrSlug, 'login');
    out.push({ slug: b.qrSlug, name: b.name, key });
  }
  return { ok: true, buildings: out };
});
fastify.post('/api/owner/change-password', async (req, reply) => {
  if (!loginRL('ip:' + bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const { phone, oldPassword, newPassword } = req.body || {};
  if (!phone || !oldPassword || !newPassword) return reply.code(400).send({ error: 'missing_fields' });
  const pwPk = phoneKey(phone);
  if (pwPk && !loginRL(pwPk)) return reply.code(429).send({ error: 'too_many' });
  if (String(newPassword).length < 6) return reply.code(400).send({ error: 'password_too_short_min_6' });
  const user = await prisma.user.findFirst({ where: { phone: normPhone(phone) } });
  if (!user || !user.passwordHash || !checkPw(oldPassword, user.passwordHash))
    return reply.code(401).send({ error: 'wrong_phone_or_password' });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPw(newPassword) } });
  return { ok: true };
});
fastify.get('/owner', async (req, reply) => reply.sendFile('owner-login.html'));
fastify.get('/health', async () => ({ ok: true, service: 'binasmart-api', ts: new Date().toISOString() }));

// ===== LANDING PAGE (connectcare.cc root) =====
fastify.get('/', async (req, reply) => reply.sendFile('home-v3.html')); // 7 Sep 2026 BinaSmart-home style; prior: gemini-home.html, coming-soon.html, index.html
fastify.get('/robots.txt', async (req, reply) => reply.sendFile('robots.txt'));
// The IndexNow key must answer at the ROOT of the host, and this server's static files are served
// under /static/ — the same trap the logo paths fell into. One route, matching only a 32-hex name.
fastify.get('/:key.txt', async (req, reply) => {
  const name = String(req.params.key || '');
  if (!/^[a-f0-9]{32}$/.test(name)) return reply.code(404).send('Not found');
  return reply.type('text/plain; charset=utf-8').sendFile(name + '.txt');
});
fastify.get('/sitemap.xml', async (req, reply) => {
  const bs = await prisma.building.findMany({ select: { qrSlug: true, buildingType: true }, orderBy: { createdAt: 'asc' } });
  const posts = await prisma.newsPost.findMany({ where: { published: true }, select: { slug: true } });
  // Only tenders that are still open. A sitemap is a list of pages worth crawling, and a closed
  // tender can never satisfy the search that finds it — 101 of 244 had already expired.
  // A tender with no deadline has nothing to compare against now, so it used to stay here forever.
  // 38 of 244 have none. The 45-day cutoff comes from the 205 tenders that DO carry one: median 9
  // days from publication to deadline, p90 22, only 2.4% longer than 30. It leans long on purpose —
  // hiding a tender that is still open costs someone an opportunity, keeping a dead one costs an
  // impression. The page stays reachable either way; this only withdraws the request to index it.
  const tnds = await prisma.tender.findMany({
    where: { published: true, OR: [
      { deadline: null, publishedAt: { gte: new Date(Date.now() - 45 * 86400000) } },
      { deadline: { gte: openSince() } },   // a bare date closes at midnight in Addis, not in UTC
    ] },
    select: { slug: true, deadline: true } });
  // Only shops whose owner has claimed them. The rest are noindex — see business/claimed.js —
  // and a sitemap is a request to index. ownerPhone used to count here; it is ops noting who MAY
  // claim a shop, not the owner claiming it, so it never belonged in this test.
  const shopUrls = (await prisma.shop.findMany({
    where: { status: 'live', NOT: { slug: null }, OR: [{ NOT: { claimedAt: null } }, { NOT: { tgChatId: null } }] },
    select: { slug: true } }).catch(() => [])).map(x => 'https://bina.et/shop/' + x.slug);
  const cshows = await prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: new Date() } }, select: { id: true } }).catch(() => []);
  const films = (await prisma.film.findMany({ where: { status: 'public' },
    select: { slug: true, status: true, rights: true, rightsUntil: true } }).catch(() => []))
    .filter(f => filmIsPublic(f));
  // A post that canonicalises to a guide page has resigned in favour of it; asking Google to index it
  // anyway is the site contradicting itself. CANONICAL_TO is declared much further down this file,
  // which is fine — a handler body runs at request time, not during module evaluation.
  // A page whose only content is "No trips found" is not worth crawling. Every demo trip departed on
  // 21 August and /api/travel filters to future departures, so /travel has been empty since. Same
  // rule as the tenders and the cinema shows above; this one was a hardcoded string and escaped it.
  const tripsAhead = await prisma.travelTrip.count({ where: { active: true, departure: { gt: new Date() } } }).catch(() => 0);
  // Same for the marketplaces: with no active listing, /cars and /property are an empty grid and a form.
  const carsListed = await prisma.carListing.count({ where: { active: true } }).catch(() => 0);
  const propsListed = await prisma.propertyListing.count({ where: { active: true } }).catch(() => 0);
  // Jobs. Same rule as the tenders above: only what is still open, because a closed vacancy can never
  // satisfy the search that finds it. A category page is listed only while it actually has vacancies in
  // it - an empty "Agriculture jobs" page asks Google to rank a promise we are not keeping.
  const openJobs = await prisma.job.findMany({
    where: { published: true, OR: [
      { deadline: null, publishedAt: { gte: new Date(Date.now() - 45 * 86400000) } },
      { deadline: { gte: openSince() } },
    ] },
    select: { slug: true, category: true, employerId: true } }).catch(() => []);
  const jobCats = [...new Set(openJobs.map(j => j.category).filter(Boolean))];
  const jobEmployerIds = [...new Set(openJobs.map(j => j.employerId))];
  const jobEmployers = jobEmployerIds.length
    ? (await prisma.employer.findMany({ where: { id: { in: jobEmployerIds } }, select: { slug: true } }).catch(() => []))
    : [];

  const urls = ['https://bina.et/', 'https://bina.et/ai', 'https://bina.et/ai-am', 'https://bina.et/news', 'https://bina.et/tenders', 'https://bina.et/insurance', 'https://bina.et/cars', 'https://bina.et/property', 'https://bina.et/for-insurers', 'https://bina.et/ride', 'https://bina.et/pool', 'https://bina.et/airport', 'https://bina.et/hotels', 'https://bina.et/why-binasmart', 'https://bina.et/about', 'https://bina.et/drive-with-us', 'https://bina.et/nav', 'https://bina.et/blog/smart-building-management-ethiopia', 'https://bina.et/travel', 'https://bina.et/cinema', 'https://bina.et/for-cinemas', 'https://bina.et/for-business', 'https://bina.et/flights', 'https://bina.et/for-filmmakers', 'https://bina.et/restaurant/bina-restaurant', 'https://bina.et/hospital/bina-general-hospital', 'https://bina.et/flights/hanud', 'https://bina.et/diaspora', 'https://bina.et/fayda', 'https://bina.et/telebirr', 'https://bina.et/telesign', 'https://bina.et/passport', 'https://bina.et/mesob', 'https://bina.et/guides', 'https://bina.et/free-ethiopian-tenders', 'https://bina.et/property-management', 'https://bina.et/property-management-software', 'https://bina.et/manage-rental-property', 'https://bina.et/digital-rent-collection', 'https://bina.et/tin-registration-ethiopia', 'https://bina.et/business-registration-ethiopia', 'https://bina.et/driving-licence-ethiopia', 'https://bina.et/vat-registration-ethiopia', 'https://bina.et/ethiopia-evisa', 'https://bina.et/rental-agreement-ethiopia', 'https://bina.et/cbe-birr-guide', 'https://bina.et/customs-import-duty-ethiopia', 'https://bina.et/how-to-start-a-business-in-ethiopia', 'https://bina.et/digital-ethiopia-2026', 'https://bina.et/amharic-ai', 'https://bina.et/oromo-ai', 'https://bina.et/afiya', 'https://bina.et/asmat', 'https://bina.et/living-working-in-ethiopia-guide', 'https://bina.et/ethiopia-income-tax-calculator', 'https://bina.et/tax-forms', 'https://bina.et/import-car-to-ethiopia', 'https://bina.et/ethiopian-origin-id-yellow-card', 'https://bina.et/open-bank-account-ethiopia', 'https://bina.et/birth-marriage-certificate-ethiopia', 'https://bina.et/pay-utility-bills-ethiopia', 'https://bina.et/lmis-labor-id-ethiopia', 'https://bina.et/coc-certificate-ethiopia', 'https://bina.et/tenant-screening-ethiopia', ...posts.filter(p => !CANONICAL_TO[p.slug]).map(p => 'https://bina.et/news/' + p.slug), ...tnds.map(t => 'https://bina.et/tenders/' + t.slug), ...cshows.map(s => 'https://bina.et/cinema/' + s.id), ...shopUrls, 'https://bina.et/watch', ...films.map(f => 'https://bina.et/watch/' + f.slug), /* /b/:slug is noindex — it lists tenants by name, unit and phone — so it is not requested here.
     The hotel pages below are a different template and stay. */ ...bs.filter(b => b.buildingType === 'HOTEL').map(b => 'https://bina.et/hotel/' + b.qrSlug), 'https://bina.et/jobs', ...jobCats.map(c => 'https://bina.et/jobs/category/' + c), ...openJobs.map(j => 'https://bina.et/jobs/' + j.slug), ...jobEmployers.map(e => 'https://bina.et/employer/' + e.slug), ...(fastify.healthServiceUrls ? fastify.healthServiceUrls() : [])]
    .filter(u => u !== 'https://bina.et/travel' || tripsAhead)
    .filter(u => (u !== 'https://bina.et/cars' || carsListed) && (u !== 'https://bina.et/property' || propsListed));
  reply.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => '<url><loc>' + u + '</loc></url>').join('\n') + '\n</urlset>');
});
fastify.get('/sw.js', async (req, reply) => reply.header('Cache-Control', 'no-cache').header('Service-Worker-Allowed', '/').sendFile('sw.js'));
fastify.get('/offline', async (req, reply) => reply.header('Cache-Control', 'no-cache').sendFile('offline.html'));
fastify.get('/manifest.webmanifest', async (req, reply) => reply.type('application/manifest+json').sendFile('manifest.webmanifest'));
fastify.get('/favicon.ico', async (req, reply) => reply.sendFile('favicon.ico'));
fastify.get('/favicon-16.png', async (req, reply) => reply.sendFile('icon-32.png'));
fastify.get('/favicon-32.png', async (req, reply) => reply.sendFile('icon-32.png'));
fastify.get('/apple-touch-icon.png', async (req, reply) => reply.sendFile('icon-192.png'));
fastify.get('/icon-192.png', async (req, reply) => reply.sendFile('icon-192.png'));
fastify.get('/icon-32.png', async (req, reply) => reply.sendFile('icon-32.png'));
fastify.get('/icon-512.png', async (req, reply) => reply.sendFile('icon-512.png'));
fastify.get('/binasmart2026indexnow1784112792.txt', async (req, reply) => reply.sendFile('binasmart2026indexnow1784112792.txt'));
// ===== RESTAURANT: menu + QR table ordering =====
fastify.get('/api/restaurant/:slug', async (req, reply) => {
  const shop = await prisma.shop.findFirst({
    where: { OR: [{ name: { equals: req.params.slug.replace(/-/g, ' '), mode: 'insensitive' } }], tenancy: { active: true } },
    include: { products: { where: { visible: true }, orderBy: { category: 'asc' } },
      tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true, subCity: true } } } } } } } });
  // A shop with no visible menu is not a restaurant, it is a tenant - and this route matches on name,
  // so without this it answered for every one of JJ Darule's named individuals and handed out the
  // mobile number and unit of whoever was asked for.
  if (!shop || !shop.products.length) return reply.code(404).send({ error: 'not_found' });
  // No phone. restaurant.html never read it, and the people behind these names did not publish it.
  return { restaurant: { id: shop.id, name: shop.name, nameAm: shop.nameAm,
    demo: hotelIsDemo(shop.tenancy.unit.building) || undefined,
    building: shop.tenancy.unit.building.name, buildingSlug: shop.tenancy.unit.building.qrSlug, unit: shop.tenancy.unit.number },
    menu: shop.products.map(p => ({ id: p.id, name: p.name, nameAm: p.nameAm, price: p.price, category: p.category || 'Menu' })) };
});

// An order is a message to a real business: notifyShop() fires for any shop with status 'live'.
// Unauthenticated and unlimited, that is an open line into someone's Telegram. Same ceiling as the
// ride and hotel paths.
const orderRL = hotelLimiter(600000, 8);
fastify.post('/api/restaurant/:shopId/order', async (req, reply) => {
  if (!orderRL(bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const { table, items, customerName, customerPhone, note } = req.body || {};
  if (!Array.isArray(items) || !items.length) return reply.code(400).send({ error: 'empty_order' });
  // The only one of these where a phone is optional, so the dimension applies only when given.
  const orderPk = phoneKey(customerPhone);
  if (orderPk && !orderRL(orderPk)) return reply.code(429).send({ error: 'too_many' });
  const shop = await prisma.shop.findUnique({ where: { id: req.params.shopId },
    include: { tenancy: { include: { unit: { include: { building: true } } } } } });
  if (!shop) return reply.code(404).send({ error: 'not_found' });
  const ids = items.map(i => i.productId);
  const prods = await prisma.product.findMany({ where: { id: { in: ids }, shopId: shop.id, visible: true } });
  if (prods.length !== ids.length) return reply.code(400).send({ error: 'bad_items' });
  let total = 0;
  const lines = items.map(i => {
    const p = prods.find(x => x.id === i.productId);
    const qty = Math.max(1, Math.min(20, parseInt(i.qty) || 1));
    total += p.price * qty;
    return { productId: p.id, qty, unitPrice: p.price };
  });
  const order = await prisma.order.create({ data: {
    shopId: shop.id, customerName: customerName || null, customerPhone: customerPhone || null,
    deliverToUnit: table ? ('Table ' + String(table).slice(0, 10)) : null, note: note || null,
    total, source: 'QR-TABLE', items: { create: lines } } });
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { orderCount: { increment: 1 } } });
  const b = shop.tenancy.unit.building;
  const code = 'OD-' + order.id.slice(-6).toUpperCase();
  await audit(b.id, 'FOOD_ORDER', shop.name + (table ? ' · Table ' + table : '') + ' · ' + code, total);
  if (shop.status === 'live') {
    const summary = lines.map(l => { const p = prods.find(x => x.id === l.productId); return l.qty + '× ' + (p.nameAm || p.name); }).join(', ');
    notifyShop(shop, '🍽️ አዲስ ትዕዛዝ / NEW ORDER ' + code + (table ? ' · Table ' + table : '') + '\n' + summary + '\n💰 ' + total.toLocaleString() + ' ETB', WA_CHANNEL[b.qrSlug]).catch(() => {});
  }
  return { ok: true, code, orderId: order.id, total };
});

fastify.get('/api/owner/:slug/orders', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const orders = await prisma.order.findMany({
    where: { shop: { tenancy: { unit: { buildingId: b.id } } } },
    include: { items: { include: { product: { select: { name: true } } } }, shop: { select: { name: true } } },
    orderBy: { createdAt: 'desc' }, take: 60 });
  return { orders };
});

fastify.post('/api/owner/:slug/order/:id/status', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const st = (req.body && req.body.status || '').toUpperCase();
  if (!['ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(st))
    return reply.code(400).send({ error: 'bad_status' });
  // Authenticating the building is not the same as owning the row. Every sibling route here -
  // appointment, booking, expense, meter-reading, meter-bill, staff - looks the row up and 404s on
  // mismatch; this one updated by id alone, so one building's key could cancel another's orders.
  // 404 rather than 403, so a wrong id is not confirmed to exist.
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const o = await prisma.order.findUnique({ where: { id: req.params.id },
    include: { shop: { select: { tenancy: { select: { unit: { select: { buildingId: true } } } } } } } });
  if (!b || !o || o.shop.tenancy.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  await prisma.order.update({ where: { id: o.id },
    data: { status: st, completedAt: ['DELIVERED', 'COMPLETED'].includes(st) ? new Date() : undefined } });
  return { ok: true, status: st };
});

fastify.get('/restaurant/:slug', async (req, reply) => {
  // The same test /api/restaurant/:slug makes: a shop matched by name that actually has a menu. A
  // tenant without one is not a restaurant, it is a person.
  const slug = String(req.params.slug);
  const shop = await prisma.shop.findFirst({ where: { name: { equals: slug.replace(/-/g, ' '), mode: 'insensitive' }, tenancy: { active: true } },
    include: { products: { where: { visible: true }, select: { id: true }, take: 1 } } });
  return slugPage(reply, 'restaurant.html', !!(shop && shop.products.length),
    'https://bina.et/restaurant/' + slug, 'ሬስቶራንት · Restaurant', '/business');
});

// ===== DIASPORA: building-owner leads =====
fastify.post('/api/diaspora-lead', async (req, reply) => {
  const { name, phone, country, city, building, units, note } = req.body || {};
  if (!name || !phone) return reply.code(400).send({ error: 'missing_fields' });
  const lead = await prisma.diasporaLead.create({ data: {
    name: String(name).slice(0, 80), phone: String(phone).slice(0, 30),
    country: country ? String(country).slice(0, 40) : null, city: city ? String(city).slice(0, 40) : null,
    building: building ? String(building).slice(0, 120) : null, units: units ? String(units).slice(0, 20) : null,
    note: note ? String(note).slice(0, 500) : null } });
  notifyAdmins('🌍 NEW DIASPORA LEAD — BinaSmart\n👤 ' + lead.name + ' (' + lead.phone + ')\n📍 Lives in: ' + (lead.country || '?') + '\n🏢 Building: ' + (lead.building || '?') + ' · ' + (lead.city || 'Addis Ababa') + ' · ' + (lead.units || '?') + ' units\n📝 ' + (lead.note || '—')).catch(() => {});
  return { ok: true };
});

fastify.get('/diaspora', async (req, reply) => reply.sendFile('diaspora.html'));
fastify.get('/insurance', async (req, reply) => reply.sendFile('insurance.html'));
fastify.get('/for-insurers', async (req, reply) => reply.sendFile('for-insurers.html'));
// ===== CARS + REAL ESTATE marketplace (partner-supplied) =====
fastify.get('/cars', async (req, reply) => reply.sendFile('cars.html'));
fastify.get('/property', async (req, reply) => reply.sendFile('property.html'));
// What a listing shows, and nothing else. dealerPhone is deliberately absent: cars.html never reads
// it, and the page's contact route is the lead form, which passes the enquiry through the admin
// rather than publishing a dealer's number. `return { cars }` would publish whatever the model grows
// next — which is exactly how /api/restaurant/:slug ended up handing out a tenant's mobile.
const pubCar = c => ({ slug: c.slug, title: c.title, make: c.make, model: c.model, year: c.year,
  price: c.price, mileage: c.mileage, fuel: c.fuel, transmission: c.transmission, bodyType: c.bodyType,
  condition: c.condition, city: c.city, imageUrl: c.imageUrl, dealer: c.dealer, featured: c.featured });
fastify.get('/api/cars', async (req) => {
  const cars = await prisma.carListing.findMany({ where: { active: true }, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: 60 });
  return { cars: cars.map(pubCar) };
});
// Same rule, same reason. agencyPhone is not here because property.html does not read it and the
// enquiry goes through the lead form. `verified` stays — the page renders a ✓ Verified badge from it —
// but note it means "an admin ticked the box", not that anything was checked automatically.
const pubProperty = p => ({ slug: p.slug, title: p.title, listingType: p.listingType,
  propertyType: p.propertyType, price: p.price, beds: p.beds, baths: p.baths, area: p.area,
  city: p.city, location: p.location, imageUrl: p.imageUrl, agency: p.agency, verified: p.verified });
fastify.get('/api/properties', async (req) => {
  const props = await prisma.propertyListing.findMany({ where: { active: true }, orderBy: [{ verified: 'desc' }, { createdAt: 'desc' }], take: 60 });
  return { properties: props.map(pubProperty) };
});
fastify.post('/api/admin/car', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {}; if (!b.slug || !b.title) return reply.code(400).send({ error: 'slug+title' });
  const f = ['slug','title','make','model','year','price','mileage','fuel','transmission','bodyType','condition','city','imageUrl','dealer','dealerPhone'];
  const data = {}; f.forEach(k => { if (b[k] != null) data[k] = String(b[k]); });
  if (data.imageUrl && !httpUrl(data.imageUrl)) return reply.code(400).send({ error: 'imageUrl' });
  data.featured = !!b.featured; if (b.active != null) data.active = !!b.active;
  const c = await prisma.carListing.upsert({ where: { slug: b.slug }, update: data, create: data });
  return { ok: true, url: 'https://bina.et/cars#' + c.slug };
});
fastify.post('/api/admin/property', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {}; if (!b.slug || !b.title) return reply.code(400).send({ error: 'slug+title' });
  const f = ['slug','title','listingType','propertyType','price','beds','baths','area','city','location','imageUrl','agency','agencyPhone'];
  const data = {}; f.forEach(k => { if (b[k] != null) data[k] = String(b[k]); });
  // The pages put imageUrl inside a CSS url(); only a web address belongs there.
  if (data.imageUrl && !httpUrl(data.imageUrl)) return reply.code(400).send({ error: 'imageUrl' });
  data.verified = !!b.verified; if (b.active != null) data.active = !!b.active;
  const p = await prisma.propertyListing.upsert({ where: { slug: b.slug }, update: data, create: data });
  return { ok: true, url: 'https://bina.et/property#' + p.slug };
});
// This route ends in a WhatsApp message from BinaSmart's own number, to a number chosen by whoever
// called it. Unlimited, that is an open relay and a way to get 0911244344 banned again.
const leadRL = hotelLimiter(600000, 5);
fastify.post('/api/market-lead', async (req, reply) => {
  if (!leadRL(bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const b = req.body || {};
  if (!b.name || !b.phone || !b.kind) return reply.code(400).send({ error: 'missing' });
  if (b.kind !== 'car' && b.kind !== 'property') return reply.code(400).send({ error: 'kind' });
  // phoneKey is null for input that identifies nobody, and the per-phone limit used to be skipped
  // whenever it was — so a junk "phone" got the IP limit only, and was still stored and sent to the
  // admin. phoneOk accepts any real-looking number, foreign ones included: the diaspora is the audience.
  if (!phoneOk(b.phone)) return reply.code(400).send({ error: 'phone' });
  if (!leadRL(phoneKey(String(b.phone).trim()))) return reply.code(429).send({ error: 'too_many' });
  const lead = await prisma.marketLead.create({ data: {
    kind: String(b.kind).slice(0,20), listingSlug: b.listingSlug ? String(b.listingSlug).slice(0,80) : null,
    listingRef: b.listingRef ? String(b.listingRef).slice(0,140) : null, name: String(b.name).slice(0,80),
    phone: String(b.phone).trim().slice(0,30), budget: b.budget ? String(b.budget).slice(0,40) : null,
    // Both pages send the same box as listingRef and note, so the admin saw it twice.
    note: b.note && b.note !== b.listingRef ? String(b.note).slice(0,500) : null } });
  const emoji = lead.kind === 'car' ? '\uD83D\uDE97' : '\uD83C\uDFE0';
  notifyAdmins(emoji + ' NEW ' + lead.kind.toUpperCase() + ' LEAD \u2014 BinaSmart\n\uD83D\uDC64 ' + lead.name + ' (' + lead.phone + ')' + (lead.listingRef ? '\n\uD83D\uDCCC ' + lead.listingRef : '') + (lead.budget ? '\n\uD83D\uDCB0 Budget: ' + lead.budget : '') + '\n\uD83D\uDCDD ' + (lead.note || '\u2014')).catch(() => {});
  // The lead is kept and the admin is told whatever the number looks like — /property is aimed at the
  // diaspora, so a foreign number is a customer, not a mistake. But the outbound message only goes to
  // a well-formed Ethiopian mobile, the numbers this bridge exists to serve. Without normPhone here,
  // b.phone was an arbitrary string handed straight to the sender.
  const waTo = etMobile(lead.phone);
  if (waTo) sendWa(waTo, 'BinaSmart \u2014 \u1325\u12eB\u1244\u12CE\u1295 \u1270\u1240\u1265\u1208\u1293\u1362 \u1260\u1240\u122D\u1265 \u12A5\u1295\u12F0\u12CD\u120B\u1208\u1295\u1362 (bina.et)').catch(() => {});
  return { ok: true };
});

// ---- INSURER PARTNER admin (referral programme) ----
fastify.post('/api/admin/insurer', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {};
  if (!b.slug || !b.name) return reply.code(400).send({ error: 'slug+name required' });
  const data = { slug: b.slug, name: b.name, products: b.products || '', commissionPct: b.commissionPct || null,
    commissionNote: b.commissionNote || null, agreement: b.agreement || 'PROSPECT',
    contactName: b.contactName || null, contactPhone: b.contactPhone || null, contactEmail: b.contactEmail || null,
    priority: parseInt(b.priority) || 0, active: !!b.active };
  const p = await prisma.insurerPartner.upsert({ where: { slug: b.slug }, update: data, create: data });
  return { ok: true, id: p.id };
});
fastify.get('/insurance-partners', async (req, reply) => {
  if ((req.query.key || '') !== OWNER_KEY) { reply.code(401).type('text/html').send('<h2>Unauthorized</h2>'); return; }
  const ps = await prisma.insurerPartner.findMany({ orderBy: [{ active: 'desc' }, { priority: 'desc' }, { name: 'asc' }] });
  const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const STAT = ['PROSPECT','CONTACTED','NEGOTIATING','SIGNED','ACTIVE'];
  const rows = ps.map(p => `<tr data-slug="${esc(p.slug)}">
    <td><b>${esc(p.name)}</b></td>
    <td><input class="pr" value="${esc(p.products)}" placeholder="Motor, Health, ..."></td>
    <td><input class="cm" value="${esc(p.commissionPct||'')}" placeholder="10%" style="width:70px"></td>
    <td><select class="ag">${STAT.map(s=>`<option ${s===p.agreement?'selected':''}>${s}</option>`).join('')}</select></td>
    <td><input class="ct" value="${esc(p.contactPhone||'')}" placeholder="09.." style="width:110px"></td>
    <td style="text-align:center"><input type="checkbox" class="ac" ${p.active?'checked':''}></td>
    <td><button onclick="save(this)">Save</button></td></tr>`).join('');
  reply.type('text/html').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>Insurer Partners · BinaSmart</title><style>
  body{font-family:system-ui,Segoe UI,sans-serif;max-width:1000px;margin:0 auto;padding:16px;background:#0f1720;color:#e8edf2}
  h1{font-size:20px}.sub{color:#8aa0b2;font-size:13px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 6px;border-bottom:1px solid #26333f;text-align:left}
  th{color:#8aa0b2;font-weight:700}input,select{background:#0f1720;border:1px solid #2c3a47;color:#e8edf2;border-radius:7px;padding:7px}
  .pr{width:100%}button{background:#0aa88f;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}
  .bar{margin:14px 0;display:flex;gap:10px;align-items:center}#msg{color:#8aa0b2;font-size:13px}
  .badge{font-size:11px;padding:2px 8px;border-radius:999px;background:#1c3b34;color:#3fbfa8}
  </style>
  <h1>🤝 Insurer Referral Partners</h1>
  <div class="sub">${ps.length} insurers · ${ps.filter(p=>p.active).length} active. Tick <b>active</b> once an agreement is signed → leads for their products auto-route to them (in your Telegram alert). Set products + commission per company.</div>
  <div class="bar"><button onclick="seed()">Seed 17 Ethiopian insurers</button><span id="msg"></span></div>
  <table><tr><th>Insurer</th><th>Products they offer</th><th>Comm.</th><th>Agreement</th><th>Contact</th><th>Active</th><th></th></tr>${rows||'<tr><td colspan=7 style="color:#8aa0b2">No partners yet — click Seed.</td></tr>'}</table>
  <script>
  const KEY=${JSON.stringify(req.query.key)};
  function save(btn){const tr=btn.closest('tr');const b={slug:tr.dataset.slug,name:tr.querySelector('b').textContent,
    products:tr.querySelector('.pr').value,commissionPct:tr.querySelector('.cm').value,agreement:tr.querySelector('.ag').value,
    contactPhone:tr.querySelector('.ct').value,active:tr.querySelector('.ac').checked};
    btn.textContent='…';fetch('/api/admin/insurer?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()).then(()=>{btn.textContent='Saved ✓';setTimeout(()=>btn.textContent='Save',1500)})}
  function seed(){document.getElementById('msg').textContent='Seeding…';fetch('/api/admin/insurer/seed?key='+encodeURIComponent(KEY),{method:'POST'}).then(r=>r.json()).then(d=>{document.getElementById('msg').textContent='Seeded '+d.added+' — reloading…';setTimeout(()=>location.reload(),1000)})}
  </script>`);
});
fastify.post('/api/admin/insurer/seed', async (req, reply) => {
  if (authFail(req, reply)) return;
  const ALLPROD = 'Motor, Health, Property, Business, Travel, Life';
  const list = ['Ethiopian Insurance Corporation','Awash Insurance','Nyala Insurance','Nib Insurance','United Insurance',
    'Africa Insurance','Oromia Insurance','Nile Insurance','Global Insurance','Lion Insurance','Abay Insurance','Zemen Insurance',
    'Berhan Insurance','National Insurance','Tsehay Insurance','Bunna Insurance','Lucy Insurance','Ethio-Life & General Insurance'];
  let added = 0;
  for (const name of list) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    try { await prisma.insurerPartner.upsert({ where: { slug }, update: {}, create: { slug, name, products: ALLPROD, agreement: 'PROSPECT', active: false } }); added++; } catch(e){}
  }
  return { ok: true, added };
});

// The same relay as /api/market-lead: this ends in a WhatsApp from BinaSmart's own number to a
// number the caller chose. Same ceiling, and the limit also stops notifyAdmins being used to bury
// Ibrahim's Telegram.
const insLeadRL = hotelLimiter(600000, 5);
fastify.post('/api/insurance-lead', async (req, reply) => {
  if (!insLeadRL(bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const b = req.body || {};
  if (!b.name || !b.phone) return reply.code(400).send({ error: 'missing_fields' });
  const insPk = phoneKey(b.phone);
  if (insPk && !insLeadRL(insPk)) return reply.code(429).send({ error: 'too_many' });
  const lead = await prisma.insuranceLead.create({ data: {
    insType: String(b.insType || 'Other').slice(0, 30), name: String(b.name).slice(0, 80), phone: String(b.phone).slice(0, 30),
    city: b.city ? String(b.city).slice(0, 40) : null, coverType: b.coverType ? String(b.coverType).slice(0, 30) : null,
    vehicleType: b.vehicleType ? String(b.vehicleType).slice(0, 40) : null, vehicleMake: b.vehicleMake ? String(b.vehicleMake).slice(0, 40) : null,
    vehicleYear: b.vehicleYear ? String(b.vehicleYear).slice(0, 10) : null, vehicleValue: b.vehicleValue ? String(b.vehicleValue).slice(0, 20) : null,
    estimate: b.estimate ? String(b.estimate).slice(0, 60) : null, note: b.note ? String(b.note).slice(0, 500) : null } });
  let routed = '';
  try {
    const partners = await prisma.insurerPartner.findMany({ where: { active: true }, orderBy: { priority: 'desc' } });
    const match = partners.filter(p => (p.products || '').toLowerCase().includes(String(lead.insType).toLowerCase()));
    if (match.length) routed = '\n\uD83E\uDD1D Route to: ' + match.map(p => p.name + (p.commissionPct ? ' (' + p.commissionPct + ')' : '')).join(', ');
    else if (partners.length) routed = '\n\u26A0\uFE0F No active partner for ' + lead.insType + ' yet';
  } catch (e) {}
  notifyAdmins('\uD83D\uDEE1\uFE0F NEW INSURANCE LEAD \u2014 BinaSmart\n\uD83D\uDCCB ' + lead.insType + (lead.coverType ? ' (' + lead.coverType + ')' : '') + '\n\uD83D\uDC64 ' + lead.name + ' (' + lead.phone + ')\n\uD83D\uDCCD ' + (lead.city || '?') + (lead.vehicleValue ? '\n\uD83D\uDCB0 Car value: ' + lead.vehicleValue : '') + '\n\uD83D\uDCDD ' + (lead.note || '\u2014') + routed).catch(() => {});
  // etMobile, not the normPhone in this file: that one formats and never fails, so it would have
  // let +971… and even "not a phone" through to the sender. An enquiry from a foreign number is
  // still kept and still reaches the admin — it just does not get an automated WhatsApp back.
  const insWaTo = etMobile(lead.phone);
  if (insWaTo) sendWa(insWaTo, 'BinaSmart \uD83D\uDEE1\uFE0F \u12e8' + lead.insType + ' \u1218\u12f5\u1295 \u1325\u12eB\u1244\u12CE\u1295 \u1270\u1240\u1265\u1208\u1293\u1362 \u1260\u1240\u122D\u1265 \u1270\u1235\u121B\u121A \u12A8\u1218\u12F5\u1295 \u12F5\u122D\u1305\u1276\u127D \u130B\u122D \u12A5\u1295\u12F0\u12CD\u120B\u1208\u1295\u1362').catch(() => {});
  return { ok: true };
});


// ===== FLIGHTS: live indicative fares (Amadeus self-service; off until AMADEUS_KEY set) =====
const AIRLINES = require('./flights/airlines');
const AMA_BASE = process.env.AMADEUS_ENV === 'prod' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';
let amaToken = null, amaTokenExp = 0;
const fareCache = new Map();
const CARRIERS = { ET: 'Ethiopian Airlines', EK: 'Emirates', FZ: 'flydubai', QR: 'Qatar Airways', TK: 'Turkish Airlines',
  SV: 'Saudia', XY: 'flynas', KQ: 'Kenya Airways', MS: 'EgyptAir', GF: 'Gulf Air', WY: 'Oman Air', J2: 'Azerbaijan',
  LH: 'Lufthansa', BA: 'British Airways', KL: 'KLM', AF: 'Air France', AI: 'Air India', CZ: 'China Southern' };
async function amaAuth() {
  if (amaToken && Date.now() < amaTokenExp - 60000) return amaToken;
  const r = await fetch(AMA_BASE + '/v1/security/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&client_id=' + process.env.AMADEUS_KEY + '&client_secret=' + process.env.AMADEUS_SECRET });
  if (!r.ok) throw new Error('ama_auth_' + r.status);
  const d = await r.json();
  amaToken = d.access_token; amaTokenExp = Date.now() + (d.expires_in * 1000);
  return amaToken;
}
fastify.get('/api/flights-price', async (req) => {
  if (!process.env.AMADEUS_KEY || !process.env.AMADEUS_SECRET) return { available: false };
  const { from, to, date, ret, pax } = req.query;
  if (!/^[A-Z]{3}$/.test(from || '') || !/^[A-Z]{3}$/.test(to || '') || !/^\d{4}-\d{2}-\d{2}$/.test(date || ''))
    return { available: false };
  const key = [from, to, date, ret || '', pax || 1].join('|');
  const hit = fareCache.get(key);
  if (hit && Date.now() - hit.at < 1800000) return hit.data;
  try {
    const tok = await amaAuth();
    let url = AMA_BASE + '/v2/shopping/flight-offers?originLocationCode=' + from + '&destinationLocationCode=' + to
      + '&departureDate=' + date + '&adults=' + (parseInt(pax) || 1) + '&max=20&currencyCode=USD';
    if (ret && /^\d{4}-\d{2}-\d{2}$/.test(ret)) url += '&returnDate=' + ret;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error('ama_' + r.status);
    const d = await r.json();
    const seen = new Set(); const offers = [];
    for (const o of (d.data || [])) {
      const seg = o.itineraries[0].segments;
      const carrier = seg[0].carrierCode;
      if (seen.has(carrier)) continue;
      seen.add(carrier);
      offers.push({ carrier: CARRIERS[carrier] || carrier, code: carrier,
        price: Math.ceil(parseFloat(o.price.grandTotal)), currency: o.price.currency,
        stops: seg.length - 1, duration: o.itineraries[0].duration.replace('PT', '').toLowerCase() });
      if (offers.length >= 3) break;
    }
    const data = { available: true, offers };
    fareCache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) { return { available: false }; }
});

// ===== FLIGHTS: travel agency ticket requests =====
// One definition of "this shop can take a flight request". It lived inline inside
// /api/flights-options, which meant the agency page — the one that publishes a phone, a unit and a
// floor — had no idea what a partner was and answered for every tenant in the building.
// FLIGHT_PARTNERS names slugs explicitly; otherwise the shop's trade has to say so. "air" on its own
// matched a spa and "ticket" a park ticket office, so the test names the trade.
const { isFlightPartner, partnerSlugs } = require('./flights/partners');
const { rollDemoTrips } = require('./travel/demo-trips');
// The one rule for whether a film may be shown — a non-blank rights note whose rightsUntil has not
// passed. watch/index.js uses it on every route that serves a film; the sitemap used to carry a
// looser copy of its own and would have advertised a film the application refuses to play.
const { isPublic: filmIsPublic } = require('./watch/rules');
// NOT the normPhone below: that one FORMATS and never fails — it returns "+" for "not a phone" and
// passes +971558785151 straight through. This one validates, and returns null for anything that is
// not a well-formed Ethiopian mobile. Use it before handing a number to the WhatsApp bridge.
// Rate limits below key on the IP AND the caller's phone, copying /api/watch/rent. On Ethiopian
// mobile networks an IP is shared by many people and cheap for one person to change, so either
// dimension alone is weak. phoneKey is a key, not a validator — see ride/phone.js.
// Naming partners is the only way in since the trade fallback was dropped, so an empty list is not a
// quiet default — it takes /flights/:slug and the partner list offline. Say so rather than let a
// missing variable look like "no agencies today".
if (!partnerSlugs().length) console.warn('[flights] FLIGHT_PARTNERS is empty — no agency can take a flight request and /flights/:slug will 404 for everyone.');
// A flight request is limited the way an order is: it ends in a message to a real agency's phone.
const flightRL = hotelLimiter(600000, 8);

fastify.get('/api/flights/:slug', async (req, reply) => {
  const q = req.params.slug.replace(/-/g, ' ');
  const shop = await prisma.shop.findFirst({
    where: { name: { contains: q, mode: 'insensitive' }, tenancy: { active: true }, status: 'live' },
    include: { tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true } } } } } } } });
  // `contains` is kept because the live page is /flights/hanud while the shop is
  // hanud-travel-agency-plc. What was missing is any check that the match is an agency at all.
  if (!isFlightPartner(shop)) return reply.code(404).send({ error: 'not_found' });
  return { agency: { id: shop.id, name: shop.name, nameAm: shop.nameAm, phone: shop.phone,
    building: shop.tenancy.unit.building.name, buildingAm: shop.tenancy.unit.building.nameAm,
    buildingSlug: shop.tenancy.unit.building.qrSlug, unit: shop.tenancy.unit.number, floor: shop.tenancy.unit.floor } };
});

fastify.post('/api/flights/:shopId/request', async (req, reply) => {
  if (!flightRL(bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const { tripType, fromCity, toCity, departDate, returnDate, passengers, cabin, name, phone, note } = req.body || {};
  if (!fromCity || !toCity || !departDate || !name || !phone) return reply.code(400).send({ error: 'missing_fields' });
  const flightPk = phoneKey(phone);
  if (flightPk && !flightRL(flightPk)) return reply.code(429).send({ error: 'too_many' });
  const shop = await prisma.shop.findUnique({ where: { id: req.params.shopId },
    include: { tenancy: { include: { unit: { include: { building: true } } } } } });
  if (!shop) return reply.code(404).send({ error: 'not_found' });
  const dep = new Date(departDate);
  // The traveller's day is the one in Addis Ababa; toISOString() is UTC and would accept yesterday
  // as a departure date between midnight and 3am local.
  if (isNaN(dep) || dep < new Date(addisToday())) return reply.code(400).send({ error: 'bad_date' });
  const pax = Math.max(1, Math.min(9, parseInt(passengers) || 1));
  const code = 'FR-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
  await prisma.flightRequest.create({ data: { shopId: shop.id,
    tripType: tripType === 'ONEWAY' ? 'ONEWAY' : 'ROUND', fromCity, toCity, departDate: dep,
    returnDate: returnDate ? new Date(returnDate) : null, passengers: pax,
    cabin: ['BUSINESS'].includes(cabin) ? cabin : 'ECONOMY', name, phone: phone.trim(), note: note || null, code } });
  const b = shop.tenancy.unit.building;
  await audit(b.id, 'FLIGHT_REQUEST', name + ' · ' + fromCity + '→' + toCity + ' ×' + pax + ' · ' + code, 0);
  if (shop.status === 'live') {
    notifyShop(shop, '✈️ አዲስ የበረራ ጥያቄ / NEW FLIGHT REQUEST ' + code + '\n👤 ' + name + ' (' + phone + ')\n🛫 ' + fromCity + ' → ' + toCity + (tripType === 'ONEWAY' ? ' (one-way)' : ' 🔁 return ' + (returnDate || '')) + '\n📅 ' + departDate + ' · ' + pax + ' pax · ' + (cabin || 'ECONOMY') + (note ? '\n📝 ' + note : '') + '\n\nReply with your best price to win this customer. / ዋጋ ይላኩ።', WA_CHANNEL[b.qrSlug]).catch(() => {});
  }
  return { ok: true, code, agency: shop.name, agencyPhone: shop.phone };
});

fastify.get('/api/owner/:slug/flight-requests', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const requests = await prisma.flightRequest.findMany({
    where: { shop: undefined, shopId: { in: (await prisma.shop.findMany({ where: { tenancy: { unit: { buildingId: b.id } } }, select: { id: true } })).map(s => s.id) } },
    orderBy: { createdAt: 'desc' }, take: 100 });
  return { requests };
});

fastify.get('/flights', async (req, reply) => reply.sendFile('flights-hub.html'));

// Airlines (with affiliate links resolved from the environment) plus the travel agencies that can
// take a request. An agency qualifies by being a live shop whose trade is travel; FLIGHT_PARTNERS
// can name slugs explicitly when a partner's name does not say "travel".
fastify.get('/api/flights-options', async () => {
  const rows = AIRLINES.resolve(process.env);
  const named = partnerSlugs();
  const shops = await prisma.shop.findMany({
    where: { tenancy: { active: true }, status: 'live', NOT: { slug: null } },
    select: { id: true, name: true, nameAm: true, phone: true, slug: true, category: true },
  }).catch(() => []);
  const partners = shops.filter(sh => isFlightPartner(sh, named));
  // An explicitly named partner outranks one matched by its name.
  partners.sort((a, b) => (named.indexOf(b.slug) - named.indexOf(a.slug)));
  return {
    birr: AIRLINES.payableInBirr(rows),
    cardOnly: AIRLINES.cardOnly(rows),
    partners: partners.map(p => ({ id: p.id, name: p.name, nameAm: p.nameAm, slug: p.slug })),
  };
});

fastify.get('/flights/:slug', async (req, reply) => {
  const slug = String(req.params.slug);
  const shop = await prisma.shop.findFirst({ where: { name: { contains: slug.replace(/-/g, ' '), mode: 'insensitive' }, tenancy: { active: true }, status: 'live' } });
  return slugPage(reply, 'flights.html', isFlightPartner(shop),
    'https://bina.et/flights/' + slug, 'ወኪል · Agency', '/flights');
});

// ===== EVENTS: cinema + event tickets (tiered seating) =====

fastify.get('/api/events', async (req, reply) => reply.code(410).send({ ok: false, error: 'moved', url: '/cinema', api: '/api/cinema/shows' }));

fastify.post('/api/events/:slug/book', async (req, reply) => reply.code(410).send({ ok: false, error: 'moved', url: '/cinema' }));

fastify.get('/events', async (req, reply) => reply.redirect('/cinema', 301));   // retired 2026-09-04: films + events live on /cinema
fastify.get('/fayda', async (req, reply) => reply.sendFile('fayda.html'));
fastify.get('/telebirr', async (req, reply) => reply.sendFile('telebirr.html'));
fastify.get('/telesign', async (req, reply) => reply.sendFile('telesign.html'));
fastify.get('/passport', async (req, reply) => reply.sendFile('passport.html'));
fastify.get('/mesob', async (req, reply) => reply.sendFile('mesob.html'));
fastify.get('/guides', async (req, reply) => reply.sendFile('guides.html'));
fastify.get('/about', async (req, reply) => reply.sendFile('about.html'));
fastify.get('/privacy', async (req, reply) => reply.sendFile('privacy.html'));
fastify.get('/terms', async (req, reply) => reply.sendFile('terms.html'));
fastify.get('/support', async (req, reply) => reply.sendFile('support.html'));
fastify.get('/ai', async (req, reply) => reply.sendFile('ai.html'));
// The same page in Amharic (hreflang pair with /ai): Amharic search is where this audience actually is.
fastify.get('/ai-am', async (req, reply) => reply.sendFile('ai-am.html'));
fastify.get('/amharic-ai', async (req, reply) => reply.sendFile('amharic-ai.html'));
fastify.get('/oromo-ai', async (req, reply) => reply.sendFile('oromo-ai.html'));
fastify.get('/afiya', async (req, reply) => reply.sendFile('afiya.html'));
fastify.get('/asmat', async (req, reply) => reply.sendFile('asmat.html'));
fastify.get('/tin-registration-ethiopia', async (req, reply) => reply.sendFile('tin-registration-ethiopia.html'));
fastify.get('/business-registration-ethiopia', async (req, reply) => reply.sendFile('business-registration-ethiopia.html'));
fastify.get('/driving-licence-ethiopia', async (req, reply) => reply.sendFile('driving-licence-ethiopia.html'));
fastify.get('/vat-registration-ethiopia', async (req, reply) => reply.sendFile('vat-registration-ethiopia.html'));
fastify.get('/ethiopia-evisa', async (req, reply) => reply.sendFile('ethiopia-evisa.html'));
fastify.get('/rental-agreement-ethiopia', async (req, reply) => reply.sendFile('rental-agreement-ethiopia.html'));
fastify.get('/cbe-birr-guide', async (req, reply) => reply.sendFile('cbe-birr-guide.html'));
fastify.get('/customs-import-duty-ethiopia', async (req, reply) => reply.sendFile('customs-import-duty-ethiopia.html'));
fastify.get('/how-to-start-a-business-in-ethiopia', async (req, reply) => reply.sendFile('how-to-start-a-business-in-ethiopia.html'));
fastify.get('/digital-ethiopia-2026', async (req, reply) => reply.sendFile('digital-ethiopia-2026.html'));
fastify.get('/living-working-in-ethiopia-guide', async (req, reply) => reply.sendFile('living-working-in-ethiopia-guide.html'));
fastify.get('/ethiopia-income-tax-calculator', async (req, reply) => reply.sendFile('ethiopia-income-tax-calculator.html'));
// The Ministry of Revenue's forms, hosted copies. Generated with the PDFs by ops/mor/mor-to-md.js; do not edit the HTML by hand.
fastify.get('/tax-forms', async (req, reply) => reply.sendFile('tax-forms.html'));
fastify.get('/import-car-to-ethiopia', async (req, reply) => reply.sendFile('import-car-to-ethiopia.html'));
fastify.get('/ethiopian-origin-id-yellow-card', async (req, reply) => reply.sendFile('ethiopian-origin-id-yellow-card.html'));
fastify.get('/lmis-labor-id-ethiopia', async (req, reply) => reply.sendFile('lmis-labor-id-ethiopia.html'));
fastify.get('/coc-certificate-ethiopia', async (req, reply) => reply.sendFile('coc-certificate-ethiopia.html'));
fastify.get('/open-bank-account-ethiopia', async (req, reply) => reply.sendFile('open-bank-account-ethiopia.html'));
fastify.get('/birth-marriage-certificate-ethiopia', async (req, reply) => reply.sendFile('birth-marriage-certificate-ethiopia.html'));
fastify.get('/pay-utility-bills-ethiopia', async (req, reply) => reply.sendFile('pay-utility-bills-ethiopia.html'));
fastify.get('/tenant-screening-ethiopia', async (req, reply) => reply.sendFile('tenant-screening-ethiopia.html'));
fastify.get('/free-ethiopian-tenders', async (req, reply) => reply.sendFile('free-ethiopian-tenders.html'));
fastify.get('/property-management', async (req, reply) => reply.sendFile('property-management.html'));
fastify.get('/property-management-software', async (req, reply) => reply.sendFile('property-management-software.html'));
fastify.get('/manage-rental-property', async (req, reply) => reply.sendFile('manage-rental-property.html'));
fastify.get('/digital-rent-collection', async (req, reply) => reply.sendFile('digital-rent-collection.html'));

// ===== 24/7 AI assistant "Bini" (GLM-backed, grounded in BinaSmart content) =====
const { loadPrompt } = require('./assistant/prompt');
const ASSIST_SYS = loadPrompt('bini', 'You are Bini, BinaSmart\'s assistant for Ethiopia. Answer from BinaSmart\'s own documents and say which one you used. Never invent a price, a deadline or a government portal name. The operational prompt for this agent is not published.');
// ===== Bini LLM adapter — cloud API (OpenAI/Anthropic-compat) primary, local GLM fallback =====
async function callBini(system, messages0, maxTokens, opts){
  maxTokens = maxTokens || 500;
  async function once(fmt, base, key, model, messages){
    messages = messages || messages0;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      let url, headers, body;
      if (fmt === 'openai') {
        url = base.replace(/\/+$/, '') + '/chat/completions';
        headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + key };
        { const _b = { model: model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }].concat(messages) };
          if (/gemini/i.test(model)) _b.reasoning_effort = 'none';  // Gemini 2.5 thinking OFF — thinking tokens were eating the answer, cutting Amharic mid-word
          // A forced intent keeps forcing until a terminal tool (quote, pool, booking, status, tenders, cinema, remember, team) has run.
          if (opts && opts.tools && opts.tools.length) {
            const forcing = !!(opts.toolChoice && (!opts.rounds || opts.keepForcing));
            _b.tools = forcing && opts.forcedTools ? opts.forcedTools : opts.tools; // a forced round never gets to pick contact_team
            _b.tool_choice = forcing ? opts.toolChoice : 'auto';
          }
          body = JSON.stringify(_b); }
      } else {
        url = base.replace(/\/+$/, '') + '/v1/messages';
        headers = { 'content-type': 'application/json', 'x-api-key': key, 'authorization': 'Bearer ' + key, 'anthropic-version': '2023-06-01' };
        body = JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: messages });
      }
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: headers, body: body });
      clearTimeout(to);
      const d = await r.json();
      // Token counts for labelled calls (tool agents: the owner agent). Counts only — never the prompt.
      if (opts && opts.label && d && d.usage) console.log('[bini] usage ' + opts.label + ' prompt=' + d.usage.prompt_tokens + ' completion=' + d.usage.completion_tokens);
      let text = '';
      if (fmt === 'openai') {
        const m = d && d.choices && d.choices[0] && d.choices[0].message;
        if (opts && opts.tools) console.log('[bini] round ' + ((opts.rounds || 0) + 1) + ' finish=' + (d.choices && d.choices[0] && d.choices[0].finish_reason) + ' calls=' + (m && m.tool_calls ? m.tool_calls.map(t => t.function.name).join(',') : '-') + ' len=' + ((m && m.content) ? String(m.content).length : 0) + (d.error ? ' error=' + JSON.stringify(d.error).slice(0, 200) : ''));
        // Tool round: run every call, append the results and ask again (max 5 rounds per reply).
        if (m && Array.isArray(m.tool_calls) && m.tool_calls.length && opts && opts.execute && (opts.rounds = (opts.rounds || 0) + 1) <= 5) {
          const next = messages.concat([{ role: 'assistant', content: m.content || null, tool_calls: m.tool_calls }]);
          for (const tc of m.tool_calls) {
            let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { args = {}; }
            const out = await opts.execute(tc.function.name, args);
            (opts.used = opts.used || []).push(tc.function.name);
            next.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 6000) });
          }
          opts.keepForcing = opts.rounds < 3 && !(opts.used || []).some(n => /^(quote_ride|pool_board|request_ride|ride_status|search_tenders|cinema_programme|remember|contact_team)$/.test(n));
          return await once(fmt, base, key, model, next);
        }
        text = (m && m.content) ? String(m.content).trim() : '';
        // The model finished a tool round without writing anything. Throwing here sends the whole
        // reply to the tool-less GLM fallback, which discards the fare quote_ride just fetched and
        // answers the price question from memory — measured as "no fare" on 4 of 7 fare questions,
        // and as an invented BinaPool corridor that the board does not contain.
        // So ask once more with the tool results still in the conversation and tool calling OFF.
        if (!text && opts && opts.rounds && !opts.answeredFromTools) {
          opts.answeredFromTools = true;   // answer_from_tools: one attempt, never a loop
          const finish = messages.concat([{ role: 'user', content:
            'Write the answer now, using the tool results above. Do not call any more tools.' }]);
          const saved = opts.tools;
          opts.tools = null;               // no further tool calls, but the results stay in context
          try { text = await once(fmt, base, key, model, finish); }
          finally { opts.tools = saved; }
          if (text) console.warn('[bini] wrote the answer from tool results after an empty round');
        }
      }
      else text = (d && d.content && d.content[0] && d.content[0].text) ? String(d.content[0].text).trim() : '';
      if (!text) throw new Error('empty_llm_response');
      return text;
    } catch (e) { clearTimeout(to); throw e; }
  }
  // Primary: cloud API when BINI_API_BASE is configured in .env
  if (process.env.BINI_API_BASE && process.env.BINI_API_KEY) {
    try {
      return await once((process.env.BINI_API_FORMAT || 'openai').toLowerCase(), process.env.BINI_API_BASE, process.env.BINI_API_KEY || 'x', process.env.BINI_API_MODEL || 'gpt-4o-mini');
    } catch (e) { console.warn('[bini] cloud model failed, falling back to GLM: ' + (e && e.message || e)); }
  }
  // Fallback / default: local GLM (Anthropic-compat) — no tools on this path
  if (opts) { opts.tools = null; opts.execute = null; }
  return await once('anthropic', process.env.GLM_BASE || 'http://127.0.0.1:4000', process.env.GLM_KEY || 'x', process.env.GLM_MODEL || 'glm-5-turbo');
}
// ===== Bini knowledge (RAG): skill + Addis Ababa notes + guide/service pages, Gemini embeddings, keyword fallback =====
const knowledge = require('./knowledge').makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY || '', log: m => fastify.log.info(m),
  // the fastify logger is off, so the per-search line "[knowledge] query embed: gemini|local|keyword" (no query text) goes to the pm2 log
  queryLog: m => console.log(m) });
knowledge.load().catch(e => fastify.log.warn('[knowledge] load: ' + e.message));
setInterval(() => knowledge.load().catch(() => {}), 600000).unref(); // pick up nightly ingests without a restart
require('./knowledge/routes')(fastify, { knowledge, OWNER_KEY });
// Crawlable pages for the health entitlements corpus. Until now this knowledge was reachable only
// by asking an assistant, and a search crawler cannot ask an assistant — so the questions it answers
// best ("is delivery free?", "which hospital does caesarean sections?") went to sites without the data.
require('./content-routes')(fastify, { shell: newsShell, root: __dirname });
const ASSIST_FACTS = '\n\nFACTS RULE: when a "Relevant BinaSmart knowledge" block is present, its facts override anything you remember. If the block does not contain a price, fare, deadline, portal name or law number, say you do not have it and point to the page link or WhatsApp — never guess. BinaPool (ጋራ ጉዞ, shared commute, pay per seat) lives inside the Ride app: /ride?pool=1. DEMO DATA, always disclose when the topic comes up: BinaHotels lists ONE hotel (Bina Grand Hotel) and it is demo data — a booking there is not a real stay; the hospital departments, the restaurant/shop menus and the bus trips are demonstrations too. Real partners are being onboarded; for a real hotel today, offer WhatsApp.';

// Deterministic guards the model cannot skip: no self-introduction mid-chat, no emoji on a complaint,
// no placeholder links it made up (e.g. /ride?id=...).

// Bini must never name the AI vendor behind it. The prompt says so, but a prompt is probabilistic, so this
// is the deterministic backstop: a sentence that names one of them WHILE describing itself is dropped.
// Keep in sync with ops/bini/checks.js (SELF_VENDOR) — test/biniChecks.test.js asserts they agree.
const VENDOR_ANY = /(google|gemini|openai|chat\s?gpt|gpt-?\d|anthropic|claude|deepseek|llama|mistral|ጎግል|ጀሚኒ|ቻትጂፒቲ)/i;
const VENDOR_SELF = /\b(i am|i'm|im|me|my)\b|ነኝ|የተሰራሁ|የሰራኝ|የፈጠረኝ|አልተሰራ|አይደለሁ/i;
// "use BinaSmart inside ChatGPT" is a feature, not an identity claim
const VENDOR_FEATURE = /\b(use|using|inside|within|through|via|connect|add|works? (?:in|with))\b|\/ai\b|ውስጥ|ተጠቀም/i;
function dropVendorSelfTalk(t) {
  const parts = String(t).split(/(?<=[.!?።])\s+/);
  const kept = parts.filter(p => !(VENDOR_ANY.test(p) && VENDOR_SELF.test(p) && !VENDOR_FEATURE.test(p)));
  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (out) return out;
  // the whole reply was vendor self-talk: answer the identity question ourselves rather than leak it
  return /[ሀ-፿]/.test(t)
    ? 'እኔ ቢኒ ነኝ፣ የቢናስማርት ረዳት። ምን ልርዳዎት?'
    : "I'm Bini, BinaSmart's assistant. How can I help?";
}

function biniGuards(text, msg, hist, grounding) {
  let t = String(text || '');
  // Measured 2026-09-11: "የጤና ባለሙያ እንደመሆኔ መጠን ... እውቀት የለኝም" — AS A HEALTH PROFESSIONAL, I lack
  // the knowledge to recommend a medicine. Bini is a general assistant; a claimed profession lends a
  // refusal authority it does not have, and the next sentence might not decline at all.
  // Rewritten, not dropped: deleting the sentence would take the refusal with it, and the refusal is
  // the useful part. Dropping is for a sentence that should not exist, such as a dosage.
  t = t.replace(/(የጤና ባለሙያ|የህክምና ባለሙያ|የሕክምና ባለሙያ|ሐኪም|ሀኪም|ዶክተር|ነርስ|ጠበቃ)\s*እንደመሆኔ(\s*መጠን)?/g,
    (m, role) => 'እኔ ' + role + ' ስላልሆንኩ');
  const greeted = /^(hi|hello|hey|selam|salam|ሰላም|ጤና ይስጥልኝ|እንደምን)/i.test(String(msg || '').trim());
  // Only a standalone opener is removed: it must end the sentence (optionally after a "(ቢኒ)" gloss).
  // Stripping a name that is the subject of a longer sentence used to leave a fragment, e.g.
  // "I'm Bini, BinaSmart's assistant." -> "BinaSmart's assistant."
  // The opener pattern below is anchored with ^\s*, so it only fires when the name is the very
  // first thing in the reply. Measured on 2026-09-11: on about 11% of replies the model opened with
  // a stray "!" or an emoji, the name sat one character in, the pattern missed, and Bini
  // re-introduced himself. Found by instrumenting this function — the gate was open every time and
  // the pattern was right; only the position was wrong.
  // The lookahead keeps this safe: leading punctuation is removed ONLY when the name follows it.
  t = t.replace(/^[\s!.,\u1360-\u1368\u2018-\u201F\u2600-\u27BF\uFE0F\uD83C-\uDBFF\uDC00-\uDFFF]+(?=(?:\u12a5\u1294\s+)?(?:\u1262\u1292\s+(?:\u1290\u129d|\u12a5\u1263\u120b\u1208\u1201|\u12a5\u1263\u120b\u1208\u12cd)|Bini\b|I am Bini|I'm Bini|This is Bini|Ani Bini))/i, '');
  if ((hist && hist.length) || !greeted) for (let pass = 0; pass < 2; pass++) t = t.replace(/^\s*(?:(?:ሰላም|እንኳን ደህና መጡ|ጤና ይስጥልኝ|እንደምን ነዎት|Welcome|Hi there|Hello there|Hello|Hi|Hey|Nagaa dha|Akkam)[!።.,፣፤]?\s*)?(?:እኔ\s+)?(?:ቢኒ\s+(?:ነኝ|እባላለሁ|እባላለው)|Bini ነኝ|(?:Bini|ቢኒ) here(?: I can help with that)?|I am Bini|I'm Bini|This is Bini|Ani Bini)(?:\s*[(（](?:ቢኒ|Bini)[)）])?\s*[።!.]+\s*/i, '');
  t = t.replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}!።]+\n+/u, ''); // an emoji-only first line left behind by the intro strip
  // The comma form ("I'm Bini, BinaSmart's assistant") is still a re-introduction, but cutting the whole
  // clause leaves a fragment. So drop the name but keep the subject, and in Amharic drop the opener whole
  // because the copula (ነኝ) is repeated in the clause that follows.
  if ((hist && hist.length) || !greeted) {
    // "…, and I was made by X" already has its own subject: drop the opener AND the conjunction.
    t = t.replace(/^\s*(?:(?:Hi|Hello|Hey)\s+there[!,.]?\s*)?(?:I am|I'm)\s+Bini\s*(?:[(（][^)）]{1,12}[)）])?\s*,\s*(?:and|or)\s+/i, '');
    t = t.replace(/^\s*(?:(?:Hi|Hello|Hey)\s+there[!,.]?\s*)?(I am|I'm)\s+Bini\s*(?:[(（][^)）]{1,12}[)）])?\s*,\s*/i, '$1 ');
    t = t.replace(/^\s*(?:ሰላም[!።,፣]?\s*)?(?:እኔ\s+)?ቢኒ\s+(?:ነኝ|እባላለሁ|እባላለው)\s*[,፣]\s*/, '');
  }
  t = t.replace(/^\s*(ቢኒ|Bini)\s*[:：]\s*/i, ''); // "ቢኒ: …" transcript-style prefix
  t = t.replace(/^[\s!።.,፣]+(?=\S)/, ''); // leftover punctuation after a stripped opener ("! ቤትዎ…")
  if (COMPLAINT_RE.test(msg)) t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/[ \t]+\n/g, '\n');
  t = dropVendorSelfTalk(t);
  // Reference furniture the model was shown, not something a customer should read: the context's bracket
  // numbers and its Source lines (owner's instruction, 2026-09-17 — the same rule the kit engine applies).
  t = tidyAnswer(t).text;
  t = t.replace(/\(?\/ride\?id=[^\s)።]*\)?/g, '/ride');
  // A figure with a unit must be traceable to a document or a tool result. Asked what a driver earns, Bini
  // once answered with a 4.4 km trip and a 239 birr fare having called nothing — and the fare is the one
  // number this product promises never to guess.
  if (grounding !== undefined) {
    // A Gregorian date written with the Ethiopian-calendar marker is a wrong date, not a wrong style:
    // measured 2026-09-17, "ከመስከረም 16 ቀን 2026 ዓ.ም." for the fetch date 2026-09-16, which an Ethiopian
    // reader takes as a year seven to eight years away. The prompt says to write እ.ኤ.አ.; this is the
    // deterministic half. The marker is rewritten and the sentence kept — the date is right.
    const cal = fixCalendarMarker(t, grounding);
    if (cal.fixed) console.warn('[bini] rewrote ' + cal.fixed + ' Gregorian date(s) marked as Ethiopian');
    t = require('./assistant/grounding').fixGregorianDates(cal.text, grounding, msg, 'bini');   // and the date itself (assistant/dates.js)
    const g = dropUngrounded(t, grounding, msg);
    if (g.dropped.length) {
      console.warn('[bini] dropped ungrounded ' + g.dropped.map(d => d.text).join(', '));
      t = g.text || (/[ሀ-፿]/.test(t)
        ? 'ትክክለኛውን ቁጥር ማረጋገጥ ስላልቻልኩ መገመት አልፈልግም። እባክዎ በቴሌግራም ያግኙን፦ https://t.me/Bina_smart'
        : "I could not verify that number, and I would rather not guess. Please reach us on Telegram: https://t.me/Bina_smart");
    }
  }
  return t.trim();
}
// ===== Bini: tools (hands), per-user memory, conversation log, misses, handover, languages =====
const biniLang = require('./assistant/lang');
const biniPolitics = require('./assistant/politics');
const biniTravel = require('./assistant/travel');
const biniBanking = require('./assistant/banking');
const biniBusiness = require('./assistant/business');
const biniTelecom = require('./assistant/telecom');
const biniForce = require('./assistant/force');
// A harness sets this header. Opt-in rather than a guess at IP patterns: a pattern would rot the
// first time a harness changed its ip, and rot invisibly.
const isEval = req => require('./api/evalGate').evalAllowed(req, OWNER_KEY);   // header alone is no longer enough: owner key, or loopback
const biniTools = require('./assistant/tools');
const { dropUngrounded, fixCalendarMarker } = require('./assistant/grounding');
const { tidyAnswer } = require('./assistant/tidy');
// Dating, attribution and our own address: what every answer owes the reader, whatever it is about.
// These were bullets inside the banking and the business guardrails until 2026-09-18, and a pack only
// appends its guardrails to a message its own intent claimed - so a labour-law, pension or
// overseas-employment question was never told to date anything. The Ministry of Labour audit measured
// the result: 10 of 40 answers carried a date. Said once here, they reach every message instead.
const { SHARED: BINI_SHARED } = require('./assistant/dating');
const afiya = require('./assistant/afiya');
const asmat = require('./assistant/asmat');
const scope = require('./assistant/scope');
const { makeMemory, makeHandover, COMPLAINT_RE } = require('./assistant/memory');
const biniMemory = makeMemory({ prisma });
const biniHandover = makeHandover({ sendTg: (chat, text) => sendTg(chat, text), chatId: process.env.BINI_HANDOVER_CHAT || '8825386029' });
const biniTranscribe = require('./assistant/transcribe').makeTranscriber({ apiKey: process.env.GEMINI_API_KEY || '' });
// Reading a photographed document (assistant/readimage.js). Same model and same inline shape as the voice
// note above - Bini could hear before it could see, which is backwards for a country where people
// photograph every letter they are given. It reads; it never says a document is genuine.
const biniReadImage = require('./assistant/readimage').makeImageReader({ apiKey: process.env.GEMINI_API_KEY || '' });
const BINI_TOOL_RULES = '\n\nTOOLS: you have real tools. For any fare, place, ride status, shared-ride price, cinema programme or tender question CALL THE TOOL and answer from its result; never answer such things from memory. Flow for a ride: search_places for pickup and drop-off → quote_ride. For well-known areas and landmarks (Megenagna, Bole, Bole Medhanialem, Piassa, Kazanchis, CMC, Mexico, Merkato, Sarbet, Saris, Kality, Jemo, Gerji, Arat Kilo, the airport…) take the FIRST result and quote at once, naming the place you used; ask "which one" only when the results are genuinely different places (e.g. two hotels with the same name). Never ask the user for coordinates. → quote_ride → show the fares → only if the user says yes AND you have an Ethiopian phone number, request_ride with confirmed=true → give the ride id and tracking link. Never call request_ride without an explicit yes in this conversation. If a tool returns an error, say what is missing in one sentence. Use remember() when the user tells you their name, phone, home or work, or asks you to remember something — one call per fact; never claim you remembered without calling it. ጋራ ጉዞ / Imala Waliinii / pool / መቀመጫ (seat) price questions → pool_board. TV, radio, FM, series, drama, kids channel, "open/play/listen" → watch_channels and answer with its openUrl (BinaWatch opens it in one tap); never say you cannot open radio or TV, and never link outside websites for media. Use contact_team when a person is needed.';

const _assistRL = new Map(); // ip -> [timestamps]
fastify.post('/api/assistant', async (req, reply) => {
  const t0 = Date.now();
  const b = req.body || {};
  const msg = String(b.message || '').slice(0, 1200).trim();
  if (!msg) return reply.code(400).send({ error: 'message required' });
  const ip = String(req.headers['x-real-ip'] || req.ip);
  const now = Date.now();
  const hits = (_assistRL.get(ip) || []).filter(t => now - t < 600000); // 10 min window
  if (hits.length >= 25) return reply.send({ reply: 'ትንሽ ቆይተው እንደገና ይሞክሩ 🙏 ወይም በቴሌግራም ያግኙን፦ https://t.me/Bina_smart' });
  hits.push(now); _assistRL.set(ip, hits);
  const hist = Array.isArray(b.history) ? b.history.slice(-6).map(m => ({
    role: (m && m.role === 'assistant') ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, 1200)
  })).filter(m => m.content) : [];
  const FALLBACK = 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ በቴሌግራም ያግኙን፦ https://t.me/Bina_smart';
  // Who is talking: Telegram id (stable), a browser uid (stable per device), or just the IP (no memory).
  const u = (b.user && typeof b.user === 'object') ? b.user : {};
  const channel = u.telegramId ? 'telegram' : (u.uid ? 'web' : 'api');
  const userKey = biniMemory.userKey({ telegramId: u.telegramId, uid: u.uid, ip, evaluation: isEval(req) });
  const mem = biniMemory.forUser(userKey, { telegramId: u.telegramId, name: u.name });
  const lang = biniLang.detect(msg);
  // FIRST, above everything, and for the same reason it is first on the other two pages: a model that
  // is right two times in three is not good enough when the third person is having a stroke.
  // Measured 2026-09-12 before this existed — Bini gave the ambulance number for a child who would not
  // wake, and NOT for chest pain with no breathing, and NOT for "I want to kill myself".
  if (afiya.isEmergency(msg)) {
    const sos = afiya.emergencyReply(lang);
    biniMemory.log({ userKey, channel, lang, message: msg, reply: sos, tools: ['emergency'],
      miss: false, ms: Date.now() - t0 });
    biniHandover({ userKey, channel, lang, user: u, message: msg, reply: sos, history: hist,
      explicit: true, reason: 'Bini: possible medical emergency' });
    return reply.send({ reply: sos, emergency: true, ambulance: afiya.AMBULANCE });
  }
  // Politics is declined entirely — the subject, not only the opinion. Decided after measuring him
  // withholding the opinion 7 times in 10 and then reporting election logistics out of crawled news.
  // Deterministic and early: before retrieval, before the model, before any tool can run.
  if (biniPolitics.isPolitical(msg)) {
    const politeNo = biniPolitics.politicalReply(lang);
    biniMemory.log({ userKey, channel, lang, message: msg, reply: politeNo,
      tools: ['politics_declined'], miss: false, ms: Date.now() - t0 });
    return reply.send({ reply: politeNo, declined: 'politics' });
  }
  const known = await mem.get().catch(() => null);
  let toolsUsed = [];
  try {
    // A travel question is pointed at the Ethiopian Airlines pack (assistant/travel.js): `prefer` moves the
    // +0.06 tie-breaker to the pack and BinaSmart's own travel pages for this one message, and to nothing
    // else. Every other message gets exactly the retrieval it got before, with no prefer key at all.
    const travelPrefer = biniTravel.isTravelQuestion(msg) ? { prefer: biniTravel.PREFER } : {};
    // A money question at a bank points at knowledge/banking the same way. Travel wins a tie on purpose:
    // "what does the airline charge to change my ticket" says a fee word and is about a ticket, and the
    // airline's own change-fee page is the better answer than any bank's tariff.
    const bankingPrefer = !travelPrefer.prefer && biniBanking.isBankingQuestion(msg) ? { prefer: biniBanking.PREFER } : {};
    // A licence, a permit, a registration or a customs question at an Ethiopian office points at
    // knowledge/business (assistant/business.js) the same way. The collision with banking is real - "I paid
    // the bank, but what does a trade licence renewal cost" is honestly both - so the rule is: a business
    // HARD word, a word only that sector uses, takes the tie-breaker back from banking; with only soft
    // business signal banking keeps it, because `bank`, `loan` and `interest rate` are OTHER_SERVICE words in
    // assistant/business.js precisely because that question is the bank pack's. Travel still wins over both.
    const businessPrefer = !travelPrefer.prefer && biniBusiness.isBusinessQuestion(msg) ? { prefer: biniBusiness.PREFER } : {};
    const businessWins = !!businessPrefer.prefer && (!bankingPrefer.prefer || biniBusiness.hasBusinessHardWord(msg));
    // A phone line, a mobile package or the telecom rules points at knowledge/telecom (assistant/telecom.js). It is a
    // soft boost for telecom, banking and law together, never a filter: the Amharic Ethio telecom FAQ is a banking
    // document. A telecom HARD word takes the preference from banking and business, and from travel unless the
    // message names the airline; soft telecom signal wins nothing another pack has already claimed.
    const telecomPrefer = biniTelecom.telecomWins(msg, { travel: !!travelPrefer.prefer, banking: !!bankingPrefer.prefer, business: !!businessPrefer.prefer, businessHard: biniBusiness.hasBusinessHardWord(msg) }) ? { prefer: biniTelecom.PREFER } : {};
    const packPrefer = { ...travelPrefer, ...bankingPrefer, ...(businessWins ? businessPrefer : {}), ...telecomPrefer };
    // What Bini may not do with money, stated where the answer is written: no account access, no transaction,
    // no advice, every figure dated and attributed. Only on the message that asked.
    const bankGuard = bankingPrefer.prefer ? biniBanking.GUARDRAILS : '';
    // And what it may not do with paperwork: file nothing on anybody's behalf, take no TIN or licence number,
    // never call a licence valid, no fee without the office and the fetched date. A message that is both a
    // bank question and a licence question gets BOTH blocks - only one pack can hold the +0.06 tie-breaker,
    // but a limit is not a retrieval preference and a half-stated rule is a half-obeyed one.
    const bizGuard = businessPrefer.prefer ? biniBusiness.GUARDRAILS : '';
    const [ctx, profile] = await Promise.all([knowledge.contextFor(msg, { lang, ...packPrefer }).catch(() => ''), Promise.resolve(biniMemory.profileText(known))]);
    const voice = (lang === 'am' || lang === 'am-latin') ? '\n\n## Amharic voice (glossary + rules)\n' + knowledge.voice() : (lang === 'om' ? '\n\n## Afaan Oromoo voice (glossary + rules)\n' + knowledge.voice('om') : '');
    const turn = hist.length ? '\n\nThis chat is already going: do not introduce yourself or say your name; do not open the way your previous reply opened.' : '\n\nFirst message of this chat: if the user only greeted you, say your name once briefly; if they asked something straight away, answer first and do not open with your name.';
    let toolOut = '';   // every tool result this turn, so a figure can be traced to its source
    const runTool = biniTools.makeExecutor({ base: 'http://127.0.0.1:' + (process.env.PORT || 4210), publicBase: 'https://bina.et', prisma, memory: mem, user: { name: (known && known.name) || u.name, phone: known && known.phone }, ip: 'bini-' + userKey.slice(0, 40),
      handover: h => biniHandover({ ...h, userKey, channel, lang, user: known || u, message: msg, history: hist }) });
    const execute = async (name, args) => {
      const r = await runTool(name, args);
      try { toolOut += ' ' + JSON.stringify(r); } catch (e) { /* not serialisable, nothing to ground with */ }
      return r;
    };
    // Flash sometimes answers a price or "remember me" from memory; on those intents the first round must call a tool.
    // Which intents those are, and why a price word is not one of them on its own any more (a bank and an airline charge too): assistant/force.js.
    const allTools = biniTools.toOpenAI();
    const forced = biniForce.shouldForceTool(msg);
    const rememberIntent = /(remember|አስታውስ|አስታውሰኝ|yaadadh)/i.test(msg);
    // While forcing, the model may only choose an action tool: never contact_team (that spammed handovers), remember only on remember intent.
    const forcedTools = allTools.filter(t => t.function.name !== 'contact_team' && (rememberIntent ? t.function.name === 'remember' : t.function.name !== 'remember'));
    const opts = { tools: allTools, forcedTools, execute, toolChoice: forced ? 'required' : undefined };
    // Media requests are looked up BEFORE the model runs (Gemini ignores tool forcing too often here): the result is
    // handed in as context, so "open Sheger radio" in any language always gets the BinaWatch link.
    let preTool = '';
    if (/(radio|ራዲዮ|ራድዮ|ኤፍኤም|\bfm\b|\btv\b|ቲቪ|ቴሌቪዥን|channel|ቻናል|series|ድራማ|ተከታታይ|raadiyoo|televizhinii|diraamaa|\bwatch\b|listen)/i.test(msg)) {
      const out = await execute('watch_channels', { q: msg.slice(0, 120), kind: 'all' }).catch(() => null);
      if (out && !out.error) { opts.used = ['watch_channels']; preTool = '\n\nTOOL RESULT for watch_channels (already run for this message; answer from it, give the openUrl as the link, do not call it again):\n' + JSON.stringify(out).slice(0, 4000); if (out.count) opts.toolChoice = undefined; }
    }
    // Same reason again, and a worse failure: asked which BinaPool corridors exist, Bini answered from
    // memory and INVENTED a CMC→Bole corridor that the board does not contain. The grounding guard
    // cannot catch that — it checks figures, and a route name is not a figure. So look first.
    if (!preTool && /(ጋራ ጉዞ|ኮሪደር|imala waliinii|pool|መቀመጫ|shared (ride|commute))/i.test(msg)) {
      const out = await execute('pool_board', {}).catch(() => null);
      if (out && !out.error) {
        opts.used = ['pool_board'];
        preTool = '\n\nTOOL RESULT for pool_board (already run for this message; answer ONLY from it, and if a'
          + ' corridor is not listed here say it does not exist — never name a route that is absent):\n'
          + JSON.stringify(out).slice(0, 4000);
        opts.toolChoice = undefined;
      }
    }
    // Same reason as the media block above: on "where can I eat" Gemini answers from its own idea of Addis
    // instead of calling the tool, which is also an overclaim because only the live shops are ours. So we
    // look first and hand it the real list, empty or not.
    const SHOP_RE = /(ምግብ ቤት|ሬስቶራንት|ካፌ|ቡና ቤት|ፋርማሲ|መድኃኒት ቤት|ሳሎን|ጂም|ክሊኒክ|የት ልብላ|የት እንብላ|restaurant|where (can i |to )?eat|pharmacy|cafe\b|coffee shop|gym\b|salon\b|recommend a place)/i;
    if (!preTool && SHOP_RE.test(msg)) {
      const CAT = [[/ምግብ ቤት|ሬስቶራንት|restaurant|eat\b/i, 'RESTAURANT'], [/ካፌ|ቡና ቤት|cafe|coffee/i, 'CAFE'],
        [/ፋርማሲ|መድኃኒት ቤት|pharmacy/i, 'PHARMACY'], [/ሳሎን|salon/i, 'SALON'], [/ጂም|gym/i, 'GYM'], [/ክሊኒክ|clinic/i, 'CLINIC']];
      const hit = CAT.find(c => c[0].test(msg));
      const out = await execute('search_shops', { category: hit ? hit[1] : undefined, q: hit ? undefined : msg.slice(0, 60), limit: 6 }).catch(() => null);
      if (out && !out.error) {
        opts.used = (opts.used || []).concat('search_shops');
        preTool = '\n\nTOOL RESULT for search_shops (already run for this message): ' + JSON.stringify(out).slice(0, 2500)
          + '\n\nThese are the ONLY businesses BinaSmart has. Name none other. If the list is empty, say plainly that we do not have that kind of place listed yet, that we are signing them up, and offer WhatsApp — do NOT suggest places from your own knowledge and do NOT imply BinaSmart lists many.';
      }
    }
    const sys = ASSIST_SYS + ASSIST_FACTS + BINI_TOOL_RULES + BINI_SHARED + voice + '\n\n' + biniLang.directive(lang) + turn + bankGuard + bizGuard + (profile ? '\n\n' + profile : '') + (ctx ? '\n\n' + ctx : '') + (Number.isFinite(+b.lat) && Number.isFinite(+b.lng) ? '\n\nUser location now: lat ' + (+b.lat).toFixed(5) + ', lng ' + (+b.lng).toFixed(5) + ' (use for pool_board and as default pickup).' : '');
    let text = await callBini(sys + preTool, [...hist, { role: 'user', content: msg }], 900, opts);
    // tool_choice:'required' is advisory and this model ignores it often enough to matter — measured
    // as a price question answered with no price, and as an invented BinaPool corridor. One retry,
    // because the second attempt usually complies and a loop would be worse than a missing fare.
    if (forced && !(opts.used || []).length) {
      console.warn('[bini] forced intent called no tool; retrying once');
      const again = { tools: allTools, forcedTools, execute, toolChoice: 'required' };
      const t2 = await callBini(sys + preTool + '\n\nYou MUST call a tool before answering this'
        + ' message. Do not answer a price, a corridor, a tender or a listing from memory.',
        [...hist, { role: 'user', content: msg }], 900, again).catch(() => '');
      if (t2 && (again.used || []).length) { text = t2; opts.used = again.used; }
    }
    toolsUsed = opts.used || [];
    // Gemini sometimes writes the call as text instead of calling it: "default_api.watch_channels(q='ደራሽ', kind='series')".
    const asText = /default_api\.(\w+)\(([^)]*)\)/.exec(text || '');
    if (asText && biniTools.DEFS.some(d => d.name === asText[1])) {
      const args = {}; for (const m of asText[2].matchAll(/(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([-\d.]+))/g)) args[m[1]] = m[2] != null ? m[2] : (m[3] != null ? m[3] : Number(m[4]));
      const out = await execute(asText[1], args); toolsUsed.push(asText[1]);
      const t2 = await callBini(sys + '\n\nTOOL RESULT for ' + asText[1] + '(' + JSON.stringify(args) + '):\n' + JSON.stringify(out).slice(0, 6000) + '\n\nAnswer the user now from this result. Do not write function calls as text.', [...hist, { role: 'user', content: msg }], 900, { tools: null }).catch(() => '');
      if (t2) text = t2;
    }
    // Flash occasionally answers a forced intent (fare, pool, TV/radio, tender…) without any tool. One strict retry, then we accept.
    const TERMINAL = /^(quote_ride|pool_board|request_ride|ride_status|search_tenders|search_shops|cinema_programme|watch_channels|remember)$/;
    if (forced && !toolsUsed.some(n => TERMINAL.test(n))) {
      const retry = { tools: opts.tools, forcedTools, execute, toolChoice: 'required', used: [] };
      const strict = sys + '\n\nSYSTEM CHECK: your previous draft answered without calling the tool this request needs. Do it now: fares → search_places (first result for a known area; saved home/work coordinates when the user says home/work) then quote_ride; ጋራ ጉዞ/pool → pool_board; TV, radio, series → watch_channels; tenders → search_tenders; cinema → cinema_programme; "remember" → remember. Then answer from the result with the exact link or numbers.';
      const t2 = await callBini(strict, [...hist, { role: 'user', content: msg }], 900, retry).catch(() => '');
      if (retry.used && retry.used.some(n => TERMINAL.test(n)) && t2) { text = t2; toolsUsed = toolsUsed.concat(retry.used); }
    }
    // Backstop: a clearly stated fact gets saved even when the model forgot to call remember().
    if (!toolsUsed.includes('remember') && mem.persistent) for (const f of require('./assistant/memory').extractMemory(msg)) { await execute('remember', { field: f.field, value: f.value }).catch(() => {}); toolsUsed.push('remember*'); }
    text = biniGuards(text, msg, hist, String(ctx || '') + ' ' + preTool + ' ' + toolOut);
    // A complaint goes to a person even when Bini sounded confident, and it is never rate-limited:
    // a second complaint from the same rider is more urgent than the first, not less.
    const always_handover = COMPLAINT_RE.test(msg) || biniMemory.wantsHuman(msg);
    const miss = biniMemory.isMiss(text, { tools: toolsUsed, message: msg }) || always_handover;
    mem.touch({ visit: true, lang: lang === 'am-latin' ? 'am' : lang, name: u.name }).catch(() => {});
    let handoverSent = false;
    if (miss && !toolsUsed.includes('contact_team')) handoverSent = biniHandover({ userKey, channel, lang, user: known || u, message: msg, reply: text, history: hist, explicit: always_handover, reason: biniMemory.wantsHuman(msg) ? 'user asked for a person' : 'Bini could not answer' }).catch(() => {});
    biniMemory.log({ userKey, channel, lang, message: msg, reply: text, tools: (await handoverSent) ? toolsUsed.concat('handover') : toolsUsed, miss, ms: Date.now() - t0 });
    return reply.send({ reply: text || FALLBACK, tools: toolsUsed, lang });
  } catch (e) {
    req.log && req.log.warn && req.log.warn('assistant err ' + e);
    biniMemory.log({ userKey, channel, lang, message: msg, reply: '', tools: toolsUsed, miss: true, ms: Date.now() - t0 });
    return reply.send({ reply: FALLBACK });
  }
});
// Voice notes from the Telegram bot: OGG/Opus base64 in, transcript out. Internal only (owner key).
// Public, limited: a photograph of a document, read out. 6 per address and 3 per person an hour, lowered
// from 20/10 on the owner's call the night it shipped. A photograph costs more than a question, and
// nobody with a genuine letter in their hand needs to send seven in an hour - but somebody feeding a
// stack of scans through a free endpoint does. Raising it is this one line.
const imgIpRL = hotelLimiter(3600000, 6), imgUidRL = hotelLimiter(3600000, 3);
fastify.post('/api/assistant/read-image', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
  const b = req.body || {};
  const ip = String(req.headers['x-real-ip'] || req.ip || '');
  const uid = String(b.uid || '').slice(0, 64);
  if (!imgIpRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
  if (uid && !imgUidRL(uid)) return reply.code(429).send({ ok: false, error: 'slow_down' });
  const img = String(b.image || '');
  if (img.length < 100) return reply.code(400).send({ ok: false, error: 'image (base64) required' });
  if (img.length > 8 * 1024 * 1024) return reply.code(413).send({ ok: false, error: 'image_too_large' });
  try {
    const text = await biniReadImage(img, String(b.mime || 'image/jpeg'), b.question);
    return { ok: true, text };
  } catch (e) {
    if (String(e.message) === 'unsupported_type') return reply.code(415).send({ ok: false, error: 'unsupported_type' });
    req.log && req.log.warn && req.log.warn('read-image err ' + e.message);
    return reply.code(502).send({ ok: false, error: 'read_failed' });
  }
});
fastify.post('/api/assistant/transcribe', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
  if ((req.headers['x-owner-key'] || '') !== OWNER_KEY) return reply.code(401).send({ ok: false, error: 'unauthorized' });
  const b = req.body || {};
  if (!b.audio || String(b.audio).length < 100) return reply.code(400).send({ ok: false, error: 'audio (base64) required' });
  try { const text = await biniTranscribe(String(b.audio), String(b.mime || 'audio/ogg')); return { ok: true, text }; }
  catch (e) { req.log && req.log.warn && req.log.warn('transcribe err ' + e.message); return reply.code(502).send({ ok: false, error: 'transcribe_failed' }); }
});
// The microphone on /afiya and /asmat (assistant/voice.js): public, limited per ip and per phone, transcript
// only - the page sends it as an ordinary question, so the emergency and urgent gates apply to speech too.
// 30 per ip, not fewer: Ethio Telecom puts many phones behind one address. 10 per phone (uid).
const { makeVoiceHandler, BODY_LIMIT: VOICE_BODY_LIMIT } = require('./assistant/voice');
const voiceIpRL = hotelLimiter(600000, 30), voiceUidRL = hotelLimiter(600000, 10);
const voiceHandler = makeVoiceHandler({ transcribe: biniTranscribe, ipLimit: voiceIpRL, uidLimit: voiceUidRL });
fastify.post('/api/assistant/voice', { bodyLimit: VOICE_BODY_LIMIT }, voiceHandler);
// Weekly numbers for the eval report and the ops page.
// ===== The agent kit: every specialist agent runs through one engine (assistant/kit/engine.js) =====
// The order an agent answers in lives there; what each agent says and refuses lives in agents/<name>/rules.js.
const { makeEngine } = require('./assistant/kit/engine');
const afiyaAgent = require('./agents/afiya/rules');
const asmatAgent = require('./agents/asmat/rules');
const ownerAgent = require('./agents/owner/rules');
const runAgent = makeEngine({
  callModel: callBini, contextFor: (q, o) => knowledge.contextFor(q, o), lang: biniLang, memory: biniMemory,
  handover: biniHandover, dropUngrounded, isEval, prisma, audit,
  get ownerActions() { return ownerActions; },   // agents/owner/actions/service.js, built below with the delivery layer
});
// Questions per hour on /afiya and /asmat (assistant/kit/limit.js): 30 per phone, 150 per address (many phones
// share one Ethio Telecom address). The engine checks it after the emergency gates, so those are never refused.
const { makeAgentLimit } = require('./assistant/kit/limit');
const agentLimit = makeAgentLimit({ ipLimit: hotelLimiter(3600000, 150), uidLimit: hotelLimiter(3600000, 30) });

// ===== Asmat (አስማት): Ethiopian legal procedure and documents. Not a lawyer, and built so he cannot act like one. =====
fastify.post('/api/asmat', (req, reply) => runAgent(asmatAgent, req, reply, { limit: agentLimit(req) }));

// ===== Dr Afiya (ዶ/ር አፍያ): health-system guide. Not a clinician, and built so she cannot act like one. =====
// Order matters and is the whole design: an emergency is answered by assistant/afiya.js without the model,
// because a model that is right 99 times in 100 is not good enough when the hundredth caller is having a
// stroke. Everything else is grounded, stripped of any dosage, and closed with the disclosure.
fastify.post('/api/afiya', (req, reply) => runAgent(afiyaAgent, req, reply, { limit: agentLimit(req) }));

// ===== The government widget (gov/): an office's assistant in a frame on its own site. =====
// One office = gov/tenants.json (behaviour, reviewed) + /root/storage/gov/offices.json (operations).
// Design: docs/superpowers/specs/2026-09-18-government-widget-design.md
fastify.register(require('./gov/routes'), { runAgent, evalAllowed: isEval });

// ===== The contact book (contacts/): every phone the platform holds, in one place, for SERVICE. =====
// Owner-key only, read-only, never exported. A shop number is marked uncontactable until the listing is
// claimed - the same rule search_places uses before it will publish a phone.
fastify.register(require('./contacts/routes'), { prisma, OWNER_KEY });
// ===== Business assistants (workspaces/): one private knowledge base and assistant per institution. =====
// The client's documents live in WorkspaceChunk and are embedded by bina-embed on this machine, so they
// never reach KnowledgeChunk (which the public index loads whole) and never leave the server. Answers go
// through the same engine as Afiya and Asmat, so the grounding, date and refusal guards apply unchanged.
// Pages: /ws/dashboard (the client), /verify (the document check), /embed.js (the website bubble).
require('./workspaces/routes')(fastify, { prisma, runAgent, isMiss: (t, o) => biniMemory.isMiss(t, o),
  // staffKey, not the other name: a building owner key is a different thing, and test/building/
  // ownerKeys.test.js guards server.js against that name coming back on any line.
  limiter: hotelLimiter, staffKey: OWNER_KEY,
  verifier: require('./workspaces/verify').makeVerifier({ knowledge }) });

fastify.get('/api/assistant/misses', async (req, reply) => {
  if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) return reply.code(401).send({ ok: false, error: 'unauthorized' });
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
  const [stats, misses] = await Promise.all([biniMemory.stats(days), biniMemory.misses(days, 30)]);
  return { ok: true, days, stats, misses };
});
fastify.get('/a702af430312f8dea0fa0412791d7a82.txt', async (req, reply) => reply.type('text/plain').send('a702af430312f8dea0fa0412791d7a82'));

// ===== HOSPITAL: departments + appointments =====
fastify.get('/api/hospital/:slug', async (req, reply) => {
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug },
    include: { departments: { where: { active: true }, orderBy: { floor: 'asc' } } } });
  if (!b || !b.departments.length) return reply.code(404).send({ error: 'not_a_hospital' });
  const day = req.query.date ? new Date(req.query.date) : new Date(new Date().toISOString().slice(0, 10));
  const next = new Date(day); next.setUTCDate(next.getUTCDate() + 1);
  const counts = await prisma.appointment.groupBy({ by: ['departmentId'],
    where: { buildingId: b.id, status: { not: 'CANCELLED' }, date: { gte: day, lt: next } }, _count: { id: true } });
  const cmap = Object.fromEntries(counts.map(c => [c.departmentId, c._count.id]));
  return { hospital: { name: b.name, nameAm: b.nameAm, city: b.city, subCity: b.subCity, slug: b.qrSlug, floors: b.floors },
    departments: b.departments.map(d => ({ id: d.id, name: d.name, nameAm: d.nameAm, nameOm: d.nameOm, icon: d.icon, floor: d.floor,
      room: d.room, fee: d.fee, doctors: d.doctors, openHours: d.openHours,
      slotsLeft: Math.max(0, d.slotsPerDay - (cmap[d.id] || 0)) })) };
});

fastify.post('/api/hospital/:slug/appointment', async (req, reply) => {
  const { departmentId, name, phone, date, note } = req.body || {};
  if (!departmentId || !name || !phone || !date) return reply.code(400).send({ error: 'missing_fields' });
  const day = new Date(date);
  if (isNaN(day)) return reply.code(400).send({ error: 'bad_date' });
  if (day < new Date(new Date().toISOString().slice(0, 10))) return reply.code(400).send({ error: 'past_date' });
  const d = await prisma.department.findUnique({ where: { id: departmentId }, include: { building: true } });
  if (!d || d.building.qrSlug !== req.params.slug) return reply.code(404).send({ error: 'not_found' });
  const next = new Date(day); next.setUTCDate(next.getUTCDate() + 1);
  const taken = await prisma.appointment.count({
    where: { departmentId: d.id, status: { not: 'CANCELLED' }, date: { gte: day, lt: next } } });
  if (taken >= d.slotsPerDay) return reply.code(409).send({ error: 'day_full' });
  const code = 'AP-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
  await prisma.appointment.create({ data: { buildingId: d.buildingId, departmentId: d.id,
    name, phone: phone.trim(), date: day, note: note || null, code } });
  await audit(d.buildingId, 'APPOINTMENT_BOOKED', name + ' · ' + d.name + ' · ' + date + ' · ' + code, d.fee || 0);
  return { ok: true, code, department: d.name, departmentAm: d.nameAm, departmentOm: d.nameOm, floor: d.floor, room: d.room,
    fee: d.fee, date, queueNumber: taken + 1 };
});

fastify.get('/api/owner/:slug/appointments', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const appointments = await prisma.appointment.findMany({ where: { buildingId: b.id },
    include: { department: { select: { name: true } } }, orderBy: { date: 'asc' }, take: 100 });
  return { appointments };
});

fastify.post('/api/owner/:slug/appointment/:id/status', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const st = (req.body && req.body.status || '').toUpperCase();
  if (!['CONFIRMED', 'CANCELLED', 'SEEN', 'NO_SHOW'].includes(st)) return reply.code(400).send({ error: 'bad_status' });
  const ap = await prisma.appointment.findUnique({ where: { id: req.params.id } });
  if (!ap || ap.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  await prisma.appointment.update({ where: { id: ap.id }, data: { status: st } });
  await audit(b.id, 'APPOINTMENT_' + st, ap.name + ' · ' + ap.code, 0);
  return { ok: true, status: st };
});

fastify.get('/hospital/:slug', async (req, reply) => {
  const slug = String(req.params.slug);
  const b = await prisma.building.findFirst({ where: { qrSlug: slug, buildingType: 'HOSPITAL' }, select: { id: true } });
  return slugPage(reply, 'hospital.html', !!b, 'https://bina.et/hospital/' + slug, 'ሆስፒታል · Hospital', '/');
});

// ===== TRAVEL: trips + tickets =====
fastify.get('/api/travel', async () => {
  const trips = await prisma.travelTrip.findMany({
    where: { active: true, departure: { gt: new Date() } },
    include: { tickets: { where: { status: { not: 'CANCELLED' } }, select: { seats: true } } },
    orderBy: { departure: 'asc' }, take: 40 });
  return { trips: trips.map(t => ({ id: t.id, from: t.fromCity, fromAm: t.fromCityAm, to: t.toCity, toAm: t.toCityAm,
    departure: t.departure, duration: t.duration, bus: t.busName, price: t.price,
    seatsLeft: t.seats - t.tickets.reduce((s, x) => s + x.seats, 0) })) };
});

// A ticket is CONFIRMED the moment it is created and takes its seats with it — no payment, no
// authentication, and no route anywhere to cancel one. Unlimited, that is 44 seats a stranger can
// take off every bus. Same ceiling as the hotel and restaurant paths.
const travelRL = hotelLimiter(600000, 8);
fastify.post('/api/travel/:tripId/book', async (req, reply) => {
  if (!travelRL(bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const { name, phone, seats } = req.body || {};
  if (!name || !phone) return reply.code(400).send({ error: 'missing_fields' });
  const travelPk = phoneKey(phone);
  if (travelPk && !travelRL(travelPk)) return reply.code(429).send({ error: 'too_many' });
  const n = parseInt(seats) || 1;
  if (n < 1 || n > 10) return reply.code(400).send({ error: 'max_10_seats' });
  const t = await prisma.travelTrip.findUnique({ where: { id: req.params.tripId },
    include: { tickets: { where: { status: { not: 'CANCELLED' } }, select: { seats: true } } } });
  if (!t || !t.active) return reply.code(404).send({ error: 'not_found' });
  if (t.departure < new Date()) return reply.code(400).send({ error: 'departed' });
  const left = t.seats - t.tickets.reduce((s, x) => s + x.seats, 0);
  if (left < n) return reply.code(409).send({ error: 'not_available', seatsLeft: left });
  const code = 'TK-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
  const tk = await prisma.travelTicket.create({ data: { tripId: t.id, name, phone: phone.trim(), seats: n, total: n * t.price, code } });
  await audit(t.buildingId, 'TICKET_BOOKED', name + ' · ' + t.fromCity + '→' + t.toCity + ' ×' + n + ' · ' + code, tk.total);
  return { ok: true, code, seats: n, total: tk.total, from: t.fromCity, to: t.toCity, departure: t.departure, bus: t.busName };
});

fastify.get('/travel', async (req, reply) => reply.sendFile('travel.html'));

// ===== HOTEL: availability + booking =====
async function roomAvailability(roomTypeId, totalRooms, checkIn, checkOut) {
  const overlapping = await prisma.hotelBooking.aggregate({
    where: { roomTypeId, status: { notIn: ['CANCELLED'] }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } },
    _sum: { rooms: true } });
  return totalRooms - (overlapping._sum.rooms || 0);
}

fastify.get('/api/hotel/:slug', async (req, reply) => {
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug },
    include: { roomTypes: { where: { active: true } } } });
  if (!b || !b.roomTypes.length) return reply.code(404).send({ error: 'not_a_hotel' });
  const ci = req.query.in ? new Date(req.query.in) : null;
  const co = req.query.out ? new Date(req.query.out) : null;
  const rooms = [];
  for (const rt of b.roomTypes) {
    let available = rt.totalRooms;
    if (ci && co && co > ci) available = await roomAvailability(rt.id, rt.totalRooms, ci, co);
    rooms.push({ id: rt.id, name: rt.name, nameAm: rt.nameAm, description: rt.description,
      pricePerNight: rt.pricePerNight, capacity: rt.capacity, amenities: rt.amenities, photos: rt.photos, available });
  }
  return { hotel: { name: b.name, nameAm: b.nameAm, city: b.city, subCity: b.subCity, slug: b.qrSlug,
    photo: b.facadePhotoUrl || null, floors: b.floors, demo: hotelIsDemo(b) }, rooms };
});

fastify.post('/api/hotel/:slug/book', async (req, reply) => {
  if (!bookRL(bookIp(req))) return reply.code(429).send({ error: 'too_many' });
  const { roomTypeId, guestName, guestPhone, checkIn, checkOut, rooms } = req.body || {};
  if (!roomTypeId || !guestName || !guestPhone || !checkIn || !checkOut)
    return reply.code(400).send({ error: 'missing_fields' });
  const bookPk = phoneKey(guestPhone);
  if (bookPk && !bookRL(bookPk)) return reply.code(429).send({ error: 'too_many' });
  const ci = new Date(checkIn), co = new Date(checkOut);
  const nRooms = Math.max(1, parseInt(rooms) || 1);
  if (!(co > ci)) return reply.code(400).send({ error: 'invalid_dates' });
  if (ci < new Date(addisToday())) return reply.code(400).send({ error: 'past_date' });
  const rt = await prisma.roomType.findUnique({ where: { id: roomTypeId }, include: { building: { include: { owner: true } } } });
  if (!rt || rt.building.qrSlug !== req.params.slug) return reply.code(404).send({ error: 'room_not_found' });
  const available = await roomAvailability(rt.id, rt.totalRooms, ci, co);
  if (available < nRooms) return reply.code(409).send({ error: 'not_available', available });
  const nights = Math.round((co - ci) / 86400000);
  const total = nights * rt.pricePerNight * nRooms;
  const code = 'BK-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
  const bk = await prisma.hotelBooking.create({ data: {
    buildingId: rt.buildingId, roomTypeId: rt.id, guestName, guestPhone: guestPhone.trim(),
    checkIn: ci, checkOut: co, rooms: nRooms, totalPrice: total, code } });
  await audit(rt.buildingId, 'BOOKING_CREATED', guestName + ' · ' + rt.name + ' ×' + nRooms + ' · ' + nights + ' nights · ' + code, total);
  if (NOTIFY_WHITELIST.includes(rt.building.qrSlug) && rt.building.owner) {
    const msg = '🏨 አዲስ ቦታ ማስያዝ / NEW BOOKING\n' + rt.building.name + '\n👤 ' + guestName + ' (' + guestPhone + ')\n🛏 ' + rt.name + ' ×' + nRooms + '\n📅 ' + checkIn + ' → ' + checkOut + ' (' + nights + ' nights)\n💰 ' + total.toLocaleString() + ' ETB\n#️⃣ ' + code;
    notifyParty({ name: rt.building.owner.name || (rt.building.name + ' owner'), phone: rt.building.owner.phone, tgChatId: rt.building.owner.telegramId || null },
      msg, WA_CHANNEL[rt.building.qrSlug], 'owner not on Telegram yet').catch(() => {});
  }
  return { ok: true, code, nights, total, status: 'PENDING',
    hotel: rt.building.name, room: rt.name };
});

fastify.get('/api/owner/:slug/bookings', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const bookings = await prisma.hotelBooking.findMany({ where: { buildingId: b.id },
    include: { roomType: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  return { bookings };
});

fastify.post('/api/owner/:slug/booking/:id/status', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const st = (req.body && req.body.status || '').toUpperCase();
  if (!['CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT'].includes(st))
    return reply.code(400).send({ error: 'bad_status' });
  const bk = await prisma.hotelBooking.findUnique({ where: { id: req.params.id } });
  if (!bk || bk.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  await prisma.hotelBooking.update({ where: { id: bk.id }, data: { status: st } });
  await audit(b.id, 'BOOKING_' + st, bk.guestName + ' · ' + bk.code, bk.totalPrice);
  return { ok: true, status: st };
});

fastify.get('/hotel/:slug', async (req, reply) => {
  const slug = String(req.params.slug);
  const b = await prisma.building.findFirst({ where: { qrSlug: slug, buildingType: 'HOTEL' }, select: { id: true } });
  return slugPage(reply, 'hotel.html', !!b, 'https://bina.et/hotel/' + slug, 'ሆቴል · Hotel', '/hotels');
});
fastify.get('/hotels', async (req, reply) => reply.sendFile('hotels.html')); // BinaHotels landing (7 Sep 2026)
// Every building that has at least one active room type is a hotel on BinaSmart.
fastify.get('/api/hotels', async (req, reply) => {
  reply.header('Cache-Control', 'public, max-age=300');
  const bs = await prisma.building.findMany({ where: { roomTypes: { some: { active: true } } },
    include: { roomTypes: { where: { active: true }, select: { pricePerNight: true } } }, orderBy: { name: 'asc' } });
  return { hotels: bs.map(b => ({ slug: b.qrSlug, name: b.name, nameAm: b.nameAm, city: b.city, subCity: b.subCity,
    photo: b.facadePhotoUrl || null, rooms: b.roomTypes.length,
    fromPrice: Math.min(...b.roomTypes.map(r => r.pricePerNight)),
    demo: hotelIsDemo(b) })) };
});

// ===== BINA NEWS + TENDERS (server-rendered, bina.et) =====
const NEWS_CATS = { 'ቴክኖሎጂ': '#2563eb', 'ግንባታ': '#c2410c', 'ንግድ': '#059669', 'ሪል እስቴት': '#7c3aed', 'መመሪያ': '#0e7490' };
const TENDER_CATS = ['ግንባታ Construction', 'አቅርቦት Supply', 'አገልግሎት Services', 'ማማከር Consultancy', 'ጤና Health', 'ትራንስፖርት Transport', 'ሽያጭ ጨረታ Disposal auction'];
const escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON inside <script> is not JSON. A "</script>" anywhere in a string value ends the block early
// and everything after it is parsed as HTML, so a headline is enough to inject markup. watch/,
// cinema/ and business/ each escape "<" for this; the news article, the building page and
// content-routes.js did not. No post carries one today - this is the guard, not a repair.
const ldScript = obj => '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
const amDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });


// A post's share card, if it has one, in both sizes. The grid uses the 600x315 thumb (~20 KB) so a
// page of 24 cards costs half a megabyte rather than one and a half; the hero and the article use the
// full card. Same filename convention as ogFor(): og-<slug>.png, and og-<slug>-thumb.png beside it.
function cardFor(slug){
  try {
    const dir = require('path').join(__dirname, 'public');
    const full = 'og-' + slug + '.png', thumb = 'og-' + slug + '-thumb.png';
    if (!fs.existsSync(require('path').join(dir, full))) return null;
    return { full: '/static/' + full, thumb: fs.existsSync(require('path').join(dir, thumb)) ? '/static/' + thumb : '/static/' + full };
  } catch (e) { return null; }
}
// The card's url carries the file's own timestamp. Telegram, Facebook and WhatsApp cache an
// og:image by URL for weeks, so a redrawn card kept showing the old picture (owner, 22 Sep 2026:
// "still not fix og"). With ?v=<mtime> a redraw IS a new url, and the next fetch gets the new
// picture. It does not purge what a platform already cached - for Telegram, send the link to
// @WebpageBot - but it stops the problem recurring.
function ogFor(slug, fallback){ try {
  const f = require('path').join(__dirname,'public','og-'+slug+'.png');
  if (!fs.existsSync(f)) return fallback;
  return 'https://bina.et/static/og-'+slug+'.png?v=' + Math.floor(fs.statSync(f).mtimeMs/1000);
} catch(e){ return fallback; } }
function newsShell({ title, desc, canonical, extraHead = '', body, active = 'news', ogImage = 'https://bina.et/static/bina-news.png' }) {
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escH(title)}</title><meta name="description" content="${escH(desc)}"><link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escH(title)}"><meta property="og:description" content="${escH(desc)}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="Bina ዜና"><meta property="og:type" content="article"><meta property="og:image" content="${ogImage}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${ogImage}">
<link rel="icon" href="/icon-32.png">
<link rel="stylesheet" href="/static/fonts/fonts.css?v=2">
${extraHead}
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#faf8f4;--ink:#141414;--mut:#6f6a60;--line:#e8e2d6;--em:#059669;--gold:#8a6a00}
body{font-family:'Noto Serif Ethiopic',Georgia,'Segoe UI',serif;background:var(--bg);color:var(--ink);line-height:1.75;-webkit-font-smoothing:antialiased}
.sans{font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Ethiopic',sans-serif}
a{color:inherit;text-decoration:none}
.topbar{border-bottom:1px solid var(--line);background:var(--bg);position:sticky;top:0;z-index:40}
.tb-in{max-width:1080px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:26px}
.brand{font-weight:900;font-size:21px;letter-spacing:-.5px}
.brand .g{color:var(--em)}
.brand .zena{color:var(--gold);font-size:15px;margin-left:2px}
.tb-nav{display:flex;gap:20px;font-size:14px;font-weight:600;color:var(--mut)}
.tb-nav a.on{color:var(--ink);border-bottom:2px solid var(--em);padding-bottom:2px}
.tb-nav a:hover{color:var(--ink)}
.tb-cta{margin-left:auto;font-size:12.5px;font-weight:800;background:var(--ink);color:#fff;border-radius:999px;padding:8px 18px}
main{max-width:1080px;margin:0 auto;padding:0 20px}
.masthead{padding:44px 0 30px;border-bottom:3px double var(--line);text-align:center}
.masthead h1{font-size:clamp(34px,6vw,58px);font-weight:900;letter-spacing:-1px;line-height:1.1}
.masthead p{color:var(--mut);margin-top:10px;font-size:15px}
.phero{background:var(--pg,linear-gradient(135deg,#0f2027,#0a3a34));border-radius:22px;padding:26px 22px;color:#fff;position:relative;overflow:hidden;margin:22px 0 2px;box-shadow:0 18px 40px -22px rgba(15,32,39,.5)}
.phero::after{content:var(--wm,'');position:absolute;right:-6px;bottom:-24px;font-size:108px;opacity:.15;transform:rotate(-12deg);line-height:1;pointer-events:none}
.phero h1{font-size:clamp(25px,5.4vw,38px);font-weight:900;letter-spacing:-.6px;line-height:1.12;position:relative}
.phero .am{font-weight:800;font-size:14px;margin-top:4px;opacity:.96;position:relative}
.phero .sub{font-size:12px;opacity:.85;margin-top:10px;max-width:640px;line-height:1.55;position:relative}
.chips{display:flex;gap:8px;overflow-x:auto;padding:16px 0 8px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;font-size:12.5px;font-weight:800;border:1.5px solid var(--line);border-radius:999px;padding:8px 16px;background:#fff;color:var(--mut);transition:all .16s;cursor:pointer}
.chip.on,.chip:hover{color:#fff;border-color:transparent;background:var(--chipon,var(--ink))}
.cat{font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase}
.hero-a{display:grid;grid-template-columns:1.4fr 1fr;gap:40px;padding:40px 0;border-bottom:1px solid var(--line);align-items:center}
.hero-a h2{font-size:clamp(26px,3.6vw,42px);font-weight:900;line-height:1.18;letter-spacing:-.5px;margin:12px 0}
.hero-a h2 a:hover{text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:var(--em)}
.hero-a p{color:var(--mut);font-size:16px}
.meta{display:flex;gap:14px;align-items:center;color:var(--mut);font-size:12.5px;margin-top:14px}
.hero-vis{aspect-ratio:4/3;border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:96px;box-shadow:inset 0 0 0 1px var(--line)}
.hero-vis.img{aspect-ratio:1200/630;overflow:hidden;font-size:0;background:#fff}
.hero-vis.img img{width:100%;height:100%;object-fit:cover;display:block}
.thumb{display:block;aspect-ratio:1200/630;border-radius:14px;overflow:hidden;margin-bottom:14px;background:#f3f1ec;box-shadow:inset 0 0 0 1px var(--line)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .35s}
.thumb:hover img{transform:scale(1.03)}
.art-hero{display:block;aspect-ratio:1200/630;border-radius:18px;overflow:hidden;margin:26px 0 30px;box-shadow:0 18px 44px -22px rgba(0,0,0,.35),inset 0 0 0 1px var(--line);background:#fff}
.art-hero img{width:100%;height:100%;object-fit:cover;display:block}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;padding:0 0 40px}
.card{padding:30px 26px;border-bottom:1px solid var(--line)}
.card:nth-child(3n+1){padding-left:0}
.card:nth-child(3n){padding-right:0}
.card:nth-child(3n+2){border-left:1px solid var(--line);border-right:1px solid var(--line)}
.card h3{font-size:20px;font-weight:800;line-height:1.3;margin:10px 0 8px}
.card h3 a:hover{text-decoration:underline;text-decoration-thickness:2px;text-decoration-color:var(--em)}
.card p{color:var(--mut);font-size:14px}
.empty{text-align:center;padding:70px 20px;color:var(--mut)}
.empty .big{font-size:64px;margin-bottom:14px}
.empty h3{font-size:24px;color:var(--ink);font-weight:900;margin-bottom:10px}
.cta-band{background:var(--ink);color:#fff;border-radius:24px;padding:34px 30px;margin:44px 0;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cta-band h3{font-size:22px;font-weight:900}
.cta-band p{color:#b9b4a9;font-size:14px;margin-top:4px}
.cta-band a{background:#047857;color:#fff;font-weight:800;border-radius:999px;padding:13px 26px;font-size:14px;flex-shrink:0}
/* glass controls (8 Sep 2026) */
.cta-band a{background:linear-gradient(135deg,rgba(0,200,150,.8),rgba(0,150,136,.72));border:1px solid rgba(255,255,255,.6);color:#fff;text-shadow:0 1px 2px rgba(0,80,60,.35);box-shadow:0 16px 32px -14px rgba(0,200,150,.6),inset 0 1px 0 rgba(255,255,255,.45);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);border-radius:999px}
.share a{background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.85);box-shadow:0 10px 24px -16px rgba(8,17,32,.35),inset 0 1px 0 rgba(255,255,255,.9);color:var(--ink);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);border-radius:999px}.share a:hover{background:rgba(255,255,255,.7)}
.tab{background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.85);box-shadow:0 10px 24px -16px rgba(8,17,32,.35),inset 0 1px 0 rgba(255,255,255,.9);color:var(--ink);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);}.tab.on{background:linear-gradient(135deg,rgba(0,200,150,.8),rgba(0,150,136,.72));border:1px solid rgba(255,255,255,.6);color:#fff;text-shadow:0 1px 2px rgba(0,80,60,.35);box-shadow:0 16px 32px -14px rgba(0,200,150,.6),inset 0 1px 0 rgba(255,255,255,.45);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);}
.print-btn{background:rgba(124,58,237,.7);border:1px solid rgba(255,255,255,.6);-webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);}

footer{border-top:3px double var(--line);margin-top:20px}
.ft-in{max-width:1080px;margin:0 auto;padding:30px 20px;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;color:var(--mut);font-size:13px}
/* article */
.art{max-width:720px;margin:0 auto;padding:50px 0 30px}
.art h1{font-size:clamp(30px,5vw,48px);font-weight:900;line-height:1.15;letter-spacing:-.8px;margin:16px 0 18px}
.art .lead{font-size:19px;color:var(--mut);line-height:1.65}
.rule{display:flex;align-items:center;gap:12px;margin:26px 0;color:var(--mut);font-size:13px}
.rule::after{content:'';flex:1;height:1px;background:var(--line)}
.body-t{font-size:17.5px}
.body-t p{margin:0 0 24px}
.body-t h2{font-size:24px;font-weight:900;margin:38px 0 14px;letter-spacing:-.3px}
.body-t strong{font-weight:800}
.body-t ul,.body-t ol{margin:0 0 24px 24px}
.body-t li{margin-bottom:10px}.body-t a{color:#1a73e8;text-decoration:underline;text-decoration-color:#9ec5f7;text-underline-offset:3px;text-decoration-thickness:2px;font-weight:600;border-radius:3px;padding:0 1px}.body-t a:hover{color:#0b4ea2;background:#e8f0fe}.body-t a:visited{color:#6b3fa0}
.share{display:flex;gap:10px;margin:36px 0}
.share a{border:1.5px solid var(--line);border-radius:999px;padding:9px 18px;font-size:13px;font-weight:700;color:var(--mut);background:#fff}
.share a:hover{border-color:var(--ink);color:var(--ink)}
#prog{position:fixed;top:0;left:0;height:3px;background:var(--em);z-index:50;width:0}
/* tenders */
.t-card{display:grid;grid-template-columns:1fr auto;gap:18px;padding:26px 0;border-bottom:1px solid var(--line);align-items:center}
.t-card h3{font-size:20px;font-weight:800;line-height:1.35;margin:8px 0 6px}
.t-card h3 a:hover{text-decoration:underline;text-decoration-color:var(--gold);text-decoration-thickness:2px}
.t-org{color:var(--mut);font-size:13.5px}
.t-tags{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.t-tag{font-size:11.5px;font-weight:700;background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 12px;color:var(--mut)}
.dl{text-align:center;border-radius:18px;padding:14px 18px;min-width:120px}
.dl b{display:block;font-size:26px;font-weight:900;line-height:1}
.dl span{font-size:10.5px;font-weight:700;letter-spacing:.5px}
.dl.ok{background:#ecfdf5;color:#047857}.dl.mid{background:#fffbeb;color:#b45309}.dl.hot{background:#fef2f2;color:#dc2626}.dl.past{background:#f1f0ec;color:#9a948a}
@media(max-width:820px){.hero-a{grid-template-columns:1fr;gap:18px}.grid{grid-template-columns:1fr}.card{padding:26px 0!important;border-left:0!important;border-right:0!important}.tb-nav{gap:12px;font-size:13px}.tb-cta{display:none}.t-card{grid-template-columns:1fr}.dl{justify-self:start}}
</style><link rel="stylesheet" href="/static/site-v3.css?v=5"><meta name="theme-color" content="#009688"></head><body>
<div id="prog"></div>
<div class="topbar sans"><div class="tb-in">
  <a class="brand" href="/">${sectionBrand.brandTile(active)}Bina<span class="g">Smart</span><span class="zena"> ${sectionBrand.suffix(active)}</span></a>
  <nav class="tb-nav">
    <a href="/jobs" class="${active === 'jobs' ? 'on' : ''}">ሥራ Jobs</a>
    <a href="/news" class="${active === 'news' ? 'on' : ''}">ዜና News</a>
    <a href="/tenders" class="${active === 'tenders' ? 'on' : ''}">ጨረታ Tenders</a>
  </nav>
  <a class="tb-cta" href="/diaspora">💼 Own a company?</a>
</div></div>
${body}
<footer class="sans"><div class="ft-in">
  <div><b style="color:var(--ink)">Bina ዜና</b> — የቴክኖሎጂ፣ ግንባታ እና ንግድ ዜና · ከፖለቲካ ነጻ</div>
  <div>ጨረታ አለዎት? <a href="https://t.me/Bina_smart" target="_blank" rel="noopener" style="color:var(--em);font-weight:700">Telegram @Bina_smart</a></div>
  <div>© 2026 BinaSmart · bina.et</div>
</div></footer>
<script>
addEventListener('scroll',()=>{const h=document.documentElement;const p=h.scrollTop/(h.scrollHeight-h.clientHeight)*100;document.getElementById('prog').style.width=p+'%'},{passive:true});
document.querySelectorAll('[data-deadline]').forEach(el=>{
  const d=new Date(el.dataset.deadline); const days=Math.ceil((d-Date.now())/86400000);
  const b=el.querySelector('b'), s=el.querySelector('span');
  if(days<0){el.className='dl past';b.textContent='—';s.textContent='ዝግ · Closed';}
  else{b.textContent=days; s.textContent=days===1?'ቀን ቀርቷል · day left':'ቀናት ቀርተዋል · days left';
    el.className='dl '+(days<3?'hot':days<=7?'mid':'ok');}
});
</script><script src="/static/bina-footer.js?v=9" defer></script></body></html>`;
}

// A post whose body starts at <h3> under the article's <h1> skips a level. Promote at render time.
function promoteHeadings(html) {
  const h = String(html || '');
  if (/<h2[\s>]/i.test(h)) return h;
  return h.replace(/<(\/?)h3([\s>])/gi, '<$1h2$2').replace(/<(\/?)h4([\s>])/gi, '<$1h3$2');
}
function catPill(cat) {
  const c = NEWS_CATS[cat] || '#6f6a60';
  // colour as a dot, text dark: the coloured text failed contrast (green on white 3.8:1)
  return `<span class="cat sans"><i aria-hidden="true" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};margin-right:7px;vertical-align:1px"></i>${escH(cat)}</span>`;
}

// ---- NEWS HUB ----
fastify.get('/news', async (req, reply) => {
  const cat = req.query.cat;
  // 25 per page with an older/newer pager: before this, posts past the 25th had no inbound link at all.
  const PER = 25, pageNo = Math.max(1, parseInt(req.query.page, 10) || 1);
  const whereN = { published: true, ...(cat ? { category: cat } : {}) };
  const [posts, totalN] = await Promise.all([
    prisma.newsPost.findMany({ where: whereN, orderBy: { publishedAt: 'desc' }, take: PER, skip: (pageNo - 1) * PER }),
    prisma.newsPost.count({ where: whereN }),
  ]);
  if (pageNo > 1 && !posts.length) return reply.code(404).type('text/html').send(newsShell({ title: 'Not found', desc: '', canonical: 'https://bina.et/news', body: '<main><div class="empty"><div class="big">🗞️</div><h3>ገጹ የለም</h3><p class="sans"><a href="/news" style="color:var(--em)">← ወደ ዜና ገጽ</a></p></div></main>' })); // past the last page
  const qCat = cat ? '&cat=' + encodeURIComponent(cat) : '';
  const pager = totalN > PER ? `<div class="sans" style="display:flex;justify-content:space-between;align-items:center;gap:12px;max-width:1080px;margin:18px auto 0;padding:0 4px;font-weight:700">${pageNo > 1 ? `<a href="/news?page=${pageNo - 1}${qCat}">← አዲስ ዜናዎች · Newer</a>` : '<span></span>'}<span style="color:var(--mut);font-weight:600">ገጽ ${pageNo} / ${Math.ceil(totalN / PER)}</span>${pageNo * PER < totalN ? `<a href="/news?page=${pageNo + 1}${qCat}">የቀድሞ ዜናዎች · Older →</a>` : '<span></span>'}</div>` : '';
  const [hero, ...rest] = posts;
  const chips = ['ሁሉም', ...Object.keys(NEWS_CATS)].map(c =>
    `<a class="chip sans ${(!cat && c === 'ሁሉም') || cat === c ? 'on' : ''}" href="/news${c === 'ሁሉም' ? '' : '?cat=' + encodeURIComponent(c)}">${c}</a>`).join('');
  const heroHtml = hero ? `<div class="hero-a"><div>
      ${catPill(hero.category)}
      <h2><a href="/news/${hero.slug}">${escH(hero.title)}</a></h2>
      <p>${escH(hero.excerpt)}</p>
      <div class="meta sans"><span>${escH(hero.author)}</span><span>·</span><span>${amDate(hero.publishedAt)}</span><span>·</span><span>${hero.readMinutes} ደቂቃ ንባብ</span></div>
    </div>${(() => { const c = cardFor(hero.slug); return c
      ? `<a class="hero-vis img" href="/news/${hero.slug}"><img src="${c.full}" width="1200" height="630" alt="${escH(hero.title)}" fetchpriority="high" decoding="async"></a>`
      : `<div class="hero-vis" style="background:${(NEWS_CATS[hero.category] || '#888')}12">${hero.heroEmoji || '📰'}</div>`; })()}</div>` : '';
  const thumbOf = p => { const c = cardFor(p.slug); return c ? `<a class="thumb" href="/news/${p.slug}"><img src="${c.thumb}" width="600" height="315" alt="" loading="lazy" decoding="async"></a>` : ''; };
  const cards = rest.map(p => `<div class="card">${thumbOf(p)}${catPill(p.category)}<h3><a href="/news/${p.slug}">${escH(p.title)}</a></h3><p>${escH(p.excerpt).slice(0, 140)}…</p><div class="meta sans"><span>${amDate(p.publishedAt)}</span><span>·</span><span>${p.readMinutes} ደቂቃ</span></div></div>`).join('');
  const body = `<main>
    <div class="phero" style="--pg:${sectionBrand.gradient('news')};--wm:''"><div style="display:flex;align-items:center;gap:14px">${sectionBrand.badge('news')}<h1 style="margin:0">ዜና · News</h1></div><div class="am sans">ቴክኖሎጂ · ግንባታ · ንግድ · ሪል እስቴት</div><div class="sub sans">Ethiopian tech, construction &amp; business news — in Amharic, politics-free.</div></div>
    <div class="chips" style="--chipon:#155e75">${chips}</div>
    ${heroHtml}
    <div class="grid">${cards}</div>
    ${pager}
    <div class="cta-band sans"><div><h3>📋 የግንባታ ጨረታዎችን ይከታተሉ</h3><p>Daily construction & supply tenders from across Ethiopia.</p></div><a href="/tenders">ጨረታዎችን ይመልከቱ →</a></div>
  </main>`;
  reply.type('text/html').send(newsShell({ title: 'Bina ዜና — ቴክኖሎጂ፣ ግንባታ እና ንግድ ዜና በአማርኛ', desc: 'Ethiopian technology, construction and business news in Amharic — politics-free. ቴክኖሎጂ፣ ግንባታ እና ንግድ ዜና በአማርኛ።', canonical: 'https://bina.et/news' + (pageNo > 1 ? '?page=' + pageNo : ''), body, active: 'news', ogImage: 'https://bina.et/static/og-section-news.png' }));
});

// ---- ARTICLE ----
// Two of our own pages were competing for one search. Measured 2026-09-12 in Search Console:
//   /fayda     1,037 words, average position 58.5   vs  /news/fayda-national-id-guide   349 words
//   /passport    810 words, average position  7.2   vs  /news/ethiopian-epassport-guide 326 words
// The guide is the better page in both cases and the news post is a thin restatement, so the post
// declares the guide as its canonical. The post stays readable and linked — only the signals move,
// accumulating on one url instead of splitting between two.
// Add a pair here ONLY when the two pages genuinely answer the same query. Nearby-looking is not
// enough: /news/iphone-duo-passport-foldables contains "passport" and is about foldable phones.
const CANONICAL_TO = {
  'fayda-national-id-guide': 'https://bina.et/fayda',
  'ethiopian-epassport-guide': 'https://bina.et/passport',
  // Found by checking all 85 posts against the guide pages, not by noticing two by hand.
  // Each guide wins its pair on length and structure: 649w/7h2 vs 315w/2h2, 773/9 vs 331/2,
  // 932/8 vs 345/2. The stubs' titles all say "Full Guide", which is precisely the problem.
  'mesob-one-stop-service-guide': 'https://bina.et/mesob',
  'telesign-digital-signature-guide': 'https://bina.et/telesign',
  'telebirr-mobile-money-guide': 'https://bina.et/telebirr',
};

fastify.get('/news/:slug', async (req, reply) => {
  const p = await prisma.newsPost.findUnique({ where: { slug: req.params.slug } });
  if (!p || !p.published) return reply.code(404).type('text/html').send(newsShell({ title: 'Not found', desc: '', canonical: 'https://bina.et/news', body: '<main><div class="empty"><div class="big">🗞️</div><h3>ጽሑፉ አልተገኘም</h3><p class="sans"><a href="/news" style="color:var(--em)">← ወደ ዜና ገጽ</a></p></div></main>' }));
  const schema = ldScript({ '@context': 'https://schema.org', '@type': p.evergreen ? 'Article' : 'NewsArticle', headline: p.title, description: p.excerpt, inLanguage: p.lang, datePublished: p.publishedAt, author: { '@type': 'Organization', name: 'Bina ዜና — BinaSmart' }, publisher: { '@type': 'Organization', name: 'BinaSmart', url: 'https://bina.et' }, mainEntityOfPage: CANONICAL_TO[p.slug] || ('https://bina.et/news/' + p.slug) })
    + '<meta name="robots" content="max-image-preview:large">';
  const share = encodeURIComponent('https://bina.et/news/' + p.slug);
  const shareT = encodeURIComponent(p.title);
  // Related reading: same category first, then the newest of the rest, so a post is reachable from its own
  // topic rather than only from whatever was published last; plus older/newer neighbours so the archive is
  // a chain. Before this, the same three newest posts got every inbound link and 16 posts had none.
  const sameCat = await prisma.newsPost.findMany({ where: { published: true, slug: { not: p.slug }, category: p.category }, orderBy: { publishedAt: 'desc' }, take: 3 });
  const fill = sameCat.length < 3 ? await prisma.newsPost.findMany({ where: { published: true, slug: { notIn: [p.slug, ...sameCat.map(o => o.slug)] } }, orderBy: { publishedAt: 'desc' }, take: 3 - sameCat.length }) : [];
  const others = [...sameCat, ...fill];
  const [older, newer] = await Promise.all([
    prisma.newsPost.findFirst({ where: { published: true, publishedAt: { lt: p.publishedAt } }, orderBy: { publishedAt: 'desc' }, select: { slug: true, title: true } }),
    prisma.newsPost.findFirst({ where: { published: true, publishedAt: { gt: p.publishedAt } }, orderBy: { publishedAt: 'asc' }, select: { slug: true, title: true } }),
  ]);
  const neighbours = (older || newer) ? `<nav class="sans" aria-label="Newer and older posts" style="display:flex;justify-content:space-between;gap:14px;margin:22px 0 6px;font-size:14px;font-weight:700;line-height:1.4">${newer ? `<a href="/news/${newer.slug}" style="max-width:48%">← ${escH(newer.title)}</a>` : '<span></span>'}${older ? `<a href="/news/${older.slug}" style="max-width:48%;text-align:right">${escH(older.title)} →</a>` : '<span></span>'}</nav>` : '';
  const rel = others.map(o => { const c = cardFor(o.slug); return `<div class="card">${c ? `<a class="thumb" href="/news/${o.slug}" aria-label="${escH(o.title)}"><img src="${c.thumb}" width="600" height="315" alt="" loading="lazy" decoding="async"></a>` : ''}${catPill(o.category)}<h3><a href="/news/${o.slug}">${escH(o.title)}</a></h3><div class="meta sans"><span>${amDate(o.publishedAt)}</span></div></div>`; }).join('');
  const body = `<main><article class="art">
    ${catPill(p.category)}
    <h1>${escH(p.title)}</h1>
    <p class="lead">${escH(p.excerpt)}</p>
    <div class="rule sans"><span>${escH(p.author)}</span><span>·</span><span>${amDate(p.publishedAt)}</span><span>·</span><span>${p.readMinutes} ደቂቃ ንባብ</span></div>
    ${(() => { const c = cardFor(p.slug); return c ? `<figure class="art-hero"><img src="${c.full}" width="1200" height="630" alt="${escH(p.title)}" fetchpriority="high" decoding="async"></figure>` : ''; })()}
    <div class="body-t">${promoteHeadings(p.bodyHtml)}</div>
    <div class="share sans">
      <a href="https://t.me/share/url?url=${share}&text=${shareT}">📣 Telegram</a>
      <a href="https://wa.me/?text=${shareT}%0A${share}">💬 WhatsApp</a>
      <a href="https://x.com/intent/tweet?url=${share}&text=${shareT}">𝕏</a>
      <a href="#" onclick="navigator.clipboard.writeText('https://bina.et/news/${p.slug}');this.textContent='✓ Copied';return false">🔗 Copy link</a>
    </div>
    <a class="sans" href="https://t.me/binasmart" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:14px;margin:18px 0 6px;padding:14px 18px;border-radius:14px;background:#e7f3fb;border:1.5px solid #bfe0f5;color:#0f4c75;text-decoration:none"><span style="font-size:30px;line-height:1">📢</span><span><b style="display:block;font-size:15px">ቢናsmart ቻናልን ይቀላቀሉ · Follow on Telegram</b><span style="font-size:13px;color:#3d6e8f">አዲስ ዜና፣ መመሪያ እና የሕግ ለውጦች በቀጥታ — @binasmart</span></span><span style="margin-left:auto;font-weight:900">→</span></a>
    ${neighbours}
    <div class="cta-band sans"><div><h3>🏢 ህንፃ አለዎት?</h3><p>BinaSmart — ሙሉ የህንፃ አስተዳደር ሲስተም በ24 ሰዓት።</p></div><a href="/diaspora">ይጀምሩ →</a></div>
  </article>
  <div style="max-width:1080px;margin:0 auto;border-top:3px double var(--line)"><h2 class="sans" style="font-size:13px;letter-spacing:2px;color:var(--mut);padding:22px 0 0;text-transform:uppercase">ተጨማሪ ያንብቡ · Read more</h2><div class="grid">${rel}</div></div></main>`;
  // 77 of 85 news titles ran past the ~60 characters a search result shows, median 82. The
  // ' — Bina ዜና' suffix is dropped: Google appends the site name itself, and those twelve
  // characters sat at the end, exactly where the truncation lands.
  reply.type('text/html').send(newsShell({ title: fitTitle(p.title, '', 60), desc: p.excerpt, canonical: CANONICAL_TO[p.slug] || ('https://bina.et/news/' + p.slug), extraHead: schema, body, active: 'news', ogImage: ogFor(p.slug, 'https://bina.et/static/bina-news.png') }));
});

// ===== Jobs (jobs/): vacancies, and the employer behind each one. =====
// The employer record is built from the first job that names it and enriched by every later one, so the
// company profile grows on its own - that is the asset, not the advert. Registered after newsShell and
// the helpers exist, because the pages use them rather than carrying a second copy of the house style.
fastify.register(require('./jobs/routes'), { prisma, shell: newsShell, escH, amDate, OWNER_KEY });
// Sending a CV through the jobs pages (jobs/apply.js). The file lands in /root/storage/cv, outside the
// web root; jobs/read-cv.js turns it into a short profile for matching and is deliberately blind to age,
// gender, religion and ethnicity, which Ethiopian CV templates still ask for.
const biniReadCv = require('./jobs/read-cv').makeCvReader({ apiKey: process.env.GEMINI_API_KEY || '' });
fastify.register(require('./jobs/apply'), { prisma, limiter: hotelLimiter, readCv: biniReadCv });
// And for the many people who have the experience but no document: jobs/cv-build.js takes what they can
// say, formats it (never invents it) and renders a real PDF they can download and we can forward.
// The owner's desk for the CVs that arrive: list, filter, download, and a record of who each one was
// sent to. Owner key only, noindex, no-store - see jobs/ops-candidates.js.
fastify.register(require('./jobs/ops-candidates'), { prisma, OWNER_KEY });
// A vacancy anyone can submit - from Bini in chat, from an employer - which reaches the board only
// after the owner taps publish. jobs/submit.js explains why nothing here auto-publishes.
fastify.register(require('./jobs/submit'), { prisma, limiter: hotelLimiter, OWNER_KEY });
// The employer-facing side of that queue: bina.et/jobs/post, free, five required fields.
fastify.register(require('./jobs/post-form'), { shell: newsShell, escH });
// "Show us your system" - the first contact for the portal-copilot service (ai/assessment.js).
// Licensed organisations only, and we promise an assessment rather than a delivery date.
fastify.register(require('./ai/assessment'), { prisma, limiter: hotelLimiter, OWNER_KEY });
fastify.register(require('./jobs/cv-build'), { prisma, limiter: hotelLimiter,
  apiKey: process.env.GEMINI_API_KEY || '', normPhone: require('./jobs/apply').normPhone });
// "12 vacancies match your CV" - the page a job seeker lands on the moment after they apply, while they
// are still reading (jobs/matches.js). It shows vacancies and the reason for each, and no personal data.
fastify.register(require('./jobs/matches'), { prisma, shell: newsShell });

// Section marks and colours (brand/sections.js): each hub carries its own badge instead of an emoji
// watermark, and the colour tells a returning reader where they are before they read a word.
const sectionBrand = require('./brand/sections');

// ---- TENDERS HUB ----
fastify.get('/tenders', async (req, reply) => {
  const cat = req.query.cat;
  // Measured 2026-09-12: the first TEN cards on this page had all closed, and 101 of the 200 shown
  // had passed their deadline. There was no deadline filter, and `deadline: asc` sorts oldest first —
  // so the tenders that closed longest ago led the page. A bidder wants what is still open, soonest
  // closing first; the rest belongs in an archive, reachable but not in the way.
  const showClosed = req.query.show === 'closed';
  const now = new Date();
  const where = { published: true, ...(cat ? { category: cat } : {}) };
  // The query fetches generously and the rule decides exactly, so no SQL has to model a timezone:
  // a deadline stored as a bare date is open until midnight in Addis, which is 21:00 UTC that day.
  const tenders = showClosed
    ? (await prisma.tender.findMany({ where: { ...where, deadline: { lt: openSince(now) } },
        orderBy: [{ deadline: 'desc' }], take: 260 }))   // most recently closed first
      .filter(t => tenderClosedAt(t.deadline, now)).slice(0, 200)
    : (await prisma.tender.findMany({ where: { ...where, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
        orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }], take: 260 }))
      .filter(t => !tenderClosedAt(t.deadline, now)).slice(0, 200);
  const closedCount = (await prisma.tender.findMany({ where: { ...where, deadline: { lt: openSince(now) } }, select: { deadline: true } }))
    .filter(t => tenderClosedAt(t.deadline, now)).length;
  const chips = ['ሁሉም', ...TENDER_CATS].map(c =>
    `<a class="chip sans ${(!cat && c === 'ሁሉም') || cat === c ? 'on' : ''}" href="/tenders${c === 'ሁሉም' ? '' : '?cat=' + encodeURIComponent(c)}">${c}</a>`).join('');
  const rows = tenders.map(t => `<div class="t-card">
    <div><span class="cat sans" style="color:var(--gold)">${escH(t.category)}</span>
      <h3><a href="/tenders/${t.slug}">${escH(t.titleAm || t.title)}</a></h3>
      ${t.titleAm && t.title && t.titleAm !== t.title ? `<div class="t-en sans" style="font-size:12.5px;color:var(--mut);margin:1px 0 3px;line-height:1.35">${escH(t.title)}</div>` : ''}
      <div class="t-org sans">${escH(t.org)}</div>
      <div class="t-tags sans"><span class="t-tag">📍 ${escH(t.region)}</span>${t.budget ? `<span class="t-tag">💰 ${escH(t.budget)}</span>` : ''}${t.deadline ? `<span class="t-tag">🗓 Deadline: ${amDate(t.deadline)}</span>` : `<span class="t-tag">🗓 ማብቂያ፡ ሰነዱን ይመልከቱ</span>`}</div>
    </div>
    ${t.deadline ? `<div class="dl sans" data-deadline="${closesAt(t.deadline).toISOString()}"><b></b><span></span></div>` : ''}
  </div>`).join('');
  const empty = `<div class="empty"><div class="big">📋</div><h3>የመጀመሪያዎቹ ጨረታዎች በቅርቡ ይለቀቃሉ</h3>
    <p class="sans" style="max-width:520px;margin:0 auto">Daily verified construction, supply and service tenders from across Ethiopia — every listing checked against its source before publishing. First listings go live this week.</p>
    <p class="sans" style="margin-top:22px"><a href="https://t.me/Bina_smart" target="_blank" rel="noopener" style="background:var(--ink);color:#fff;border-radius:999px;padding:13px 28px;font-weight:800;font-size:14px">🔔 ጨረታ ሲወጣ አሳውቀኝ · Notify me</a></p></div>`;
  const body = `<main>
    <div class="phero" style="--pg:${sectionBrand.gradient('tenders')};--wm:''"><div style="display:flex;align-items:center;gap:14px">${sectionBrand.badge('tenders')}<h1 style="margin:0">ጨረታዎች · Tenders</h1></div><div class="am sans">የተረጋገጡ የኢትዮጵያ ጨረታዎች — ግንባታ · አቅርቦት · አገልግሎት</div><div class="sub sans">Verified Ethiopian tenders with full details, contacts &amp; deadlines — updated daily, free.</div></div>
    <div class="chips" style="--chipon:#059669">${chips}</div>
    ${showClosed ? `<div class="sans" style="display:flex;gap:12px;align-items:center;margin:0 0 18px;padding:13px 17px;border-radius:14px;background:#fdeaea;border:1.5px solid #f3bdbd;color:#8a1f1f"><span style="font-size:22px;line-height:1">🔒</span><span><b style="display:block;font-size:15px">የተዘጉ ጨረታዎች · Closed tenders</b><span style="font-size:13px">እነዚህ ማብቂያቸው አልፏል። <a href="/tenders" style="color:#8a1f1f;font-weight:700">ክፍት ጨረታዎች · Open tenders →</a></span></span></div>` : ''}
    ${rows || empty}
    ${!showClosed && closedCount ? `<p class="sans" style="text-align:center;margin:26px 0 4px;font-size:13.5px"><a href="/tenders?show=closed${cat ? '&cat=' + encodeURIComponent(cat) : ''}" style="color:var(--mut)">🔒 ${closedCount} የተዘጉ ጨረታዎችን ይመልከቱ · View ${closedCount} closed tenders</a></p>` : ''}
    <div class="cta-band sans" style="background:var(--em)"><div><h3>📢 ጨረታዎን በነጻ ያውጡ · Post your tender FREE</h3><p>Organizations: we publish your tender at no cost — reach thousands of bidders.</p></div><a style="background:#fff;color:var(--em)" href="https://t.me/Bina_smart" target="_blank" rel="noopener">Telegram us →</a></div>
    <div class="cta-band sans"><div><h3>📰 ዜናችንንም ያንብቡ</h3><p>Technology, construction & business — in Amharic, politics-free.</p></div><a href="/news">ወደ ዜና →</a></div>
  </main>`;
  reply.type('text/html').send(newsShell({ title: 'ጨረታዎች — Verified Ethiopian Tenders | Bina', desc: 'Daily verified Ethiopian tenders: construction, supply, services and consultancy — with deadlines and sources. የተረጋገጡ ጨረታዎች በየቀኑ።', canonical: 'https://bina.et/tenders', body, active: 'tenders', ogImage: 'https://bina.et/static/og-section-tenders.png' }));
});

// ---- TENDER DETAIL ----
// A <title> over about 60 characters is truncated in search results, and 209 of 244 tender titles
// were longer than that — median 68, longest 140. Trim at a WORD boundary so the visible part is
// still a readable phrase rather than a cut-off syllable. The h1 keeps the full title.
function fitTitle(name, suffix, budget) {
  const room = budget - suffix.length;
  const n = String(name || '').trim();
  if (n.length <= room) return n + suffix;
  const cut = n.slice(0, room - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > room * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:\u2014-]+$/, '') + '…' + suffix;
}

fastify.get('/tenders/:slug', async (req, reply) => {
  const t = await prisma.tender.findUnique({ where: { slug: req.params.slug } });
  if (!t || !t.published) return reply.code(404).type('text/html').send(newsShell({ title: 'Not found', desc: '', canonical: 'https://bina.et/tenders', body: '<main><div class="empty"><div class="big">📋</div><h3>ጨረታው አልተገኘም</h3><p class="sans"><a href="/tenders" style="color:var(--em)">← ወደ ጨረታዎች</a></p></div></main>', active: 'tenders' }));
  // A tender whose deadline has passed says so HERE, in the html, not only after the countdown
  // script runs — a crawler and a slow connection both see the server's version first.
  const tenderClosed = tenderClosedAt(t.deadline);
  const closedBanner = tenderClosed
    ? `<div class="sans" style="display:flex;gap:12px;align-items:center;margin:0 0 22px;padding:14px 18px;border-radius:14px;background:#fdeaea;border:1.5px solid #f3bdbd;color:#8a1f1f"><span style="font-size:24px;line-height:1">🔒</span><span><b style="display:block;font-size:15px">ይህ ጨረታ ተዘግቷል · This tender has closed</b><span style="font-size:13px">ማብቂያው ${amDate(t.deadline)} ነበር። <a href="/tenders" style="color:#8a1f1f;font-weight:700">ክፍት ጨረታዎችን ይመልከቱ · See open tenders →</a></span></span></div>`
    : '';
  const body = `<main><article class="art">
    ${closedBanner}
    <span class="cat sans" style="color:var(--gold)">${escH(t.category)}</span>
    <h1>${escH(t.titleAm || t.title)}</h1>
    ${t.titleAm ? `<p class="sans" style="color:var(--mut);font-size:15px;margin:-6px 0 10px">${escH(t.title)}</p>` : ''}
    <div class="rule sans"><span>${escH(t.org)}</span><span>·</span><span>📍 ${escH(t.region)}</span></div>
    <div class="t-tags sans" style="margin-bottom:26px">${t.deadline ? `<span class="t-tag">🗓 Deadline: ${amDate(t.deadline)}</span>` : `<span class="t-tag">🗓 ማብቂያ፡ ሰነዱን ይመልከቱ · See document</span>`}${t.budget ? `<span class="t-tag">💰 ${escH(t.budget)}</span>` : ''}</div>
    ${t.deadline ? `<div class="dl sans" style="display:inline-block;margin-bottom:26px" data-deadline="${closesAt(t.deadline).toISOString()}"><b></b><span></span></div>` : ''}
    <h2 class="sans" style="font-size:15px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:26px 0 10px">ስለ ጨረታው · About this tender</h2>
    <div class="body-t"><p>${escH(t.summary)}</p>${t.bodyHtml || ''}</div>
    ${t.sourceUrl ? `<h2 class="sans" style="font-size:15px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:26px 0 8px">ምንጭ · Source</h2>` : ''}
    ${t.sourceUrl ? `<p class="sans" style="font-size:13px;color:var(--mut)">ምንጭ · Source: <a href="${escH(t.sourceUrl)}" rel="nofollow" style="color:var(--em)">${escH(t.sourceName || t.sourceUrl)}</a></p>` : ''}
    <div class="cta-band sans"><div><h3>🔔 ተመሳሳይ ጨረታዎችን በቴሌግራም ይቀበሉ</h3><p>Get tenders like this the moment they publish.</p></div><a href="https://t.me/Bina_smart" target="_blank" rel="noopener">Subscribe →</a></div>
  </article></main>`;
  // Say it before the click, not after. Discovering a dead deadline yourself is the unkind version.
  // "| Bina" is dropped: Google appends the site name itself, and those were the characters being cut.
  const closedPrefix = tenderClosed ? 'ተዘግቷል · ' : '';
  // the budget covers the WHOLE tag, prefix included — otherwise a closed tender runs long again
  const titleTag = closedPrefix + fitTitle(t.title, ' — ጨረታ', 60 - closedPrefix.length);
  reply.type('text/html').send(newsShell({ title: titleTag, desc: (tenderClosed ? 'ተዘግቷል · This tender has closed. ' : '') + t.summary.slice(0, 155), canonical: 'https://bina.et/tenders/' + t.slug, body, active: 'tenders', ogImage: ogFor(t.slug, 'https://bina.et/static/og-section-tenders.png') }));
});


// ===== AUTOPOST FANOUT — one publish -> Telegram channel + Facebook page + LinkedIn paste-draft =====
async function fbPagePost(message, link, ogImage){
  const id = process.env.BINA_FB_PAGE_ID, tok = process.env.BINA_FB_PAGE_TOKEN;
  if (!id || !tok) return { skipped: true };
  try{
    let endpoint, body;
    if (ogImage) { endpoint = '/photos'; body = { url: ogImage, caption: message, access_token: tok }; }
    else { endpoint = '/feed'; body = { message, link, access_token: tok }; }
    const r = await fetch('https://graph.facebook.com/v21.0/' + id + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    return (j.id || j.post_id) ? { ok: true, id: j.post_id || j.id } : { error: JSON.stringify(j.error || j).slice(0, 300) };
  }catch(e){ return { error: String(e).slice(0, 200) }; }
}
async function sendTgPhoto(chatId, photoUrl, caption){
  const tok = process.env.BINASMART_TG_TOKEN; if (!tok) return false;
  try{
    const r = await fetch('https://api.telegram.org/bot' + tok + '/sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: caption })
    });
    return (await r.json()).ok === true;
  }catch(e){ return false; }
}
async function autopostAll({ emoji, title, excerpt, url, tags, linkedin, ogImage }){
  const social = emoji + ' ' + title + '\n\n' + excerpt + '\n\n🔗 ' + url + (tags ? '\n\n' + tags : '');
  if (!ogImage) { try { const slug = url.split('?')[0].replace(/\/$/, '').split('/').pop(); ogImage = ogFor(slug, null); } catch(e){} }
  const out = [];
  if (process.env.BINA_TG_CHANNEL) {
    const t = ogImage ? await sendTgPhoto(process.env.BINA_TG_CHANNEL, ogImage, social).catch(() => false)
                      : await sendTg(process.env.BINA_TG_CHANNEL, social).catch(() => false);
    out.push('Telegram ' + (t ? '✅' : '❌'));
  }
  const fb = await fbPagePost(social, url, ogImage);
  out.push('Facebook ' + (fb.ok ? '✅' : fb.skipped ? '⏸ (no token yet)' : '❌ ' + fb.error));
  let confirm = '✅ Published: ' + title + '\n' + url + '\n\n' + out.join('\n');
  if (linkedin) confirm += '\n\n💼 LinkedIn — copy-paste this:\n──────────\n' + linkedin + '\n──────────';
  notifyAdmins(confirm).catch(() => {});
  return out;
}


// ---- TEMP: FB token bootstrap form (remove after setup) ----
fastify.get('/fb-setup-x7k2', async (req, reply) => {
  if (authFail(req, reply)) return;   // the form in front of the .env writer, same gate as the writer
  reply.type('text/html').send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>FB Setup</title>
  <body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px">
  <h2>🔐 BinaSmart Facebook Setup</h2>
  <p style="color:#555">Paste the System-User token from the Meta dialog (click <b>Copy</b> there first).</p>
  <form onsubmit="event.preventDefault();var b=this.querySelector('button');b.textContent='Connecting…';b.disabled=true;fetch('/fb-setup-x7k2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:this.token.value})}).then(r=>r.text()).then(t=>document.body.innerHTML=t)">
  <p><label>Access Token:<br><textarea name=token rows=4 style="width:100%;padding:10px" autocomplete=off required></textarea></label></p>
  <button style="padding:12px 28px;background:#0866ff;color:#fff;border:0;border-radius:8px;font-size:16px">Connect Facebook</button>
  </form></body>`);
});
fastify.post('/fb-setup-x7k2', async (req, reply) => {
  // This rewrites .env and sets process.env, and it had no gate at all - the obscure path was the
  // only thing in front of it. The bootstrap it exists for ran on 28 August and the token has been in
  // .env since, so it is kept for the next reconnect rather than deleted, behind the owner key.
  if (authFail(req, reply)) return;
  const tok = String((req.body || {}).token || '').trim();
  if (!tok || tok.length < 40) return reply.code(400).type('text/html').send('<h2>❌ Missing/short token</h2>');
  const pageId = '1400749246446309';
  try {
    const r = await fetch('https://graph.facebook.com/v21.0/' + pageId + '?fields=access_token,name&access_token=' + encodeURIComponent(tok)).then(x => x.json());
    if (r.error || !r.access_token) return reply.type('text/html').send('<h2>❌ ' + escH(r.error ? r.error.message : 'No page token — token may lack pages_manage_posts') + '</h2>');
    const pageTok = r.access_token;
    process.env.BINA_FB_PAGE_ID = pageId;
    process.env.BINA_FB_PAGE_TOKEN = pageTok;
    let env = fs.readFileSync('.env', 'utf8').split('\n').filter(l => !/^BINA_FB_PAGE_(ID|TOKEN)=/.test(l)).join('\n').replace(/\n+$/, '');
    env += '\nBINA_FB_PAGE_ID=' + pageId + '\nBINA_FB_PAGE_TOKEN=' + pageTok + '\n';
    fs.writeFileSync('.env', env);
    fs.writeFileSync('/root/storage/binasmart-fb-bootstrap.json', JSON.stringify({ pageId: pageId, page: r.name, ok: true }));
    reply.type('text/html').send('<body style="font-family:sans-serif;text-align:center;margin-top:80px"><h1>✅ Facebook connected!</h1><p>Page: <b>' + escH(r.name) + '</b></p><p>Tell Claude "saved".</p></body>');
  } catch (e) { reply.type('text/html').send('<h2>❌ ' + escH(String(e).slice(0, 100)) + '</h2>'); }
});

// ---- ADMIN: add news / tender (global key) ----
// Both of these used to spread the request body into Prisma: `const { silent, ...data } = b`. That is
// the write-side twin of `return { rows }` - every column settable by the caller, no length caps, and
// any column added to the model later silently joins the API. Owner-gated, so this is house style
// rather than a hole, but it is the one shape this codebase has spent the day removing.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEWS_FIELDS = ['slug', 'title', 'titleAm', 'category', 'excerpt', 'bodyHtml', 'lang', 'author', 'heroEmoji', 'readMinutes', 'evergreen', 'published', 'publishedAt'];
const TENDER_FIELDS = ['slug', 'title', 'titleAm', 'category', 'region', 'org', 'summary', 'bodyHtml', 'deadline', 'budget', 'sourceUrl', 'sourceName', 'published', 'publishedAt'];
const pickFields = (body, fields) => { const d = {}; for (const f of fields) if (body[f] !== undefined) d[f] = body[f]; return d; };
// The slug is concatenated into the sitemap and into every canonical without escaping, so an "&" in
// one would make the sitemap invalid XML and Google would drop the whole file, not just that url.
const badSlug = s => !SLUG_RE.test(String(s || ''));
// sourceUrl is rendered as an href. escH stops it breaking out of the attribute but says nothing
// about the scheme, so "javascript:..." would be a working link on the page. business/index.js
// already refuses those for a shop's socialLink; tenders never learned it. All 244 rows are http
// today - this is the guard.
const httpUrl = u => { try { const p = new URL(String(u)); return p.protocol === 'http:' || p.protocol === 'https:'; } catch (e) { return false; } };

fastify.post('/api/admin/news', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {};
  const data = pickFields(b, NEWS_FIELDS);
  if (badSlug(data.slug)) return reply.code(400).send({ error: 'slug must be lower-case letters, digits and single hyphens' });
  if (data.publishedAt !== undefined) {
    const d = new Date(data.publishedAt);
    if (isNaN(d)) return reply.code(400).send({ error: 'publishedAt must be a date' });
    data.publishedAt = d;
  }
  const post = await prisma.newsPost.upsert({ where: { slug: data.slug }, update: data, create: data });
  const url = 'https://bina.et/news/' + post.slug;
  if (post.published && !b.silent) {
    autopostAll({
      // The channel and the page are read in Amharic; the English title is for search engines and the
      // browser tab. Share the Amharic one when the post has it.
      emoji: post.heroEmoji || '📰', title: post.titleAm || post.title, excerpt: post.excerpt, url,
      tags: '#BinaZena #' + post.category,
      linkedin: b.linkedin || (post.title + '\n\n' + post.excerpt + '\n\nRead in Amharic + English: ' + url + '\n\n#Ethiopia #' + post.category)
    }).catch(() => {});
  }
  return { ok: true, url };
});
fastify.post('/api/admin/tender', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {};
  const data = pickFields(b, TENDER_FIELDS);
  if (badSlug(data.slug)) return reply.code(400).send({ error: 'slug must be lower-case letters, digits and single hyphens' });
  // deadline stays optional - the model allows null and the tender pages already handle it - but a
  // value that is present has to be a date, rather than becoming Invalid Date inside Prisma.
  if (data.deadline !== undefined && data.deadline !== null) {
    const d = new Date(data.deadline);
    if (isNaN(d)) return reply.code(400).send({ error: 'deadline must be a date' });
    data.deadline = d;
  }
  if (data.sourceUrl !== undefined && data.sourceUrl !== null && !httpUrl(data.sourceUrl)) {
    return reply.code(400).send({ error: 'sourceUrl must be http or https' });
  }
  const t = await prisma.tender.upsert({ where: { slug: data.slug }, update: data, create: data });
  const turl = 'https://bina.et/tenders/' + t.slug;
  if (!b.silent) {
    const dl = new Date(t.deadline).toISOString().slice(0, 10);
    autopostAll({
      emoji: '📋', title: 'ጨረታ · Tender: ' + t.title,
      excerpt: (t.org ? t.org + '\n' : '') + '⏰ Deadline: ' + dl + (t.region ? ' · 📍 ' + t.region : ''),
      url: turl, tags: '#Tender #ጨረታ #Ethiopia'
    }).catch(() => {});
  }
  return { ok: true, url: turl };
});


// ---- ADMIN: tender review queue (harvested candidates -> publish) ----
const CAND_FILE = '/root/storage/bina_tender_candidates.json';
function loadCands(){ try { return JSON.parse(fs.readFileSync(CAND_FILE, 'utf8')); } catch(e){ return []; } }
function saveCands(a){ try { fs.writeFileSync(CAND_FILE, JSON.stringify(a, null, 1)); } catch(e){} }

fastify.get('/tender-queue', async (req, reply) => {
  if ((req.query.key || '') !== OWNER_KEY) { reply.code(401).type('text/html').send('<h2>Unauthorized</h2>'); return; }
  const cands = loadCands();
  const esc = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const today = new Date().toISOString().slice(0,10);
  const cats = ['Supply','Construction','Consultancy','Service','ICT','Vehicle','Other'];
  const rows = cands.map((c,i) => `
    <div class="c" data-id="${esc(c.id)}">
      <label class="pick"><input type="checkbox" class="cb"> <b>#${i+1}</b></label>
      <div class="f">
        <input class="ti" value="${esc(c.title)}" placeholder="Title">
        <div class="org">🏢 ${esc(c.org||'—')} · <a href="${esc(c.source)}" target="_blank" rel="noopener">open source ↗</a></div>
        <div class="row">
          <label>⏰ Deadline <input type="date" class="dl" value="${esc(c.deadline||'')}" min="${today}"></label>
          <label>Category <select class="cat">${cats.map(x=>`<option ${x===c.category?'selected':''}>${x}</option>`).join('')}</select></label>
          <label>Region <input class="rg" value="${esc(c.region||'Ethiopia')}" style="width:110px"></label>
        </div>
        <textarea class="sm" rows="2" placeholder="Summary (our words)">${esc(c.summary)}</textarea>
      </div>
    </div>`).join('');
  reply.type('text/html').send(`<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Tender Queue · BinaSmart</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:820px;margin:0 auto;padding:14px;background:#0f1720;color:#e8edf2}
  h1{font-size:20px;margin:6px 0} .sub{color:#8aa0b2;font-size:13px;margin-bottom:14px}
  .c{background:#18232f;border:1px solid #26333f;border-radius:12px;padding:12px;margin-bottom:12px;display:flex;gap:10px}
  .pick{flex:0 0 auto;font-size:13px;color:#7fd1c4} .cb{transform:scale(1.5);margin-right:4px}
  .f{flex:1;min-width:0} .org{font-size:12px;color:#8aa0b2;margin:6px 0} .org a{color:#3fbfa8}
  input,select,textarea{background:#0f1720;border:1px solid #2c3a47;color:#e8edf2;border-radius:8px;padding:8px;font-size:14px;box-sizing:border-box}
  .ti{width:100%;font-weight:600} .row{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0} .row label{font-size:12px;color:#8aa0b2;display:flex;flex-direction:column;gap:3px}
  .sm{width:100%;resize:vertical} .dl{color:#ffd479}
  .bar{position:sticky;bottom:0;background:#0f1720;padding:12px 0;display:flex;gap:10px;align-items:center;border-top:1px solid #26333f;margin-top:8px}
  button{background:#0aa88f;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer}
  #cnt{color:#8aa0b2;font-size:13px} .warn{color:#ff9a9a;font-size:12px;margin-top:4px}
  label.post{color:#8aa0b2;font-size:13px;display:flex;align-items:center;gap:6px}
</style></head><body>
<h1>📋 Tender Review Queue</h1>
<div class="sub">${cands.length} waiting. Tick the good ones, fix the title/summary, set the deadline (required), then Publish. Publishing puts them live on bina.et/tenders — free + ranked.</div>
${rows || '<div class="sub">Queue is empty — the morning harvest will fill it. 🎉</div>'}
<div class="bar">
  <button onclick="pub()">Publish selected</button>
  <label class="post"><input type="checkbox" id="broadcast"> also post to Telegram/Facebook</label>
  <span id="cnt"></span>
</div>
<script>
const KEY=${JSON.stringify(req.query.key)};
function pub(){
  const sel=[...document.querySelectorAll('.c')].filter(c=>c.querySelector('.cb').checked);
  if(!sel.length){alert('Tick at least one tender');return;}
  const items=[]; let bad=0;
  for(const c of sel){
    const dl=c.querySelector('.dl').value;
    if(!dl){c.querySelector('.dl').style.borderColor='#ff5a5a';bad++;continue;}
    items.push({id:c.dataset.id,title:c.querySelector('.ti').value,deadline:dl,
      category:c.querySelector('.cat').value,region:c.querySelector('.rg').value,summary:c.querySelector('.sm').value});
  }
  if(bad){alert(bad+' selected tender(s) need a deadline (highlighted red)');return;}
  document.getElementById('cnt').textContent='Publishing '+items.length+'…';
  fetch('/api/admin/tender-queue/publish?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({items,broadcast:document.getElementById('broadcast').checked})})
   .then(r=>r.json()).then(r=>{
     document.getElementById('cnt').textContent='✅ Published '+r.published+'. Reloading…';
     setTimeout(()=>location.reload(),1200);
   }).catch(e=>document.getElementById('cnt').textContent='Error: '+e);
}
</script><script src="/static/bina-footer.js?v=9" defer></script></body></html>`);
});

fastify.post('/api/admin/tender-queue/publish', async (req, reply) => {
  if (authFail(req, reply)) return;
  const { items, broadcast } = req.body || {};
  if (!Array.isArray(items) || !items.length) return { published: 0 };
  const cands = loadCands();
  const byId = Object.fromEntries(cands.map(c => [c.id, c]));
  const slugify = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
  let published = 0; const doneIds = [], failed = [];
  for (const it of items) {
    const c = byId[it.id]; if (!c) continue;
    const slug = 'rt-' + slugify((c.org||'') + '-' + (it.title||c.title));
    const rec = { slug, title: (it.title||c.title).slice(0,140), category: it.category||'Supply',
      region: it.region||'Ethiopia', org: c.org || 'Ethiopia', summary: (it.summary||c.summary).slice(0,600),
      deadline: new Date(it.deadline), sourceUrl: httpUrl(c.source) ? c.source : null, sourceName: c.sourceName, published: true };
    if (isNaN(rec.deadline)) { failed.push({ id: it.id, why: 'deadline is not a date' }); continue; }
    try {
      const t = await prisma.tender.upsert({ where: { slug }, update: rec, create: rec });
      published++; doneIds.push(it.id);
      if (broadcast) {
        const dl = new Date(t.deadline).toISOString().slice(0,10);
        autopostAll({ emoji: '📋', title: 'ጨረታ · Tender: ' + t.title,
          excerpt: (t.org ? t.org + '\n' : '') + '⏰ Deadline: ' + dl + (t.region ? ' · 📍 ' + t.region : ''),
          url: 'https://bina.et/tenders/' + t.slug, tags: '#Tender #ጨረታ #Ethiopia' }).catch(()=>{});
      }
    } catch(e) { failed.push({ id: it.id, why: String(e.message || e).slice(0, 140) }); }
  }
  const remaining = cands.filter(c => !doneIds.includes(c.id));
  saveCands(remaining);
  // A row that cannot be written stays in the queue. It used to do that silently, so "published: 3"
  // out of five looked like a full run and the two that failed were never explained.
  return { published, remaining: remaining.length, failed };
});

// ===== PUBLIC: universal search (buildings + shops) =====
fastify.get('/api/search', async (req) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return { results: [] };
  const [bs, shops] = await Promise.all([
    prisma.building.findMany({
      where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAm: { contains: q } }] },
      select: { name: true, nameAm: true, qrSlug: true, floors: true, city: true }, take: 5 }),
    prisma.shop.findMany({
      where: { tenancy: { active: true }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAm: { contains: q } }] },
      include: { tenancy: { include: { unit: { include: { building: { select: { qrSlug: true, name: true } } } } } } }, take: 8 })
  ]);
  return { results: [
    ...bs.map(b => ({ kind: 'building', name: b.name, nameAm: b.nameAm, slug: b.qrSlug, sub: b.city + ' · G+' + (b.floors - 1) })),
    ...shops.map(s => ({ kind: 'shop', name: s.name, nameAm: s.nameAm, slug: s.tenancy.unit.building.qrSlug,
      building: s.tenancy.unit.building.name, unit: s.tenancy.unit.number, floor: s.tenancy.unit.floor }))
  ] };
});

fastify.get('/googleaff9b37bce6985aa.html', async (req, reply) => reply.type('text/html').sendFile('googleaff9b37bce6985aa.html'));
fastify.get('/llms.txt', async (req, reply) => reply.type('text/plain; charset=utf-8').sendFile('llms.txt'));
fastify.get('/blog/smart-building-management-ethiopia', async (req, reply) => reply.sendFile('blog-smart-building-management-ethiopia.html'));


// ===== PUBLIC PAGE: what a QR code opens =====
// A visit token for one building, for one hour.
//
// /api/b/:slug used to return every tenant's phone number to anyone who asked — 71 of them for JJ
// Darule in one unauthenticated request. The phones are the point of the page (the Call button, the
// WhatsApp order links, the directory listing), so they cannot simply go; what can go is handing all
// 71 to a caller who never opened the page.
//
// The printed QR codes encode a bare /b/<slug>, so the token cannot live in the QR without reprinting
// them. It is minted here instead, where the QR already lands, and spent by the page's own fetch.
//
// This ends the bulk dump. It does not stop someone who fetches the page and reads the token out of
// it — that would need a secret in the printed code.
const { makeVisit } = require('./building/visit');
const { isClaimed } = require('./business/claimed');
const { closesAt, isClosed: tenderClosedAt, openSince } = require('./tenders/deadline');
const { mint: visitTokenNow, check: visitOk } = makeVisit(process.env.VISIT_SECRET || OWNER_KEY || 'bina-visit-fallback');

fastify.get('/b/:slug', async (req, reply) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'building.html'), 'utf8');
  try {
    const b = await prisma.building.findUnique({
      where: { qrSlug: req.params.slug },
      select: { name: true, nameAm: true, city: true, subCity: true, floors: true, facadePhotoUrl: true, lat: true, lng: true, buildingType: true }
    });
    if (b) {
      const title = b.name + ' (' + b.nameAm + ') — Shops, Offers & 3D View | BinaSmart';
      const desc = b.name + ' in ' + (b.subCity ? b.subCity + ', ' : '') + b.city
        + ' — browse shops and live offers, see the ' + b.floors + '-floor building in interactive 3D, contact tenants, report maintenance and find vacant units.';
      const url = 'https://bina.et/b/' + req.params.slug;
      const _schemaObj = {
        '@context': 'https://schema.org', '@type': b.buildingType === 'HOTEL' ? 'Hotel' : 'ShoppingCenter',
        name: b.name, alternateName: b.nameAm, url,
        address: { '@type': 'PostalAddress', streetAddress: b.subCity || '', addressLocality: b.city, addressCountry: 'ET' }
      };
      if (b.lat && b.lng) _schemaObj.geo = { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng };
      if (b.facadePhotoUrl) _schemaObj.image = 'https://bina.et' + b.facadePhotoUrl;
      const _bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'BinaSmart', item: 'https://bina.et/' },
        { '@type': 'ListItem', position: 2, name: b.name, item: url } ] };
      const schema = ldScript(_schemaObj) + '\n' + ldScript(_bc);
      html = html.replace('<title>BinaSmart — Building</title>',
        '<title>' + title + '</title>\n'
        + '<meta name="description" content="' + desc + '">\n'
        + '<link rel="canonical" href="' + url + '">\n'
        + '<meta property="og:title" content="' + title + '">\n'
        + '<meta property="og:description" content="' + desc + '">\n'
        + '<meta property="og:type" content="website">\n'
        + '<meta property="og:url" content="' + url + '">\n'
        + (b.facadePhotoUrl ? '<meta property="og:image" content="https://bina.et' + b.facadePhotoUrl.replace('/static','/static') + '">\n' : '')
        + schema);
    }
  } catch (e) {}
  // The page came from the printed QR; hand it the token its own fetch will need for the phones.
  html = html.replace('</head>', '<script>window.__visit=' + JSON.stringify(visitTokenNow(req.params.slug)) + ';</script>\n</head>');
  reply.type('text/html').send(html);
});

// ===== OWNER PAGE =====
fastify.get('/owner/:slug', async (req, reply) => reply.sendFile('owner.html'));

// ===== PUBLIC: building by QR slug =====
fastify.get('/api/b/:slug', async (req, reply) => {
  // A phone number is returned only to a caller that opened the building page — see visitOk above.
  // Without it this endpoint handed out all 71 of JJ Darule's real tenants, named individuals among
  // them, in a single unauthenticated request. Everything else about the directory is unchanged.
  const seen = visitOk(req.params.slug, req.query.v || req.headers['x-visit'] || '');
  const b = await prisma.building.findUnique({
    where: { qrSlug: req.params.slug },
    include: {
      units: {
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        include: {
          tenancies: {
            where: { active: true },
            include: { shop: { include: { products: { where: { visible: true, approved: true } }, offers: { where: { active: true, approved: true, endsAt: { gt: new Date() } } } } } }
          }
        }
      }
    }
  });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });

  prisma.qrScanEvent.create({ data: { buildingId: b.id, userAgent: req.headers['user-agent'] || null, referrer: 'API' } }).catch(() => {});

  const units = b.units.map(u => {
    const shop = u.tenancies[0]?.shop || null;
    return {
      id: u.id, number: u.number, floor: u.floor, areaSqm: u.areaSqm,
      // Rent is published only for a VACANT unit, where it advertises a price and there is no
      // tenant to expose. It used to be returned for every unit — on JJ Darule that was 71 of 71
      // occupied units handing out what each tenant pays, from one unauthenticated url. The page
      // shows rent in exactly one place: the vacant unit advertises it on an "Interested" card.
      monthlyRent: u.status === 'VACANT' ? u.monthlyRent : undefined, status: u.status,
      shop: shop ? {
        id: shop.id, name: shop.name, nameAm: shop.nameAm, icon: shop.icon,
        category: shop.category,
        phone: seen ? shop.phone : undefined,
        avgRating: Math.round(shop.avgRating * 10) / 10, reviewCount: shop.reviewCount,
        // Boolean @default(true) with nothing computing it and no openingHours on any shop here, so
        // this was the schema speaking, not a shopkeeper. Same rule as the shop pages and the MCP
        // directory: only a claimed listing is in a position to say it is open.
        isOpenNow: isClaimed(shop) ? shop.isOpenNow : undefined,
        products: shop.products.map(p => ({ id: p.id, name: p.name, nameAm: p.nameAm, price: p.price, deliverable: p.deliverable })),
        offers: shop.offers.map(o => ({ id: o.id, title: o.title, titleAm: o.titleAm, endsAt: o.endsAt }))
      } : null
    };
  });

  return {
    id: b.id, name: b.name, nameAm: b.nameAm, city: b.city, subCity: b.subCity,
    floors: b.floors, signText: b.signText, lat: b.lat, lng: b.lng, facadePhotoUrl: b.facadePhotoUrl,
    threeD: { style: b.threeD_style, facadeColor: b.threeD_facadeColor, width: b.threeD_width, depth: b.threeD_depth, modelUrl: b.threeD_modelUrl },
    stats: {
      units: units.length,
      occupied: units.filter(u => u.status === 'OCCUPIED').length,
      vacant: units.filter(u => u.status === 'VACANT').length
    },
    units
  };
});

// ===== PUBLIC: live offers feed =====
fastify.get('/api/b/:slug/offers', async (req, reply) => {
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });
  const offers = await prisma.offer.findMany({
    where: { active: true, endsAt: { gt: new Date() }, shop: { tenancy: { unit: { buildingId: b.id } } } },
    include: { shop: { select: { name: true, nameAm: true, icon: true, phone: true, tenancy: { select: { unit: { select: { number: true } } } } } } },
    orderBy: { endsAt: 'asc' }
  });
  return offers.map(o => ({
    id: o.id, title: o.title, titleAm: o.titleAm, endsAt: o.endsAt,
    views: o.views, claims: o.claims,
    shop: { name: o.shop.name, nameAm: o.shop.nameAm, icon: o.shop.icon, phone: o.shop.phone, unit: o.shop.tenancy.unit.number }
  }));
});

// ===== PUBLIC: vacancy list =====
fastify.get('/api/b/:slug/vacancies', async (req, reply) => {
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });
  return prisma.unit.findMany({
    where: { buildingId: b.id, status: 'VACANT' },
    select: { id: true, number: true, floor: true, areaSqm: true, monthlyRent: true },
    orderBy: { monthlyRent: 'asc' }
  });
});

// The two public forms behind a building's QR poster — a lead for a vacant unit, and a maintenance
// request. Both land in the owner dashboard. On 2026-09-13 a maintenance description written as
// <img onerror> ran inside that dashboard and read the owner key from localStorage; owner.html now
// escapes what it renders. These limits are the other half: neither form had one, and every
// maintenance request for a messaging building also messages the owner and the technician.
// The IP ceiling is loose on purpose — Ethio telecom puts a whole building behind one address.
const formIpRL = hotelLimiter(600000, 30), formPhoneRL = hotelLimiter(600000, 5);
// A phone number, not "anything under 20 characters". Landlines and spacing both pass; markup does not.
const PHONE_SHAPE = /^\+?[\d\s-]{7,20}$/;
const phoneOk = p => { const t = String(p == null ? '' : p).trim(); return PHONE_SHAPE.test(t) && !!phoneKey(t); };

// ===== PUBLIC: create lead =====
fastify.post('/api/units/:unitId/leads', async (req, reply) => {
  if (!formIpRL(bookIp(req))) return reply.code(429).send({ error: 'too_many_requests' });
  const { name, phone, budgetMax } = req.body || {};
  const nm = String(name == null ? '' : name).trim().slice(0, 60);   // was stored with no length limit at all
  if (!nm || !phone) return reply.code(400).send({ error: 'name_and_phone_required' });
  if (!phoneOk(phone)) return reply.code(400).send({ error: 'phone' });
  if (!formPhoneRL(phoneKey(phone))) return reply.code(429).send({ error: 'too_many_requests' });
  // A unit that does not exist used to surface as a Prisma foreign-key 500.
  const unit = await prisma.unit.findUnique({ where: { id: String(req.params.unitId) }, select: { id: true } });
  if (!unit) return reply.code(404).send({ error: 'unit_not_found' });
  const bm = Number(budgetMax);
  const lead = await prisma.lead.create({ data: { unitId: unit.id, name: nm, phone: String(phone).trim().slice(0, 20),
    budgetMax: Number.isFinite(bm) && bm > 0 ? Math.round(bm) : null, source: 'QR' } });
  return { ok: true, leadId: lead.id };
});

// ===== PUBLIC: all buildings (portfolio grid) =====
fastify.get('/api/buildings', async () => {
  const bs = await prisma.building.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      name: true, nameAm: true, qrSlug: true, city: true, subCity: true,
      floors: true, threeD_facadeColor: true,
      units: { select: { status: true } }
    }
  });
  return bs.map(b => {
    const units = b.units.length;
    const occupied = b.units.filter(u => u.status === 'OCCUPIED').length;
    return {
      slug: b.qrSlug, name: b.name, nameAm: b.nameAm,
      city: b.city, subCity: b.subCity, floors: b.floors,
      facadeColor: b.threeD_facadeColor || '#c2a875',
      units, occupied, vacant: units - occupied,
      occupancyPct: units ? Math.round(occupied / units * 100) : 0
    };
  });
});

// ===== PUBLIC: claim an offer (counts + opens WhatsApp client-side) =====
fastify.post('/api/offers/:id/claim', async (req, reply) => {
  try {
    await prisma.offer.update({ where: { id: req.params.id }, data: { claims: { increment: 1 } } });
    return { ok: true };
  } catch (e) { return reply.code(404).send({ error: 'offer_not_found' }); }
});

// ===== PUBLIC: report a maintenance problem =====
fastify.post('/api/b/:slug/maintenance', async (req, reply) => {
  if (!formIpRL(bookIp(req))) return reply.code(429).send({ error: 'too_many_requests' });
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });
  const { name, phone, unit, type, description } = req.body || {};
  if (!phone || !description) return reply.code(400).send({ error: 'phone_and_description_required' });
  if (!phoneOk(phone)) return reply.code(400).send({ error: 'phone' });
  if (!formPhoneRL(phoneKey(phone))) return reply.code(429).send({ error: 'too_many_requests' });
  const m = await prisma.maintenanceRequest.create({ data: {
    buildingId: b.id,
    type: String(type || 'GENERAL').slice(0, 30).toUpperCase(),
    description: String(description).slice(0, 500) + (unit ? ' [unit: ' + String(unit).slice(0, 20) + ']' : ''),
    reporterName: name ? String(name).slice(0, 60) : null,
    reporterPhone: String(phone).slice(0, 20),
    source: 'QR'
  }});
  if (NOTIFY_WHITELIST.includes(req.params.slug)) {
    const bb = await prisma.building.findUnique({ where: { id: b.id }, include: { owner: true } });
    if (bb.owner) notifyParty({ name: bb.owner.name || (bb.name + ' owner'), phone: bb.owner.phone, tgChatId: bb.owner.telegramId || null }, '🔧 New maintenance request — ' + bb.name + '\n' + (type || 'GENERAL') + ': ' + String(description).slice(0, 120) + (unit ? '\nUnit: ' + unit : '') + '\nBy: ' + (name || '') + ' ' + phone + '\n\n📊 bina.et/owner');
    const tech = await prisma.staffMember.findFirst({ where: { buildingId: b.id, active: true, role: { in: ['MAINTENANCE', 'TECHNICIAN', 'LIFT'] } } });
    if (tech) notifyParty({ name: tech.name || 'technician', phone: tech.phone, tgChatId: tech.telegramId || null }, '🔧 ' + (type || 'GENERAL') + ': ' + String(description).slice(0, 120) + (unit ? ' — Unit ' + unit : '') + ' / አዲስ የጥገና ጥያቄ');
  }
  return { ok: true, id: m.id };
});

// ===== OWNER: full printable building report (key-gated) =====
fastify.get('/owner/:slug/report', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({
    where: { qrSlug: req.params.slug },
    include: {
      units: {
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        include: {
          leads: { orderBy: { createdAt: 'desc' } },
          tenancies: {
            where: { active: true },
            include: {
              user: true, contract: true,
              shop: { include: { products: true, offers: true } },
              invoices: { orderBy: { dueDate: 'desc' } }
            }
          }
        }
      }
    }
  });
  if (!b) return reply.code(404).send({ error: 'not found' });
  const maint = await prisma.maintenanceRequest.findMany({ where: { buildingId: b.id }, orderBy: { createdAt: 'desc' }, take: 30 });
  const scans30 = await prisma.qrScanEvent.count({ where: { buildingId: b.id, createdAt: { gt: new Date(Date.now() - 30 * 86400000) } } });

  const fmt = n => (n || 0).toLocaleString();
  const dt = d => d ? new Date(d).toISOString().slice(0, 10) : '—';
  const units = b.units;
  const occ = units.filter(u => u.status === 'OCCUPIED');
  const vac = units.filter(u => u.status === 'VACANT');
  const expected = occ.reduce((s, u) => s + u.monthlyRent, 0);
  const allInv = units.flatMap(u => u.tenancies.flatMap(t => t.invoices));
  const now = new Date();
  const mInv = allInv.filter(i => new Date(i.dueDate).getMonth() === now.getMonth() && new Date(i.dueDate).getFullYear() === now.getFullYear());
  const mPaid = mInv.filter(i => i.status === 'PAID');
  const allLeads = units.flatMap(u => u.leads.map(l => ({ ...l, unitNumber: u.number, rent: u.monthlyRent })));
  const openMaint = maint.filter(m => !['DONE','VERIFIED','CANCELLED'].includes(m.status));
  const MONTH = now.toLocaleString('en', { month: 'long', year: 'numeric' });

  const rentRows = units.map(u => {
    const t = u.tenancies[0];
    return '<tr><td>' + u.number + '</td><td>' + (u.floor === 0 ? 'Ground' : 'Floor ' + u.floor) + '</td><td>' + u.areaSqm + '</td>'
      + '<td>' + (t && t.shop ? (t.shop.icon || '') + ' ' + t.shop.name : '<em>—</em>') + '</td>'
      + '<td>' + (t ? (t.user.phone || '') : '—') + '</td>'
      + '<td>' + (t && t.contract ? dt(t.contract.startDate) + ' → ' + dt(t.contract.endDate) : '—') + '</td>'
      + '<td class="r">' + fmt(u.monthlyRent) + '</td>'
      + '<td>' + (u.status === 'OCCUPIED' ? '<span class="ok">Occupied</span>' : '<span class="warn">VACANT</span>') + '</td></tr>';
  }).join('');

  const invRows = mInv.map(i => {
    const t = units.flatMap(u => u.tenancies).find(t => t.invoices.some(x => x.id === i.id));
    const u = units.find(u => u.tenancies.includes(t));
    return '<tr><td>' + (u ? u.number : '') + '</td><td>' + (t && t.shop ? t.shop.name : '') + '</td>'
      + '<td class="r">' + fmt(i.amount) + '</td><td>' + (i.paymentCode || '') + '</td><td>' + dt(i.dueDate) + '</td>'
      + '<td>' + (i.status === 'PAID' ? '<span class="ok">PAID · ' + (i.method || '') + ' · ' + dt(i.paidDate) + '</span>' : '<span class="bad">' + i.status + '</span>') + '</td></tr>';
  }).join('');

  const leadRows = allLeads.map(l =>
    '<tr><td>' + l.unitNumber + '</td><td>' + l.name + '</td><td>' + l.phone + '</td><td class="r">' + fmt(l.rent) + '</td><td>' + dt(l.createdAt) + '</td><td>' + (l.status || 'NEW') + '</td></tr>').join('')
    || '<tr><td colspan="6"><em>No leads yet</em></td></tr>';

  const maintRows = maint.map(m =>
    '<tr><td>' + dt(m.createdAt) + '</td><td>' + m.type + '</td><td>' + m.description + '</td><td>' + (m.reporterName || '') + ' ' + (m.reporterPhone || '') + '</td><td>' + m.status + '</td></tr>').join('')
    || '<tr><td colspan="5"><em>No maintenance requests</em></td></tr>';

  const offers = units.flatMap(u => u.tenancies.flatMap(t => t.shop ? t.shop.offers.map(o => ({ shop: t.shop.name, ...o })) : []));
  const offerRows = offers.map(o =>
    '<tr><td>' + o.shop + '</td><td>' + o.title + '</td><td class="r">' + o.views + '</td><td class="r">' + o.claims + '</td><td>' + dt(o.endsAt) + '</td></tr>').join('')
    || '<tr><td colspan="5"><em>No offers</em></td></tr>';

  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>' + b.name + ' — Owner Report</title><style>'
    + 'body{font-family:-apple-system,Segoe UI,Roboto,"Noto Sans Ethiopic",sans-serif;color:#1e293b;max-width:960px;margin:0 auto;padding:28px;background:#fff}'
    + 'h1{font-size:1.6rem;letter-spacing:-.02em}h2{font-size:1.05rem;margin:28px 0 8px;border-bottom:2px solid #e7e2d8;padding-bottom:4px}'
    + '.am{color:#b45309;font-weight:700}.sub{color:#64748b;font-size:.85rem}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0}'
    + '.tile{border:1px solid #e7e2d8;border-radius:12px;padding:12px;text-align:center;background:#faf8f4}'
    + '.tile b{display:block;font-size:1.3rem}.tile span{font-size:.7rem;color:#64748b;font-weight:700}'
    + 'table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:6px}'
    + 'th{text-align:left;background:#f4f1ea;padding:6px 8px;border-bottom:2px solid #e7e2d8;font-size:.7rem;text-transform:uppercase;color:#475569}'
    + 'td{padding:6px 8px;border-bottom:1px solid #f0ece2;vertical-align:top}.r{text-align:right;font-variant-numeric:tabular-nums}'
    + '.ok{color:#047857;font-weight:700}.bad{color:#dc2626;font-weight:700}.warn{color:#b45309;font-weight:800}'
    + '.print-btn{position:fixed;top:14px;right:14px;background:#7c3aed;color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:800;cursor:pointer}'
    + 'footer{margin-top:30px;color:#94a3b8;font-size:.72rem;text-align:center}'
    + '@media print{.print-btn{display:none}body{padding:0}}'
    + '</style></head><body>'
    + '<button class="print-btn" onclick="window.print()">🖨️ Print / PDF</button>'
    + '<h1>' + b.name + ' <span class="am">' + (b.nameAm || '') + '</span></h1>'
    + '<div class="sub">📍 ' + (b.subCity ? b.subCity + ', ' : '') + b.city + ' · ' + b.floors + ' floors · Owner report generated ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC · Powered by ቢ BinaSmart</div>'
    + '<div class="grid">'
    + '<div class="tile"><b>' + units.length + '</b><span>UNITS</span></div>'
    + '<div class="tile"><b>' + Math.round(occ.length / (units.length || 1) * 100) + '%</b><span>OCCUPANCY (' + occ.length + '/' + units.length + ')</span></div>'
    + '<div class="tile"><b>' + fmt(expected) + '</b><span>EXPECTED ETB / MONTH</span></div>'
    + '<div class="tile"><b>' + fmt(mPaid.reduce((s, i) => s + i.amount, 0)) + '</b><span>COLLECTED ' + MONTH.toUpperCase() + '</span></div>'
    + '<div class="tile"><b>' + fmt(mInv.filter(i => i.status !== 'PAID').reduce((s, i) => s + i.amount, 0)) + '</b><span>OUTSTANDING</span></div>'
    + '<div class="tile"><b>' + scans30 + '</b><span>QR SCANS (30D)</span></div>'
    + '<div class="tile"><b>' + allLeads.length + '</b><span>VACANCY LEADS</span></div>'
    + '<div class="tile"><b>' + openMaint.length + '</b><span>OPEN MAINTENANCE</span></div>'
    + '</div>'
    + '<h2>1 · Rent Roll / የኪራይ ዝርዝር</h2><table><tr><th>Unit</th><th>Floor</th><th>m²</th><th>Tenant / Shop</th><th>Phone</th><th>Contract</th><th>Rent ETB/mo</th><th>Status</th></tr>' + rentRows + '</table>'
    + '<h2>2 · ' + MONTH + ' Invoices / ደረሰኞች</h2><table><tr><th>Unit</th><th>Tenant</th><th>Amount</th><th>Code</th><th>Due</th><th>Status</th></tr>' + invRows + '</table>'
    + '<h2>3 · Vacancy Leads / የክፍት ክፍል ፍላጎቶች</h2><table><tr><th>Unit</th><th>Name</th><th>Phone</th><th>Rent</th><th>Date</th><th>Status</th></tr>' + leadRows + '</table>'
    + '<h2>4 · Maintenance History / የጥገና ታሪክ</h2><table><tr><th>Date</th><th>Type</th><th>Description</th><th>Reporter</th><th>Status</th></tr>' + maintRows + '</table>'
    + '<h2>5 · Marketplace Offers / ቅናሾች</h2><table><tr><th>Shop</th><th>Offer</th><th>Views</th><th>Claims</th><th>Ends</th></tr>' + offerRows + '</table>'
    + ((b.bankAccounts && b.bankAccounts.length) || b.tinNumber ?
      '<h2>6 · Payment Accounts / የክፍያ ሂሳቦች</h2><table><tr><th>Bank</th><th>Account Number</th></tr>'
      + (b.bankAccounts || []).map(a => '<tr><td>' + a.bank + '</td><td style="font-variant-numeric:tabular-nums;font-weight:700">' + a.account + '</td></tr>').join('')
      + (b.tinNumber ? '<tr><td><b>TIN</b></td><td style="font-weight:700">' + b.tinNumber + '</td></tr>' : '')
      + '</table><div class="sub" style="margin-top:4px">Tenants pay rent to these accounts and send the payment code as reference. / ተከራዮች ኪራይ ወደ እነዚህ ሂሳቦች ከፍለው የክፍያ ኮዱን እንደ ማጣቀሻ ይላካሉ።</div>'
      : '')
    + '<h2>7 · Building Links</h2>'
    + '<table><tr><td>Public page (tenants scan QR)</td><td>https://bina.et/b/' + b.qrSlug + '</td></tr>'
    + '<tr><td>Owner dashboard</td><td>https://bina.et/owner/' + b.qrSlug + '</td></tr>'
    + '<tr><td>Printable entrance poster</td><td>https://bina.et/static/qr-poster.html?b=' + b.qrSlug + '</td></tr></table>'
    + '<footer>Confidential — prepared for the owner of ' + b.name + ' · BinaSmart Building Management · bina.et</footer>'
    + '<script src="/static/bina-footer.js?v=9" defer></script></body></html>';
  reply.type('text/html').send(html);
});

// ===== AUDIT helper =====
async function audit(buildingId, action, detail, amount, actor){
  try{ await prisma.auditLog.create({ data: { buildingId, action, actor: actor ? String(actor).slice(0, 60) : null, detail: detail ? String(detail).slice(0, 200) : null, amount: amount != null ? Math.round(amount) : null } }); }catch(e){}
}

// ===== ACCOUNTING: monthly VAT + P&L =====
const VAT_RATE = 0.15; // Ethiopia, VAT Proclamation 1341/2024
fastify.get('/api/owner/:slug/accounting', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 1));
  const invoices = await prisma.invoice.findMany({
    where: { tenancy: { unit: { buildingId: b.id } }, dueDate: { gte: start, lt: end } },
    include: { tenancy: { include: { unit: true, shop: true } } }
  });
  const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const collected = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + i.amount, 0);
  // Ethiopian VAT: output VAT accrues on invoices issued in the period
  const outputVat = b.vatRegistered ? Math.round(b.vatInclusive ? invoiced * VAT_RATE / (1 + VAT_RATE) : invoiced * VAT_RATE) : 0;
  const taxable = b.vatRegistered ? invoiced - (b.vatInclusive ? outputVat : 0) : invoiced;
  const expenses = await prisma.expense.findMany({ where: { buildingId: b.id, date: { gte: start, lt: end } }, orderBy: { date: 'desc' } });
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const inputVat = b.vatRegistered ? expenses.reduce((s, e) => s + e.vatAmount, 0) : 0;
  const netVat = outputVat - inputVat;
  const due = new Date(Date.UTC(y, mo + 1, 0)); // last day of following month
  // Owner Bini questions are audited too; left out here so they cannot push payments and expenses off the trail.
  const auditRows = await prisma.auditLog.findMany({ where: { buildingId: b.id, action: { not: 'OWNER_BINI_Q' } }, orderBy: { createdAt: 'desc' }, take: 40 });
  return {
    month: m, vat: { registered: b.vatRegistered, number: b.vatNumber, inclusive: b.vatInclusive, rate: VAT_RATE,
      taxable, outputVat, inputVat, netVat, filingDue: due.toISOString().slice(0, 10) },
    income: { invoiced, collected, outstanding: invoiced - collected },
    expenses: expenses.map(e => ({ id: e.id, date: e.date.toISOString().slice(0, 10), vendor: e.vendor, vendorTin: e.vendorTin, category: e.category, description: e.description, amount: e.amount, vatAmount: e.vatAmount, receiptNo: e.receiptNo })),
    expenseTotal, profit: collected - expenseTotal,
    tin: b.tinNumber,
    audit: auditRows.map(a => ({ at: a.createdAt.toISOString().slice(0, 16).replace('T', ' '), action: a.action, detail: a.detail, amount: a.amount }))
  };
});
fastify.post('/api/owner/:slug/expense', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { date, vendor, vendorTin, category, description, amount, vatAmount, receiptNo } = req.body || {};
  if (!vendor || !amount) return reply.code(400).send({ error: 'vendor_and_amount_required' });
  const e = await prisma.expense.create({ data: {
    buildingId: b.id, date: date ? new Date(date) : new Date(),
    vendor: String(vendor).slice(0, 80), vendorTin: vendorTin || null,
    category: (category || 'GENERAL').toUpperCase(), description: description || null,
    amount: Math.round(parseFloat(amount)), vatAmount: Math.round(parseFloat(vatAmount || 0)), receiptNo: receiptNo || null
  }});
  await audit(b.id, 'EXPENSE_ADDED', vendor + (receiptNo ? ' #' + receiptNo : ''), e.amount);
  return { ok: true, id: e.id };
});
fastify.post('/api/owner/:slug/expense/:id/delete', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const e = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!e || e.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  await prisma.expense.delete({ where: { id: e.id } });
  await audit(b.id, 'EXPENSE_DELETED', e.vendor, e.amount);
  return { ok: true };
});
fastify.post('/api/owner/:slug/vat-settings', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { vatRegistered, vatNumber, vatInclusive } = req.body || {};
  await prisma.building.update({ where: { id: b.id }, data: {
    vatRegistered: !!vatRegistered, vatNumber: vatNumber || null,
    vatInclusive: vatInclusive === undefined ? b.vatInclusive : !!vatInclusive
  }});
  await audit(b.id, 'VAT_SETTINGS', 'registered=' + !!vatRegistered + (vatNumber ? ' no=' + vatNumber : ''));
  return { ok: true };
});

// ===== Owner AI agent — scoped to THIS owner's building only =====
// Bini for the owner of this building, answer only: agents/owner reads this building through scoped,
// read-only tools. The scope comes from the owner key checked here, never from the request.
fastify.post('/api/owner/:slug/ai', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const sw = await actionSwitches([b.id]);   // owner actions (agents/owner/actions/store.js); never from the body
  return runAgent(ownerAgent, req, reply, { scope: { buildingIds: [b.id], actionsOn: sw.on, staffConfirm: sw.staff }, channel: 'owner-web' });
});

// ===== Bini for owners on Telegram (owner Bini design §3) =====
// @bina_smart_bot links an owner by Share-my-phone (agents/owner/access.js) and answers through the same agent as
// the dashboard. The scope is re-read from OwnerAccess × AgentSwitch on every message.
const { makeOwnerAccess, makeOwnerAccessStore } = require('./agents/owner/access');
const { healthMessage } = require('./agents/owner/health-report');
const ownerAccess = makeOwnerAccess({ store: makeOwnerAccessStore(prisma), audit });
const ownerTelegram = {
  access: ownerAccess,
  async answer({ text, from, chatId, scope }) {
    const req = { body: { message: text, user: { telegramId: String(from && from.id) } }, headers: {}, ip: 'tg-' + chatId, log: fastify.log };
    const res = { code() { return this; }, send(o) { return o; } };
    const sw = await actionSwitches(scope.buildingIds);
    const full = Object.assign({}, scope, { actionsOn: sw.on, staffConfirm: sw.staff, telegramId: String(from && from.id) });
    const out = await runAgent(ownerAgent, req, res, { scope: full, channel: 'owner-telegram' });
    if (!out || !out.reply) return null;
    // A prepared action comes back with its id and buttons; ride/binaBot.js shows them and passes presses to actions.press.
    return out.ownerAction ? { reply: String(out.reply), ownerAction: out.ownerAction } : String(out.reply);
  },
  async health(scope) {
    return healthMessage(await require('./agents/owner/tools/building').makeExecutor({ prisma })(scope)('data_health', {}));
  },
};

// The dashboard's view of those links. Remove signs one Telegram account out; the number stays approved until
// ops revoke it (ops/owner/access.js revoke).
fastify.get('/api/owner/:slug/telegram-links', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const on = await prisma.agentSwitch.findFirst({ where: { agent: 'owner', kind: 'building', entityId: b.id, disabledAt: null }, select: { id: true } });
  return { enabled: !!on, bot: 'https://t.me/' + (process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot') + '?start=owner',
    links: await ownerAccess.linksForBuilding(b.id) };
});
fastify.post('/api/owner/:slug/telegram-links/:id/remove', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  // Ownership, as every sibling route checks it: only a link this building's dashboard lists can be removed here.
  const shown = (await ownerAccess.linksForBuilding(b.id)).find(l => l.id === String(req.params.id));
  const row = { buildingId: shown ? b.id : null };
  if (row.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (!(await ownerAccess.revokeForBuilding(b.id, req.params.id))) return reply.code(404).send({ error: 'not_found' });
  return { ok: true };
});

// ===== Tenant notices on Telegram (owner actions and messaging design §2) =====
// Tenants link @bina_smart_bot from the building's poster: /start tenant_<slug>, then Share my phone. The proof and the
// match live in messaging/tenant-link.js; the bot (ride/binaBot.js) calls it only within ten minutes of that command.
// The owner sees how many tenants linked, prints the poster, and can remove a unit's link.
const QRCode = require('qrcode');
const { makeTenantLink, makeTenantLinkStore } = require('./messaging/tenant-link');
const { tenantPoster } = require('./messaging/tenant-poster');
const tenantLink = makeTenantLink({ store: makeTenantLinkStore(prisma), audit });
const tenantStartUrl = slug => 'https://t.me/' + (process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot') + '?start=tenant_' + slug;
fastify.get('/api/owner/:slug/tenant-telegram', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true, qrSlug: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const st = await tenantLink.statsForBuilding(b.id);
  return { active: st.active, linked: st.linked, units: st.units, startLink: tenantStartUrl(b.qrSlug), poster: '/tenant-poster/' + b.qrSlug };
});
fastify.post('/api/owner/:slug/tenant-telegram/:tenancyId/remove', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const t = await prisma.tenancy.findUnique({ where: { id: String(req.params.tenancyId) }, select: { id: true, unit: { select: { buildingId: true } } } });
  // Ownership, as every sibling route checks it; 404 rather than 403, so a wrong id is not confirmed.
  if (!b || !t || t.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (!(await tenantLink.removeForBuilding(b.id, t.id))) return reply.code(404).send({ error: 'not_linked' });
  return { ok: true };
});
// Printable A4 page behind the building's owner key or the owner session. The dashboard fetches it with the key in the
// x-owner-key header and writes it into a new window, so the key never sits in an address or the access log.
// It shows only the building name and the bot link; the QR is drawn here
// by the qrcode package, no outside QR service.
fastify.get('/tenant-poster/:slug', async (req, reply) => {
  const slug = String(req.params.slug || '');
  if (!/^[A-Za-z0-9-]{1,60}$/.test(slug)) return reply.code(404).type('text/html; charset=utf-8').send(slugMiss('ህንፃ · Building', '/'));
  if (await authBuildingFail(req, reply, slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: slug }, select: { name: true, nameAm: true, qrSlug: true } });
  if (!b) return reply.code(404).type('text/html; charset=utf-8').send(slugMiss('ህንፃ · Building', '/'));
  const qrSvg = await QRCode.toString(tenantStartUrl(b.qrSlug), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    .type('text/html; charset=utf-8').send(tenantPoster({ building: b, startUrl: tenantStartUrl(b.qrSlug), qrSvg }));
});

// ===== SMART NOTIFICATIONS + PENALTIES (daily engine) =====
const NOTIFY_WHITELIST = ['darulle']; // real buildings only — demo owners have fake numbers
const WA_CHANNEL = { darulle: 'darulle' }; // per-building sender (owner's own number once linked)
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sendWa(phone, message, channel){
  for (const ch of [channel || 'binasmart', 'binasmart']) { // BinaSmart number 0911244344 is the default sender
    if (ch === undefined && channel === undefined && ch !== channel) continue;
    try{
      const body = { phone, message };
      if (ch) body.channel = ch;
      const r = await fetch('http://127.0.0.1:8081/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if ((await r.json()).success === true) { await sleep(3000 + Math.random() * 2000); return true; }
    }catch(e){}
    if (!ch) break;
  }
  return false;
}
// Must be @bina_smart_bot: owners link through that bot, and Telegram only lets the same bot message them.
const TG_TOKEN = process.env.BINA_RIDER_BOT_TOKEN || process.env.BINASMART_TG_TOKEN || '';
const { makeNotify } = require('./notify/notify');
const ADMIN_TG_CHAT = process.env.BINASMART_ADMIN_TG_CHAT || '';
// Telegram first, WhatsApp as backup, admin copy always — see notify/notify.js
// 8096525984 is the ride ops account ("81171") that has received lead alerts since launch; kept as a
// second admin so nothing that used to reach it stops reaching it.
const OPS_TG_CHAT = process.env.BINASMART_OPS_TG_CHAT || '8096525984';
const { notifyShop, notifyParty, notifyAdmins } = makeNotify({ sendTg, sendWa, adminChatIds: [ADMIN_TG_CHAT, OPS_TG_CHAT], log: console.log });
async function sendTg(chatId, text){
  if (!TG_TOKEN || !chatId) return false;
  try{
    const r = await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return (await r.json()).ok === true;
  }catch(e){ return false; }
}
// ===== Tenant messages (owner actions and messaging design, 15 Sep 2026, §1) =====
// Every message to a tenant goes through messaging/delivery.js: Telegram if the tenant linked @bina_smart_bot, otherwise
// SMS, otherwise recorded as not delivered. One channel per message, every attempt in OutboundMessage. WhatsApp is no
// longer tried for tenants: the bridge on 127.0.0.1:8081 does not answer (15 Sep 2026) and each failed try slept 3-5 s
// inside the daily run. Owners, shops and admins keep notifyParty / notifyShop / notifyAdmins exactly as before.
// An SMS to a TENANT leaves the server only when SMS_MODE=live and SMS_TENANT_MODE=live, SMS_API_TOKEN is set, the
// building is real (NOTIFY_WHITELIST and not a demo) and its smsMonthlyLimit allows it; otherwise the row says `test`,
// or why it was not sent. Sign-in codes are transactional, not tenant messages: they need SMS_MODE only (Plan D).
const { makeSmsFromEnv, buildingSmsLabel, parsePriceTiers } = require('./messaging/sms');
const { makeDelivery, makeDeliveryStore, isRealMiss } = require('./messaging/delivery');
const { makeInvoiceLinks } = require('./messaging/invoice-links');
const { renderInvoicePage, renderGonePage } = require('./messaging/invoice-page');
const invoiceText = require('./messaging/invoice-text');
const errorKindOf = e => String((e && (e.code || e.name)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';
// Delivery reports come to a path only the SMS provider is given; without a long secret there is no report route.
const SMS_CALLBACK_SECRET = process.env.SMS_CALLBACK_SECRET || '';
const smsCallbackUrl = SMS_CALLBACK_SECRET.length >= 24 ? 'https://bina.et/api/sms/report/' + SMS_CALLBACK_SECRET : '';
const tenantSms = makeSmsFromEnv(process.env, { log: m => console.log(m), callbackUrl: smsCallbackUrl });
const delivery = makeDelivery({ store: makeDeliveryStore(prisma), sendTg, sms: tenantSms, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
  priceTiers: parsePriceTiers(process.env.SMS_PRICE_TIERS), log: m => console.error(m) });
const invoiceLinks = makeInvoiceLinks({ prisma });
// Mark-paid and invoice send, shared by the dashboard routes and Bini's confirmed owner actions (building/invoice-ops.js).
const { makeInvoiceOps } = require('./building/invoice-ops');
const invoiceOps = makeInvoiceOps({ prisma, audit, notifyTenant, invoiceLinks, invoiceText, canMessage: b => !!b && NOTIFY_WHITELIST.includes(b.qrSlug),
  log: m => console.error(m) });
console.log('[sms] mode ' + tenantSms.mode + ' · tenant sms ' + tenantSms.tenantMode + ' · ' + (tenantSms.provider || 'no provider'));
// Every SMS starts "BinaSmart · <building name>፦ " until approved sender names exist; smsSender null = provider default.
function tenantBuilding(b){
  return { id: b.id, slug: b.qrSlug, real: NOTIFY_WHITELIST.includes(b.qrSlug) && !hotelIsDemo(b), smsLabel: buildingSmsLabel(b.name),
    smsMonthlyLimit: b.smsMonthlyLimit == null ? 0 : b.smsMonthlyLimit, smsSender: b.smsSender || '' };
}
let tenantMisses = 0;   // real failures only (failed Telegram, live SMS), per building per daily run — see runDailyChecks and isRealMiss
// One message to the tenant of one tenancy ({ id, userId, user: { phone, telegramChatId } }). Never throws.
async function notifyTenant(b, tenancy, { kind, source, actor, text, smsText, invoiceId }){
  const tb = tenantBuilding(b);
  let r = null;
  if (tenancy && tenancy.user) {
    r = await delivery.sendToTenants({ building: tb, kind, source, actor: actor || null,
      recipients: [{ tenancyId: tenancy.id, userId: tenancy.userId, telegramChatId: tenancy.user.telegramChatId || null,
        phone: tenancy.user.phone, text, smsText: smsText || text, invoiceId: invoiceId || null }] })
      .catch(e => { console.error('[delivery] error: ' + errorKindOf(e)); return null; });
  }
  const one = (r && r.results[0]) || null;
  const delivered = !!one && (one.status === 'sent' || one.status === 'delivered');
  // The owner reads this count in the daily report: test-mode SMS rows are never "not delivered"; a failed Telegram send is.
  if (isRealMiss({ real: tb.real, tenantMode: tenantSms.tenantMode }, one)) tenantMisses++;
  return { delivered, status: one ? one.status : 'failed', channel: one ? one.channel : 'none', errorKind: one ? one.errorKind : (r ? r.error : 'error'), batchId: (r && r.batchId) || null };
}
async function alreadyAudited(buildingId, action, detailContains){
  const hit = await prisma.auditLog.findFirst({ where: { buildingId, action, detail: { contains: detailContains } } });
  return !!hit;
}
async function runDailyChecks(onlySlug){
  const buildings = await prisma.building.findMany({ where: onlySlug ? { qrSlug: onlySlug } : {}, include: { owner: true } });
  const results = [];
  const now = new Date();
  for (const b of buildings) {
    const res = { slug: b.qrSlug, renewals: 0, dueSoon: 0, penalties: 0, notified: false };
    tenantMisses = 0;
    const canSend = NOTIFY_WHITELIST.includes(b.qrSlug);
    let tenantSendBudget = 8; // max tenant messages per building per run — spread over days, avoids WhatsApp spam bans
    const ownerMsgs = [];
    const tenancies = await prisma.tenancy.findMany({
      where: { active: true, unit: { buildingId: b.id }, contract: { endDate: { gte: now, lte: new Date(now.getTime() + 90 * 86400000) } } },
      include: { contract: true, unit: true, shop: true, user: true }
    });
    for (const t of tenancies) {
      const tag = 'REN-' + t.contract.id.slice(-6) + '-' + now.toISOString().slice(0, 7);
      if (await alreadyAudited(b.id, 'NOTIFY_RENEWAL', tag)) continue;
      const days = Math.ceil((new Date(t.contract.endDate) - now) / 86400000);
      const who = (t.shop ? t.shop.nameAm || t.shop.name : t.user.fullName) + ' (' + t.unit.number + ')';
      ownerMsgs.push('📋 ' + who + ' — contract ends in ' + days + ' days (' + t.contract.endDate.toISOString().slice(0, 10) + ') / ውል በ' + days + ' ቀን ያበቃል');
      if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(b, t, { kind: 'reminder', source: 'daily-renewal', actor: 'cron', text: 'ሰላም! የ' + b.nameAm + ' ክፍል ' + t.unit.number + ' ውልዎ በ' + days + ' ቀናት ውስጥ ያበቃል። ለማደስ ያነጋግሩን። — BinaSmart' });
      await audit(b.id, 'NOTIFY_RENEWAL', tag + ' ' + who);
      res.renewals++;
    }
    const dueSoon = await prisma.invoice.findMany({
      where: { status: 'PENDING', tenancy: { unit: { buildingId: b.id } },
        dueDate: { gte: now, lte: new Date(now.getTime() + 5 * 86400000) } },
      include: { tenancy: { include: { unit: true, shop: true, user: true } } }
    });
    for (const i of dueSoon) {
      const tag = 'DUE-' + i.id.slice(-8);
      if (await alreadyAudited(b.id, 'NOTIFY_DUE', tag)) continue;
      const who = (i.tenancy.shop ? i.tenancy.shop.nameAm || i.tenancy.shop.name : '') + ' ' + i.tenancy.unit.number;
      ownerMsgs.push('⏰ ' + who + ' — ' + i.amount.toLocaleString() + ' ETB due ' + i.dueDate.toISOString().slice(0, 10));
      if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(b, i.tenancy, { kind: 'reminder', source: 'daily-due', actor: 'cron', invoiceId: i.id, text: 'ሰላም! የ' + b.nameAm + ' ኪራይ ' + i.amount.toLocaleString() + ' ብር በ' + i.dueDate.toISOString().slice(0, 10) + ' ይከፈላል። ኮድ: ' + (i.paymentCode || '') + ' — BinaSmart' });
      await audit(b.id, 'NOTIFY_DUE', tag + ' ' + who, i.amount);
      res.dueSoon++;
    }
    const overdue = !b.penaltiesEnabled ? [] : await prisma.invoice.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] }, lateFee: 0, dueDate: { lt: now }, tenancy: { unit: { buildingId: b.id } } },
      include: { tenancy: { include: { unit: true, shop: true, user: true } } }
    });
    for (const i of overdue) {
      const daysLate = Math.floor((now - new Date(i.dueDate)) / 86400000);
      const fee = Math.round(i.amount * (b.latePenaltyPct || 10) / 100);
      await prisma.invoice.update({ where: { id: i.id }, data: { status: 'OVERDUE', lateFee: fee, daysLate } });
      const who = (i.tenancy.shop ? i.tenancy.shop.nameAm || i.tenancy.shop.name : '') + ' ' + i.tenancy.unit.number;
      ownerMsgs.push('🔴 ' + who + ' — OVERDUE ' + daysLate + 'd, penalty +' + fee.toLocaleString() + ' ETB');
      await audit(b.id, 'PENALTY_APPLIED', who + ' +' + b.latePenaltyPct + '%', fee);
      if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(b, i.tenancy, { kind: 'reminder', source: 'daily-penalty', actor: 'cron', invoiceId: i.id, text: 'ማሳሰቢያ: የ' + b.nameAm + ' ኪራይ ክፍያዎ አልፏል። ቅጣት ' + fee.toLocaleString() + ' ብር ታክሏል። — BinaSmart' });
      res.penalties++;
    }
    if (tenantMisses) { ownerMsgs.push('📵 ' + tenantMisses + ' tenant message(s) not delivered — no working Telegram link, and SMS not available for them'); res.tenantsUnreached = tenantMisses; }
    if (canSend && ownerMsgs.length && b.owner) {
      res.notified = (await notifyParty({ name: b.owner.name || (b.name + ' owner'), phone: b.owner.phone, tgChatId: b.owner.telegramId || null }, '🏢 ' + b.name + ' — BinaSmart daily report:\n\n' + ownerMsgs.slice(0, 15).join('\n') + (ownerMsgs.length > 15 ? '\n…+' + (ownerMsgs.length - 15) + ' more' : '') + '\n\n📊 bina.et/owner', WA_CHANNEL[b.qrSlug], 'owner not on Telegram yet')).ok;
    }
    results.push(res);
  }
  return results;
}
cron.schedule('0 4 * * *', async () => {
  try{ const r = await runDailyChecks(); console.log('[daily-checks]', JSON.stringify(r.filter(x => x.renewals + x.dueSoon + x.penalties > 0))); }
  catch(e){ console.error('[daily-checks]', e.message); }
}, { timezone: 'UTC' });
fastify.post('/api/admin/:slug/run-daily', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  return { ok: true, results: await runDailyChecks(req.params.slug) };
});

// ===== Legacy tenant webhook (retired 15 Sep 2026) =====
// This route linked a Telegram chat to a Darulle tenant from nothing but a unit number, which is written on doors. It
// answered only Telegram's secret and no bot delivered here (0 links were ever made; on 15 Sep no bot token's webhook
// pointed here and nginx logged no request to it). Tenants now link in @bina_smart_bot with Telegram's proof of their
// phone number (messaging/tenant-link.js). The route stays so an old webhook registration gets a quiet 200 instead of
// retries; it reads nothing and changes nothing.
fastify.post('/api/tg-webhook', async (req, reply) => {
  const tgSecret = process.env.TG_WEBHOOK_SECRET || '';
  if (!tgSecret || req.headers['x-telegram-bot-api-secret-token'] !== tgSecret) return reply.code(401).send({ ok: false });
  return { ok: true };
});

// ===== SUB-METERING =====
fastify.get('/api/owner/:slug/meters', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const units = await prisma.unit.findMany({ where: { buildingId: b.id, status: 'OCCUPIED' },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    include: { tenancies: { where: { active: true }, include: { shop: true, meters: { include: { readings: { orderBy: { readAt: 'desc' }, take: 2 } } } } } } });
  const out = [];
  for (const u of units) {
    const t = u.tenancies[0]; if (!t) continue;
    const row = { unitId: u.id, number: u.number, floor: u.floor, tenant: t.shop ? (t.shop.nameAm || t.shop.name) : '' };
    for (const type of ['ELECTRICITY', 'WATER']) {
      const m = t.meters.find(x => x.meterType === type);
      const rds = m ? m.readings : [];
      const last = rds[0], prev = rds[1];
      const cons = last && prev ? Math.max(0, last.reading - prev.reading) : null;
      const tariff = m ? m.tariff : (type === 'ELECTRICITY' ? b.elecTariff : b.waterTariff);
      row[type.toLowerCase()] = { last: last ? last.reading : null, lastAt: last ? last.readAt.toISOString().slice(0, 10) : null,
        consumption: cons, tariff, charge: cons != null ? Math.round(cons * tariff) : null };
    }
    out.push(row);
  }
  for (const type of ['electricity', 'water']) {
    const vals = out.map(r => r[type].consumption).filter(v => v != null && v > 0).sort((a, b2) => a - b2);
    const med = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    out.forEach(r => { if (med && r[type].consumption != null && r[type].consumption > 2 * med) r[type].high = true; });
  }
  return { units: out, tariffs: { electricity: b.elecTariff, water: b.waterTariff } };
});
fastify.post('/api/owner/:slug/meter-reading', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { unitId, type, reading } = req.body || {};
  if (!unitId || !['ELECTRICITY', 'WATER'].includes(type) || reading === undefined) return reply.code(400).send({ error: 'unitId_type_reading_required' });
  const u = await prisma.unit.findUnique({ where: { id: unitId }, include: { tenancies: { where: { active: true }, include: { meters: true } } } });
  if (!u || u.buildingId !== b.id || !u.tenancies[0]) return reply.code(404).send({ error: 'occupied_unit_not_found' });
  const t = u.tenancies[0];
  let meter = t.meters.find(m => m.meterType === type);
  if (!meter) meter = await prisma.meter.create({ data: { tenancyId: t.id, meterType: type, tariff: type === 'ELECTRICITY' ? b.elecTariff : b.waterTariff } });
  const prev = await prisma.meterReading.findFirst({ where: { meterId: meter.id }, orderBy: { readAt: 'desc' } });
  const r = await prisma.meterReading.create({ data: { meterId: meter.id, reading: parseFloat(reading), readBy: 'owner' } });
  const cons = prev ? Math.max(0, r.reading - prev.reading) : 0;
  await audit(b.id, 'METER_READING', u.number + ' ' + type + ' ' + reading + (prev ? ' (Δ' + cons.toFixed(1) + ')' : ' (first)'));
  return { ok: true, consumption: prev ? cons : null, charge: prev ? Math.round(cons * meter.tariff) : null };
});
fastify.post('/api/owner/:slug/meter-bill', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { unitId, type } = req.body || {};
  const u = await prisma.unit.findUnique({ where: { id: unitId }, include: { tenancies: { where: { active: true }, include: { shop: true, meters: { include: { readings: { orderBy: { readAt: 'desc' }, take: 2 } } } } } } });
  if (!u || u.buildingId !== b.id || !u.tenancies[0]) return reply.code(404).send({ error: 'not_found' });
  const t = u.tenancies[0];
  const m = t.meters.find(x => x.meterType === type);
  if (!m || m.readings.length < 2) return reply.code(400).send({ error: 'need_two_readings' });
  const cons = Math.max(0, m.readings[0].reading - m.readings[1].reading);
  const amount = Math.round(cons * m.tariff);
  if (!amount) return reply.code(400).send({ error: 'zero_consumption' });
  const code = (type === 'ELECTRICITY' ? 'ELC' : 'WTR') + '-' + Math.floor(1000 + Math.random() * 9000) + '-' + u.number.replace(/[^A-Za-z0-9]/g, '');
  const inv = await prisma.invoice.create({ data: { tenancyId: t.id, type: type, amount, dueDate: new Date(Date.now() + 10 * 86400000), paymentCode: code, status: 'PENDING' } });
  await audit(b.id, 'UTILITY_BILLED', u.number + ' ' + type + ' ' + cons.toFixed(1) + (type === 'ELECTRICITY' ? ' kWh' : ' m³'), amount);
  return { ok: true, invoiceId: inv.id, consumption: cons, amount, code };
});

// ===== STAFF & SALARIES =====
fastify.get('/api/owner/:slug/staff', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const staff = await prisma.staffMember.findMany({ where: { buildingId: b.id, active: true }, orderBy: { createdAt: 'asc' } });
  const month = new Date().toISOString().slice(0, 7);
  const posted = await prisma.expense.count({ where: { buildingId: b.id, category: 'SALARY', receiptNo: { startsWith: 'SAL-' + month } } });
  return { staff, monthlyTotal: staff.reduce((s, x) => s + x.salary, 0), postedThisMonth: posted };
});
fastify.post('/api/owner/:slug/staff', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { name, role, phone, salary } = req.body || {};
  if (!name || !salary) return reply.code(400).send({ error: 'name_and_salary_required' });
  const s = await prisma.staffMember.create({ data: { buildingId: b.id, name: String(name).slice(0, 60), role: (role || 'GUARD').toUpperCase(), phone: phone || null, salary: Math.round(parseFloat(salary)) } });
  await audit(b.id, 'STAFF_ADDED', name + ' (' + s.role + ')', s.salary);
  return { ok: true, id: s.id };
});
fastify.post('/api/owner/:slug/staff/:id/update', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const s = await prisma.staffMember.findUnique({ where: { id: req.params.id } });
  if (!s || s.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  const { salary, name, role, remove } = req.body || {};
  if (remove) {
    await prisma.staffMember.update({ where: { id: s.id }, data: { active: false } });
    await audit(b.id, 'STAFF_REMOVED', s.name);
    return { ok: true };
  }
  await prisma.staffMember.update({ where: { id: s.id }, data: {
    salary: salary ? Math.round(parseFloat(salary)) : s.salary,
    name: name || s.name, role: role ? role.toUpperCase() : s.role
  }});
  await audit(b.id, 'STAFF_UPDATED', (name || s.name) + (salary ? ' salary→' + salary : ''), salary ? parseInt(salary) : null);
  return { ok: true };
});
fastify.post('/api/owner/:slug/post-salaries', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const month = /^\d{4}-\d{2}$/.test((req.body || {}).month || '') ? req.body.month : new Date().toISOString().slice(0, 7);
  const staff = await prisma.staffMember.findMany({ where: { buildingId: b.id, active: true } });
  let created = 0, skipped = 0;
  for (const s of staff) {
    const ref = 'SAL-' + month + '-' + s.id.slice(-6);
    const exists = await prisma.expense.findFirst({ where: { buildingId: b.id, receiptNo: ref } });
    if (exists) { skipped++; continue; }
    await prisma.expense.create({ data: {
      buildingId: b.id, date: new Date(month + '-28'), vendor: s.name + ' (' + s.role + ')',
      category: 'SALARY', description: 'Monthly salary ' + month, amount: s.salary, vatAmount: 0, receiptNo: ref
    }});
    created++;
  }
  if (created) await audit(b.id, 'SALARIES_POSTED', month + ' — ' + created + ' staff', staff.reduce((x, s) => x + s.salary, 0));
  return { ok: true, created, skipped, month };
});

// ===== PRINTABLE VAT RETURN =====
fastify.get('/owner/:slug/vat-report', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, include: { org: true } });
  const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 1));
  const invoices = await prisma.invoice.findMany({ where: { tenancy: { unit: { buildingId: b.id } }, dueDate: { gte: start, lt: end } },
    include: { tenancy: { include: { unit: true, shop: true } } }, orderBy: { amount: 'desc' } });
  const expenses = await prisma.expense.findMany({ where: { buildingId: b.id, date: { gte: start, lt: end } }, orderBy: { date: 'asc' } });
  const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const outputVat = b.vatRegistered ? Math.round(b.vatInclusive ? invoiced * 0.15 / 1.15 : invoiced * 0.15) : 0;
  const taxable = invoiced - (b.vatInclusive ? outputVat : 0);
  const inputVat = b.vatRegistered ? expenses.reduce((s, e) => s + e.vatAmount, 0) : 0;
  const expTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const net = outputVat - inputVat;
  const due = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  const fmt = n => (n || 0).toLocaleString();
  const MONTH = start.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const invRows = invoices.map(i => '<tr><td>' + i.tenancy.unit.number + '</td><td>' + (i.tenancy.shop ? i.tenancy.shop.name : '') + '</td><td>' + (i.paymentCode || '') + '</td><td class="r">' + fmt(i.amount) + '</td><td class="r">' + fmt(b.vatRegistered ? Math.round(i.amount * 0.15 / 1.15) : 0) + '</td></tr>').join('');
  const expRows = expenses.map(e => '<tr><td>' + e.date.toISOString().slice(0, 10) + '</td><td>' + e.vendor + (e.vendorTin ? ' (TIN ' + e.vendorTin + ')' : '') + '</td><td>' + e.category + '</td><td>' + (e.receiptNo || '') + '</td><td class="r">' + fmt(e.amount) + '</td><td class="r">' + fmt(e.vatAmount) + '</td></tr>').join('') || '<tr><td colspan="6"><em>No expenses recorded</em></td></tr>';
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>VAT Return ' + MONTH + ' — ' + b.name + '</title><style>'
    + 'body{font-family:-apple-system,Segoe UI,Roboto,"Noto Sans Ethiopic",sans-serif;color:#1e293b;max-width:900px;margin:0 auto;padding:28px;background:#fff}'
    + 'h1{font-size:1.35rem}h2{font-size:1rem;margin:22px 0 6px;border-bottom:2px solid #e7e2d8;padding-bottom:4px}'
    + '.sub{color:#64748b;font-size:.82rem}table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:6px}'
    + 'th{text-align:left;background:#f4f1ea;padding:6px 8px;border-bottom:2px solid #e7e2d8;font-size:.7rem;text-transform:uppercase}'
    + 'td{padding:5px 8px;border-bottom:1px solid #f0ece2}.r{text-align:right;font-variant-numeric:tabular-nums}'
    + '.box{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:16px 0}'
    + '.tile{border:1px solid #e7e2d8;border-radius:12px;padding:12px;text-align:center;background:#faf8f4}.tile b{display:block;font-size:1.15rem}.tile span{font-size:.68rem;color:#64748b;font-weight:700}'
    + '.net{background:#fef3c7;border-color:#fcd34d}.print-btn{position:fixed;top:14px;right:14px;background:#7c3aed;color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:800;cursor:pointer}'
    + 'footer{margin-top:26px;color:#94a3b8;font-size:.7rem}@media print{.print-btn{display:none}body{padding:0}}'
    + '</style></head><body><button class="print-btn" onclick="window.print()">🖨️ Print / PDF</button>'
    + '<h1>VAT Return Summary — ' + MONTH + '</h1>'
    + '<div class="sub">' + b.org.name + ' · ' + b.name + ' · TIN: <b>' + (b.tinNumber || '—') + '</b>' + (b.vatNumber ? ' · VAT Reg No: <b>' + b.vatNumber + '</b>' : '') + ' · VAT rate 15% (' + (b.vatInclusive ? 'prices VAT-inclusive' : 'VAT added on top') + ')</div>'
    + '<div class="box">'
    + '<div class="tile"><b>' + fmt(taxable) + '</b><span>TAXABLE SUPPLIES (ETB)</span></div>'
    + '<div class="tile"><b>' + fmt(outputVat) + '</b><span>OUTPUT VAT (SALES)</span></div>'
    + '<div class="tile"><b>' + fmt(inputVat) + '</b><span>INPUT VAT (PURCHASES)</span></div>'
    + '<div class="tile net"><b>' + fmt(net) + '</b><span>' + (net >= 0 ? 'NET VAT PAYABLE' : 'VAT CREDIT CARRIED') + '</span></div>'
    + '</div>'
    + '<div class="sub">⏰ Filing & payment deadline: <b>' + due + '</b> (last day of the month following the accounting period).</div>'
    + '<h2>1 · Output — Rent invoices issued (' + invoices.length + ')</h2><table><tr><th>Unit</th><th>Tenant</th><th>Code</th><th>Amount</th><th>VAT (15/115)</th></tr>' + invRows
    + '<tr><th colspan="3">TOTAL</th><th class="r">' + fmt(invoiced) + '</th><th class="r">' + fmt(outputVat) + '</th></tr></table>'
    + '<h2>2 · Input — Expenses (' + expenses.length + ')</h2><table><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Receipt</th><th>Amount</th><th>VAT</th></tr>' + expRows
    + '<tr><th colspan="4">TOTAL</th><th class="r">' + fmt(expTotal) + '</th><th class="r">' + fmt(inputVat) + '</th></tr></table>'
    + '<footer>Prepared by BinaSmart · bina.et · Based on VAT Proclamation No. 1341/2024 (15%). This is a management summary — please verify with your accountant before filing with the Ministry of Revenues.</footer>'
    + '<script src="/static/bina-footer.js?v=9" defer></script></body></html>';
  reply.type('text/html').send(html);
});

// ===== OWNER MGMT: full unit/tenant list =====
fastify.get('/api/owner/:slug/units', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const units = await prisma.unit.findMany({
    where: { buildingId: b.id },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    include: { tenancies: { where: { active: true }, include: { user: true, shop: true, contract: true, invoices: { orderBy: { dueDate: 'desc' }, take: 14 } } } }
  });
  return units.map(u => {
    const t = u.tenancies[0];
    let pay = null, contractDays = null;
    if (t) {
      const now = new Date();
      const mInv = (t.invoices || []).filter(i => i.type === 'RENT' && new Date(i.dueDate).getUTCMonth() === now.getUTCMonth() && new Date(i.dueDate).getUTCFullYear() === now.getUTCFullYear())[0];
      pay = mInv ? (mInv.status === 'PAID' ? 'PAID' : (new Date(mInv.dueDate) < now ? 'OVERDUE' : 'PENDING')) : 'NONE';
      if (t.contract && t.contract.endDate) contractDays = Math.ceil((new Date(t.contract.endDate) - now) / 86400000);
    }
    return { id: u.id, number: u.number, floor: u.floor, areaSqm: u.areaSqm,
      monthlyRent: u.monthlyRent, status: u.status, pay, contractDays,
      tenant: t ? { name: t.shop ? t.shop.name : t.user.fullName, nameAm: t.shop ? t.shop.nameAm : '', phone: t.user.phone,
        contractEnd: t.contract ? t.contract.endDate : null } : null };
  });
});
// ===== OWNER MGMT: edit unit / tenant =====
fastify.post('/api/owner/:slug/unit/:unitId/update', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const { rent, tenantPhone, tenantName } = req.body || {};
  // Owning a building is not owning every unit. Without this, one building's key reached any unit in
  // any building — see test/owner-routes.test.js. 404 rather than 403, so a wrong id is not confirmed.
  const ownB = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId },
    include: { tenancies: { where: { active: true }, include: { user: true, shop: true, contract: true } } } });
  if (!u || !ownB || u.buildingId !== ownB.id) return reply.code(404).send({ error: 'unit_not_found' });
  if (rent !== undefined && rent !== null && rent !== '') {
    const r = parseInt(rent);
    await prisma.unit.update({ where: { id: u.id }, data: { monthlyRent: r } });
    const t = u.tenancies[0];
    if (t && t.contract) await prisma.contract.update({ where: { id: t.contract.id }, data: { monthlyRent: r } });
  }
  const t = u.tenancies[0];
  if (t) {
    if (tenantPhone) await prisma.user.update({ where: { id: t.userId }, data: { phone: tenantPhone } });
    if (tenantPhone && t.shop) await prisma.shop.update({ where: { id: t.shop.id }, data: { phone: tenantPhone } });
    if (tenantName && t.shop) await prisma.shop.update({ where: { id: t.shop.id }, data: { name: tenantName } });
    if (tenantName) await prisma.user.update({ where: { id: t.userId }, data: { fullName: tenantName.slice(0, 60) } });
  }
  await audit(u.buildingId, 'UNIT_UPDATED', u.number + (rent ? ' rent→' + rent : ''), rent ? parseInt(rent) : null);
  return { ok: true };
});
// ===== OWNER MGMT: vacate unit =====
fastify.post('/api/owner/:slug/unit/:unitId/vacate', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  // Owning a building is not owning every unit. Without this, one building's key reached any unit in
  // any building — see test/owner-routes.test.js. 404 rather than 403, so a wrong id is not confirmed.
  const ownB = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId }, include: { tenancies: { where: { active: true } } } });
  if (!u || !ownB || u.buildingId !== ownB.id) return reply.code(404).send({ error: 'unit_not_found' });
  for (const t of u.tenancies) await prisma.tenancy.update({ where: { id: t.id }, data: { active: false, endDate: new Date(), endReason: 'vacated by owner' } });
  await prisma.unit.update({ where: { id: u.id }, data: { status: 'VACANT' } });
  await audit(u.buildingId, 'UNIT_VACATED', u.number);
  return { ok: true };
});
// ===== OWNER: undo mark-paid (mistake fix) =====
fastify.post('/api/owner/:slug/invoice/:id/unpay', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id },
    include: { tenancy: { include: { unit: true, shop: true } } } });
  if (!inv || inv.tenancy.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (inv.status !== 'PAID') return reply.code(400).send({ error: 'not_paid' });
  const status = inv.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
  await prisma.invoice.update({ where: { id: inv.id }, data: { status, paidDate: null } });
  await audit(b.id, 'PAYMENT_REVERSED', (inv.tenancy.shop ? inv.tenancy.shop.name : '') + ' ' + inv.tenancy.unit.number + ' — undo mark-paid, back to ' + status, inv.amount);
  return { ok: true, status };
});

// ===== OWNER: send invoice to tenant (Telegram, else SMS — messaging/delivery.js) =====
fastify.post('/api/owner/:slug/invoice/:id/send', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id },
    include: { tenancy: { include: { unit: true, shop: true, user: true } } } });
  if (!inv || inv.tenancy.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (!NOTIFY_WHITELIST.includes(b.qrSlug)) return reply.code(403).send({ error: 'messaging_not_enabled_for_this_building' });
  const r = await invoiceOps.sendInvoice({ building: b, invoiceId: inv.id, source: 'dashboard-send', actor: 'dashboard' });
  if (!r.ok) return reply.code(404).send({ error: 'not_found' });
  return { ok: true, delivered: r.delivered, channel: r.channel, status: r.status, reason: r.reason || null };
});

// ===== Invoices that did not reach the tenant (design §1.6) =====
// The newest invoice message of each invoice, listed while it is not sent and the invoice is not paid. The dashboard's
// "Send now" calls POST /api/owner/:slug/invoice/:id/send above, which uses the invoice as it is today.
fastify.get('/api/owner/:slug/pending-deliveries', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const rows = await prisma.outboundMessage.findMany({ where: { buildingId: b.id, kind: 'invoice', invoiceId: { not: null } },
    orderBy: { createdAt: 'desc' }, take: 500, select: { invoiceId: true, status: true, errorKind: true, createdAt: true } });
  const latest = new Map();
  for (const m of rows) if (!latest.has(m.invoiceId)) latest.set(m.invoiceId, m);
  // queued: the provider took it but the record write after failed (messaging/delivery.js), so it may have gone — not offered again.
  const stuck = [...latest.values()].filter(m => !['sent', 'delivered', 'queued'].includes(m.status));
  if (!stuck.length) return { invoices: [] };
  const invs = await prisma.invoice.findMany({ where: { id: { in: stuck.map(m => m.invoiceId) }, status: { not: 'PAID' }, tenancy: { unit: { buildingId: b.id } } },
    include: { tenancy: { include: { unit: { select: { number: true } } } } }, orderBy: { dueDate: 'asc' } });
  return { invoices: invs.map(i => { const m = latest.get(i.id); return { id: i.id, unit: i.tenancy.unit.number, type: i.type,
    amount: i.amount + (i.lateFee || 0), dueDate: i.dueDate.toISOString().slice(0, 10), lastTry: m.createdAt.toISOString().slice(0, 10),
    reason: m.errorKind || m.status }; }) };
});

// ===== The owner's Messages tab (owner actions and messaging design §4) =====
// Four read-only routes behind the building's owner key. They answer with counts, dates and unit numbers — never a
// phone number, a user id, a tenancy id, a provider id, an OwnerAccess id, a Telegram id or the id of a pending
// action. The GeezSMS balance is read on the server behind a ten-minute cache (messaging/sms-balance.js): the token
// and the provider's URL never reach the page, and a provider that is down shows "unavailable", not an error.
// None of these routes writes, sends or confirms anything; the only button in the tab is the Invoices tab's own
// Send now, which is POST /api/owner/:slug/invoice/:id/send and is unchanged.
const { makeMessagesStore, makeMessagesView } = require('./messaging/messages-view');
const { makeSmsBalance } = require('./messaging/sms-balance');
const { makeActionHistory } = require('./agents/owner/actions/history');
// Its own parse: the delivery layer's call above is pinned as a literal by test/messaging/server-delivery.test.js.
const smsTiers = parsePriceTiers(process.env.SMS_PRICE_TIERS);
const messagesView = makeMessagesView({ store: makeMessagesStore(prisma) });
const smsBalance = makeSmsBalance({ provider: tenantSms.balance ? { balance: tenantSms.balance } : null, log: m => console.log(m) });
const actionHistory = makeActionHistory({ prisma });

fastify.get('/api/owner/:slug/messages', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const q = req.query || {};
  return messagesView.list({ buildingId: b.id, page: q.page, kind: String(q.kind || ''), month: String(q.month || '') });
});

// One batch by unit. The view looks it up with the building in the where, so a batch id from somewhere else is not
// found — 404 rather than 403, so nothing here tells a caller whether an id exists.
fastify.get('/api/owner/:slug/messages/:batchId', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const one = await messagesView.one({ buildingId: b.id, batchId: req.params.batchId, page: (req.query || {}).page });
  if (!one) return reply.code(404).send({ error: 'not_found' });
  return one;
});

// This month's SMS against the building's limit, with the cost estimate and — only when a token is configured — the
// provider's balance. tenantBuilding() decides real/test exactly as the delivery layer does, so the tab can never say
// live for a building that reaches nobody.
fastify.get('/api/owner/:slug/sms-month', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const tb = tenantBuilding(b);
  const [month, balance] = await Promise.all([
    messagesView.smsMonth({ buildingId: b.id, limit: tb.smsMonthlyLimit, real: tb.real, tenantMode: tenantSms.tenantMode, tiers: smsTiers }),
    smsBalance.read().catch(() => ({ state: 'unavailable' })),
  ]);
  return Object.assign({}, month, { balance });
});

// What became of the actions the owner confirmed in Bini (design §3.3). Roles and counts only — see the list of
// columns this must never read in agents/owner/actions/history.js.
fastify.get('/api/owner/:slug/owner-actions', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  return actionHistory.list({ buildingId: b.id, page: (req.query || {}).page });
});

// ===== Short invoice and receipt links: bina.et/i/<token> (design §1.3) =====
// One invoice or receipt, no login, no tenant name or phone, 60 days. Unknown, malformed and expired tokens get the same
// page. Limited per client address (nginx sets X-Real-IP).
const invoiceLinkRL = hotelLimiter(600000, 30);
fastify.get('/i/:token', async (req, reply) => {
  reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
  if (!invoiceLinkRL(bookIp(req))) return reply.code(429).type('text/html; charset=utf-8').send(renderGonePage({ slow: true }));
  const found = await invoiceLinks.resolve(req.params.token).catch(() => null);
  if (!found) return reply.code(404).type('text/html; charset=utf-8').send(renderGonePage());
  return reply.type('text/html; charset=utf-8').send(renderInvoicePage(found));
});

// ===== SMS delivery reports (the provider's `callback`, design §1.2) =====
// https://bina.et/api/sms/report/<SMS_CALLBACK_SECRET>; anything without the secret gets 404. A report can only move an
// SMS row we sent from queued/sent to delivered or failed; it is trusted for nothing else. The first report after a
// restart logs its field names and types (never values), because GeezSMS does not document the payload.
let smsReportShapeLogged = false;
async function smsReport(req, reply){
  const given = Buffer.from(String(req.params.secret || '')), want = Buffer.from(SMS_CALLBACK_SECRET);
  if (!smsCallbackUrl || given.length !== want.length || !cryptoMod.timingSafeEqual(given, want)) return reply.code(404).send({ error: 'not_found' });
  const body = Object.assign({}, req.query || {}, req.body && typeof req.body === 'object' ? req.body : {});
  if (!smsReportShapeLogged) { smsReportShapeLogged = true; console.log('[sms] delivery report fields: ' + delivery.reportShape(body)); }
  const updated = await delivery.applyDeliveryReport(body).catch(e => { console.error('[sms] report error: ' + errorKindOf(e)); return 0; });
  return { ok: true, updated };
}
fastify.register(async function smsReportRoutes(f){
  // Form posts are parsed inside this plugin only; the rest of the API still refuses them.
  f.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16384 },
    (req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(body))); } catch (e) { done(e); } });
  f.post('/api/sms/report/:secret', smsReport);
  f.get('/api/sms/report/:secret', smsReport);
});

// ===== OWNER: add another building (same owner login) =====
fastify.post('/api/owner/:slug/add-building', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const base = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { name, nameAm, floors, city, subCity } = req.body || {};
  if (!name || !floors) return reply.code(400).send({ error: 'name_and_floors_required' });
  let slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'building';
  let n = 1, s = slug;
  while (await prisma.building.findUnique({ where: { qrSlug: s } })) s = slug + '-' + (++n);
  const b = await prisma.building.create({ data: {
    orgId: base.orgId, ownerId: base.ownerId,
    name: String(name).slice(0, 80), nameAm: nameAm || name,
    city: city || 'Addis Ababa', subCity: subCity || null,
    floors: Math.max(1, parseInt(floors) || 1), qrSlug: s,
    signText: nameAm || name,
    threeD_style: 'modern', threeD_facadeColor: '#a3b3c2', threeD_width: 14, threeD_depth: 11,
    marketplaceEnabled: true
  }});
  await audit(b.id, 'BUILDING_CREATED', name + ' by owner of ' + base.name);
  const key = await ownerKeys.issue(b.id, s, 'add-building');   // shown once, in this response
  return { ok: true, slug: s, key, name: b.name };
});
// ===== OWNER: add a unit (for new/growing buildings) =====
fastify.post('/api/owner/:slug/add-unit', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const { number, floor, rent, areaSqm } = req.body || {};
  if (!number) return reply.code(400).send({ error: 'number_required' });
  const dup = await prisma.unit.findFirst({ where: { buildingId: b.id, number: String(number) } });
  if (dup) return reply.code(409).send({ error: 'unit_number_exists' });
  const u = await prisma.unit.create({ data: {
    buildingId: b.id, number: String(number).slice(0, 20), floor: Math.max(0, parseInt(floor) || 0),
    areaSqm: parseFloat(areaSqm) || 0, monthlyRent: Math.round(parseFloat(rent)) || 0,
    status: 'VACANT', unitType: 'SHOP'
  }});
  await audit(b.id, 'UNIT_CREATED', u.number);
  return { ok: true, id: u.id };
});

// ===== OWNER MGMT: restore last tenant (undo vacate) =====
fastify.post('/api/owner/:slug/unit/:unitId/restore', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  // Owning a building is not owning every unit. Without this, one building's key reached any unit in
  // any building — see test/owner-routes.test.js. 404 rather than 403, so a wrong id is not confirmed.
  const ownB = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId },
    include: { tenancies: { where: { active: false }, orderBy: { endDate: 'desc' }, take: 1, include: { shop: true, user: true } } } });
  if (!u || !ownB || u.buildingId !== ownB.id) return reply.code(404).send({ error: 'unit_not_found' });
  const t = u.tenancies[0];
  if (!t) return reply.code(404).send({ error: 'no_previous_tenant' });
  await prisma.tenancy.update({ where: { id: t.id }, data: { active: true, endDate: null, endReason: null } });
  await prisma.unit.update({ where: { id: u.id }, data: { status: 'OCCUPIED' } });
  await audit(u.buildingId, 'UNIT_RESTORED', u.number + ' ← ' + (t.shop ? t.shop.name : t.user.fullName));
  return { ok: true, restored: t.shop ? t.shop.name : t.user.fullName };
});

// ===== OWNER MGMT: add tenant to vacant unit =====
fastify.post('/api/owner/:slug/unit/:unitId/occupy', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const { name, phone, rent } = req.body || {};
  if (!name || !phone) return reply.code(400).send({ error: 'name_and_phone_required' });
  // Owning a building is not owning every unit. Without this, one building's key reached any unit in
  // any building — see test/owner-routes.test.js. 404 rather than 403, so a wrong id is not confirmed.
  const ownB = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId }, include: { building: true } });
  if (!u || !ownB || u.buildingId !== ownB.id) return reply.code(404).send({ error: 'unit_not_found' });
  let user = await prisma.user.findFirst({ where: { phone } });
  if (!user) user = await prisma.user.create({ data: { orgId: u.building.orgId, phone, fullName: name.slice(0, 60), role: 'TENANT' } });
  const tenancy = await prisma.tenancy.create({ data: { unitId: u.id, userId: user.id, startDate: new Date(), active: true } });
  const r = parseInt(rent) || u.monthlyRent;
  await prisma.contract.create({ data: { tenancyId: tenancy.id, startDate: new Date(), endDate: new Date(Date.now() + 365 * 86400000), monthlyRent: r } });
  await prisma.shop.create({ data: { tenancyId: tenancy.id, name, nameAm: name, category: 'OFFICE', phone, icon: '🏢', avgRating: 0, reviewCount: 0, isOpenNow: true } });
  await prisma.unit.update({ where: { id: u.id }, data: { status: 'OCCUPIED', monthlyRent: r } });
  await audit(u.buildingId, 'TENANT_ADDED', name + ' → ' + u.number, r);
  return { ok: true };
});

// ===== OWNER: update maintenance status =====
fastify.post('/api/admin/maintenance/:id/status', async (req, reply) => {
  const m0 = await prisma.maintenanceRequest.findUnique({ where: { id: req.params.id }, select: { buildingId: true } });
  if (!m0) return reply.code(404).send({ error: 'not found' });
  const mb = m0.buildingId ? await prisma.building.findUnique({ where: { id: m0.buildingId }, select: { qrSlug: true } }) : null;
  if (await authBuildingFail(req, reply, mb ? mb.qrSlug : '__none__')) return;
  const status = (req.body || {}).status;
  const allowed = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'];
  if (!allowed.includes(status)) return reply.code(400).send({ error: 'bad_status' });
  const m = await prisma.maintenanceRequest.update({
    where: { id: req.params.id },
    data: { status, resolvedAt: ['DONE', 'VERIFIED'].includes(status) ? new Date() : null }
  });
  if (m.buildingId) await audit(m.buildingId, 'MAINTENANCE_' + status, m.description ? m.description.slice(0, 60) : m.type);
  return { ok: true, status: m.status };
});

// ===== INVOICE GENERATOR (reusable) — building/invoices.js explains the August/September gap =====
const invoiceGen = require('./building/invoices');
async function generateInvoicesForBuilding(buildingId, when = new Date()) {
  return invoiceGen.generateInvoicesForBuilding(prisma, buildingId, when);
}

// manual trigger (owner)
fastify.post('/api/admin/:slug/generate-invoices', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });
  return generateInvoicesForBuilding(b.id);
});

// mark invoice paid (owner)
fastify.post('/api/admin/invoices/:id/pay', async (req, reply) => {
  const inv0 = await prisma.invoice.findUnique({ where: { id: req.params.id },
    include: { tenancy: { include: { unit: { include: { building: { select: { qrSlug: true } } } } } } } });
  if (!inv0) return reply.code(404).send({ error: 'not found' });
  if (await authBuildingFail(req, reply, inv0.tenancy.unit.building.qrSlug)) return;
  // A second tap re-stamped the payment and sent the tenant a second receipt; now it changes nothing.
  if (inv0.status === 'PAID') return reply.code(409).send({ error: 'already_paid' });
  const { method } = req.body || {};
  // building/invoice-ops.js: PAID only if still unpaid (one statement), the INVOICE_PAID audit, and the e-receipt for a
  // building in NOTIFY_WHITELIST — not awaited by the dashboard.
  const r = await invoiceOps.markPaid({ invoiceId: inv0.id, method, actor: 'dashboard', source: 'receipt' });
  if (!r.ok) return reply.code(r.error === 'already_paid' ? 409 : 404).send({ error: r.error === 'already_paid' ? 'already_paid' : 'not found' });
  if (r.receipt) r.receipt.catch(e => console.error('[receipt] error: ' + errorKindOf(e)));
  return { ok: true, invoice: r.invoice.id };
});

// ===== Owner actions in Bini with ✅ confirm (owner actions design §3) =====
// Bini's prepare tools store a pending action (OwnerAction) and show a preview; only the owner's ✅ — in Telegram
// (ride/binaBot.js) or in the dashboard chat (the two routes below) — runs it, through invoiceOps, the invoice generator
// and the delivery layer. Actions depend on the building's 'owner-actions' switch (ops/owner/actions.js) and NEVER on
// Building.notifyTenants: that switch is for the automatic daily checks only. Messages reach tenants only for a real
// building (NOTIFY_WHITELIST and not a demo, see tenantBuilding); for any other building they are recorded as test.
const { makeOwnerActions } = require('./agents/owner/actions/service');
const { makeActionResolver } = require('./agents/owner/actions/resolve');
const { makeOwnerActionStore, makeActionSwitches } = require('./agents/owner/actions/store');
const actionSwitches = makeActionSwitches(prisma);
const ownerActions = makeOwnerActions({
  store: makeOwnerActionStore(prisma), resolver: makeActionResolver({ prisma }), delivery, access: ownerAccess, switches: actionSwitches, audit,
  ops: {
    tenantBuilding,
    sendBatch: ({ building, kind, text, recipients, actor }) => delivery.sendToTenants({ building: tenantBuilding(building), kind, source: 'owner-action', actor, text, recipients }),
    sendInvoice: async ({ buildingId, invoiceId, actor }) =>
      invoiceOps.sendInvoice({ building: await prisma.building.findUnique({ where: { id: buildingId } }), invoiceId, source: 'owner-action', actor }),
    markPaid: ({ invoiceId, method, actor }) => invoiceOps.markPaid({ invoiceId, method, actor, source: 'owner-action', receipt: 'always' }),
    generateInvoices: (buildingId, month) => invoiceGen.generateInvoicesForBuilding(prisma, buildingId, invoiceGen.monthWhen(month)),
    invoiceLink: (invoiceId, kind) => invoiceLinks.linkFor(invoiceId, kind),
  },
  log: m => console.error(m),
});
ownerTelegram.actions = ownerActions;
cron.schedule('*/5 * * * *', () => { ownerActions.expireOld().catch(e => console.error('[owner-actions] expiry error: ' + errorKindOf(e))); });

// The dashboard chat's ✅ / ⚠️ / ✖. The building comes from the owner key and the slug; the body only says whether ⚠️ was pressed.
// A press that changed nothing — the id was already confirmed, cancelled, refused, failed or expired — answers 409 with
// the card that says so; a press that just ran the action is an ordinary 200 (r.ok). A wrong id is
// the route's 404 below, so nothing here tells a caller whether an id exists.
const ACTION_SETTLED = ['done', 'failed', 'refused', 'cancelled', 'expired'];
function ownerActionReply(reply, r) {
  if (!r.card) return reply.code(r.status === 'gone' ? 404 : 403).send({ error: r.status, reply: r.toast });
  if (!r.ok && ACTION_SETTLED.includes(r.status)) reply.code(409);
  return { ok: r.ok, status: r.status, reply: r.card.text, ownerAction: { id: r.id, status: r.status, buttons: r.card.buttons } };
}
fastify.post('/api/owner/:slug/actions/:id/confirm', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const a = await prisma.ownerAction.findUnique({ where: { id: String(req.params.id) }, select: { buildingId: true } });
  // Ownership, as every sibling route checks it; 404 rather than 403, so a wrong id is not confirmed.
  if (!b || !a || a.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  const verb = (req.body || {}).urgent === true ? 'urgent' : 'confirm';
  return ownerActionReply(reply, await ownerActions.press({ id: String(req.params.id), verb, actor: { channel: 'owner-web', buildingId: b.id } }));
});
fastify.post('/api/owner/:slug/actions/:id/cancel', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const a = await prisma.ownerAction.findUnique({ where: { id: String(req.params.id) }, select: { buildingId: true } });
  if (!b || !a || a.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  return ownerActionReply(reply, await ownerActions.press({ id: String(req.params.id), verb: 'cancel', actor: { channel: 'owner-web', buildingId: b.id } }));
});

// ===== OWNER: full overview =====
fastify.get('/api/owner/:slug/overview', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [units, occupied, openMaint, scans30d, leads, invoices, offers, maintReqs] = await Promise.all([
    prisma.unit.count({ where: { buildingId: b.id } }),
    prisma.unit.count({ where: { buildingId: b.id, status: 'OCCUPIED' } }),
    prisma.maintenanceRequest.count({ where: { buildingId: b.id, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } }),
    prisma.qrScanEvent.count({ where: { buildingId: b.id, createdAt: { gt: new Date(Date.now() - 30 * 86400000) } } }),
    prisma.lead.findMany({
      where: { unit: { buildingId: b.id } },
      include: { unit: { select: { number: true, monthlyRent: true } } },
      orderBy: { createdAt: 'desc' }, take: 20
    }),
    prisma.invoice.findMany({
      where: { tenancy: { unit: { buildingId: b.id } }, dueDate: { gte: monthStart, lt: monthEnd } },
      include: { tenancy: { include: { unit: { select: { number: true } }, shop: { select: { name: true, icon: true } } } } },
      orderBy: { amount: 'desc' }
    }),
    prisma.offer.findMany({
      where: { shop: { tenancy: { unit: { buildingId: b.id } } } },
      include: { shop: { select: { name: true, icon: true } } },
      orderBy: { views: 'desc' }, take: 10
    }),
    prisma.maintenanceRequest.findMany({
      where: { buildingId: b.id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' }, take: 25
    })
  ]);

  // scans per day, last 14 days
  const scansRaw = await prisma.qrScanEvent.findMany({
    where: { buildingId: b.id, createdAt: { gt: new Date(Date.now() - 14 * 86400000) } },
    select: { createdAt: true }
  });
  const scansByDay = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    scansByDay[d.toISOString().slice(0, 10)] = 0;
  }
  scansRaw.forEach(s => {
    const k = s.createdAt.toISOString().slice(0, 10);
    if (k in scansByDay) scansByDay[k]++;
  });

  const paid = invoices.filter(i => i.status === 'PAID');
  const rentAgg = await prisma.unit.aggregate({ where: { buildingId: b.id, status: 'OCCUPIED' }, _sum: { monthlyRent: true } });

  return {
    building: { name: b.name, nameAm: b.nameAm, qrSlug: b.qrSlug },
    stats: {
      units, occupied, vacant: units - occupied,
      occupancyPct: Math.round(occupied / units * 100),
      expectedMonthly: rentAgg._sum.monthlyRent || 0,
      openMaintenance: openMaint, qrScans30d: scans30d
    },
    collection: {
      invoiceCount: invoices.length,
      paidCount: paid.length,
      collected: paid.reduce((s, i) => s + i.amount, 0),
      outstanding: invoices.filter(i => i.status !== 'PAID').reduce((s, i) => s + i.amount, 0)
    },
    invoices: invoices.map(i => ({
      id: i.id, unit: i.tenancy.unit.number,
      shop: i.tenancy.shop ? { name: i.tenancy.shop.name, icon: i.tenancy.shop.icon } : null,
      amount: i.amount, status: i.status, paymentCode: i.paymentCode,
      dueDate: i.dueDate, paidDate: i.paidDate, method: i.method
    })),
    leads: leads.map(l => ({
      id: l.id, name: l.name, phone: l.phone, unit: l.unit.number,
      rent: l.unit.monthlyRent, status: l.status, createdAt: l.createdAt
    })),
    scansByDay,
    bankAccounts: b.bankAccounts || [], tinNumber: b.tinNumber || null,
    maintenance: maintReqs.map(m => ({
      id: m.id, type: m.type, description: m.description,
      name: m.reporterName, phone: m.reporterPhone,
      status: m.status, createdAt: m.createdAt, resolvedAt: m.resolvedAt
    })),
    offers: offers.map(o => ({ title: o.title, views: o.views, claims: o.claims, shop: o.shop.name, icon: o.shop.icon, active: o.active }))
  };
});

// ===== CRON: 1st of every month 06:00 — generate rent invoices for ALL buildings =====
cron.schedule('0 6 1 * *', async () => {
  try {
    // Each building on its own: one failure is reported and the rest still get their invoices.
    const r = await invoiceGen.runMonthlyInvoices(prisma, { log: m => console.log(m) });
    if (r.failed.length) notifyAdmins('⚠️ Monthly rent invoices failed for ' + r.failed.length + ' building(s): '
      + r.failed.map(f => f.name).join(', ') + '. The others were generated. Details: binasmart-api log, [cron] invoice error.').catch(() => {});
  } catch (e) { console.error('[cron] invoice error', e.message); }
}, { timezone: 'Africa/Addis_Ababa' });

// ===== CRON: daily 08:00 — expire old offers =====
// 03:40 Addis, before the first demo departure of the morning. /travel served No trips found
// from 21 August because the sample timetable is three days long and those three days passed. Whole
// days only, demo operators only — see travel/demo-trips.js and test/travel/demo-trips.test.js.
cron.schedule('40 3 * * *', async () => {
  try {
    const r = await rollDemoTrips(prisma, hotelIsDemo);
    if (r.moved) console.log('[cron] demo timetable rolled forward ' + r.days + ' day(s), ' + r.moved + ' trips');
  } catch (e) { console.error('[cron] demo trips', e.message); }
}, { timezone: 'Africa/Addis_Ababa' });

cron.schedule('0 8 * * *', async () => {
  try {
    const r = await prisma.offer.updateMany({ where: { active: true, endsAt: { lt: new Date() } }, data: { active: false } });
    if (r.count) console.log('[cron] expired offers:', r.count);
  } catch (e) { console.error('[cron] offer error', e.message); }
}, { timezone: 'Africa/Addis_Ababa' });

const PORT = process.env.PORT || 4210;
// ===== CHAPA PAYMENTS (BinaSmart) =====
const CHAPA_SECRET = process.env.CHAPA_MODE==='live' ? process.env.CHAPA_SECRET_LIVE : process.env.CHAPA_SECRET_TEST;
const CHAPA_BASE = 'https://api.chapa.co/v1';
async function chapaApi(path, method, body){
  const r = await fetch(CHAPA_BASE+path, { method, headers:{ 'Authorization':'Bearer '+CHAPA_SECRET, 'Content-Type':'application/json' }, body: body?JSON.stringify(body):undefined });
  let j=null; try{ j=await r.json(); }catch(e){}
  return j;
}
function chapaRef(){ return 'bina-'+Date.now()+'-'+Math.random().toString(36).slice(2,8); }
async function markBookingPaid(type, code){
  try{
    if(type==='ride'){ await prisma.ride.updateMany({ where:{ id: code }, data:{ paymentStatus:'paid' } }); return; }
    if(type==='hotel') await prisma.hotelBooking.updateMany({ where:{ code }, data:{ status:'PAID' } });
    else if(type==='event') await prisma.eventTicket.updateMany({ where:{ code }, data:{ status:'PAID' } });
    else if(type==='travel') await prisma.travelTicket.updateMany({ where:{ code }, data:{ status:'PAID' } });
  }catch(e){}
}
async function chapaVerify(ref){
  const v = await chapaApi('/transaction/verify/'+encodeURIComponent(ref),'GET');
  const ok = !!(v && v.status==='success' && v.data && v.data.status==='success');
  if(ok){
    const upd = await prisma.payment.updateMany({ where:{ txRef:ref, status:{ not:'success' } }, data:{ status:'success' } });
    if(upd.count>0){
      const pay = await prisma.payment.findUnique({ where:{ txRef:ref } });
      if(pay && pay.meta){ try{ const m=JSON.parse(pay.meta);
        if(pay.kind==='wallet_topup' && m.walletId){
          await prisma.wallet.update({ where:{ id:m.walletId }, data:{ balance:{ increment: pay.amount } } });
          await prisma.walletTxn.create({ data:{ walletId:m.walletId, type:'topup', amount:pay.amount, ref, note:'Chapa top-up' } });
        }
        if(m.bookingType && m.bookingCode) await markBookingPaid(m.bookingType, m.bookingCode);
      }catch(e){} }
    }
  }
  return { ok, v };
}
// Initialize a payment -> returns checkout_url
fastify.post('/api/pay/init', async (req, reply) => {
  const b = req.body||{};
  const amount = Number(b.amount);
  if(!amount || amount < 1) return reply.code(400).send({ ok:false, error:'valid amount required' });
  if(!CHAPA_SECRET) return reply.code(500).send({ ok:false, error:'gateway not configured' });
  const ref = chapaRef();
  const kind = b.kind==='wallet' ? 'wallet_topup' : 'checkout';
  const nm = (b.name||'BinaSmart Customer').trim();
  const bmeta=(b.bt&&b.bc)?JSON.stringify({bookingType:String(b.bt),bookingCode:String(b.bc)}):null;
  await prisma.payment.create({ data:{ txRef:ref, amount, purpose:(b.purpose||kind).slice(0,120), email:b.email||null, name:nm, phone:b.phone||null, kind, status:'pending', meta:bmeta } });
  const init = await chapaApi('/transaction/initialize','POST',{
    amount:String(amount), currency:'ETB',
    email:(b.email||'customer@bina.et'),
    first_name:(nm.split(' ')[0]||'BinaSmart').slice(0,30),
    last_name:(nm.split(' ').slice(1).join(' ')||'Customer').slice(0,30),
    phone_number:b.phone||undefined,
    tx_ref:ref,
    callback_url:'https://bina.et/api/chapa/webhook',
    return_url:'https://bina.et/pay/callback?ref='+ref,
    'customization[title]':'BinaSmart',
    'customization[description]':(b.purpose||'BinaSmart payment').slice(0,60)
  });
  if(init && init.status==='success' && init.data && init.data.checkout_url) return { ok:true, checkout_url:init.data.checkout_url, tx_ref:ref };
  return reply.code(502).send({ ok:false, error:(init&&init.message)||'initialize failed', detail:init });
});
// Webhook (server-to-server) -> verify + mark paid
fastify.post('/api/chapa/webhook', async (req, reply) => {
  try{ const b=req.body||{}; const ref=b.tx_ref||b.trx_ref||b.reference||(req.query&&req.query.ref); if(ref) await chapaVerify(ref); if(ref && cinema && /^bina-cin-/.test(String(ref))) await cinema.confirmChapa(ref); if(ref && watch && /^bina-w-/.test(String(ref))) await watch.confirmChapa(ref); }catch(e){}
  reply.send({ received:true });
});
// Return URL (user redirected back)
fastify.get('/pay/callback', async (req, reply) => {
  const ref=req.query.ref; let paid=false, amt='', purpose='';
  if(ref==='wallet'){ paid=req.query.ok==='1'; amt=req.query.amt||''; purpose='Wallet payment'; }
  else if(ref){ try{ const r=await chapaVerify(ref); paid=r.ok; const p=await prisma.payment.findUnique({ where:{ txRef:ref } }); if(p){ amt=p.amount; purpose=p.purpose||''; } }catch(e){} }
  const ok=paid;
  const body='<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+(ok?'ክፍያ ተሳክቷል':'ክፍያ በመጠባበቅ ላይ')+' · BinaSmart</title>'+
  ''+
  '<style>*{margin:0;box-sizing:border-box}body{font-family:\'Plus Jakarta Sans\',\'Noto Sans Ethiopic\',sans-serif;background:#f6faf9;color:#0b2a26;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.c{background:#fff;border:1.5px solid #e2ece9;border-radius:24px;padding:34px 26px;max-width:400px;text-align:center;box-shadow:0 20px 50px -26px rgba(11,42,38,.4)}.ic{width:84px;height:84px;border-radius:50%;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;font-size:44px;color:#fff;background:'+(ok?'linear-gradient(135deg,#059669,#0aa88f)':'linear-gradient(135deg,#d97706,#f59e0b)')+'}h1{font-size:22px;font-weight:800}p{color:#5c7371;font-size:14px;margin-top:8px}.amt{font-size:30px;font-weight:800;color:#057461;margin:14px 0}a{display:inline-block;margin-top:20px;background:linear-gradient(135deg,#0b2a26,#068c78);color:#fff;font-weight:800;border-radius:999px;padding:13px 28px;text-decoration:none}</style></head>'+
  '<body><div class="c"><div class="ic">'+(ok?'✓':'⏳')+'</div><h1 class="am">'+(ok?'ክፍያ ተሳክቷል!':'ክፍያ በመጠባበቅ ላይ ነው')+'</h1>'+(amt?'<div class="amt">ETB '+amt+'</div>':'')+'<p class="am">'+(ok?('የ'+ (purpose||'BinaSmart') +' ክፍያዎ ተከፍሏል። እናመሰግናለን!'):'ክፍያዎ ገና አልተረጋገጠም። ካጠናቀቁ ትንሽ ቆይተው ይሞክሩ።')+'</p><p style="font-size:11px;margin-top:10px">Ref: '+(ref||'')+'</p><a href="/" class="am">← ወደ BinaSmart</a></div><script src="/static/bina-footer.js?v=9" defer></script></body></html>';
  reply.type('text/html').send(body);
});
// Test checkout page
fastify.get('/pay', async (req, reply) => {
  const amt=req.query.amount||''; const purpose=req.query.for||''; const bt=req.query.bt||''; const bc=req.query.bc||'';
  const locked = !!(amt && bc);
  const esc=v=>String(v).replace(/"/g,'&quot;');
  const body='<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ክፍያ · Pay · BinaSmart</title>'+
  ''+
  '<style>*{margin:0;box-sizing:border-box}body{font-family:\'Plus Jakarta Sans\',\'Noto Sans Ethiopic\',sans-serif;background:#f6faf9;color:#0b2a26;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.c{background:#fff;border:1.5px solid #e2ece9;border-radius:24px;padding:26px 22px;max-width:420px;width:100%;box-shadow:0 20px 50px -26px rgba(11,42,38,.4)}h1{font-size:21px;font-weight:800;display:flex;align-items:center;gap:8px}.sub{color:#5c7371;font-size:13px;margin:6px 0 16px}.amtbox{background:#f3faf7;border:1.5px solid #dbeee8;border-radius:16px;padding:14px 16px;margin-bottom:6px}.amtbox .l{font-size:11px;color:#5c7371;font-weight:800}.amtbox .v{font-size:26px;font-weight:800;color:#057461}label{font-size:12px;font-weight:800;display:block;margin:12px 0 5px}input{width:100%;border:1.5px solid #e2ece9;border-radius:12px;padding:12px 14px;font-size:15px;font-family:inherit;outline:none}input:focus{border-color:#068c78}.btn{width:100%;border:0;border-radius:14px;padding:15px;margin-top:12px;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit;color:#fff}.chapa{background:linear-gradient(135deg,#0b2a26,#068c78)}.wallet{background:linear-gradient(135deg,#059669,#0aa88f)}.or{text-align:center;color:#94a3b8;font-size:12px;margin:12px 0 2px}.err{color:#dc2626;font-size:13px;margin-top:10px;text-align:center;min-height:16px}.badge{display:inline-block;background:#fef3c7;color:#92700a;border:1px solid #f2d98a;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:800;margin-top:12px}.pw{text-align:center;font-size:11px;color:#94a3b8;margin-top:12px}</style></head>'+
  '<body><div class="c"><h1 class="am">💳 ክፍያ</h1><div class="sub am">'+(purpose?esc(purpose):'BinaSmart')+(bc?(' · #'+esc(bc)):'')+'</div>'+
  (locked?('<div class="amtbox am"><div class="l">የሚከፈል · Amount</div><div class="v">ETB '+esc(amt)+'</div></div>'):'<label class="am">የክፍያ መጠን (ETB)</label><input id="amount" type="number" min="1" value="'+esc(amt)+'" placeholder="100">')+
  '<label class="am">ስም</label><input id="name" placeholder="ስም">'+
  '<label class="am">ኢሜይል (option)</label><input id="email" type="email" placeholder="you@email.com">'+
  '<label class="am">ስልክ</label><input id="phone" placeholder="09...">'+
  '<button class="btn chapa am" id="cbtn" onclick="payChapa()">💳 በ Chapa ይክፈሉ →</button>'+
  '<div class="or am">— ወይም —</div>'+
  '<button class="btn wallet am" id="wbtn" onclick="payWallet()">👛 ከ ዋሌት ይክፈሉ</button>'+
  '<div class="err am" id="err"></div><div style="text-align:center"><span class="badge">🧪 TEST MODE — Chapa</span></div><div class="pw">Powered by Chapa · BinaSmart</div></div>'+
  '<script>var AMT='+(locked?JSON.stringify(Number(amt)):'null')+',BT='+JSON.stringify(bt)+',BC='+JSON.stringify(bc)+',PURPOSE='+JSON.stringify(purpose)+';'+
  'function amount(){return AMT!=null?AMT:Number((document.getElementById("amount")||{}).value||0);}'+
  'function body(){return{amount:amount(),name:document.getElementById("name").value,email:document.getElementById("email").value,phone:document.getElementById("phone").value,purpose:PURPOSE,bt:BT,bc:BC};}'+
  'async function payChapa(){var e=document.getElementById("err");e.textContent="";var amt=amount();if(!amt||amt<1){e.textContent="ትክክለኛ መጠን ያስገቡ";return;}var b=document.getElementById("cbtn");b.disabled=true;b.textContent="…";try{var r=await fetch("/api/pay/init",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body())});var j=await r.json();if(j.ok&&j.checkout_url){location.href=j.checkout_url;}else{e.textContent=(j.error||"አልተሳካም");b.disabled=false;b.textContent="💳 በ Chapa ይክፈሉ →";}}catch(x){e.textContent="ስህተት";b.disabled=false;b.textContent="💳 በ Chapa ይክፈሉ →";}}'+
  'async function payWallet(){var e=document.getElementById("err");e.textContent="";var amt=amount();if(!amt||amt<1){e.textContent="ትክክለኛ መጠን ያስገቡ";return;}var tok=localStorage.getItem("bina_wallet_tok");if(!tok){if(confirm("ወደ ዋሌትዎ መግባት ያስፈልጋል። አሁን ይግቡ?"))location.href="/wallet";return;}var b=document.getElementById("wbtn");b.disabled=true;b.textContent="…";try{var r=await fetch("/api/wallet/pay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:tok,amount:amt,bt:BT,bc:BC,purpose:PURPOSE})});var j=await r.json();if(j.ok){location.href="/pay/callback?ref=wallet&ok=1&amt="+amt;}else if(r.status===402){e.textContent="በ ዋሌትዎ በቂ ገንዘብ የለም። ";if(confirm("ገንዘብ ይሙሉ?"))location.href="/wallet";b.disabled=false;b.textContent="👛 ከ ዋሌት ይክፈሉ";}else if(r.status===401){location.href="/wallet";}else{e.textContent=(j.error||"አልተሳካም");b.disabled=false;b.textContent="👛 ከ ዋሌት ይክፈሉ";}}catch(x){e.textContent="ስህተት";b.disabled=false;b.textContent="👛 ከ ዋሌት ይክፈሉ";}}'+
  '</script><script src="/static/bina-footer.js?v=9" defer></script></body></html>';
  reply.type('text/html').send(body);
});

const WALLET_HTML = `<!DOCTYPE html>
<html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>የኔ ዋሌት · BinaSmart Wallet</title>
<link rel="icon" href="/icon-32.png">
<style>
*{margin:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',sans-serif;background:#f6faf9;color:#0b2a26;min-height:100vh;padding:18px}
.am{font-family:'Noto Sans Ethiopic','Plus Jakarta Sans',sans-serif}
.wrap{max-width:440px;margin:0 auto}
.top{display:flex;align-items:center;gap:10px;padding:6px 2px 16px}
.logo{font-weight:800;font-size:18px}.logo b{color:#068c78}
.top a{margin-left:auto;font-size:13px;font-weight:700;color:#5c7371;text-decoration:none}
.card{background:#fff;border:1.5px solid #e2ece9;border-radius:22px;padding:22px 20px;box-shadow:0 16px 40px -24px rgba(11,42,38,.4)}
h1{font-size:20px;font-weight:800;display:flex;align-items:center;gap:8px}
.sub{color:#5c7371;font-size:13px;margin:5px 0 16px}
label{font-size:12px;font-weight:800;display:block;margin:12px 0 5px}
input{width:100%;border:1.5px solid #e2ece9;border-radius:12px;padding:12px 14px;font-size:15px;font-family:inherit;outline:none}
input:focus{border-color:#068c78}
.btn{width:100%;border:0;border-radius:14px;padding:15px;margin-top:18px;background:linear-gradient(135deg,#0b2a26,#068c78);color:#fff;font-weight:800;font-size:16px;cursor:pointer;font-family:inherit}
.btn.g{background:linear-gradient(135deg,#059669,#0aa88f)}
.tabs{display:flex;gap:8px;margin-bottom:6px}
.tab{flex:1;text-align:center;padding:10px;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;border:1.5px solid #e2ece9;background:#fff;color:#5c7371}
.tab.on{background:#068c78;color:#fff;border-color:#068c78}
.err{color:#dc2626;font-size:13px;margin-top:10px;text-align:center;min-height:16px}
.bal{background:linear-gradient(135deg,#068c78,#0aa88f);border-radius:20px;padding:22px;color:#fff;position:relative;overflow:hidden}
.bal::after{content:'👛';position:absolute;right:-6px;bottom:-14px;font-size:90px;opacity:.15}
.bal .lb{font-size:12px;opacity:.9;font-weight:700}
.bal .amt{font-size:38px;font-weight:800;margin-top:2px;letter-spacing:-1px}
.bal .ph{font-size:12px;opacity:.85;margin-top:8px}
.acts{display:flex;gap:10px;margin-top:14px}
.acts .btn{margin-top:0}
.txns{margin-top:20px}
.txns h3{font-size:14px;font-weight:800;margin-bottom:8px}
.tx{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #eef4f2}
.tx .i{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.tx.topup .i{background:#ecfdf5;color:#059669}.tx.spend .i{background:#fef2f2;color:#dc2626}
.tx .m{flex:1}.tx .m b{font-size:14px}.tx .m span{font-size:11px;color:#94a3b8;display:block}
.tx .a{font-weight:800;font-size:15px}.tx.topup .a{color:#059669}.tx.spend .a{color:#dc2626}
.empty{text-align:center;color:#94a3b8;font-size:13px;padding:20px}
.badge{display:inline-block;background:#fef3c7;color:#92700a;border:1px solid #f2d98a;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:800;margin-top:14px}
.hide{display:none}
</style></head>
<body><div class="wrap">
<div class="top"><div class="logo am">🏢 Bina<b>Smart</b></div><a href="/">← መነሻ</a></div>

<div id="authView" class="card hide">
  <h1 class="am">👛 የኔ ዋሌት</h1>
  <div class="sub am">ገንዘብ ይሙሉ · ይቆጥቡ · ይክፈሉ — በሞባይልዎ</div>
  <div class="tabs am"><div class="tab on" id="tabLogin" onclick="setMode('login')">ግባ</div><div class="tab" id="tabReg" onclick="setMode('register')">አዲስ ይክፈቱ</div></div>
  <div id="nameWrap" class="hide"><label class="am">ስም</label><input id="wname" placeholder="ስም"></div>
  <label class="am">ስልክ ቁጥር</label><input id="wphone" inputmode="tel" placeholder="09...">
  <label class="am">የሚስጥር ቁጥር (PIN · 4-6 አሃዝ)</label><input id="wpin" inputmode="numeric" type="password" maxlength="6" placeholder="••••">
  <button class="btn am" id="authBtn" onclick="doAuth()">ግባ →</button>
  <div class="err am" id="authErr"></div>
  <div style="text-align:center"><span class="badge">🧪 TEST MODE — Chapa</span></div>
</div>

<div id="dashView" class="hide">
  <div class="bal am"><div class="lb">ቀሪ ሂሳብ · Balance</div><div class="amt" id="balAmt">ETB 0.00</div><div class="ph" id="balPh"></div></div>
  <div class="acts"><button class="btn g am" onclick="topup()">＋ ገንዘብ ሙላ</button><button class="btn am" style="background:#eef4f2;color:#0b2a26" onclick="logout()">ውጣ</button></div>
  <div class="txns"><h3 class="am">የግብይት ታሪክ</h3><div id="txList"></div></div>
</div>

<script>
var API='/api/wallet', mode='login', T=localStorage.getItem('bina_wallet_tok')||'';
function $(id){return document.getElementById(id);}
function setMode(m){mode=m;$('tabLogin').classList.toggle('on',m==='login');$('tabReg').classList.toggle('on',m==='register');$('nameWrap').classList.toggle('hide',m!=='register');$('authBtn').textContent=(m==='login'?'ግባ →':'ዋሌት ክፈት →');$('authErr').textContent='';}
function money(n){return 'ETB '+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
async function doAuth(){
  var e=$('authErr');e.textContent='';var b=$('authBtn');
  var phone=$('wphone').value.trim(),pin=$('wpin').value.trim(),name=$('wname').value.trim();
  if(!phone||!/^[0-9]{4,6}$/.test(pin)){e.textContent='ስልክ እና 4-6 አሃዝ PIN ያስገቡ';return;}
  b.disabled=true;
  try{
    var r=await fetch(API+'/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone,pin:pin,name:name})});
    var j=await r.json();
    if(j.ok&&j.token){T=j.token;localStorage.setItem('bina_wallet_tok',T);showDash();}
    else{e.textContent=(j.error==='wallet_exists'?'ዋሌት አለ — ይግቡ':(j.error==='wrong_phone_or_pin'?'ስልክ ወይም PIN ተሳስቷል':(j.error||'አልተሳካም')));}
  }catch(x){e.textContent='ስህተት';}
  b.disabled=false;
}
async function showDash(){
  var r=await fetch(API+'/me?token='+encodeURIComponent(T));
  if(r.status===401){logout();return;}
  var j=await r.json();
  $('authView').classList.add('hide');$('dashView').classList.remove('hide');
  $('balAmt').textContent=money(j.balance);$('balPh').textContent=(j.name?j.name+' · ':'')+j.phone;
  var L=$('txList');
  if(!j.txns||!j.txns.length){L.innerHTML='<div class="empty am">እስካሁን ግብይት የለም</div>';}
  else{L.innerHTML=j.txns.map(function(t){var up=t.type==='topup';return '<div class="tx '+(up?'topup':'spend')+'"><div class="i">'+(up?'＋':'−')+'</div><div class="m"><b class="am">'+(t.note||(up?'ገንዘብ ሙላ':'ክፍያ'))+'</b><span>'+new Date(t.at).toLocaleString()+'</span></div><div class="a">'+(up?'+':'-')+money(t.amount).replace('ETB ','')+'</div></div>';}).join('');}
}
async function topup(){
  var a=prompt('ምን ያህል ብር ይሙሉ? (ETB)','200');if(!a)return;var amt=Number(a);if(!amt||amt<1){alert('ትክክለኛ መጠን ያስገቡ');return;}
  var r=await fetch(API+'/topup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:T,amount:amt})});
  var j=await r.json();
  if(j.ok&&j.checkout_url){window.location.href=j.checkout_url;}else{alert(j.error||'አልተሳካም');}
}
function logout(){localStorage.removeItem('bina_wallet_tok');T='';$('dashView').classList.add('hide');$('authView').classList.remove('hide');setMode('login');}
(async function(){
  var u=new URL(location.href);var tref=u.searchParams.get('topup');
  if(tref){try{await fetch('/api/pay/verify?ref='+encodeURIComponent(tref));}catch(e){} history.replaceState({},'','/wallet');}
  if(T){showDash();}else{$('authView').classList.remove('hide');setMode('login');}
})();
</script>
</div><script src="/static/bina-footer.js?v=9" defer></script></body></html>`;

// ===== BINASMART WALLET (phone + PIN, Chapa top-up) =====
function walletTok(){ return cryptoMod.randomBytes(24).toString('hex'); }
async function walletByToken(t){ if(!t) return null; try{ return await prisma.wallet.findFirst({ where:{ token:String(t) } }); }catch(e){ return null; } }
fastify.get('/api/pay/verify', async (req, reply) => {
  const ref=req.query.ref; if(!ref) return { ok:false };
  try{ const r=await chapaVerify(ref); return { ok:r.ok }; }catch(e){ return { ok:false }; }
});
fastify.post('/api/wallet/register', async (req, reply) => {
  const { phone, pin, name } = req.body||{};
  const ph=normPhone(phone||'');
  if(!ph || !/^[0-9]{4,6}$/.test(String(pin||''))) return reply.code(400).send({ error:'phone + 4–6 digit PIN required' });
  const ex=await prisma.wallet.findUnique({ where:{ phone:ph } });
  if(ex) return reply.code(409).send({ error:'wallet_exists' });
  const tok=walletTok();
  const w=await prisma.wallet.create({ data:{ phone:ph, pinHash:hashPw(String(pin)), name:(name||'').slice(0,60)||null, token:tok } });
  return { ok:true, token:tok, balance:w.balance, name:w.name, phone:w.phone };
});
fastify.post('/api/wallet/login', async (req, reply) => {
  const { phone, pin } = req.body||{};
  const w=await prisma.wallet.findUnique({ where:{ phone:normPhone(phone||'') } });
  if(!w || !checkPw(String(pin||''), w.pinHash)) return reply.code(401).send({ error:'wrong_phone_or_pin' });
  const tok=walletTok(); await prisma.wallet.update({ where:{ id:w.id }, data:{ token:tok } });
  return { ok:true, token:tok, balance:w.balance, name:w.name, phone:w.phone };
});
fastify.get('/api/wallet/me', async (req, reply) => {
  const w=await walletByToken(req.query.token); if(!w) return reply.code(401).send({ error:'login_required' });
  const txns=await prisma.walletTxn.findMany({ where:{ walletId:w.id }, orderBy:{ createdAt:'desc' }, take:25 });
  return { ok:true, balance:w.balance, name:w.name, phone:w.phone, txns:txns.map(t=>({ type:t.type, amount:t.amount, note:t.note, at:t.createdAt })) };
});
fastify.post('/api/wallet/topup', async (req, reply) => {
  const { token, amount } = req.body||{};
  const w=await walletByToken(token); if(!w) return reply.code(401).send({ error:'login_required' });
  const amt=Number(amount); if(!amt || amt<1) return reply.code(400).send({ error:'valid_amount_required' });
  if(!CHAPA_SECRET) return reply.code(500).send({ error:'gateway_not_configured' });
  const ref=chapaRef();
  await prisma.payment.create({ data:{ txRef:ref, amount:amt, purpose:'Wallet top-up', name:w.name, phone:w.phone, kind:'wallet_topup', status:'pending', meta:JSON.stringify({ walletId:w.id }) } });
  const init=await chapaApi('/transaction/initialize','POST',{ amount:String(amt), currency:'ETB', email:'wallet@bina.et', first_name:(w.name||'BinaSmart').split(' ')[0].slice(0,30), last_name:'Wallet', phone_number:w.phone, tx_ref:ref, callback_url:'https://bina.et/api/chapa/webhook', return_url:'https://bina.et/wallet?topup='+ref, 'customization[title]':'BinaSmart', 'customization[description]':'Wallet top-up' });
  if(init && init.status==='success' && init.data && init.data.checkout_url) return { ok:true, checkout_url:init.data.checkout_url, tx_ref:ref };
  return reply.code(502).send({ ok:false, error:(init&&init.message)||'init_failed' });
});
fastify.post('/api/wallet/pay', async (req, reply) => {
  const { token, amount, bt, bc, purpose } = req.body||{};
  const w=await walletByToken(token); if(!w) return reply.code(401).send({ error:'login_required' });
  const amt=Number(amount); if(!amt || amt<1) return reply.code(400).send({ error:'valid_amount_required' });
  if(w.balance < amt) return reply.code(402).send({ error:'insufficient_balance', balance:w.balance });
  const uw=await prisma.wallet.updateMany({ where:{ id:w.id, balance:{ gte:amt } }, data:{ balance:{ decrement:amt } } });
  if(!uw.count) return reply.code(402).send({ error:'insufficient_balance', balance:w.balance });
  await prisma.walletTxn.create({ data:{ walletId:w.id, type:'spend', amount:amt, note:(purpose||'ክፍያ').slice(0,80) } });
  if(bt&&bc){ try{ await markBookingPaid(String(bt),String(bc)); }catch(e){} }
  const nw=await prisma.wallet.findUnique({ where:{ id:w.id } });
  return { ok:true, balance:nw.balance };
});
fastify.get('/wallet', async (req, reply) => reply.type('text/html').send(WALLET_HTML));

// ===== BinaSmart Ride (Phase 1: rider app + concierge) =====
const rideMod = require('./ride')(fastify, {
  prisma, sendTg, OWNER_KEY,
  OWNER_CHAT: '8096525984',
  ROUTER_URL: process.env.ROUTER_URL || 'http://127.0.0.1:8989',
  askBini: callBini, // Bini's LLM adapter, for /api/ride/intent (Ask Bini)
  ownerTelegram, // Bini for owners in @bina_smart_bot (agents/owner/access.js)
  tenantTelegram: tenantLink, // tenant notices: /start tenant_<slug> and /stop (messaging/tenant-link.js)
  BASE_URL: 'https://bina.et'
});

// Daily group invite: /pool/g/<id>. Same 3 KB idea: OG preview, one Join button.
fastify.get('/pool/g/:id', async (req, reply) => {
  const id = String(req.params.id).replace(/[^a-z0-9]/gi, '').slice(0, 40);
  const g = id && rideMod.groups ? await rideMod.groups.pub(id).catch(() => null) : null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
  if (!g || g.status !== 'active') return reply.code(404).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BinaPool</title><body style="font-family:system-ui;padding:24px;background:#F8FAFC;color:#081120"><h2>ቡድኑ አልተገኘም · Group not found or closed</h2><p><a href="/ride?pool=1" style="color:#009688;font-weight:800">ጋራ ጉዞ ይክፈቱ · Open BinaPool →</a></p></body>');
  const title = g.name + ' · ' + g.daysLabel + ' ' + g.time + ' · ' + (g.full ? 'full' : (g.seats - g.members) + ' seats left');
  const desc = '🔁 ቋሚ ቡድን · Daily group: ' + g.from.label + ' → ' + g.to.label + ', ' + g.daysLabel + ' at ' + g.time + '. Same car every day, pay per seat in cash. ' + g.members + '/' + g.seats + ' members.';
  const html = '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:image" content="https://bina.et/static/og-pool.png"><meta property="og:url" content="https://bina.et/pool/g/' + esc(g.id) + '"><meta name="theme-color" content="#009688">'
    + '<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F8FAFC;color:#081120;padding:18px}.c{max-width:420px;margin:0 auto;background:#fff;border:1px solid rgba(8,17,32,.08);border-radius:20px;padding:18px}.k{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.1em;color:#0B4FB3;background:rgba(0,153,255,.12);border-radius:999px;padding:5px 10px}h1{font-size:22px;margin:10px 0 4px;line-height:1.2}p{margin:6px 0;color:#475569;font-size:14px}.t{font-size:30px;font-weight:900;color:#009688;margin:10px 0 0}.t small{display:block;font-size:12px;color:#64748B;font-weight:600}.b{display:block;text-align:center;margin-top:14px;padding:15px;border-radius:16px;background:linear-gradient(135deg,#00C896,#009688);color:#fff;font-weight:800;text-decoration:none;font-size:16px}.g{background:#eef2f7;color:#081120}.w{background:#fff3f7;border:1px solid #f9a8d4;border-radius:12px;padding:8px 10px;font-size:13px;margin-top:8px}</style></head><body><div class="c">'
    + '<span class="k">🔁 ቋሚ ቡድን · DAILY GROUP</span><h1>' + esc(g.name) + '</h1><p>' + esc(g.from.label) + ' → ' + esc(g.to.label) + '</p>'
    + (g.womenOnly ? '<div class="w">👩 ሴቶች ብቻ · Women only</div>' : '')
    + '<div class="t">' + esc(g.daysLabel) + ' · ' + esc(g.time) + '<small>' + g.members + '/' + g.seats + ' members · ' + esc(g.names.join(', ')) + ' · organised by ' + esc(g.organizer) + '</small></div>'
    + '<p>Same car every day at the same time. Your seat is held automatically; tap "skip today" when you cannot come. Pay your seat to the driver in cash.</p>'
    + (g.full ? '<a class="b g" href="/ride?pool=1">ቡድኑ ሞልቷል · Group is full — find another</a>' : '<a class="b" href="/ride?group=' + esc(g.id) + '">ተቀላቀል · Join this daily group</a><a class="b g" href="https://t.me/bina_smart_bot?startapp=g_' + esc(g.id) + '">✈️ በቴሌግራም · Open in Telegram</a>')
    + '</div></body></html>';
  return html;
});

// BinaPool share link: /pool/<id>. A 3 KB page with real OG tags (WhatsApp / Telegram previews show the
// group and its price) and one button into the app. No fonts, no scripts: it must open on 2G.
fastify.get('/pool/:id', async (req, reply) => {
  const id = String(req.params.id).replace(/[^a-z0-9]/gi, '').slice(0, 40);
  const g = id && rideMod.pool ? await rideMod.pool.pub(id).catch(() => null) : null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
  if (!g) return reply.code(404).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BinaPool</title><body style="font-family:system-ui;padding:24px;background:#F8FAFC;color:#081120"><h2>ቡድኑ አልተገኘም · Group not found</h2><p><a href="/ride?pool=1" style="color:#009688;font-weight:800">ጋራ ጉዞ ይክፈቱ · Open BinaPool →</a></p></body>');
  const who = g.riders.length ? g.riders.join(', ') : 'BinaPool';
  const left = g.seats - g.filled;
  const title = (g.open ? who + ' · ' + g.name + ' · ' + left + ' seats left · ' + g.seatIfJoinEtb + ' ETB' : g.name + ' · this car has left');
  const desc = g.open ? 'ጋራ ጉዞ · Share the car, pay per seat. ' + g.filled + '/' + g.seats + ' in the car, ' + g.seatIfJoinEtb + ' ETB if you join, ' + g.seatIfFullEtb + ' ETB when full. Leaves in ' + Math.ceil(g.leavesInS / 60) + ' min. Cash to the driver.' : 'Open BinaPool to find or start another group near you.';
  const html = '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>'
    + '<meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:image" content="https://bina.et/static/og-pool.png"><meta property="og:url" content="https://bina.et/pool/' + esc(g.id) + '"><meta name="theme-color" content="#009688">'
    + '<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#F8FAFC;color:#081120;padding:18px}.c{max-width:420px;margin:0 auto;background:#fff;border:1px solid rgba(8,17,32,.08);border-radius:20px;padding:18px}.k{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.1em;color:#009688;background:rgba(0,200,150,.12);border-radius:999px;padding:5px 10px}h1{font-size:22px;margin:10px 0 4px;line-height:1.2}p{margin:6px 0;color:#475569;font-size:14px}.pr{font-size:34px;font-weight:900;color:#009688;margin:10px 0 0}.pr small{display:block;font-size:12px;color:#64748B;font-weight:600}.b{display:block;text-align:center;margin-top:14px;padding:15px;border-radius:16px;background:linear-gradient(135deg,#00C896,#009688);color:#fff;font-weight:800;text-decoration:none;font-size:16px}.g{background:#eef2f7;color:#081120}.w{background:#fff3f7;border:1px solid #f9a8d4;border-radius:12px;padding:8px 10px;font-size:13px;margin-top:8px}</style></head><body><div class="c">'
    + '<span class="k">👥 ጋራ ጉዞ · BINAPOOL</span><h1>' + esc(g.nameAm) + '</h1><p>' + esc(g.name) + (g.kind === 'custom' ? ' · from ' + esc(g.board.label) : ' · board at ' + esc(g.board.label)) + '</p>'
    + (g.womenOnly ? '<div class="w">👩 ሴቶች ብቻ · Women only</div>' : '')
    + (g.open ? '<p>' + esc(who) + ' · ' + g.filled + '/' + g.seats + ' በመኪናው · leaves in ' + Math.ceil(g.leavesInS / 60) + ' min' + (g.driverWaiting ? ' · 🚗 driver waiting' : '') + '</p><div class="pr">' + g.seatIfJoinEtb + ' ETB<small>ከተቀላቀሉ · if you join · ' + g.seatIfFullEtb + ' ETB when full · cash to the driver</small></div>'
      + '<a class="b" href="/ride?join=' + esc(g.id) + '">ተቀላቀል · Join this group</a><a class="b g" href="https://t.me/bina_smart_bot?startapp=j_' + esc(g.id) + '">✈️ በቴሌግራም · Open in Telegram</a>'
      : '<p>መኪናው ተነስቷል · This car has already left.</p><a class="b" href="/ride?pool=1">ሌላ ቡድን ፈልግ · Find another group</a>')
    + '</div></body></html>';
  return html;
});

// ===== telebirr (Ethio Telecom SuperApp) payments: web checkout + in-app (mini app). Sandbox until TELEBIRR_MODE=live =====
const telebirrClient = require('./payments/telebirr').makeTelebirr({ mode: process.env.TELEBIRR_MODE || 'sandbox', baseUrl: process.env.TELEBIRR_BASE_URL, webBaseUrl: process.env.TELEBIRR_WEB_BASE_URL,
  fabricAppId: process.env.TELEBIRR_FABRIC_APP_ID, appSecret: process.env.TELEBIRR_APP_SECRET, merchantAppId: process.env.TELEBIRR_MERCHANT_APP_ID, merchantCode: process.env.TELEBIRR_MERCHANT_CODE,
  privateKey: process.env.TELEBIRR_PRIVATE_KEY, spPublicKey: process.env.TELEBIRR_SP_PUBLIC_KEY });
let cinemaRef = null; // set right after the cinema module mounts (settle needs its ticket helpers)
const telebirrRoutes = require('./payments/telebirrRoutes')(fastify, { telebirr: telebirrClient, prisma, BASE_URL: 'https://bina.et', OWNER_KEY,
  // what is being paid for: amount comes from OUR record, never from the client
  resolve: async (type, code) => {
    if (type === 'cinema') { const t = await prisma.ticket.findUnique({ where: { code: String(code).toUpperCase() }, include: { show: { include: { event: true } } } }); if (!t) return null;
      return { payable: t.status === 'RESERVED', reason: t.status === 'RESERVED' ? null : 'ticket_' + t.status.toLowerCase(), amountEtb: t.total, title: 'Ticket ' + (t.show && t.show.event ? (t.show.event.titleAm || t.show.event.title) : '') + ' ' + (t.seats || []).join(' '), redirectPath: '/ticket/' + t.code + '?paid=1', phone: t.phone, name: t.name }; }
    if (type === 'ride') { const r = await prisma.ride.findUnique({ where: { id: String(code) } }); if (!r) return null;
      return { payable: r.paymentStatus !== 'paid' && ['completed', 'arrived', 'on_trip', 'assigned'].includes(r.status), reason: r.paymentStatus === 'paid' ? 'already_paid' : 'ride_' + r.status, amountEtb: r.fareEtb, title: 'BinaRide fare', redirectPath: '/ride?id=' + r.id + '&paid=1', phone: r.riderPhone, name: r.riderName }; }
    if (type === 'poolseat') { const st = await prisma.poolSeat.findUnique({ where: { id: String(code) }, include: { pool: true } }); if (!st) return null;
      const fare = st.fareEtb || (st.pool && st.pool.seatFareEtb) || 0; const ok = !st.paidAt && ['held', 'boarded'].includes(st.status) && fare > 0;
      return { payable: ok, reason: st.paidAt ? 'already_paid' : 'seat_' + st.status, amountEtb: fare, title: 'BinaPool seat', redirectPath: '/ride?pool=' + st.poolId + '&seat=' + st.id + '&paid=1', phone: st.riderPhone, name: st.riderName }; }
    return null;
  },
  settle: async (type, code, info) => {
    if (type === 'poolseat') { await prisma.poolSeat.updateMany({ where: { id: String(code) }, data: { paidAt: new Date(), paymentMethod: 'telebirr' } }); return; }
    if (type === 'cinema' && cinemaRef) { await cinemaRef.tickets.markPaid(String(code).toUpperCase(), 'telebirr', info.orderId); const t = await prisma.ticket.findUnique({ where: { code: String(code).toUpperCase() } }); if (t) cinemaRef.notify(t, '✅ ' + t.code + ' በቴሌብር ተከፍሏል · paid with telebirr. ' + (t.seats || []).join(', ') + '\nhttps://bina.et/ticket/' + t.code).catch(() => {}); return; }
    if (type === 'ride') { await prisma.ride.updateMany({ where: { id: String(code) }, data: { paymentStatus: 'paid', paymentMethod: 'telebirr' } }); return; }
  },
});
const telebirrForModules = { enabled: telebirrClient.enabled, mode: telebirrClient.mode, initFor: telebirrRoutes.initFor, confirmFor: telebirrRoutes.confirmFor };
console.log('[telebirr] ' + (telebirrClient.enabled ? 'enabled mode=' + telebirrClient.mode : 'off (no TELEBIRR_* config)'));
// ===== BinaSmart Cinema & Events: seat booking (Phase A). Mounted only when CINEMA_ENABLED=1 =====
const cinema = require('./cinema')(fastify, {
  prisma, OWNER_KEY, BASE_URL: 'https://bina.et', telebirr: telebirrForModules,
  chapa: {
    enabled: !!CHAPA_SECRET, mode: process.env.CHAPA_MODE === 'live' ? 'live' : 'test',
    init: async ({ amount, ref, name, phone, returnUrl, title }) => {
      const init = await chapaApi('/transaction/initialize', 'POST', { amount: String(amount), currency: 'ETB', email: 'cinema@bina.et',
        first_name: String(name || 'BinaSmart').split(' ')[0].slice(0, 30), last_name: 'Cinema', phone_number: phone, tx_ref: ref,
        callback_url: 'https://bina.et/api/chapa/webhook', return_url: returnUrl, 'customization[title]': 'BinaSmart', 'customization[description]': String(title || 'Ticket').slice(0, 50) });
      return init && init.data && init.data.checkout_url ? init.data.checkout_url : null;
    },
    verify: async ref => { const v = await chapaApi('/transaction/verify/' + encodeURIComponent(ref), 'GET'); return !!(v && v.status === 'success' && v.data && v.data.status === 'success'); },
  },
});

cinemaRef = cinema;
// ===== BinaSmart Watch: licensed films, video hosted elsewhere (Phase B). Same flag, same Chapa object =====
const watch = require('./watch')(fastify, { prisma, OWNER_KEY, BASE_URL: 'https://bina.et', chapa: cinema ? cinema.chapa : null });

// ===== BinaSmart Business: shop, office and venue owners manage their own page (BUSINESS_ENABLED=1) =====
require('./business')(fastify, {
  notifyShop, prisma, OWNER_KEY, BASE_URL: 'https://bina.et',
  // A verified claim becomes a membership on the signed-in account, and proves their phone.
  onClaimVerified: async (req, r) => {
    if (!req.authUser) return;
    await identity.grantMembership(req.authUser.id, { kind: r.kind, shopId: r.shopId || null, venueId: r.venueId || null, role: 'owner' });
    if (!req.authUser.phone && r.phone) await identity.setVerifiedPhone(req.authUser.id, r.phone, 'owner_claim');
  }
});

fastify.listen({ port: PORT, host: '127.0.0.1' })
  .then(() => console.log('BinaSmart API v0.2 on :' + PORT))
  .catch(err => { console.error(err); process.exit(1); });
