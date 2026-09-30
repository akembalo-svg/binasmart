'use strict';
// The contact book: every phone number BinaSmart holds, in one searchable place, for SERVICE.
//
//   GET /ops/contacts?key=<OWNER_KEY>              the page
//   GET /api/ops/contacts?key=<OWNER_KEY>&q=&role= the same data as JSON
//
// Owner-key only, same gate as /ride-ops. Nothing here writes, exports, or sends anything: it reads the
// rows the platform already holds and shows them to the one person entitled to see them.
//
// Why it is a view and not a table: a copied contact list goes stale the day it is copied, and then two
// answers exist for "what is this person's number". Every row below is read live from the table that owns
// it, so a corrected phone is corrected everywhere at once and a deleted person is deleted everywhere.
//
// `contactable` is the field that matters, and it is not decoration:
//   • rider, driver, and every customer who booked something gave us the number FOR that booking, so
//     they can be contacted ABOUT it. That is service, not marketing.
//   • a shop is contactable only once somebody has claimed the listing (business/claimed.js — the same
//     rule search_places uses to decide whether to publish a phone). 345 of the 416 shops are seeded demo
//     rows, and of the rest not one has ever been claimed: those numbers belong to named individuals who
//     are tenants in a building, not to businesses with a switchboard. They are listed here so the owner
//     can see what exists, and marked so nobody mistakes them for an audience.
// Broadcasting to any of this is how a business number gets reported and banned, and a banned number
// takes every customer conversation with it. The page says so in the one place someone would act on it.

const ROLES = ['rider', 'driver', 'shop', 'lead', 'customer'];

