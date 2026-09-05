'use strict';
// BinaSmart Business: a shop, office or venue owner manages their own page.
// The building owner keeps their full property dashboard (/owner); this one is deliberately small —
// profile, catalogue, offers, orders — and a tenant with several units switches between them.
// Photos arrive as data URLs (no multipart plugin in this app) and are written as jpeg files.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeOwners } = require('./owners');
const { normPhone } = require('../ride/phone');
const { makeTgApi } = require('../ride/tgApi');

const CATEGORIES = ['CAFE', 'RESTAURANT', 'PHARMACY', 'RETAIL', 'SERVICE', 'GYM', 'SALON', 'CLINIC', 'BANK', 'OFFICE', 'OTHER'];
const CAT_AM = { CAFE: 'ካፌ', RESTAURANT: 'ሬስቶራንት', PHARMACY: 'ፋርማሲ', RETAIL: 'መደብር', SERVICE: 'አገልግሎት', GYM: 'ጂም', SALON: 'ሳሎን', CLINIC: 'ክሊኒክ', BANK: 'ባንክ', OFFICE: 'ቢሮ', OTHER: 'ሌላ' };
const STATUS_NEXT = { NEW: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['DELIVERED', 'CANCELLED'], DELIVERED: ['COMPLETED'], COMPLETED: [], CANCELLED: [], REJECTED: [] };
const MAX_PRODUCTS = 200, MAX_PHOTOS = 8, MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200) || null;
const intOr = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
const escAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function limiter(windowMs, max) { const m = new Map(); return key => { const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs); if (hits.length >= max) return false; hits.push(now); m.set(key, hits); if (m.size > 5000) for (const [k, v] of m) if (!v.length || now - v[v.length - 1] > windowMs) m.delete(k); return true; }; }
const clientIp = req => String(req.headers['x-real-ip'] || req.ip);

