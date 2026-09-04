// BinaSmart API v0.2 — Fastify + Prisma + invoice cron + owner dashboard
require('dotenv').config?.();
const fastify = require('fastify')({ logger: false, ignoreTrailingSlash: true });

// ---- technical-SEO: security headers + static-asset caching ----
fastify.addHook('onSend', async (req, reply, payload) => {
  reply.header('Strict-Transport-Security', 'max-age=15768000');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  const u = String(req.raw.url || '').split('?')[0];
  if (reply.statusCode < 400) {
    if (/\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|pmtiles)$/i.test(u)) reply.header('Cache-Control', 'public, max-age=2592000, immutable');
    else if (/\.(js|css|webmanifest|pbf)$/i.test(u)) reply.header('Cache-Control', 'public, max-age=86400');
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

const OWNER_KEY = process.env.OWNER_KEY || 'change-me';
const authFail = (req, reply) => {
  if (req.authUser && req.authUser.role === 'admin') return false; // session-based admin
  if ((req.query.key || '') !== OWNER_KEY) { reply.code(401).send({ error: 'unauthorized' }); return true; }
  return false;
};
// per-building owner key (scoped) OR global key
async function authBuildingFail(req, reply, slug) {
  if (req.authUser) {
    if (req.authUser.role === 'admin') return false;
    if (req.authUser.buildingSlug && req.authUser.buildingSlug === slug) return false;
  }
  const key = req.query.key || '';
  if (key === OWNER_KEY) return false;
  if (key) {
    const b = await prisma.building.findUnique({ where: { qrSlug: slug }, select: { ownerKey: true } });
    if (b && b.ownerKey && key === b.ownerKey) return false;
  }
  reply.code(401).send({ error: 'unauthorized' });
  return true;
}

// health
fastify.get('/nav', async (req, reply) => reply.sendFile('nav.html'));
fastify.get('/login', async (req, reply) => reply.sendFile('login.html'));
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
function normPhone(p){
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '251' + d.slice(1);
  if (d.startsWith('9') && d.length === 9) d = '251' + d;
  return '+' + d;
}
fastify.post('/api/owner/login', async (req, reply) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return reply.code(400).send({ error: 'phone_and_password_required' });
  const user = await prisma.user.findFirst({ where: { phone: normPhone(phone) } });
  if (!user || !user.passwordHash || !checkPw(password, user.passwordHash))
    return reply.code(401).send({ error: 'wrong_phone_or_password' });
  const buildings = await prisma.building.findMany({ where: { ownerId: user.id } });
  if (!buildings.length) return reply.code(403).send({ error: 'no_buildings_for_this_account' });
  const out = [];
  for (const b of buildings) {
    let key = b.ownerKey;
    if (!key) {
      key = b.qrSlug.slice(0, 3).toUpperCase() + '-' + cryptoMod.randomBytes(5).toString('hex').toUpperCase();
      await prisma.building.update({ where: { id: b.id }, data: { ownerKey: key } });
    }
    out.push({ slug: b.qrSlug, name: b.name, key });
  }
  return { ok: true, buildings: out };
});
fastify.post('/api/owner/change-password', async (req, reply) => {
  const { phone, oldPassword, newPassword } = req.body || {};
  if (!phone || !oldPassword || !newPassword) return reply.code(400).send({ error: 'missing_fields' });
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
fastify.get('/', async (req, reply) => reply.sendFile('gemini-home.html')); // prior versions: coming-soon.html, index.html (full grid)
fastify.get('/robots.txt', async (req, reply) => reply.sendFile('robots.txt'));
fastify.get('/sitemap.xml', async (req, reply) => {
  const bs = await prisma.building.findMany({ select: { qrSlug: true, buildingType: true }, orderBy: { createdAt: 'asc' } });
  const posts = await prisma.newsPost.findMany({ where: { published: true }, select: { slug: true } });
  const tnds = await prisma.tender.findMany({ where: { published: true }, select: { slug: true } });
  const cshows = await prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: new Date() } }, select: { id: true } }).catch(() => []);
  const urls = ['https://bina.et/', 'https://bina.et/news', 'https://bina.et/tenders', 'https://bina.et/insurance', 'https://bina.et/cars', 'https://bina.et/property', 'https://bina.et/for-insurers', 'https://bina.et/ride', 'https://bina.et/why-binasmart', 'https://bina.et/drive-with-us', 'https://bina.et/nav', 'https://bina.et/blog/smart-building-management-ethiopia', 'https://bina.et/travel', 'https://bina.et/cinema', 'https://bina.et/for-cinemas', 'https://bina.et/restaurant/bina-restaurant', 'https://bina.et/hospital/bina-general-hospital', 'https://bina.et/flights/hanud', 'https://bina.et/diaspora', 'https://bina.et/fayda', 'https://bina.et/telebirr', 'https://bina.et/telesign', 'https://bina.et/passport', 'https://bina.et/mesob', 'https://bina.et/guides', 'https://bina.et/free-ethiopian-tenders', 'https://bina.et/property-management', 'https://bina.et/property-management-software', 'https://bina.et/manage-rental-property', 'https://bina.et/digital-rent-collection', 'https://bina.et/tin-registration-ethiopia', 'https://bina.et/business-registration-ethiopia', 'https://bina.et/driving-licence-ethiopia', 'https://bina.et/vat-registration-ethiopia', 'https://bina.et/ethiopia-evisa', 'https://bina.et/rental-agreement-ethiopia', 'https://bina.et/cbe-birr-guide', 'https://bina.et/customs-import-duty-ethiopia', 'https://bina.et/how-to-start-a-business-in-ethiopia', 'https://bina.et/digital-ethiopia-2026', 'https://bina.et/living-working-in-ethiopia-guide', 'https://bina.et/ethiopia-income-tax-calculator', 'https://bina.et/import-car-to-ethiopia', 'https://bina.et/ethiopian-origin-id-yellow-card', 'https://bina.et/open-bank-account-ethiopia', 'https://bina.et/birth-marriage-certificate-ethiopia', 'https://bina.et/pay-utility-bills-ethiopia', 'https://bina.et/tenant-screening-ethiopia', ...posts.map(p => 'https://bina.et/news/' + p.slug), ...tnds.map(t => 'https://bina.et/tenders/' + t.slug), ...cshows.map(s => 'https://bina.et/cinema/' + s.id), ...bs.map(b => 'https://bina.et/b/' + b.qrSlug), ...bs.filter(b => b.buildingType === 'HOTEL').map(b => 'https://bina.et/hotel/' + b.qrSlug)];
  reply.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => '<url><loc>' + u + '</loc></url>').join('\n') + '\n</urlset>');
});
fastify.get('/sw.js', async (req, reply) => reply.sendFile('sw.js'));
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
      tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true } } } } } } } });
  if (!shop) return reply.code(404).send({ error: 'not_found' });
  return { restaurant: { id: shop.id, name: shop.name, nameAm: shop.nameAm, phone: shop.phone,
    building: shop.tenancy.unit.building.name, buildingSlug: shop.tenancy.unit.building.qrSlug, unit: shop.tenancy.unit.number },
    menu: shop.products.map(p => ({ id: p.id, name: p.name, nameAm: p.nameAm, price: p.price, category: p.category || 'Menu' })) };
});

