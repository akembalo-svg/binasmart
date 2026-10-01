'use strict';
// /mypages on @bina_smart_bot (1 Oct 2026, Ibrahim chose it): every page and listing tied to one PROVEN phone, each with
// the place to manage it. The phone is never typed: it comes from the account the Telegram user signed in with, a
// contact they shared in the bot, or a contact they share now (Telegram signs it, and it must be their own).
// Stores and their phone fields (all compared on the last 9 digits, so +251…, 0… and typed forms match):
//   restaurants/entries.json phone · health/entries.json phone · shop/posts.json shop.phone · PropertyListing.agencyPhone
//   HotelClaim.phone (hotels and companies) · Driver.phone
const fs = require('fs');
const k9 = s => String(s || '').replace(/\D/g, '').slice(-9);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const tally = list => Object.entries(list.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {})).map(([s, n]) => n + ' ' + s).join(', ');

async function findMyPages({ prisma, phone }) {
  const key = k9(phone); if (key.length !== 9) return [];
  const out = [];
  const R = readJ(process.env.RESTAURANTS_FILE || '/root/storage/restaurants/entries.json', { entries: [] });
  for (const e of R.entries || []) if (k9(e.phone) === key && ['live', 'hidden', 'pending'].includes(e.status))
    out.push({ icon: '🍽', name: e.restaurant, status: e.status, url: e.status === 'pending' ? null : 'https://bina.et/restaurants/dashboard' });
  const Hs = readJ(process.env.HEALTH_FILE || '/root/storage/health/entries.json', { entries: [] });
  for (const e of Hs.entries || []) if (k9(e.phone) === key && ['live', 'paused', 'hidden', 'pending'].includes(e.status))
    out.push({ icon: e.type === 'doctor' ? '👩🏾‍⚕️' : '🏥', name: e.type === 'doctor' ? e.name : (e.facilityName || e.name), status: e.status, url: e.status === 'pending' ? null : 'https://bina.et/health/dashboard' });
  const S = readJ(process.env.SHOP_POSTS_FILE || '/root/storage/shop/posts.json', { posts: [] });
  const posts = (S.posts || []).filter(p => p && p.shop && k9(p.shop.phone) === key && ['live', 'sold', 'pending'].includes(p.status));
  if (posts.length) out.push({ icon: '🛍', name: posts.length + ' shop post' + (posts.length === 1 ? '' : 's'), status: tally(posts.map(p => p.status)), url: 'https://bina.et/shop/dashboard' });
  if (prisma) {
    try {
      const rows = (await prisma.propertyListing.findMany({ where: { agencyPhone: { endsWith: key } }, select: { active: true, details: true }, take: 100 }))
        .filter(L => L.details && L.details.submittedVia === 'bini');
      const st = rows.map(L => (L.details.review || {}).status === 'pending' ? 'pending' : (L.details.review || {}).status === 'rejected' ? null : L.active ? 'live' : L.details.closed ? 'rented / sold' : 'taken down').filter(Boolean);
      if (st.length) out.push({ icon: '🏠', name: st.length + ' home listing' + (st.length === 1 ? '' : 's'), status: tally(st), url: 'https://bina.et/property/dashboard' });
    } catch (e) { /* no property table here */ }
    try {
      for (const c of await prisma.hotelClaim.findMany({ where: { phone: { endsWith: key }, status: { in: ['approved', 'pending'] } } })) {
        const company = /^company/.test(String(c.placeRef)), onMap = !/^(new:|company-new)/.test(String(c.placeRef));
        out.push({ icon: company ? '🏢' : '🏨', name: c.placeName, status: c.status === 'approved' ? 'confirmed' : 'pending',
          url: c.status !== 'approved' || !onMap ? null : company ? 'https://bina.et/companies/' + c.slug : 'https://bina.et/hotels/dashboard' });
      }
    } catch (e) { /* no claims table here */ }
    try {
      const d = await prisma.driver.findFirst({ where: { phone: { endsWith: key } }, select: { name: true, status: true } });
      if (d) out.push({ icon: '🚗', name: 'Driver: ' + d.name, status: d.status === 'rejected' ? 'not accepted' : d.status, url: d.status === 'approved' ? 'https://t.me/binasmartdriverbot' : null });
    } catch (e) { /* no driver table here */ }
  }
  return out;
}

// The bot's answer, Amharic and English, plain text (Telegram renders the links).
function myPagesText(phone, pages) {
  const tail = '…' + k9(phone).slice(-4);
  if (!pages.length) return '📋 ከ' + tail + ' ጋር የተያያዘ ገጽ የለም። · No page or listing is linked to ' + tail + ' yet.\n\n'
    + 'Restaurants: bina.et/restaurants · Shops: bina.et/shop?bini=shop · Homes: bina.et/property?bini=list · Hotels: bina.et/hotels · Doctors and clinics: bina.et/health';
  return '📋 የእርስዎ ገጾች · Your pages (' + tail + ')\n\n'
    + pages.map(p => p.icon + ' ' + p.name + ' — ' + p.status + (p.url ? '\n   ' + p.url : p.status === 'pending' ? '\n   waiting for our team to call you · ቡድናችን ይደውልልዎታል' : '')).join('\n')
    + '\n\nSign in at the link with Telegram or a phone code, using this number. · በዚሁ ቁጥር ይግቡ።';
}

module.exports = { findMyPages, myPagesText, k9 };