// A slug must be ASCII, so it comes from the English name; Amharic script folds to nothing, and an
// Amharic-only tenant gets a short id-based slug rather than a meaningless one.
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')      // drop accents: café -> cafe
    .replace(/['’`]/g, '')                // Kaldi's -> kaldis
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
const openNow = (hours, d) => {
  if (!hours || typeof hours !== 'object') return null;
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(d).getUTCDay()];
  const row = hours[day]; if (!row || !row.open || !row.close || row.closed) return false;
  const mins = new Date(d).getUTCHours() * 60 + new Date(d).getUTCMinutes() + 180;   // Addis = UTC+3
  const [oh, om] = row.open.split(':').map(Number), [ch, cm] = row.close.split(':').map(Number);
  const now = mins % 1440;
  return now >= oh * 60 + om && now <= ch * 60 + cm;
};

// registerBusiness(fastify, { prisma, OWNER_KEY, BASE_URL, tgApi?, riderBotToken?, ownerChat?, force?, now? })
module.exports = function registerBusiness(fastify, deps) {
  if (process.env.BUSINESS_ENABLED !== '1' && !deps.force) { console.log('[business] disabled (BUSINESS_ENABLED != 1)'); return null; }
  const prisma = deps.prisma, base = (deps.BASE_URL || 'https://bina.et').replace(/\/$/, '');
  const clock = deps.now || Date.now;
  const riderBotToken = deps.riderBotToken != null ? deps.riderBotToken : (process.env.BINA_RIDER_BOT_TOKEN || '');
  const api = deps.tgApi || (riderBotToken ? makeTgApi({ token: riderBotToken }) : null);
  const ownerChat = deps.ownerChat || process.env.BINA_OWNER_TG_CHAT || '';
  const uploadsDir = deps.uploadsDir || path.join(__dirname, '..', 'uploads', 'shops');
  const claimRL = limiter(600000, 6), orderRL = limiter(600000, 8), ipRL = limiter(60000, 300);
  const ops = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== deps.OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };

  // The code goes to the owner's Telegram when the shop record has one; otherwise Ibrahim approves.
  const notify = async ({ claim, target, code, phone }) => {
    let sent = false;
    if (claim.telegramId && api) {
      try { await api.sendMessage(String(claim.telegramId), '🔐 BinaSmart · ' + (target.nameAm || target.name) + '\nየማረጋገጫ ኮድዎ · your code: ' + code + '\nለ15 ደቂቃ ብቻ ይሰራል።'); sent = true; } catch (e) { console.error('[business] code send: ' + e.message); }
    }
    if (!sent && api && ownerChat) {
      try { await api.sendMessage(String(ownerChat), '🏪 Claim: ' + (target.nameAm || target.name) + ' · ' + phone + '\nApprove: ' + base + '/ops/business?claim=' + claim.id, { disable_web_page_preview: true }); } catch (e) { /* ignore */ }
    }
    return sent;
  };
  const owners = makeOwners({ prisma, now: clock, notify });

  const COOKIE = 'bsown';
  const tokenOf = req => { const m = (req.headers.cookie || '').match(/(?:^|;\s*)bsown=([A-Za-z0-9_-]+)/); return m ? m[1] : (req.headers['x-owner-token'] || null); };
  const setCookie = (reply, token) => reply.header('set-cookie', COOKIE + '=' + token + '; Path=/; Max-Age=' + (30 * 24 * 3600) + '; HttpOnly; Secure; SameSite=Lax');
  async function me(req, reply) {
    const s = await owners.session(tokenOf(req));
    if (!s) { reply.code(401).send({ ok: false, error: 'sign_in' }); return null; }
    return s;
  }

  const pubShop = (s, extra) => ({ id: s.id, slug: s.slug, name: s.name, nameAm: s.nameAm, category: s.category, categoryAm: CAT_AM[s.category] || null,
    description: s.description, descriptionAm: s.descriptionAm, about: s.about, aboutAm: s.aboutAm, phone: s.phone, telegram: s.telegram, socialLink: s.socialLink,
    photos: s.photos || [], logoUrl: s.logoUrl, address: s.address, mapUrl: s.mapUrl, openingHours: s.openingHours, isOpenNow: s.isOpenNow,
    avgRating: s.avgRating, reviewCount: s.reviewCount, status: s.status, ...(extra || {}) });
  const pubProduct = p => ({ id: p.id, name: p.name, nameAm: p.nameAm, description: p.description, price: p.price, category: p.category, photoUrl: p.photoUrl, deliverable: p.deliverable, visible: p.visible, orderCount: p.orderCount });
  const pubOffer = o => ({ id: o.id, title: o.title, titleAm: o.titleAm, description: o.description, startsAt: o.startsAt, endsAt: o.endsAt, active: o.active });
  const pubOrder = o => ({ id: o.id, customerName: o.customerName, customerPhone: o.customerPhone, note: o.note, total: o.total, status: o.status, createdAt: o.createdAt, items: (o.items || []).map(i => ({ name: i.product ? (i.product.nameAm || i.product.name) : '', qty: i.qty, price: i.unitPrice })) });

  async function ensureSlug(shop) {
    if (shop.slug) return shop.slug;
    const stem = slugify(shop.name) || slugify(shop.nameAm) || 'shop-' + shop.id.slice(-6);
    let s = stem;
    for (let i = 0; i < 5; i++) {
      const taken = await prisma.shop.findUnique({ where: { slug: s } });
      if (!taken) { await prisma.shop.update({ where: { id: shop.id }, data: { slug: s } }); return s; }
      s = stem + '-' + crypto.randomBytes(2).toString('hex');
    }
    return null;
  }

  // ---------- pages ----------
  fastify.get('/business', async (req, reply) => reply.sendFile('business.html'));
  fastify.get('/ops/business', async (req, reply) => reply.sendFile('ops-business.html'));
  fastify.get('/for-business', async (req, reply) => reply.sendFile('for-business.html'));
  // A tablet menu board inside the restaurant, fed by the same catalogue the owner edits.
  fastify.get('/menu/:slug', async (req, reply) => reply.sendFile('menu.html'));
  fastify.get('/shop/:slug', async (req, reply) => {
    let html = fs.readFileSync(path.join(__dirname, '..', 'public', 'shop.html'), 'utf8');
    try {
      const s = await prisma.shop.findUnique({ where: { slug: String(req.params.slug) }, include: { tenancy: { include: { unit: { include: { building: true } } } }, products: { where: { visible: true, approved: true } } } });
      if (s && s.status === 'live') {
        const b = s.tenancy && s.tenancy.unit && s.tenancy.unit.building;
        const where = b ? (b.nameAm || b.name) + (b.subCity ? ', ' + b.subCity : '') : (s.address || 'Addis Ababa');
        const title = (s.nameAm || s.name) + ' — ' + (CAT_AM[s.category] || s.category) + ' · ' + where + ' | BinaSmart';
        const desc = (s.aboutAm || s.about || s.descriptionAm || s.description || (s.nameAm || s.name) + ' — ' + (CAT_AM[s.category] || s.category) + ' በ' + where + '። ስልክ ' + s.phone + '።').slice(0, 300);
        const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': base + '/shop/' + s.slug + '#business', name: s.nameAm || s.name, alternateName: s.name !== s.nameAm ? s.name : undefined,
          description: desc, telephone: s.phone, url: base + '/shop/' + s.slug, image: (s.photos || []).slice(0, 5), logo: s.logoUrl || undefined,
          address: { '@type': 'PostalAddress', streetAddress: s.address || (b ? b.name : undefined), addressLocality: 'Addis Ababa', addressRegion: b ? b.subCity : undefined, addressCountry: 'ET' },
          geo: b && b.lat && b.lng ? { '@type': 'GeoCoordinates', latitude: b.lat, longitude: b.lng } : undefined,
          aggregateRating: s.reviewCount > 0 ? { '@type': 'AggregateRating', ratingValue: s.avgRating, reviewCount: s.reviewCount } : undefined,
          makesOffer: (s.products || []).slice(0, 30).map(p => ({ '@type': 'Offer', itemOffered: { '@type': 'Product', name: p.nameAm || p.name, image: p.photoUrl || undefined }, price: p.price, priceCurrency: 'ETB' })) };
        html = html.replace(/<title>[^<]*<\/title>/, '<title>' + escAttr(title) + '</title>')
          .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escAttr(desc) + '">')
          .replace('<link rel="canonical" href="https://bina.et/business">', '<link rel="canonical" href="' + base + '/shop/' + s.slug + '">')
          .replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + escAttr(s.nameAm || s.name) + '">')
          .replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + escAttr(desc) + '">')
          .replace('<meta property="og:url" content="https://bina.et/business">', '<meta property="og:url" content="' + base + '/shop/' + s.slug + '">');
        if ((s.photos || [])[0]) html = html.replace(/<meta property="og:image" content="[^"]*">/, '<meta property="og:image" content="' + escAttr(s.photos[0]) + '">');
        html = html.replace('</head>', '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>\n</head>');
      }
    } catch (e) { console.error('[business] shop page: ' + e.message); }
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ---------- public shop API ----------
  fastify.get('/api/shops/:slug', async (req, reply) => {
    if (!ipRL(clientIp(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const s = await prisma.shop.findUnique({ where: { slug: String(req.params.slug) },
      include: { tenancy: { include: { unit: { include: { building: true } } } }, products: { where: { visible: true, approved: true }, orderBy: { orderCount: 'desc' } },
        offers: { where: { active: true, approved: true, endsAt: { gte: new Date(clock()) } } } } });
    if (!s || s.status !== 'live') return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = s.tenancy && s.tenancy.unit && s.tenancy.unit.building;
    return { ok: true, shop: pubShop(s, { open: openNow(s.openingHours, clock()), unit: s.tenancy ? s.tenancy.unit.number : null,
      building: b ? { name: b.name, nameAm: b.nameAm, slug: b.qrSlug, subCity: b.subCity, lat: b.lat, lng: b.lng } : null }),
      products: s.products.map(pubProduct), offers: s.offers.map(pubOffer) };
  });

  fastify.post('/api/shops/:slug/order', async (req, reply) => {
    const b = req.body || {};
    const s = await prisma.shop.findUnique({ where: { slug: String(req.params.slug) } });
    if (!s || s.status !== 'live') return reply.code(404).send({ ok: false, error: 'not_found' });
    const name = str(b.name, 60), phone = normPhone(b.phone);
    if (!name) return reply.code(400).send({ ok: false, error: 'name' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone' });
    if (!orderRL(phone) || !orderRL('ip:' + clientIp(req))) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const wanted = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
    if (!wanted.length) return reply.code(400).send({ ok: false, error: 'no_items' });
    const ids = wanted.map(i => String(i.productId || ''));
    const products = await prisma.product.findMany({ where: { id: { in: ids }, shopId: s.id, visible: true, approved: true } });
    if (!products.length) return reply.code(400).send({ ok: false, error: 'no_items' });
    let total = 0; const items = [];
    for (const w of wanted) {
      const p = products.find(x => x.id === String(w.productId || '')); if (!p) continue;
      const qty = Math.max(1, Math.min(20, intOr(w.qty, 1)));
      total += p.price * qty; items.push({ productId: p.id, qty, unitPrice: p.price, label: p.nameAm || p.name });
    }
    if (!items.length) return reply.code(400).send({ ok: false, error: 'no_items' });
    const order = await prisma.order.create({ data: { shopId: s.id, customerName: name, customerPhone: phone, note: str(b.note, 300), total, source: 'WEB', items: { create: items.map(i => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice })) } }, include: { items: true } });
    await prisma.product.updateMany({ where: { id: { in: items.map(i => i.productId) } }, data: { orderCount: { increment: 1 } } });
    // Tell the owner: Telegram if linked, WhatsApp as backup, admin copy always. The dashboard shows
    // the order regardless. A numeric Telegram id typed into the profile still works as the chat.
    const text = '🧾 አዲስ ትዕዛዝ · new order OD-' + order.id.slice(-6).toUpperCase() + '\n' + name + ' · ' + phone + '\n'
      + items.map(i => i.label + ' ×' + i.qty).join('\n') + '\n💰 ' + total.toLocaleString() + ' ETB' + (b.note ? '\n📝 ' + str(b.note, 300) : '') + '\n' + base + '/business';
    const party = { id: s.id, name: s.nameAm || s.name, phone: s.phone, tgChatId: s.tgChatId || (/^\d+$/.test(s.telegram || '') ? s.telegram : null) };
    if (deps.notifyShop) deps.notifyShop(party, text).catch(e => console.error('[business] order notify: ' + e.message));
    else if (api && party.tgChatId) api.sendMessage(String(party.tgChatId), text).catch(e => console.error('[business] order ping: ' + e.message));
    return { ok: true, order: { id: order.id, total: order.total, status: order.status } };
  });

  // ---------- claim / session ----------
  fastify.post('/api/business/claim', async (req, reply) => {
    const b = req.body || {};
    if (!claimRL('ip:' + clientIp(req))) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const r = await owners.startClaim(b.phone, str(b.name, 60));
    if (!r.ok) return reply.code(r.error === 'phone' ? 400 : 404).send(r);
    return r;
  });
  fastify.post('/api/business/verify', async (req, reply) => {
    const b = req.body || {};
    const r = await owners.verify(b.claimId, b.code);
    if (!r.ok) return reply.code(r.error === 'bad_code' ? 401 : 410).send(r);
    setCookie(reply, r.token);
    return { ok: true, kind: r.kind, token: r.token };
  });
  fastify.post('/api/business/logout', async (req, reply) => { await owners.signOut(tokenOf(req)); reply.header('set-cookie', COOKIE + '=; Path=/; Max-Age=0'); return { ok: true }; });

  fastify.get('/api/business/me', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const pages = await owners.pagesFor(s.session);
    if (s.kind === 'venue') return { ok: true, kind: 'venue', pages, venue: { id: s.venue.id, name: s.venue.name, nameAm: s.venue.nameAm, slug: s.venue.slug, phone: s.venue.phone, address: s.venue.address } };
    const shop = s.shop; const slug = await ensureSlug(shop);
    const [products, offers, orders] = await Promise.all([
      prisma.product.count({ where: { shopId: shop.id } }),
      prisma.offer.count({ where: { shopId: shop.id, active: true } }),
      prisma.order.count({ where: { shopId: shop.id, status: 'NEW' } }),
    ]);
    return { ok: true, kind: 'shop', pages, shopId: shop.id, tgLinked: !!shop.tgChatId, shop: pubShop({ ...shop, slug }), counts: { products, offers, newOrders: orders }, url: base + '/shop/' + slug, categories: CATEGORIES.map(c => ({ value: c, am: CAT_AM[c] })) };
  });
  fastify.post('/api/business/switch', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const r = await owners.switchTo(tokenOf(req), (req.body || {}).id);
    return r.ok ? r : reply.code(403).send(r);
  });

  // ---------- profile ----------
  fastify.post('/api/business/profile', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    if (s.kind !== 'shop') return reply.code(400).send({ ok: false, error: 'not_a_shop' });
    const b = req.body || {};
    const data = {};
    if (b.name !== undefined) { const v = str(b.name, 80); if (!v) return reply.code(400).send({ ok: false, error: 'name' }); data.name = v; }
    if (b.nameAm !== undefined) data.nameAm = str(b.nameAm, 80);
    if (b.category !== undefined && CATEGORIES.includes(b.category)) data.category = b.category;
    if (b.description !== undefined) data.description = str(b.description, 500);
    if (b.descriptionAm !== undefined) data.descriptionAm = str(b.descriptionAm, 500);
    if (b.about !== undefined) data.about = str(b.about, 3000);
    if (b.aboutAm !== undefined) data.aboutAm = str(b.aboutAm, 3000);
    if (b.phone !== undefined) { const p = normPhone(b.phone); if (!p) return reply.code(400).send({ ok: false, error: 'phone' }); data.phone = p; }
    if (b.telegram !== undefined) data.telegram = str(b.telegram, 60);
    if (b.socialLink !== undefined) { const v = str(b.socialLink, 300); if (v && !/^https?:\/\//.test(v)) return reply.code(400).send({ ok: false, error: 'link' }); data.socialLink = v; }
    if (b.address !== undefined) data.address = str(b.address, 200);
    if (b.mapUrl !== undefined) { const v = str(b.mapUrl, 300); if (v && !/^https?:\/\//.test(v)) return reply.code(400).send({ ok: false, error: 'link' }); data.mapUrl = v; }
    if (b.openingHours !== undefined && b.openingHours && typeof b.openingHours === 'object') data.openingHours = b.openingHours;
    if (b.isOpenNow !== undefined) data.isOpenNow = !!b.isOpenNow;
    const shop = await prisma.shop.update({ where: { id: s.shop.id }, data });
    return { ok: true, shop: pubShop(shop) };
  });

  // Photos arrive as data URLs; we write jpeg/png/webp files under uploads/shops/<shopId>/.
  fastify.post('/api/business/photos', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    if (s.kind !== 'shop') return reply.code(400).send({ ok: false, error: 'not_a_shop' });
    const b = req.body || {};
    const m = String(b.dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return reply.code(400).send({ ok: false, error: 'image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_PHOTO_BYTES) return reply.code(413).send({ ok: false, error: 'too_big' });
    const photos = s.shop.photos || [];
    const asLogo = !!b.logo;
    if (!asLogo && photos.length >= MAX_PHOTOS) return reply.code(400).send({ ok: false, error: 'too_many', max: MAX_PHOTOS });
    const dir = path.join(uploadsDir, s.shop.id);
    await fs.promises.mkdir(dir, { recursive: true });
    const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
    const file = (asLogo ? 'logo' : crypto.randomBytes(6).toString('hex')) + '.' + ext;
    await fs.promises.writeFile(path.join(dir, file), buf);
    const url = '/api/shops/photo/' + s.shop.id + '/' + file;
    const shop = asLogo ? await prisma.shop.update({ where: { id: s.shop.id }, data: { logoUrl: url } })
      : await prisma.shop.update({ where: { id: s.shop.id }, data: { photos: [...photos, url] } });
    return { ok: true, url, shop: pubShop(shop) };
  });
  fastify.post('/api/business/photos/remove', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const url = String((req.body || {}).url || '');
    const shop = await prisma.shop.update({ where: { id: s.shop.id }, data: { photos: (s.shop.photos || []).filter(p => p !== url), ...(s.shop.logoUrl === url ? { logoUrl: null } : {}) } });
    return { ok: true, shop: pubShop(shop) };
  });
  fastify.get('/api/shops/photo/:shopId/:file', async (req, reply) => {
    const id = String(req.params.shopId).replace(/[^a-z0-9]/gi, '');
    const file = String(req.params.file).replace(/[^a-z0-9.]/gi, '');
    const p = path.join(uploadsDir, id, file);
    if (!p.startsWith(uploadsDir) || !fs.existsSync(p)) return reply.code(404).send({ ok: false, error: 'not_found' });
    reply.type(file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg').header('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(p);
  });

  // ---------- products ----------
  fastify.get('/api/business/products', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const rows = await prisma.product.findMany({ where: { shopId: s.shop.id }, orderBy: { createdAt: 'desc' } });
    return { ok: true, products: rows.map(pubProduct), max: MAX_PRODUCTS };
  });
  const productData = b => {
    const d = {};
    if (b.name !== undefined) d.name = str(b.name, 80);
    if (b.nameAm !== undefined) d.nameAm = str(b.nameAm, 80);
    if (b.description !== undefined) d.description = str(b.description, 500);
    if (b.category !== undefined) d.category = str(b.category, 40);
    if (b.photoUrl !== undefined) d.photoUrl = str(b.photoUrl, 400);
    if (b.price !== undefined) d.price = Math.max(0, intOr(b.price, 0));
    if (b.deliverable !== undefined) d.deliverable = !!b.deliverable;
    if (b.visible !== undefined) d.visible = !!b.visible;
    return d;
  };
  fastify.post('/api/business/products', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const d = productData(req.body || {});
    if (!d.name) return reply.code(400).send({ ok: false, error: 'name' });
    if (!Number.isFinite(d.price)) return reply.code(400).send({ ok: false, error: 'price' });
    if ((await prisma.product.count({ where: { shopId: s.shop.id } })) >= MAX_PRODUCTS) return reply.code(400).send({ ok: false, error: 'too_many', max: MAX_PRODUCTS });
    const p = await prisma.product.create({ data: { shopId: s.shop.id, visible: true, approved: true, ...d } });
    return { ok: true, product: pubProduct(p) };
  });
  fastify.post('/api/business/products/:id', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const own = await prisma.product.findFirst({ where: { id: String(req.params.id), shopId: s.shop.id } });
    if (!own) return reply.code(404).send({ ok: false, error: 'not_found' });
    const p = await prisma.product.update({ where: { id: own.id }, data: productData(req.body || {}) });
    return { ok: true, product: pubProduct(p) };
  });
  fastify.post('/api/business/products/:id/delete', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const own = await prisma.product.findFirst({ where: { id: String(req.params.id), shopId: s.shop.id } });
    if (!own) return reply.code(404).send({ ok: false, error: 'not_found' });
    const used = await prisma.orderItem.count({ where: { productId: own.id } });
    if (used) { await prisma.product.update({ where: { id: own.id }, data: { visible: false } }); return { ok: true, hidden: true }; }
    await prisma.product.delete({ where: { id: own.id } });
    return { ok: true, deleted: true };
  });

  // ---------- offers ----------
  fastify.get('/api/business/offers', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const rows = await prisma.offer.findMany({ where: { shopId: s.shop.id }, orderBy: { createdAt: 'desc' } });
    return { ok: true, offers: rows.map(pubOffer) };
  });
  fastify.post('/api/business/offers', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const b = req.body || {};
    const title = str(b.title, 100); if (!title) return reply.code(400).send({ ok: false, error: 'title' });
    const day = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) ? new Date(v + 'T00:00:00+03:00') : null;
    const startsAt = day(b.startsAt) || new Date(clock()), endsAt = day(b.endsAt);
    if (!endsAt || endsAt < startsAt) return reply.code(400).send({ ok: false, error: 'dates' });
    const o = await prisma.offer.create({ data: { shopId: s.shop.id, title, titleAm: str(b.titleAm, 100), description: str(b.description, 400), startsAt, endsAt: new Date(endsAt.getTime() + 86400000 - 1), active: true, approved: true } });
    return { ok: true, offer: pubOffer(o) };
  });
  fastify.post('/api/business/offers/:id/delete', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const r = await prisma.offer.updateMany({ where: { id: String(req.params.id), shopId: s.shop.id }, data: { active: false } });
    return r.count ? { ok: true } : reply.code(404).send({ ok: false, error: 'not_found' });
  });

  // ---------- orders ----------
  fastify.get('/api/business/orders', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const rows = await prisma.order.findMany({ where: { shopId: s.shop.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { items: { include: { product: true } } } });
    return { ok: true, orders: rows.map(pubOrder) };
  });
  fastify.post('/api/business/orders/:id/status', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    const own = await prisma.order.findFirst({ where: { id: String(req.params.id), shopId: s.shop.id } });
    if (!own) return reply.code(404).send({ ok: false, error: 'not_found' });
    const next = String((req.body || {}).status || '');
    if (!(STATUS_NEXT[own.status] || []).includes(next)) return reply.code(400).send({ ok: false, error: 'bad_status', from: own.status, allowed: STATUS_NEXT[own.status] || [] });
    const o = await prisma.order.update({ where: { id: own.id }, data: { status: next, ...(next === 'COMPLETED' ? { completedAt: new Date(clock()) } : {}) }, include: { items: { include: { product: true } } } });
    return { ok: true, order: pubOrder(o) };
  });

  // ---------- venue owners: their programme ----------
  fastify.get('/api/business/programme', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    if (s.kind !== 'venue') return reply.code(400).send({ ok: false, error: 'not_a_venue' });
    const rows = await prisma.programme.findMany({ where: { venueId: s.venue.id, active: true }, orderBy: { dateFrom: 'desc' }, take: 200 });
    return { ok: true, programme: rows };
  });
  fastify.post('/api/business/programme', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    if (s.kind !== 'venue') return reply.code(400).send({ ok: false, error: 'not_a_venue' });
    const b = req.body || {};
    const title = str(b.title, 120); if (!title) return reply.code(400).send({ ok: false, error: 'title' });
    const times = [...new Set(String(b.times || '').split(/[,\s]+/).filter(t => /^\d{1,2}:\d{2}$/.test(t)).map(t => t.padStart(5, '0')))].sort();
    if (!times.length) return reply.code(400).send({ ok: false, error: 'times' });
    const day = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) ? new Date(v + 'T00:00:00+03:00') : null;
    const dateFrom = day(b.dateFrom), dateTo = day(b.dateTo || b.dateFrom);
    if (!dateFrom || !dateTo || dateTo < dateFrom) return reply.code(400).send({ ok: false, error: 'dates' });
    const p = await prisma.programme.create({ data: { venueId: s.venue.id, title, titleAm: str(b.titleAm, 120), hallName: str(b.hallName, 40), priceText: str(b.priceText, 40), notes: str(b.notes, 200), times, dateFrom, dateTo: new Date(dateTo.getTime() + 86400000 - 1),
      sourceName: (s.venue.nameAm || s.venue.name) + ' (posted by the cinema on BinaSmart)', sourceUrl: '', postedAt: new Date(clock()) } });
    return { ok: true, programme: p };
  });
  fastify.post('/api/business/programme/:id/delete', async (req, reply) => {
    const s = await me(req, reply); if (!s) return;
    if (s.kind !== 'venue') return reply.code(400).send({ ok: false, error: 'not_a_venue' });
    const r = await prisma.programme.updateMany({ where: { id: String(req.params.id), venueId: s.venue.id }, data: { active: false } });
    return r.count ? { ok: true } : reply.code(404).send({ ok: false, error: 'not_found' });
  });

  // ---------- ops ----------
  fastify.get('/api/business/ops/overview', async (req, reply) => {
    if (!ops(req, reply)) return;
    const [live, demo, hidden, products, orders, claimedIds] = await Promise.all([
      prisma.shop.count({ where: { status: 'live' } }),
      prisma.shop.count({ where: { status: 'demo' } }),
      prisma.shop.count({ where: { status: 'hidden' } }),
      prisma.product.count(),
      prisma.order.count(),
      prisma.ownerSession.findMany({ where: { expiresAt: { gt: new Date(clock()) } }, select: { shopId: true } }),
    ]);
    const claimed = new Set(claimedIds.map(x => x.shopId).filter(Boolean));
    const shops = await prisma.shop.findMany({ where: { status: { not: 'demo' } }, orderBy: { name: 'asc' }, take: 500,
      include: { tenancy: { include: { unit: { include: { building: true } } } }, _count: { select: { products: true } } } });
    const claims = await prisma.ownerClaim.findMany({ where: { status: 'PENDING', expiresAt: { gt: new Date(clock() - 7 * 86400000) } }, orderBy: { createdAt: 'desc' }, take: 100, include: { shop: true, venue: true } });
    const recent = await prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { shop: true, items: true } });
    return { ok: true,
      counts: { live, demo, hidden, products, orders, claimed: claimed.size },
      shops: shops.map(s2 => ({ id: s2.id, name: s2.name, nameAm: s2.nameAm, slug: s2.slug, phone: s2.phone, status: s2.status, products: s2._count.products,
        claimed: claimed.has(s2.id), building: s2.tenancy && s2.tenancy.unit && s2.tenancy.unit.building ? s2.tenancy.unit.building.name : null,
        unit: s2.tenancy && s2.tenancy.unit ? s2.tenancy.unit.number : null })),
      claims: claims.map(c => ({ id: c.id, kind: c.kind, phone: c.phone, name: c.name, createdAt: c.createdAt, expiresAt: c.expiresAt,
        target: c.shop ? (c.shop.nameAm || c.shop.name) : c.venue ? (c.venue.nameAm || c.venue.name) : null })),
      orders: recent.map(o => ({ id: o.id, createdAt: o.createdAt, shop: o.shop ? (o.shop.nameAm || o.shop.name) : '', customerName: o.customerName, customerPhone: o.customerPhone, items: o.items.length, total: o.total, status: o.status })) };
  });

  fastify.get('/api/business/ops/claims', async (req, reply) => {
    if (!ops(req, reply)) return;
    const rows = await prisma.ownerClaim.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 100, include: { shop: true, venue: true } });
    return { ok: true, claims: rows.map(c => ({ id: c.id, kind: c.kind, phone: c.phone, name: c.name, createdAt: c.createdAt, expiresAt: c.expiresAt, target: c.shop ? (c.shop.nameAm || c.shop.name) : c.venue ? (c.venue.nameAm || c.venue.name) : null })) };
  });
  fastify.post('/api/business/ops/claims/:id/approve', async (req, reply) => {
    if (!ops(req, reply)) return;
    const r = await owners.approveById(req.params.id);
    return r.ok ? { ok: true, token: r.token } : reply.code(400).send(r);
  });
  fastify.post('/api/business/ops/shops/:id/status', async (req, reply) => {
    if (!ops(req, reply)) return;
    const status = String((req.body || {}).status || '');
    if (!['live', 'hidden', 'demo', 'pending'].includes(status)) return reply.code(400).send({ ok: false, error: 'status' });
    const r = await prisma.shop.updateMany({ where: { id: String(req.params.id) }, data: { status } });
    return { ok: true, changed: r.count };
  });

  const sweeper = setInterval(() => owners.sweep().catch(e => console.error('[business] sweep: ' + e.message)), 3600000);
  sweeper.unref();
  console.log('[business] mounted' + (api ? '' : ' (no Telegram: claims need ops approval)'));
  return { owners, ensureSlug, slugify, openNow };
};
module.exports.CATEGORIES = CATEGORIES;
module.exports.CAT_AM = CAT_AM;