fastify.post('/api/restaurant/:shopId/order', async (req, reply) => {
  const { table, items, customerName, customerPhone, note } = req.body || {};
  if (!Array.isArray(items) || !items.length) return reply.code(400).send({ error: 'empty_order' });
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
  if (NOTIFY_WHITELIST.includes(b.qrSlug)) {
    const summary = lines.map(l => { const p = prods.find(x => x.id === l.productId); return l.qty + '× ' + (p.nameAm || p.name); }).join(', ');
    sendWa(shop.phone, '🍽️ አዲስ ትዕዛዝ / NEW ORDER ' + code + (table ? ' · Table ' + table : '') + '\n' + summary + '\n💰 ' + total.toLocaleString() + ' ETB', WA_CHANNEL[b.qrSlug]).catch(() => {});
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
  await prisma.order.update({ where: { id: req.params.id },
    data: { status: st, completedAt: ['DELIVERED', 'COMPLETED'].includes(st) ? new Date() : undefined } });
  return { ok: true, status: st };
});

fastify.get('/restaurant/:slug', async (req, reply) => reply.sendFile('restaurant.html'));

// ===== DIASPORA: building-owner leads =====
fastify.post('/api/diaspora-lead', async (req, reply) => {
  const { name, phone, country, city, building, units, note } = req.body || {};
  if (!name || !phone) return reply.code(400).send({ error: 'missing_fields' });
  const lead = await prisma.diasporaLead.create({ data: {
    name: String(name).slice(0, 80), phone: String(phone).slice(0, 30),
    country: country ? String(country).slice(0, 40) : null, city: city ? String(city).slice(0, 40) : null,
    building: building ? String(building).slice(0, 120) : null, units: units ? String(units).slice(0, 20) : null,
    note: note ? String(note).slice(0, 500) : null } });
  sendTg('8096525984', '🌍 NEW DIASPORA LEAD — BinaSmart\n👤 ' + lead.name + ' (' + lead.phone + ')\n📍 Lives in: ' + (lead.country || '?') + '\n🏢 Building: ' + (lead.building || '?') + ' · ' + (lead.city || 'Addis Ababa') + ' · ' + (lead.units || '?') + ' units\n📝 ' + (lead.note || '—')).catch(() => {});
  return { ok: true };
});

fastify.get('/diaspora', async (req, reply) => reply.sendFile('diaspora.html'));
fastify.get('/insurance', async (req, reply) => reply.sendFile('insurance.html'));
fastify.get('/for-insurers', async (req, reply) => reply.sendFile('for-insurers.html'));
// ===== CARS + REAL ESTATE marketplace (partner-supplied) =====
fastify.get('/cars', async (req, reply) => reply.sendFile('cars.html'));
fastify.get('/property', async (req, reply) => reply.sendFile('property.html'));
fastify.get('/api/cars', async (req) => {
  const cars = await prisma.carListing.findMany({ where: { active: true }, orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }], take: 60 });
  return { cars };
});
fastify.get('/api/properties', async (req) => {
  const props = await prisma.propertyListing.findMany({ where: { active: true }, orderBy: [{ verified: 'desc' }, { createdAt: 'desc' }], take: 60 });
  return { properties: props };
});
fastify.post('/api/admin/car', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {}; if (!b.slug || !b.title) return reply.code(400).send({ error: 'slug+title' });
  const f = ['slug','title','make','model','year','price','mileage','fuel','transmission','bodyType','condition','city','imageUrl','dealer','dealerPhone'];
  const data = {}; f.forEach(k => { if (b[k] != null) data[k] = String(b[k]); });
  data.featured = !!b.featured; if (b.active != null) data.active = !!b.active;
  const c = await prisma.carListing.upsert({ where: { slug: b.slug }, update: data, create: data });
  return { ok: true, url: 'https://bina.et/cars#' + c.slug };
});
fastify.post('/api/admin/property', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body || {}; if (!b.slug || !b.title) return reply.code(400).send({ error: 'slug+title' });
  const f = ['slug','title','listingType','propertyType','price','beds','baths','area','city','location','imageUrl','agency','agencyPhone'];
  const data = {}; f.forEach(k => { if (b[k] != null) data[k] = String(b[k]); });
  data.verified = !!b.verified; if (b.active != null) data.active = !!b.active;
  const p = await prisma.propertyListing.upsert({ where: { slug: b.slug }, update: data, create: data });
  return { ok: true, url: 'https://bina.et/property#' + p.slug };
});
fastify.post('/api/market-lead', async (req, reply) => {
  const b = req.body || {};
  if (!b.name || !b.phone || !b.kind) return reply.code(400).send({ error: 'missing' });
  const lead = await prisma.marketLead.create({ data: {
    kind: String(b.kind).slice(0,20), listingSlug: b.listingSlug ? String(b.listingSlug).slice(0,80) : null,
    listingRef: b.listingRef ? String(b.listingRef).slice(0,140) : null, name: String(b.name).slice(0,80),
    phone: String(b.phone).slice(0,30), budget: b.budget ? String(b.budget).slice(0,40) : null,
    note: b.note ? String(b.note).slice(0,500) : null } });
  const emoji = lead.kind === 'car' ? '\uD83D\uDE97' : '\uD83C\uDFE0';
  sendTg('8096525984', emoji + ' NEW ' + lead.kind.toUpperCase() + ' LEAD \u2014 BinaSmart\n\uD83D\uDC64 ' + lead.name + ' (' + lead.phone + ')' + (lead.listingRef ? '\n\uD83D\uDCCC ' + lead.listingRef : '') + (lead.budget ? '\n\uD83D\uDCB0 Budget: ' + lead.budget : '') + '\n\uD83D\uDCDD ' + (lead.note || '\u2014')).catch(() => {});
  sendWa(lead.phone, 'BinaSmart \u2014 \u1325\u12eB\u1244\u12CE\u1295 \u1270\u1240\u1265\u1208\u1293\u1362 \u1260\u1240\u122D\u1265 \u12A5\u1295\u12F0\u12CD\u120B\u1208\u1295\u1362 (bina.et)').catch(() => {});
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

fastify.post('/api/insurance-lead', async (req, reply) => {
  const b = req.body || {};
  if (!b.name || !b.phone) return reply.code(400).send({ error: 'missing_fields' });
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
  sendTg('8096525984', '\uD83D\uDEE1\uFE0F NEW INSURANCE LEAD \u2014 BinaSmart\n\uD83D\uDCCB ' + lead.insType + (lead.coverType ? ' (' + lead.coverType + ')' : '') + '\n\uD83D\uDC64 ' + lead.name + ' (' + lead.phone + ')\n\uD83D\uDCCD ' + (lead.city || '?') + (lead.vehicleValue ? '\n\uD83D\uDCB0 Car value: ' + lead.vehicleValue : '') + '\n\uD83D\uDCDD ' + (lead.note || '\u2014') + routed).catch(() => {});
  sendWa(lead.phone, 'BinaSmart \uD83D\uDEE1\uFE0F \u12e8' + lead.insType + ' \u1218\u12f5\u1295 \u1325\u12eB\u1244\u12CE\u1295 \u1270\u1240\u1265\u1208\u1293\u1362 \u1260\u1240\u122D\u1265 \u1270\u1235\u121B\u121A \u12A8\u1218\u12F5\u1295 \u12F5\u122D\u1305\u1276\u127D \u130B\u122D \u12A5\u1295\u12F0\u12CD\u120B\u1208\u1295\u1362').catch(() => {});
  return { ok: true };
});


// ===== FLIGHTS: live indicative fares (Amadeus self-service; off until AMADEUS_KEY set) =====
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
fastify.get('/api/flights/:slug', async (req, reply) => {
  const q = req.params.slug.replace(/-/g, ' ');
  const shop = await prisma.shop.findFirst({
    where: { name: { contains: q, mode: 'insensitive' }, tenancy: { active: true } },
    include: { tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true } } } } } } } });
  if (!shop) return reply.code(404).send({ error: 'not_found' });
  return { agency: { id: shop.id, name: shop.name, nameAm: shop.nameAm, phone: shop.phone,
    building: shop.tenancy.unit.building.name, buildingAm: shop.tenancy.unit.building.nameAm,
    buildingSlug: shop.tenancy.unit.building.qrSlug, unit: shop.tenancy.unit.number, floor: shop.tenancy.unit.floor } };
});