// Each source names its own columns. Nothing selects a document, a licence, a payment or a location.
const SQL = `
  SELECT 'rider' AS role, 'rider' AS detail, r.name, r.phone, r."createdAt" AS since,
         (SELECT count(*)::int FROM "Ride" x WHERE x."riderId" = r.id) AS activity,
         true AS contactable, NULL AS note
    FROM "Rider" r WHERE r.phone IS NOT NULL AND r.phone <> ''
  UNION ALL
  SELECT 'driver', d.status, d.name, d.phone, d."createdAt",
         (SELECT count(*)::int FROM "Ride" x WHERE x."driverId" = d.id),
         true, d.tier || COALESCE(' · ' || d.plate, '')
    FROM "Driver" d WHERE d.phone IS NOT NULL AND d.phone <> ''
  UNION ALL
  SELECT 'customer', 'cinema ticket', t.name, t.phone, t."createdAt", 1, true, t.status
    FROM "Ticket" t WHERE t.phone IS NOT NULL AND t.phone <> ''
  UNION ALL
  SELECT 'customer', 'hotel booking', b."guestName", b."guestPhone", b."createdAt", 1, true, b.status
    FROM "HotelBooking" b WHERE b."guestPhone" IS NOT NULL AND b."guestPhone" <> ''
  UNION ALL
  SELECT 'lead', 'flight request', f.name, f.phone, f."createdAt", 1, true, f.status
    FROM "FlightRequest" f WHERE f.phone IS NOT NULL AND f.phone <> ''
  UNION ALL
  SELECT 'lead', 'market: ' || m.kind, m.name, m.phone, m."createdAt", 1, true, m.status
    FROM "MarketLead" m WHERE m.phone IS NOT NULL AND m.phone <> ''
  UNION ALL
  SELECT 'lead', 'insurance', i.name, i.phone, i."createdAt", 1, true, i.status
    FROM "InsuranceLead" i WHERE i.phone IS NOT NULL AND i.phone <> ''
  UNION ALL
  -- Shop has no createdAt; claimedAt is the only date it carries, and NULL sorts last, which is right:
  -- an unclaimed tenant number is the least useful row on the page.
  SELECT 'shop', s.category::text, s.name, s.phone, s."claimedAt", 0,
         (s."claimedAt" IS NOT NULL AND s.status <> 'demo'),
         CASE WHEN s.status = 'demo' THEN 'demo listing — not a real business'
              WHEN s."claimedAt" IS NULL THEN 'unclaimed listing — this number belongs to a tenant, not a business'
              ELSE 'claimed' END
    FROM "Shop" s WHERE s.phone IS NOT NULL AND s.phone <> ''
`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(rows, { q, role }) {
  const counts = rows.reduce((a, r) => { a[r.role] = (a[r.role] || 0) + 1; return a; }, {});
  const chip = r => `<a class="chip${role === r ? ' on' : ''}" href="?key=KEY&role=${r === role ? '' : r}">${r} ${counts[r] || 0}</a>`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contacts · BinaSmart</title><style>
:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#faf9f7;color:#1a1a1a}
@media(prefers-color-scheme:dark){body{background:#15161a;color:#e9e9ec}td,th{border-color:#2c2e36!important}input{background:#22242c;color:inherit;border-color:#33363f!important}}
h1{font-size:19px;margin:0 0 4px}.sub{opacity:.65;font-size:13px;margin-bottom:14px}
.warn{background:#fff3cd;border:1px solid #e0c97a;color:#5c4813;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:14px}
@media(prefers-color-scheme:dark){.warn{background:#3a3117;border-color:#6b5a24;color:#f0dfae}}
form{margin-bottom:12px}input{padding:8px 10px;border:1px solid #d8d5cf;border-radius:8px;width:min(320px,70vw);font-size:15px}
.chip{display:inline-block;padding:4px 10px;margin:0 6px 6px 0;border-radius:99px;background:#eceae6;color:inherit;text-decoration:none;font-size:13px}
.chip.on{background:#0a7d62;color:#fff}@media(prefers-color-scheme:dark){.chip{background:#272a33}}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #e6e3dd;vertical-align:top}
th{font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;opacity:.6}
.no{opacity:.5}.tag{font-size:11px;padding:1px 6px;border-radius:99px;background:#eceae6}
@media(prefers-color-scheme:dark){.tag{background:#272a33}}
a.tel{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor}
@media(max-width:620px){th:nth-child(5),td:nth-child(5),th:nth-child(6),td:nth-child(6){display:none}}
</style>
<h1>Contacts</h1><div class="sub">${rows.length} number(s) · read from the live tables, nothing is copied or exported</div>
<div class="warn"><b>For service, not for broadcasts.</b> These people gave a number to book something — contact them about <i>their own</i> booking. A mass message gets the business number reported and banned, and a banned number takes every customer conversation with it.</div>
<form><input type="hidden" name="key" value="KEY"><input name="q" value="${esc(q || '')}" placeholder="name or phone…" autofocus></form>
<div>${ROLES.map(chip).join('')}</div>
<table><tr><th>Name</th><th>Phone</th><th>Role</th><th>Detail</th><th>Activity</th><th>Since</th></tr>
${rows.map(r => `<tr><td>${esc(r.name) || '<span class="no">(no name)</span>'}</td>
<td>${r.contactable ? `<a class="tel" href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : `<span class="no">${esc(r.phone)}</span>`}</td>
<td>${esc(r.role)}</td><td>${esc(r.detail)}${r.note ? ` <span class="tag">${esc(r.note)}</span>` : ''}</td>
<td>${r.activity || ''}</td><td>${new Date(r.since).toISOString().slice(0, 10)}</td></tr>`).join('\n')}
</table>`;
}

module.exports = async function contactRoutes(fastify, { prisma, OWNER_KEY }) {
  const ops = (req, reply) => {
    if (!OWNER_KEY || (req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) {
      reply.code(401).send({ ok: false, error: 'unauthorized' }); return false;
    }
    return true;
  };

  async function read({ q, role }) {
    // NULLS LAST, or the 345 unclaimed shop rows (no date at all) would sit above every real customer.
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM (${SQL}) c ORDER BY c.since DESC NULLS LAST LIMIT 2000`);
    const needle = String(q || '').trim().toLowerCase();
    return rows.filter(r => (!role || r.role === role)
      && (!needle || String(r.name || '').toLowerCase().includes(needle) || String(r.phone || '').includes(needle)))
      .map(r => ({ ...r, activity: Number(r.activity || 0) }));
  }

  fastify.get('/api/ops/contacts', async (req, reply) => {
    if (!ops(req, reply)) return;
    const rows = await read({ q: req.query.q, role: req.query.role });
    return { ok: true, count: rows.length, contacts: rows };
  });

  fastify.get('/ops/contacts', async (req, reply) => {
    if (!ops(req, reply)) return;
    const rows = await read({ q: req.query.q, role: req.query.role });
    // The key is in the query string the owner already holds; it is put back into the form and the
    // filter links so the page keeps working, and nowhere else.
    reply.type('text/html; charset=utf-8');
    return page(rows, { q: req.query.q, role: req.query.role }).split('KEY').join(encodeURIComponent(String(req.query.key || '')));
  });
};