fastify.post('/api/flights/:shopId/request', async (req, reply) => {
  const { tripType, fromCity, toCity, departDate, returnDate, passengers, cabin, name, phone, note } = req.body || {};
  if (!fromCity || !toCity || !departDate || !name || !phone) return reply.code(400).send({ error: 'missing_fields' });
  const shop = await prisma.shop.findUnique({ where: { id: req.params.shopId },
    include: { tenancy: { include: { unit: { include: { building: true } } } } } });
  if (!shop) return reply.code(404).send({ error: 'not_found' });
  const dep = new Date(departDate);
  if (isNaN(dep) || dep < new Date(new Date().toISOString().slice(0, 10))) return reply.code(400).send({ error: 'bad_date' });
  const pax = Math.max(1, Math.min(9, parseInt(passengers) || 1));
  const code = 'FR-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Date.now().toString(36).slice(-4).toUpperCase();
  await prisma.flightRequest.create({ data: { shopId: shop.id,
    tripType: tripType === 'ONEWAY' ? 'ONEWAY' : 'ROUND', fromCity, toCity, departDate: dep,
    returnDate: returnDate ? new Date(returnDate) : null, passengers: pax,
    cabin: ['BUSINESS'].includes(cabin) ? cabin : 'ECONOMY', name, phone: phone.trim(), note: note || null, code } });
  const b = shop.tenancy.unit.building;
  await audit(b.id, 'FLIGHT_REQUEST', name + ' · ' + fromCity + '→' + toCity + ' ×' + pax + ' · ' + code, 0);
  if (NOTIFY_WHITELIST.includes(b.qrSlug)) {
    sendWa(shop.phone, '✈️ አዲስ የበረራ ጥያቄ / NEW FLIGHT REQUEST ' + code + '\n👤 ' + name + ' (' + phone + ')\n🛫 ' + fromCity + ' → ' + toCity + (tripType === 'ONEWAY' ? ' (one-way)' : ' 🔁 return ' + (returnDate || '')) + '\n📅 ' + departDate + ' · ' + pax + ' pax · ' + (cabin || 'ECONOMY') + (note ? '\n📝 ' + note : '') + '\n\nReply with your best price to win this customer. / ዋጋ ይላኩ።', WA_CHANNEL[b.qrSlug]).catch(() => {});
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

fastify.get('/flights/:slug', async (req, reply) => reply.sendFile('flights.html'));

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
fastify.get('/privacy', async (req, reply) => reply.sendFile('privacy.html'));
fastify.get('/terms', async (req, reply) => reply.sendFile('terms.html'));
fastify.get('/support', async (req, reply) => reply.sendFile('support.html'));
fastify.get('/ai', async (req, reply) => reply.sendFile('ai.html'));
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
fastify.get('/import-car-to-ethiopia', async (req, reply) => reply.sendFile('import-car-to-ethiopia.html'));
fastify.get('/ethiopian-origin-id-yellow-card', async (req, reply) => reply.sendFile('ethiopian-origin-id-yellow-card.html'));
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
const ASSIST_SYS = `You are "Bini" (ቢኒ) — the warm, sharp, human-like assistant for BinaSmart (bina.et), Ethiopia's all-in-one digital platform. Talk like a friendly, helpful Ethiopian guide who genuinely cares — personable and natural, never robotic or stiff. Your name is ONLY Bini (ቢኒ) — never introduce yourself with any other name (not Philip/ፊልጶስ or anything else), and only say your name once at the very start of a chat.

HOW YOU TALK:
- Reply in the SAME language the user writes (Amharic or English). Use warm, everyday, natural Amharic — not formal/textbook.
- Be concise but COMPLETE — always finish your helpful point, never cut off mid-thought. 2-5 short sentences.
- A little emoji is welcome; match the user's energy and tone.
- Greetings/small talk → reply warmly and briefly, then gently offer to help.
- When the user shares a problem or frustration → ACKNOWLEDGE it with real empathy FIRST (e.g. "that's really frustrating"), THEN help.
- Remember the conversation and build on it — never repeat yourself or re-introduce yourself after the first message.
- Keep it moving — end with a helpful next step or a light, relevant question when it fits.

BE A SKILLED HELPER (soft, never pushy):
When the user has a need or pain point that BinaSmart solves, connect the dots naturally — name the exact feature, say the benefit in their own words, then point to the right page or next step. E.g.: tenants not paying / chasing rent → BinaSmart tracks overdue rent, sends reminders and screens tenants (/digital-rent-collection, /owner); starting a business → /how-to-start-a-business-in-ethiopia; needs work/opportunities → /free-ethiopian-tenders.

WHAT BINASMART OFFERS:
- 🏢 Property/building management: a QR code per unit, online rent collection via telebirr & Chapa, tenant screening, maintenance tracking, invoices, income reports, automatic VAT accounting (tracks input & output VAT from invoices and prepares your VAT-return figures), and a private owner AI. Owners start at /owner. Guides: /property-management-software, /manage-rental-property, /digital-rent-collection, /tenant-screening-ethiopia, /rental-agreement-ethiopia (hub /property-management).
- 📋 Free Ethiopian tenders (government, banks, NGOs), updated daily, free: /free-ethiopian-tenders (live list /tenders).
- 📚 Digital Ethiopia guides (A-Z, bilingual): Fayda /fayda, telebirr /telebirr, CBE Birr /cbe-birr-guide, e-Passport /passport, eVisa /ethiopia-evisa, Telesign /telesign, Mesob /mesob, TIN /tin-registration-ethiopia, business licence /business-registration-ethiopia, VAT/TOT /vat-registration-ethiopia, customs /customs-import-duty-ethiopia, driving licence /driving-licence-ethiopia, import a car (EV) /import-car-to-ethiopia, Yellow Card /ethiopian-origin-id-yellow-card, bank account /open-bank-account-ethiopia, birth/marriage certificate /birth-marriage-certificate-ethiopia, utility bills /pay-utility-bills-ethiopia (hub /guides). Tools: income-tax calculator /ethiopia-income-tax-calculator.
- Also: events & cinema, hotel & travel booking, online payments and a wallet.
- 🚕 BinaSmart Ride (/ride): the price is FIXED and shown upfront before you book — it does NOT change with time, traffic or demand (no surge). NEVER say the fare varies or depends on traffic. Tiers: Moto, Bajaj, Economy, Comfort, XL; pay the driver in cash or telebirr/Chapa; Addis Ababa only. To see the exact fixed price, open /ride and enter the destination — never guess or state a number yourself. Riders can also book inside Telegram (@bina_smart_bot) or from ChatGPT/Claude via /ai, and anyone can book for someone else (e.g. family abroad booking for a relative in Addis). Drivers: register free in Telegram @binasmartdriverbot — 0% commission during launch.

VAT — BE PRECISE (two different things):
- "BinaSmart's VAT accounting" = a BUILDING-OWNER feature inside /owner: it automatically tracks input & output VAT from the owner's invoices and prepares the VAT-return figures. When someone asks how BinaSmart's VAT accounting works, describe THIS and point to /owner (owners sign in there).
- REGISTERING for VAT/TOT with the government is a separate thing → the guide /vat-registration-ethiopia.
- Don't blur the two, and never say BinaSmart doesn't do VAT — it has owner VAT accounting.

ALWAYS HONEST (never break):
- NEVER invent prices, numbers, deadlines or features. If unsure, say so warmly and offer WhatsApp.
- NEVER guess or invent the NAME, acronym, URL or office of any government portal, system, ministry, law or fee (do NOT make up things like "eRkAB", "eTax portal", a website address, or a proclamation number). If you are not 100% certain of the exact official name, DO NOT state one — describe the step in plain words instead ("apply at the tax office / through the official online system") and send the user to our verified step-by-step guide (e.g. /tin-registration-ethiopia) or WhatsApp. Our guides hold the correct names and links; you do not need to.
- For pricing, a demo, a booking, a complaint, or anything needing a person → route warmly to WhatsApp https://wa.me/251911244344 (owners can also use /owner). Frame it helpfully, e.g. "pricing depends on your building size — let me connect you with our team for a quick quote."
- Don't claim to be human and don't over-promise.
- Give ONE relevant bina.et link when it genuinely helps (a /path).`;
// ===== Bini LLM adapter — cloud API (OpenAI/Anthropic-compat) primary, local GLM fallback =====
async function callBini(system, messages, maxTokens){
  maxTokens = maxTokens || 500;
  async function once(fmt, base, key, model){
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      let url, headers, body;
      if (fmt === 'openai') {
        url = base.replace(/\/+$/, '') + '/chat/completions';
        headers = { 'content-type': 'application/json', 'authorization': 'Bearer ' + key };
        { const _b = { model: model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }].concat(messages) };
          if (/gemini/i.test(model)) _b.reasoning_effort = 'none';  // Gemini 2.5 thinking OFF — thinking tokens were eating the answer, cutting Amharic mid-word
          body = JSON.stringify(_b); }
      } else {
        url = base.replace(/\/+$/, '') + '/v1/messages';
        headers = { 'content-type': 'application/json', 'x-api-key': key, 'authorization': 'Bearer ' + key, 'anthropic-version': '2023-06-01' };
        body = JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: messages });
      }
      const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: headers, body: body });
      clearTimeout(to);
      const d = await r.json();
      let text = '';
      if (fmt === 'openai') text = (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) ? String(d.choices[0].message.content).trim() : '';
      else text = (d && d.content && d.content[0] && d.content[0].text) ? String(d.content[0].text).trim() : '';
      if (!text) throw new Error('empty_llm_response');
      return text;
    } catch (e) { clearTimeout(to); throw e; }
  }
  // Primary: cloud API when BINI_API_BASE is configured in .env
  if (process.env.BINI_API_BASE && process.env.BINI_API_KEY) {
    try {
      return await once((process.env.BINI_API_FORMAT || 'openai').toLowerCase(), process.env.BINI_API_BASE, process.env.BINI_API_KEY || 'x', process.env.BINI_API_MODEL || 'gpt-4o-mini');
    } catch (e) { /* fall back to local GLM below so Bini never goes dark */ }
  }
  // Fallback / default: local GLM (Anthropic-compat)
  return await once('anthropic', process.env.GLM_BASE || 'http://127.0.0.1:4000', process.env.GLM_KEY || 'x', process.env.GLM_MODEL || 'glm-5-turbo');
}
const _assistRL = new Map(); // ip -> [timestamps]
fastify.post('/api/assistant', async (req, reply) => {
  const b = req.body || {};
  const msg = String(b.message || '').slice(0, 1200).trim();
  if (!msg) return reply.code(400).send({ error: 'message required' });
  const ip = String(req.headers['x-real-ip'] || req.ip);
  const now = Date.now();
  const hits = (_assistRL.get(ip) || []).filter(t => now - t < 600000); // 10 min window
  if (hits.length >= 25) return reply.send({ reply: 'ትንሽ ቆይተው እንደገና ይሞክሩ 🙏 ወይም በ WhatsApp ያግኙን፦ https://wa.me/251911244344' });
  hits.push(now); _assistRL.set(ip, hits);
  const hist = Array.isArray(b.history) ? b.history.slice(-6).map(m => ({
    role: (m && m.role === 'assistant') ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, 1200)
  })).filter(m => m.content) : [];
  const FALLBACK = 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ በ WhatsApp ያግኙን፦ https://wa.me/251911244344';
  try {
    const text = await callBini(ASSIST_SYS, [...hist, { role: 'user', content: msg }], 700);
    return reply.send({ reply: text || FALLBACK });
  } catch (e) {
    req.log && req.log.warn && req.log.warn('assistant err ' + e);
    return reply.send({ reply: FALLBACK });
  }
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
    departments: b.departments.map(d => ({ id: d.id, name: d.name, nameAm: d.nameAm, icon: d.icon, floor: d.floor,
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
  return { ok: true, code, department: d.name, departmentAm: d.nameAm, floor: d.floor, room: d.room,
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

fastify.get('/hospital/:slug', async (req, reply) => reply.sendFile('hospital.html'));

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

fastify.post('/api/travel/:tripId/book', async (req, reply) => {
  const { name, phone, seats } = req.body || {};
  if (!name || !phone) return reply.code(400).send({ error: 'missing_fields' });
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
    photo: b.facadePhotoUrl || null, floors: b.floors }, rooms };
});

fastify.post('/api/hotel/:slug/book', async (req, reply) => {
  const { roomTypeId, guestName, guestPhone, checkIn, checkOut, rooms } = req.body || {};
  if (!roomTypeId || !guestName || !guestPhone || !checkIn || !checkOut)
    return reply.code(400).send({ error: 'missing_fields' });
  const ci = new Date(checkIn), co = new Date(checkOut);
  const nRooms = Math.max(1, parseInt(rooms) || 1);
  if (!(co > ci)) return reply.code(400).send({ error: 'invalid_dates' });
  if (ci < new Date(new Date().toISOString().slice(0, 10))) return reply.code(400).send({ error: 'past_date' });
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
    sendWa(rt.building.owner.phone, msg, WA_CHANNEL[rt.building.qrSlug]).catch(() => {});
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

fastify.get('/hotel/:slug', async (req, reply) => reply.sendFile('hotel.html'));

// ===== BINA NEWS + TENDERS (server-rendered, bina.et) =====
const NEWS_CATS = { 'ቴክኖሎጂ': '#2563eb', 'ግንባታ': '#c2410c', 'ንግድ': '#059669', 'ሪል እስቴት': '#7c3aed', 'መመሪያ': '#0e7490' };
const TENDER_CATS = ['ግንባታ Construction', 'አቅርቦት Supply', 'አገልግሎት Services', 'ማማከር Consultancy', 'ጤና Health', 'ትራንስፖርት Transport', 'ሽያጭ ጨረታ Disposal auction'];
const escH = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
function ogFor(slug, fallback){ try { return fs.existsSync(require('path').join(__dirname,'public','og-'+slug+'.png')) ? 'https://bina.et/static/og-'+slug+'.png' : fallback; } catch(e){ return fallback; } }
function newsShell({ title, desc, canonical, extraHead = '', body, active = 'news', ogImage = 'https://bina.et/static/bina-news.png' }) {
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escH(title)}</title><meta name="description" content="${escH(desc)}"><link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escH(title)}"><meta property="og:description" content="${escH(desc)}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="Bina ዜና"><meta property="og:type" content="article"><meta property="og:image" content="${ogImage}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${ogImage}">
<link rel="icon" href="/icon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Ethiopic:wght@600;800;900&display=swap" rel="stylesheet">
${extraHead}
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#faf8f4;--ink:#141414;--mut:#6f6a60;--line:#e8e2d6;--em:#059669;--gold:#b8860b}
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
.cta-band a{background:var(--em);color:#fff;font-weight:800;border-radius:999px;padding:13px 26px;font-size:14px;flex-shrink:0}
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
.body-t li{margin-bottom:10px}
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
</style></head><body>
<div id="prog"></div>
<div class="topbar sans"><div class="tb-in">
  <a class="brand" href="/">Bina<span class="g">Smart</span><span class="zena"> ዜና</span></a>
  <nav class="tb-nav">
    <a href="/news" class="${active === 'news' ? 'on' : ''}">ዜና News</a>
    <a href="/tenders" class="${active === 'tenders' ? 'on' : ''}">ጨረታ Tenders</a>
    <a href="/b/darulle">ሕንፃዎች</a>
  </nav>
  <a class="tb-cta" href="/diaspora">💼 Own a company?</a>
</div></div>
${body}
<footer class="sans"><div class="ft-in">
  <div><b style="color:var(--ink)">Bina ዜና</b> — የቴክኖሎጂ፣ ግንባታ እና ንግድ ዜና · ከፖለቲካ ነጻ</div>
  <div>ጨረታ አለዎት? <a href="https://wa.me/251911244344" style="color:var(--em);font-weight:700">WhatsApp +251 911 244 344</a></div>
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
</script></body></html>`;
}

function catPill(cat) {
  const c = NEWS_CATS[cat] || '#6f6a60';
  return `<span class="cat sans" style="color:${c}">${escH(cat)}</span>`;
}

// ---- NEWS HUB ----
fastify.get('/news', async (req, reply) => {
  const cat = req.query.cat;
  const posts = await prisma.newsPost.findMany({ where: { published: true, ...(cat ? { category: cat } : {}) }, orderBy: { publishedAt: 'desc' }, take: 25 });
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
    <div class="phero" style="--pg:linear-gradient(135deg,#0f2027,#155e75);--wm:'📰'"><h1>ዜና · News</h1><div class="am sans">ቴክኖሎጂ · ግንባታ · ንግድ · ሪል እስቴት</div><div class="sub sans">Ethiopian tech, construction &amp; business news — in Amharic, politics-free.</div></div>
    <div class="chips" style="--chipon:#155e75">${chips}</div>
    ${heroHtml}
    <div class="grid">${cards}</div>
    <div class="cta-band sans"><div><h3>📋 የግንባታ ጨረታዎችን ይከታተሉ</h3><p>Daily construction & supply tenders from across Ethiopia.</p></div><a href="/tenders">ጨረታዎችን ይመልከቱ →</a></div>
  </main>`;
  reply.type('text/html').send(newsShell({ title: 'Bina ዜና — ቴክኖሎጂ፣ ግንባታ እና ንግድ ዜና በአማርኛ', desc: 'Ethiopian technology, construction and business news in Amharic — politics-free. ቴክኖሎጂ፣ ግንባታ እና ንግድ ዜና በአማርኛ።', canonical: 'https://bina.et/news', body, active: 'news' }));
});

// ---- ARTICLE ----
fastify.get('/news/:slug', async (req, reply) => {
  const p = await prisma.newsPost.findUnique({ where: { slug: req.params.slug } });
  if (!p || !p.published) return reply.code(404).type('text/html').send(newsShell({ title: 'Not found', desc: '', canonical: 'https://bina.et/news', body: '<main><div class="empty"><div class="big">🗞️</div><h3>ጽሑፉ አልተገኘም</h3><p class="sans"><a href="/news" style="color:var(--em)">← ወደ ዜና ገጽ</a></p></div></main>' }));
  const schema = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': p.evergreen ? 'Article' : 'NewsArticle', headline: p.title, description: p.excerpt, inLanguage: p.lang, datePublished: p.publishedAt, author: { '@type': 'Organization', name: 'Bina ዜና — BinaSmart' }, publisher: { '@type': 'Organization', name: 'BinaSmart', url: 'https://bina.et' }, mainEntityOfPage: 'https://bina.et/news/' + p.slug })}</script><meta name="robots" content="max-image-preview:large">`;
  const share = encodeURIComponent('https://bina.et/news/' + p.slug);
  const shareT = encodeURIComponent(p.title);
  const others = await prisma.newsPost.findMany({ where: { published: true, slug: { not: p.slug } }, orderBy: { publishedAt: 'desc' }, take: 3 });
  const rel = others.map(o => { const c = cardFor(o.slug); return `<div class="card">${c ? `<a class="thumb" href="/news/${o.slug}"><img src="${c.thumb}" width="600" height="315" alt="" loading="lazy" decoding="async"></a>` : ''}${catPill(o.category)}<h3><a href="/news/${o.slug}">${escH(o.title)}</a></h3><div class="meta sans"><span>${amDate(o.publishedAt)}</span></div></div>`; }).join('');
  const body = `<main><article class="art">
    ${catPill(p.category)}
    <h1>${escH(p.title)}</h1>
    <p class="lead">${escH(p.excerpt)}</p>
    <div class="rule sans"><span>${escH(p.author)}</span><span>·</span><span>${amDate(p.publishedAt)}</span><span>·</span><span>${p.readMinutes} ደቂቃ ንባብ</span></div>
    ${(() => { const c = cardFor(p.slug); return c ? `<figure class="art-hero"><img src="${c.full}" width="1200" height="630" alt="${escH(p.title)}" fetchpriority="high" decoding="async"></figure>` : ''; })()}
    <div class="body-t">${p.bodyHtml}</div>
    <div class="share sans">
      <a href="https://t.me/share/url?url=${share}&text=${shareT}">📣 Telegram</a>
      <a href="https://wa.me/?text=${shareT}%0A${share}">💬 WhatsApp</a>
      <a href="https://x.com/intent/tweet?url=${share}&text=${shareT}">𝕏</a>
      <a href="#" onclick="navigator.clipboard.writeText('https://bina.et/news/${p.slug}');this.textContent='✓ Copied';return false">🔗 Copy link</a>
    </div>
    <div class="cta-band sans"><div><h3>🏢 ህንፃ አለዎት?</h3><p>BinaSmart — ሙሉ የህንፃ አስተዳደር ሲስተም በ24 ሰዓት።</p></div><a href="/diaspora">ይጀምሩ →</a></div>
  </article>
  <div style="max-width:1080px;margin:0 auto;border-top:3px double var(--line)"><h2 class="sans" style="font-size:13px;letter-spacing:2px;color:var(--mut);padding:22px 0 0;text-transform:uppercase">ተጨማሪ ያንብቡ · Read more</h2><div class="grid">${rel}</div></div></main>`;
  reply.type('text/html').send(newsShell({ title: p.title + ' — Bina ዜና', desc: p.excerpt, canonical: 'https://bina.et/news/' + p.slug, extraHead: schema, body, active: 'news', ogImage: ogFor(p.slug, 'https://bina.et/static/bina-news.png') }));
});

// ---- TENDERS HUB ----
fastify.get('/tenders', async (req, reply) => {
  const cat = req.query.cat;
  const tenders = await prisma.tender.findMany({ where: { published: true, ...(cat ? { category: cat } : {}) }, orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }], take: 200 });
  const chips = ['ሁሉም', ...TENDER_CATS].map(c =>
    `<a class="chip sans ${(!cat && c === 'ሁሉም') || cat === c ? 'on' : ''}" href="/tenders${c === 'ሁሉም' ? '' : '?cat=' + encodeURIComponent(c)}">${c}</a>`).join('');
  const rows = tenders.map(t => `<div class="t-card">
    <div><span class="cat sans" style="color:var(--gold)">${escH(t.category)}</span>
      <h3><a href="/tenders/${t.slug}">${escH(t.titleAm || t.title)}</a></h3>
      ${t.titleAm && t.title && t.titleAm !== t.title ? `<div class="t-en sans" style="font-size:12.5px;color:var(--mut);margin:1px 0 3px;line-height:1.35">${escH(t.title)}</div>` : ''}
      <div class="t-org sans">${escH(t.org)}</div>
      <div class="t-tags sans"><span class="t-tag">📍 ${escH(t.region)}</span>${t.budget ? `<span class="t-tag">💰 ${escH(t.budget)}</span>` : ''}${t.deadline ? `<span class="t-tag">🗓 Deadline: ${amDate(t.deadline)}</span>` : `<span class="t-tag">🗓 ማብቂያ፡ ሰነዱን ይመልከቱ</span>`}</div>
    </div>
    ${t.deadline ? `<div class="dl sans" data-deadline="${new Date(t.deadline).toISOString()}"><b></b><span></span></div>` : ''}
  </div>`).join('');
  const empty = `<div class="empty"><div class="big">📋</div><h3>የመጀመሪያዎቹ ጨረታዎች በቅርቡ ይለቀቃሉ</h3>
    <p class="sans" style="max-width:520px;margin:0 auto">Daily verified construction, supply and service tenders from across Ethiopia — every listing checked against its source before publishing. First listings go live this week.</p>
    <p class="sans" style="margin-top:22px"><a href="https://wa.me/251911244344?text=${encodeURIComponent('ሰላም! ጨረታ ሲወጣ አሳውቁኝ / Notify me when tenders go live')}" style="background:var(--ink);color:#fff;border-radius:999px;padding:13px 28px;font-weight:800;font-size:14px">🔔 ጨረታ ሲወጣ አሳውቀኝ · Notify me</a></p></div>`;
  const body = `<main>
    <div class="phero" style="--pg:linear-gradient(135deg,#064e3b,#059669);--wm:'📋'"><h1>ጨረታዎች · Tenders</h1><div class="am sans">የተረጋገጡ የኢትዮጵያ ጨረታዎች — ግንባታ · አቅርቦት · አገልግሎት</div><div class="sub sans">Verified Ethiopian tenders with full details, contacts &amp; deadlines — updated daily, free.</div></div>
    <div class="chips" style="--chipon:#059669">${chips}</div>
    ${rows || empty}
    <div class="cta-band sans" style="background:var(--em)"><div><h3>📢 ጨረታዎን በነጻ ያውጡ · Post your tender FREE</h3><p>Organizations: we publish your tender at no cost — reach thousands of bidders.</p></div><a style="background:#fff;color:var(--em)" href="https://wa.me/251911244344?text=${encodeURIComponent('ሰላም! ጨረታ ማውጣት እፈልጋለሁ / I want to post a tender')}">WhatsApp us →</a></div>
    <div class="cta-band sans"><div><h3>📰 ዜናችንንም ያንብቡ</h3><p>Technology, construction & business — in Amharic, politics-free.</p></div><a href="/news">ወደ ዜና →</a></div>
  </main>`;
  reply.type('text/html').send(newsShell({ title: 'ጨረታዎች — Verified Ethiopian Tenders | Bina', desc: 'Daily verified Ethiopian tenders: construction, supply, services and consultancy — with deadlines and sources. የተረጋገጡ ጨረታዎች በየቀኑ።', canonical: 'https://bina.et/tenders', body, active: 'tenders' }));
});

// ---- TENDER DETAIL ----
fastify.get('/tenders/:slug', async (req, reply) => {
  const t = await prisma.tender.findUnique({ where: { slug: req.params.slug } });
  if (!t || !t.published) return reply.code(404).type('text/html').send(newsShell({ title: 'Not found', desc: '', canonical: 'https://bina.et/tenders', body: '<main><div class="empty"><div class="big">📋</div><h3>ጨረታው አልተገኘም</h3><p class="sans"><a href="/tenders" style="color:var(--em)">← ወደ ጨረታዎች</a></p></div></main>', active: 'tenders' }));
  const body = `<main><article class="art">
    <span class="cat sans" style="color:var(--gold)">${escH(t.category)}</span>
    <h1>${escH(t.titleAm || t.title)}</h1>
    ${t.titleAm ? `<p class="sans" style="color:var(--mut);font-size:15px;margin:-6px 0 10px">${escH(t.title)}</p>` : ''}
    <div class="rule sans"><span>${escH(t.org)}</span><span>·</span><span>📍 ${escH(t.region)}</span></div>
    <div class="t-tags sans" style="margin-bottom:26px">${t.deadline ? `<span class="t-tag">🗓 Deadline: ${amDate(t.deadline)}</span>` : `<span class="t-tag">🗓 ማብቂያ፡ ሰነዱን ይመልከቱ · See document</span>`}${t.budget ? `<span class="t-tag">💰 ${escH(t.budget)}</span>` : ''}</div>
    ${t.deadline ? `<div class="dl sans" style="display:inline-block;margin-bottom:26px" data-deadline="${new Date(t.deadline).toISOString()}"><b></b><span></span></div>` : ''}
    <div class="body-t"><p>${escH(t.summary)}</p>${t.bodyHtml || ''}</div>
    ${t.sourceUrl ? `<p class="sans" style="font-size:13px;color:var(--mut)">ምንጭ · Source: <a href="${escH(t.sourceUrl)}" rel="nofollow" style="color:var(--em)">${escH(t.sourceName || t.sourceUrl)}</a></p>` : ''}
    <div class="cta-band sans"><div><h3>🔔 ተመሳሳይ ጨረታዎችን በWhatsApp ይቀበሉ</h3><p>Get tenders like this the moment they publish.</p></div><a href="https://wa.me/251911244344?text=${encodeURIComponent('ሰላም! የ' + t.category + ' ጨረታ ማሳወቂያ እፈልጋለሁ')}">Subscribe →</a></div>
  </article></main>`;
  reply.type('text/html').send(newsShell({ title: t.title + ' — ጨረታ | Bina', desc: t.summary.slice(0, 155), canonical: 'https://bina.et/tenders/' + t.slug, body, active: 'tenders', ogImage: ogFor(t.slug, 'https://bina.et/static/bina-tenders.png') }));
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
  sendTg('8096525984', confirm).catch(() => {});
  return out;
}


// ---- TEMP: FB token bootstrap form (remove after setup) ----
fastify.get('/fb-setup-x7k2', async (req, reply) => {
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
  const tok = String((req.body || {}).token || '').trim();
  if (!tok || tok.length < 40) return reply.code(400).type('text/html').send('<h2>❌ Missing/short token</h2>');
  const pageId = '1400749246446309';
  try {
    const r = await fetch('https://graph.facebook.com/v21.0/' + pageId + '?fields=access_token,name&access_token=' + encodeURIComponent(tok)).then(x => x.json());
    if (r.error || !r.access_token) return reply.type('text/html').send('<h2>❌ ' + (r.error ? r.error.message : 'No page token — token may lack pages_manage_posts') + '</h2>');
    const pageTok = r.access_token;
    process.env.BINA_FB_PAGE_ID = pageId;
    process.env.BINA_FB_PAGE_TOKEN = pageTok;
    let env = fs.readFileSync('.env', 'utf8').split('\n').filter(l => !/^BINA_FB_PAGE_(ID|TOKEN)=/.test(l)).join('\n').replace(/\n+$/, '');
    env += '\nBINA_FB_PAGE_ID=' + pageId + '\nBINA_FB_PAGE_TOKEN=' + pageTok + '\n';
    fs.writeFileSync('.env', env);
    fs.writeFileSync('/root/storage/binasmart-fb-bootstrap.json', JSON.stringify({ pageId: pageId, page: r.name, ok: true }));
    reply.type('text/html').send('<body style="font-family:sans-serif;text-align:center;margin-top:80px"><h1>✅ Facebook connected!</h1><p>Page: <b>' + r.name + '</b></p><p>Tell Claude "saved".</p></body>');
  } catch (e) { reply.type('text/html').send('<h2>❌ ' + String(e).slice(0, 100) + '</h2>'); }
});

// ---- ADMIN: add news / tender (global key) ----
fastify.post('/api/admin/news', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body;
  const { silent, linkedin, ...data } = b;
  const post = await prisma.newsPost.upsert({ where: { slug: data.slug }, update: data, create: data });
  const url = 'https://bina.et/news/' + post.slug;
  if (post.published && !b.silent) {
    autopostAll({
      emoji: post.heroEmoji || '📰', title: post.title, excerpt: post.excerpt, url,
      tags: '#BinaZena #' + post.category,
      linkedin: b.linkedin || (post.title + '\n\n' + post.excerpt + '\n\nRead in Amharic + English: ' + url + '\n\n#Ethiopia #' + post.category)
    }).catch(() => {});
  }
  return { ok: true, url };
});
fastify.post('/api/admin/tender', async (req, reply) => {
  if (authFail(req, reply)) return;
  const b = req.body;
  const { silent, ...data } = b;
  data.deadline = new Date(data.deadline);
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
</script></body></html>`);
});

fastify.post('/api/admin/tender-queue/publish', async (req, reply) => {
  if (authFail(req, reply)) return;
  const { items, broadcast } = req.body || {};
  if (!Array.isArray(items) || !items.length) return { published: 0 };
  const cands = loadCands();
  const byId = Object.fromEntries(cands.map(c => [c.id, c]));
  const slugify = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
  let published = 0; const doneIds = [];
  for (const it of items) {
    const c = byId[it.id]; if (!c) continue;
    const slug = 'rt-' + slugify((c.org||'') + '-' + (it.title||c.title));
    const rec = { slug, title: (it.title||c.title).slice(0,140), category: it.category||'Supply',
      region: it.region||'Ethiopia', org: c.org || 'Ethiopia', summary: (it.summary||c.summary).slice(0,600),
      deadline: new Date(it.deadline), sourceUrl: c.source, sourceName: c.sourceName, published: true };
    try {
      const t = await prisma.tender.upsert({ where: { slug }, update: rec, create: rec });
      published++; doneIds.push(it.id);
      if (broadcast) {
        const dl = new Date(t.deadline).toISOString().slice(0,10);
        autopostAll({ emoji: '📋', title: 'ጨረታ · Tender: ' + t.title,
          excerpt: (t.org ? t.org + '\n' : '') + '⏰ Deadline: ' + dl + (t.region ? ' · 📍 ' + t.region : ''),
          url: 'https://bina.et/tenders/' + t.slug, tags: '#Tender #ጨረታ #Ethiopia' }).catch(()=>{});
      }
    } catch(e) { /* skip bad row */ }
  }
  const remaining = cands.filter(c => !doneIds.includes(c.id));
  saveCands(remaining);
  return { published, remaining: remaining.length };
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
      const schema = JSON.stringify(_schemaObj) + '</script>\n<script type="application/ld+json">' + JSON.stringify(_bc);
      html = html.replace('<title>BinaSmart — Building</title>',
        '<title>' + title + '</title>\n'
        + '<meta name="description" content="' + desc + '">\n'
        + '<link rel="canonical" href="' + url + '">\n'
        + '<meta property="og:title" content="' + title + '">\n'
        + '<meta property="og:description" content="' + desc + '">\n'
        + '<meta property="og:type" content="website">\n'
        + '<meta property="og:url" content="' + url + '">\n'
        + (b.facadePhotoUrl ? '<meta property="og:image" content="https://bina.et' + b.facadePhotoUrl.replace('/static','/static') + '">\n' : '')
        + '<script type="application/ld+json">' + schema + '</script>');
    }
  } catch (e) {}
  reply.type('text/html').send(html);
});

// ===== OWNER PAGE =====
fastify.get('/owner/:slug', async (req, reply) => reply.sendFile('owner.html'));

// ===== PUBLIC: building by QR slug =====
fastify.get('/api/b/:slug', async (req, reply) => {
  const b = await prisma.building.findUnique({
    where: { qrSlug: req.params.slug },
    include: {
      units: {
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        include: {
          tenancies: {
            where: { active: true },
            include: { shop: { include: { products: { where: { visible: true } }, offers: { where: { active: true, endsAt: { gt: new Date() } } } } } }
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
      monthlyRent: u.monthlyRent, status: u.status,
      shop: shop ? {
        id: shop.id, name: shop.name, nameAm: shop.nameAm, icon: shop.icon,
        category: shop.category, phone: shop.phone,
        avgRating: Math.round(shop.avgRating * 10) / 10, reviewCount: shop.reviewCount,
        isOpenNow: shop.isOpenNow,
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

// ===== PUBLIC: create lead =====
fastify.post('/api/units/:unitId/leads', async (req, reply) => {
  const { name, phone, budgetMax } = req.body || {};
  if (!name || !phone) return reply.code(400).send({ error: 'name_and_phone_required' });
  const lead = await prisma.lead.create({ data: { unitId: req.params.unitId, name, phone, budgetMax: budgetMax || null, source: 'QR' } });
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
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'building_not_found' });
  const { name, phone, unit, type, description } = req.body || {};
  if (!phone || !description) return reply.code(400).send({ error: 'phone_and_description_required' });
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
    if (bb.owner && bb.owner.phone) sendWa(bb.owner.phone, '🔧 New maintenance request — ' + bb.name + '\n' + (type || 'GENERAL') + ': ' + String(description).slice(0, 120) + (unit ? '\nUnit: ' + unit : '') + '\nBy: ' + (name || '') + ' ' + phone + '\n\n📊 bina.et/owner');
    const tech = await prisma.staffMember.findFirst({ where: { buildingId: b.id, active: true, role: { in: ['MAINTENANCE', 'TECHNICIAN', 'LIFT'] } } });
    if (tech && tech.phone) sendWa(tech.phone, '🔧 ' + (type || 'GENERAL') + ': ' + String(description).slice(0, 120) + (unit ? ' — Unit ' + unit : '') + ' / አዲስ የጥገና ጥያቄ');
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
    + '</body></html>';
  reply.type('text/html').send(html);
});

// ===== AUDIT helper =====
async function audit(buildingId, action, detail, amount){
  try{ await prisma.auditLog.create({ data: { buildingId, action, detail: detail ? String(detail).slice(0, 200) : null, amount: amount != null ? Math.round(amount) : null } }); }catch(e){}
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
  const auditRows = await prisma.auditLog.findMany({ where: { buildingId: b.id }, orderBy: { createdAt: 'desc' }, take: 40 });
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

// ===== Owner AI agent — GLM-backed, scoped to THIS owner's building only =====
fastify.post('/api/owner/:slug/ai', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const msg = String((req.body || {}).message || '').slice(0, 800).trim();
  if (!msg) return reply.code(400).send({ error: 'message_required' });
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, include: { units: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const now = new Date();
  const m = now.toISOString().slice(0, 7); const [y, mo] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 1));
  const units = b.units || [];
  const occupied = units.filter(u => u.status === 'OCCUPIED').length;
  const vacant = units.filter(u => u.status === 'VACANT').length;
  const expectedRent = units.reduce((s, u) => s + (u.monthlyRent || 0), 0);
  const vacantList = units.filter(u => u.status === 'VACANT').map(u => u.number).slice(0, 30).join(', ') || 'none';
  let invoiced = 0, collected = 0, outstanding = 0, overdueN = 0, overdueAmt = 0, outputVat = 0, inputVat = 0, netVat = 0, openMaint = 0;
  try {
    const invs = await prisma.invoice.findMany({ where: { tenancy: { unit: { buildingId: b.id } }, dueDate: { gte: start, lt: end } } });
    invoiced = invs.reduce((s, i) => s + i.amount, 0);
    collected = invs.filter(i => i.status === 'PAID').reduce((s, i) => s + i.amount, 0);
    outstanding = invoiced - collected;
    const od = invs.filter(i => i.status !== 'PAID' && i.dueDate < now);
    overdueN = od.length; overdueAmt = od.reduce((s, i) => s + i.amount, 0);
    outputVat = b.vatRegistered ? Math.round(b.vatInclusive ? invoiced * VAT_RATE / (1 + VAT_RATE) : invoiced * VAT_RATE) : 0;
    const exps = await prisma.expense.findMany({ where: { buildingId: b.id, date: { gte: start, lt: end } } });
    inputVat = b.vatRegistered ? exps.reduce((s, e) => s + (e.vatAmount || 0), 0) : 0;
    netVat = outputVat - inputVat;
  } catch (e) {}
  try { openMaint = await prisma.maintenanceRequest.count({ where: { unit: { buildingId: b.id }, status: { not: 'DONE' } } }); } catch (e) {}
  const data = `Building: ${b.name}${b.nameAm ? ' / ' + b.nameAm : ''} (${b.city || ''}).
Units: ${units.length} total — ${occupied} occupied, ${vacant} vacant. Vacant unit numbers: ${vacantList}.
Expected monthly rent (all units): ${expectedRent} ETB.
This month (${m}): invoiced ${invoiced} ETB, collected ${collected} ETB, outstanding ${outstanding} ETB.
Overdue invoices: ${overdueN} (total ${overdueAmt} ETB).
Open maintenance requests: ${openMaint}.
VAT registered: ${b.vatRegistered ? ('yes, no. ' + (b.vatNumber || '-')) : 'no'}. This month output VAT ${outputVat} ETB, input VAT ${inputVat} ETB, net VAT payable ${netVat} ETB (rate ${Math.round(VAT_RATE*100)}%).
TIN: ${b.tinNumber || '-'}.`;
  const SYS = `You are "Bini", the BinaSmart assistant for the OWNER of this building. Answer ONLY from the DATA below about THIS building — never invent numbers. Reply in the user's language (Amharic or English), short and concrete, and give exact figures from the data (amounts in ETB). If the answer isn't in the data, say so briefly and point to the relevant dashboard tab (Overview, Rent Collection, Accounting, Maintenance). Do not give tax-filing or legal advice beyond the figures shown.
DATA:
${data}`;
  const FALLBACK = 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ ዳሽቦርዱን ይመልከቱ።';
  try {
    const text = await callBini(SYS, [{ role: 'user', content: msg }], 700);
    return reply.send({ reply: text || FALLBACK });
  } catch (e) { return reply.send({ reply: FALLBACK }); }
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
const TG_TOKEN = process.env.BINASMART_TG_TOKEN || '';
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
async function notifyTenant(user, text, channel){
  let sent = false;
  if (user.phone) sent = await sendWa(user.phone, text, channel);
  if (user.telegramChatId) { const t = await sendTg(user.telegramChatId, text); sent = sent || t; }
  return sent;
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
    const canSend = NOTIFY_WHITELIST.includes(b.qrSlug);
    const bChan = WA_CHANNEL[b.qrSlug];
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
      if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(t.user, 'ሰላም! የ' + b.nameAm + ' ክፍል ' + t.unit.number + ' ውልዎ በ' + days + ' ቀናት ውስጥ ያበቃል። ለማደስ ያነጋግሩን። — BinaSmart', bChan);
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
      if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(i.tenancy.user, 'ሰላም! የ' + b.nameAm + ' ኪራይ ' + i.amount.toLocaleString() + ' ብር በ' + i.dueDate.toISOString().slice(0, 10) + ' ይከፈላል። ኮድ: ' + (i.paymentCode || '') + ' — BinaSmart');
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
      if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(i.tenancy.user, 'ማሳሰቢያ: የ' + b.nameAm + ' ኪራይ ክፍያዎ አልፏል። ቅጣት ' + fee.toLocaleString() + ' ብር ታክሏል። — BinaSmart');
      res.penalties++;
    }
    if (canSend && ownerMsgs.length && b.owner && b.owner.phone) {
      res.notified = await sendWa(b.owner.phone, '🏢 ' + b.name + ' — BinaSmart daily report:\n\n' + ownerMsgs.slice(0, 15).join('\n') + (ownerMsgs.length > 15 ? '\n…+' + (ownerMsgs.length - 15) + ' more' : '') + '\n\n📊 bina.et/owner');
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

// ===== TELEGRAM LINKING (tenant opt-in bot) =====
fastify.post('/api/tg-webhook', async (req, reply) => {
  reply.send({ ok: true });
  try{
    const msg = (req.body || {}).message;
    if (!msg || !msg.chat || !msg.text) return;
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    if (text.startsWith('/start')){
      await sendTg(chatId, 'ሰላም! 🏢 BinaSmart — የጄጄ ዳሩሌ ህንፃ\n\nየክፍልዎን ቁጥር ይላኩ (ለምሳሌ: 707 ወይም G-003)\nPlease send your unit number (e.g. 707 or G-003) to receive rent & contract reminders here.');
      return;
    }
    const b = await prisma.building.findUnique({ where: { qrSlug: 'darulle' } });
    const unit = await prisma.unit.findFirst({
      where: { buildingId: b.id, number: { equals: text, mode: 'insensitive' } },
      include: { tenancies: { where: { active: true }, include: { user: true, shop: true } } }
    });
    if (!unit || !unit.tenancies[0]){
      await sendTg(chatId, '❌ ክፍል "' + text.slice(0, 20) + '" አልተገኘም። እባክዎ በትክክል ይላኩ (ለምሳሌ: 112/01)\nUnit not found — please send it exactly as on your contract.');
      return;
    }
    const t = unit.tenancies[0];
    await prisma.user.update({ where: { id: t.userId }, data: { telegramChatId: chatId } });
    await audit(b.id, 'TG_LINKED', unit.number + ' ' + (t.shop ? t.shop.name : t.user.fullName));
    await sendTg(chatId, '✅ ተሳክቷል! ' + (t.shop ? (t.shop.nameAm || t.shop.name) : t.user.fullName) + ' — ክፍል ' + unit.number + '\n\nከአሁን በኋላ የኪራይ እና የውል ማሳሰቢያዎች እዚህ ይደርስዎታል። 🔔\nYou will now receive rent & contract reminders here on Telegram too.');
  }catch(e){ console.error('[tg-webhook]', e.message); }
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
    + '</body></html>';
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
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId },
    include: { tenancies: { where: { active: true }, include: { user: true, shop: true, contract: true } } } });
  if (!u) return reply.code(404).send({ error: 'unit_not_found' });
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
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId }, include: { tenancies: { where: { active: true } } } });
  if (!u) return reply.code(404).send({ error: 'unit_not_found' });
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

// ===== OWNER: send invoice to tenant (WhatsApp + Telegram) =====
fastify.post('/api/owner/:slug/invoice/:id/send', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id },
    include: { tenancy: { include: { unit: true, shop: true, user: true } } } });
  if (!inv || inv.tenancy.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (!NOTIFY_WHITELIST.includes(b.qrSlug)) return reply.code(403).send({ error: 'messaging_not_enabled_for_this_building' });
  const total = inv.amount + (inv.lateFee || 0);
  const typeAm = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' }[inv.type] || 'ክፍያ';
  const banks = (b.bankAccounts || []).map(a => '• ' + a.bank + ': ' + a.account).join('\n');
  const msg = '🧾 የክፍያ መጠየቂያ / INVOICE\n' +
    '━━━━━━━━━━━━━━━\n' +
    '🏢 ' + (b.nameAm || b.name) + '\n' + b.name + (b.tinNumber ? ' · TIN ' + b.tinNumber : '') + '\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👤 ' + (inv.tenancy.shop ? (inv.tenancy.shop.nameAm || inv.tenancy.shop.name) : inv.tenancy.user.fullName) + ' — ክፍል ' + inv.tenancy.unit.number + '\n' +
    '💰 ' + typeAm + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB' +
    (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '') +
    '\n📌 ጠቅላላ / TOTAL: ' + total.toLocaleString() + ' ETB\n' +
    '📅 መክፈያ ቀን / Due: ' + inv.dueDate.toISOString().slice(0, 10) + '\n' +
    (banks ? '━━━━━━━━━━━━━━━\n🏦 የሚከፈልበት / Pay to:\n' + banks + '\n' : '') +
    (inv.paymentCode ? '#️⃣ ማጣቀሻ / Reference: ' + inv.paymentCode + '\n' : '') +
    '━━━━━━━━━━━━━━━\n' +
    'ክፍያ ሲፈጽሙ ኮዱን እንደ ማጣቀሻ ይጠቀሙ። / Use the reference code with your transfer.\n— ' + b.name + ' · BinaSmart';
  const sent = await notifyTenant(inv.tenancy.user, msg, WA_CHANNEL[b.qrSlug]);
  await audit(b.id, 'INVOICE_SENT', (inv.tenancy.shop ? inv.tenancy.shop.name : '') + ' ' + inv.tenancy.unit.number + (sent ? '' : ' (delivery pending — channel down)'), total);
  return { ok: true, delivered: sent };
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
  const key = s.slice(0, 3).toUpperCase() + '-' + cryptoMod.randomBytes(5).toString('hex').toUpperCase();
  const b = await prisma.building.create({ data: {
    orgId: base.orgId, ownerId: base.ownerId,
    name: String(name).slice(0, 80), nameAm: nameAm || name,
    city: city || 'Addis Ababa', subCity: subCity || null,
    floors: Math.max(1, parseInt(floors) || 1), qrSlug: s,
    signText: nameAm || name, ownerKey: key,
    threeD_style: 'modern', threeD_facadeColor: '#a3b3c2', threeD_width: 14, threeD_depth: 11,
    marketplaceEnabled: true
  }});
  await audit(b.id, 'BUILDING_CREATED', name + ' by owner of ' + base.name);
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
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId },
    include: { tenancies: { where: { active: false }, orderBy: { endDate: 'desc' }, take: 1, include: { shop: true, user: true } } } });
  if (!u) return reply.code(404).send({ error: 'unit_not_found' });
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
  const u = await prisma.unit.findUnique({ where: { id: req.params.unitId }, include: { building: true } });
  if (!u) return reply.code(404).send({ error: 'unit_not_found' });
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

// ===== INVOICE GENERATOR (reusable) =====
async function generateInvoicesForBuilding(buildingId, when = new Date()) {
  const y = when.getFullYear(), m = when.getMonth();
  const monthStart = new Date(y, m, 1);
  const monthEnd = new Date(y, m + 1, 1);
  const tenancies = await prisma.tenancy.findMany({
    where: { active: true, unit: { buildingId } },
    include: { unit: true, contract: true }
  });
  let created = 0, skipped = 0;
  for (const t of tenancies) {
    const exists = await prisma.invoice.findFirst({
      where: { tenancyId: t.id, type: 'RENT', dueDate: { gte: monthStart, lt: monthEnd } }
    });
    if (exists) { skipped++; continue; }
    const amount = t.contract?.monthlyRent || t.unit.monthlyRent;
    const code = 'BS-' + Math.floor(1000 + Math.random() * 9000) + '-' + t.unit.number.replace(/[^A-Za-z0-9]/g, '');
    await prisma.invoice.create({ data: {
      tenancyId: t.id, type: 'RENT', amount,
      dueDate: new Date(y, m, 5), paymentCode: code, status: 'PENDING'
    }});
    created++;
  }
  return { created, skipped, month: (m + 1) + '/' + y };
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
  const { method } = req.body || {};
  const inv = await prisma.invoice.update({
    where: { id: req.params.id },
    data: { status: 'PAID', paidDate: new Date(), method: method || 'CASH' },
    include: { tenancy: { include: { unit: true, shop: true } } }
  });
  await audit(inv.tenancy.unit.buildingId, 'INVOICE_PAID', (inv.tenancy.shop ? inv.tenancy.shop.name : 'Unit') + ' ' + inv.tenancy.unit.number + ' via ' + (method || 'CASH'), inv.amount);
  // e-receipt to the tenant, under the building's name
  try{
    const bb = await prisma.building.findUnique({ where: { id: inv.tenancy.unit.buildingId } });
    if (NOTIFY_WHITELIST.includes(bb.qrSlug)) {
      const tu = await prisma.user.findUnique({ where: { id: inv.tenancy.userId } });
      const total = inv.amount + (inv.lateFee || 0);
      const typeAm = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' }[inv.type] || 'ክፍያ';
      const vatLine = bb.vatRegistered ? '\nVAT (15%): ' + Math.round(total * 0.15 / 1.15).toLocaleString() + ' ETB (ተካቷል/incl.)' : '';
      const receipt = '🧾 ደረሰኝ / E-RECEIPT\n' +
        '━━━━━━━━━━━━━━━\n' +
        '🏢 ' + (bb.nameAm || bb.name) + '\n' + bb.name + (bb.tinNumber ? ' · TIN ' + bb.tinNumber : '') + '\n' +
        '━━━━━━━━━━━━━━━\n' +
        '👤 ' + (inv.tenancy.shop ? (inv.tenancy.shop.nameAm || inv.tenancy.shop.name) : tu.fullName) + ' — ክፍል ' + inv.tenancy.unit.number + '\n' +
        '💰 ' + typeAm + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB' +
        (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '') +
        '\n✅ ጠቅላላ የተከፈለ / TOTAL PAID: ' + total.toLocaleString() + ' ETB' + vatLine + '\n' +
        '💳 በ: ' + (method || 'CASH') + ' · ' + new Date().toISOString().slice(0, 10) + '\n' +
        (inv.paymentCode ? '#️⃣ ' + inv.paymentCode + '\n' : '') +
        '━━━━━━━━━━━━━━━\n' +
        'እናመሰግናለን! / Thank you!\n📊 BinaSmart · bina.et/b/' + bb.qrSlug;
      if (tu) notifyTenant(tu, receipt, WA_CHANNEL[bb.qrSlug]);
    }
  }catch(e){ console.error('[receipt]', e.message); }
  return { ok: true, invoice: inv.id };
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
    const buildings = await prisma.building.findMany({ select: { id: true, name: true } });
    for (const b of buildings) {
      const r = await generateInvoicesForBuilding(b.id);
      console.log('[cron] invoices', b.name, JSON.stringify(r));
    }
  } catch (e) { console.error('[cron] invoice error', e.message); }
}, { timezone: 'Africa/Addis_Ababa' });

// ===== CRON: daily 08:00 — expire old offers =====
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
  try{ const b=req.body||{}; const ref=b.tx_ref||b.trx_ref||b.reference||(req.query&&req.query.ref); if(ref) await chapaVerify(ref); if(ref && cinema && /^bina-cin-/.test(String(ref))) await cinema.confirmChapa(ref); }catch(e){}
  reply.send({ received:true });
});
// Return URL (user redirected back)
fastify.get('/pay/callback', async (req, reply) => {
  const ref=req.query.ref; let paid=false, amt='', purpose='';
  if(ref==='wallet'){ paid=req.query.ok==='1'; amt=req.query.amt||''; purpose='Wallet payment'; }
  else if(ref){ try{ const r=await chapaVerify(ref); paid=r.ok; const p=await prisma.payment.findUnique({ where:{ txRef:ref } }); if(p){ amt=p.amount; purpose=p.purpose||''; } }catch(e){} }
  const ok=paid;
  const body='<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+(ok?'ክፍያ ተሳክቷል':'ክፍያ በመጠባበቅ ላይ')+' · BinaSmart</title>'+
  '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&family=Noto+Sans+Ethiopic:wght@600;800&display=swap" rel="stylesheet">'+
  '<style>*{margin:0;box-sizing:border-box}body{font-family:\'Plus Jakarta Sans\',\'Noto Sans Ethiopic\',sans-serif;background:#f6faf9;color:#0b2a26;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.c{background:#fff;border:1.5px solid #e2ece9;border-radius:24px;padding:34px 26px;max-width:400px;text-align:center;box-shadow:0 20px 50px -26px rgba(11,42,38,.4)}.ic{width:84px;height:84px;border-radius:50%;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;font-size:44px;color:#fff;background:'+(ok?'linear-gradient(135deg,#059669,#0aa88f)':'linear-gradient(135deg,#d97706,#f59e0b)')+'}h1{font-size:22px;font-weight:800}p{color:#5c7371;font-size:14px;margin-top:8px}.amt{font-size:30px;font-weight:800;color:#057461;margin:14px 0}a{display:inline-block;margin-top:20px;background:linear-gradient(135deg,#0b2a26,#068c78);color:#fff;font-weight:800;border-radius:999px;padding:13px 28px;text-decoration:none}</style></head>'+
  '<body><div class="c"><div class="ic">'+(ok?'✓':'⏳')+'</div><h1 class="am">'+(ok?'ክፍያ ተሳክቷል!':'ክፍያ በመጠባበቅ ላይ ነው')+'</h1>'+(amt?'<div class="amt">ETB '+amt+'</div>':'')+'<p class="am">'+(ok?('የ'+ (purpose||'BinaSmart') +' ክፍያዎ ተከፍሏል። እናመሰግናለን!'):'ክፍያዎ ገና አልተረጋገጠም። ካጠናቀቁ ትንሽ ቆይተው ይሞክሩ።')+'</p><p style="font-size:11px;margin-top:10px">Ref: '+(ref||'')+'</p><a href="/" class="am">← ወደ BinaSmart</a></div></body></html>';
  reply.type('text/html').send(body);
});
// Test checkout page
fastify.get('/pay', async (req, reply) => {
  const amt=req.query.amount||''; const purpose=req.query.for||''; const bt=req.query.bt||''; const bc=req.query.bc||'';
  const locked = !!(amt && bc);
  const esc=v=>String(v).replace(/"/g,'&quot;');
  const body='<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ክፍያ · Pay · BinaSmart</title>'+
  '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&family=Noto+Sans+Ethiopic:wght@600;800&display=swap" rel="stylesheet">'+
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
  '</script></body></html>';
  reply.type('text/html').send(body);
});

const WALLET_HTML = `<!DOCTYPE html>
<html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>የኔ ዋሌት · BinaSmart Wallet</title>
<link rel="icon" href="/icon-32.png">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Noto+Sans+Ethiopic:wght@600;700;800&display=swap" rel="stylesheet">
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
</div></body></html>`;

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
require('./ride')(fastify, {
  prisma, sendTg, OWNER_KEY,
  OWNER_CHAT: '8096525984',
  ROUTER_URL: process.env.ROUTER_URL || 'http://127.0.0.1:8989',
  BASE_URL: 'https://bina.et'
});

// ===== BinaSmart Cinema & Events: seat booking (Phase A). Mounted only when CINEMA_ENABLED=1 =====
const cinema = require('./cinema')(fastify, {
  prisma, OWNER_KEY, BASE_URL: 'https://bina.et',
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

fastify.listen({ port: PORT, host: '127.0.0.1' })
  .then(() => console.log('BinaSmart API v0.2 on :' + PORT))
  .catch(err => { console.error(err); process.exit(1); });
