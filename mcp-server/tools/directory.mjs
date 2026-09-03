import { z } from 'zod';
import { toolError } from './ride.mjs';

export const BASE = 'https://bina.et';
export const CATEGORIES = ['cafe', 'restaurant', 'pharmacy', 'retail', 'service', 'gym', 'salon', 'clinic', 'bank', 'office', 'other'];

export function restaurantSlug(name) { return String(name).trim().toLowerCase().replace(/\s+/g, '-'); }
const like = s => '%' + String(s).replace(/[%_\\]/g, m => '\\' + m) + '%';
const coords = r => (r.lat != null && r.lng != null) ? { lat: Number(r.lat), lng: Number(r.lng) } : undefined;

function buildingUrl(b) {
  if (b.buildingType === 'HOTEL') return `${BASE}/hotel/${b.qrSlug}`;
  if (b.buildingType === 'HOSPITAL') return `${BASE}/hospital/${b.qrSlug}`;
  return `${BASE}/b/${b.qrSlug}`;
}

// Every SELECT names its columns. Owner fields (TIN, bank accounts, ownerKey, tenant data) are never selected.
const SQL = {
  buildings: `SELECT name, "nameAm", "qrSlug", city, "subCity", lat, lng, "buildingType"
              FROM "Building" b
              WHERE (name ILIKE $1 OR "nameAm" LIKE $1) ORDER BY name LIMIT $2`,
  shops: `SELECT s.name, s."nameAm", s.category, s.phone, s."isOpenNow", s."avgRating", s."reviewCount",
                 u.number AS unit, b.name AS building, b."nameAm" AS "buildingAm", b."qrSlug", b.lat, b.lng, b."buildingType"
          FROM "Shop" s
          JOIN "Tenancy" t ON t.id = s."tenancyId"
          JOIN "Unit" u ON u.id = t."unitId"
          JOIN "Building" b ON b.id = u."buildingId"
          WHERE t.active = true AND ($1::text IS NULL OR s.name ILIKE $1 OR s."nameAm" LIKE $1) AND ($2::text IS NULL OR s.category::text = $2)
          ORDER BY s."avgRating" DESC, s.name LIMIT $3`,
  events: `SELECT e.slug, e.title, e."titleAm", e.type, e.venue, e.city, e.descr, e."startsAt", e."durationMin", e.tiers,
                  COALESCE((SELECT json_agg(json_build_object('tier', x.tier, 'qty', x.q)) FROM
                    (SELECT tier, SUM(qty) AS q FROM "EventTicket" WHERE "eventId" = e.id AND status <> 'CANCELLED' GROUP BY tier) x), '[]'::json) AS sold
           FROM "Event" e WHERE e.active = true AND e."startsAt" > now() ORDER BY e."startsAt" LIMIT 30`,
  building: `SELECT id, name, "nameAm", city, "subCity", "buildingType" FROM "Building" WHERE "qrSlug" = $1`,
  rooms: `SELECT name, "nameAm", description, "pricePerNight", capacity, amenities, "totalRooms" FROM "RoomType" WHERE "buildingId" = $1 AND active = true ORDER BY "pricePerNight"`,
  departments: `SELECT id, name, "nameAm", floor, room, fee, doctors, "openHours", "slotsPerDay" FROM "Department" WHERE "buildingId" = $1 AND active = true ORDER BY floor, name`,
  booked: `SELECT "departmentId", COUNT(*)::int AS n FROM "Appointment" WHERE "buildingId" = $1 AND status <> 'CANCELLED' AND date >= $2 AND date < $3 GROUP BY "departmentId"`,
};

export function registerDirectoryTools(server, { db, wrap, json }) {
  const guard = fn => async args => { try { return await fn(args); } catch (e) { console.error('[mcp/directory]', e.message); return toolError('The BinaSmart directory is temporarily unavailable. Try again shortly or browse https://bina.et.'); } };

  server.registerTool('search_places', {
    title: 'Search the BinaSmart directory',
    description: 'Find buildings, hotels, hospitals and shops in Addis Ababa listed on BinaSmart (bina.et): cafés, restaurants, pharmacies, banks, gyms, salons, clinics, offices. Returns names (English + Amharic), building and unit, phone for shops, coordinates when known (usable as pickup/dropoff for quote_ride), and the bina.et page. Hotels and hospitals are flagged — use get_hotel_rooms / get_hospital_departments for details.',
    inputSchema: {
      query: z.string().min(1).max(80).describe('Name or part of a name, English or Amharic'),
      category: z.string().optional().describe('Shop category filter: ' + CATEGORIES.join(' | ')),
      limit: z.number().int().min(1).max(25).optional().describe('Max results per kind (default 8)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('search_places', guard(async ({ query, category, limit }) => {
    const cat = category ? String(category).trim().toLowerCase() : null;
    if (cat && !CATEGORIES.includes(cat)) return toolError('Unknown category. Use one of: ' + CATEGORIES.join(', '));
    const lim = Math.min(limit || 8, 25);
    const [b, s] = await Promise.all([
      cat ? { rows: [] } : db.query(SQL.buildings, [like(query), lim]),
      db.query(SQL.shops, [like(query), cat ? cat.toUpperCase() : null, lim]),
    ]);
    const results = [
      ...b.rows.map(r => ({ kind: 'building', name: r.name, name_am: r.nameAm || undefined, city: r.city, sub_city: r.subCity || undefined,
        is_hotel: r.buildingType === 'HOTEL', is_hospital: r.buildingType === 'HOSPITAL', slug: r.qrSlug, coords: coords(r), url: buildingUrl(r) })),
      ...s.rows.map(r => ({ kind: 'shop', name: r.name, name_am: r.nameAm || undefined, category: String(r.category).toLowerCase(), phone: r.phone || undefined,
        open_now: r.isOpenNow, rating: r.reviewCount ? { average: Number(r.avgRating), count: r.reviewCount } : undefined,
        building: r.building, building_am: r.buildingAm || undefined, unit: r.unit, coords: coords(r),
        url: r.category === 'RESTAURANT' ? `${BASE}/restaurant/${restaurantSlug(r.name)}` : buildingUrl(r) })),
    ];
    return json({ count: results.length, results, note: results.length ? 'coords can be passed to quote_ride as "lat,lng".' : 'Nothing matched. Try a shorter query or a category.', source_url: `${BASE}/` });
  })));

  server.registerTool('list_events', {
    title: 'Upcoming events',
    description: 'Upcoming events on BinaSmart (concerts, cinema, festivals) in Addis Ababa with venue, start time, ticket price from and seats left. Tickets are bought at the link returned.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_events', guard(async () => {
    const { rows } = await db.query(SQL.events, []);
    const events = rows.map(e => {
      const tiers = Array.isArray(e.tiers) ? e.tiers : [];
      const sold = Object.fromEntries((e.sold || []).map(x => [x.tier, Number(x.qty) || 0]));
      const left = tiers.reduce((n, t) => n + Math.max(0, (t.seats || 0) - (sold[t.name] || 0)), 0);
      return { slug: e.slug, title: e.title, title_am: e.titleAm || undefined, type: e.type, venue: e.venue, city: e.city, description: e.descr || undefined,
        starts_at: e.startsAt, duration_min: e.durationMin, price_from_etb: tiers.length ? Math.min(...tiers.map(t => t.price)) : undefined,
        seats_left: left, tiers: tiers.map(t => ({ name: t.name, price_etb: t.price, seats_left: Math.max(0, (t.seats || 0) - (sold[t.name] || 0)) })), url: `${BASE}/events` };
    });
    return json({ count: events.length, events, source_url: `${BASE}/events` });
  })));

  server.registerTool('get_hotel_rooms', {
    title: 'Hotel rooms and prices',
    description: 'Room types, nightly prices (ETB), capacity and amenities for a hotel listed on BinaSmart. Use the slug from search_places (is_hotel = true).',
    inputSchema: { slug: z.string().min(1).max(60).describe('Hotel slug from search_places') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_hotel_rooms', guard(async ({ slug }) => {
    const b = (await db.query(SQL.building, [slug])).rows[0];
    if (!b) return toolError(`No hotel with slug "${slug}". Find it with search_places first.`);
    const { rows } = await db.query(SQL.rooms, [b.id]);
    if (!rows.length) return toolError(`"${b.name}" has no bookable rooms on BinaSmart.`);
    return json({ hotel: { name: b.name, name_am: b.nameAm || undefined, city: b.city, sub_city: b.subCity || undefined },
      rooms: rows.map(r => ({ name: r.name, name_am: r.nameAm || undefined, description: r.description || undefined, price_per_night_etb: r.pricePerNight, capacity: r.capacity, amenities: r.amenities || [], total_rooms: r.totalRooms })),
      book_url: `${BASE}/hotel/${slug}`, source_url: `${BASE}/hotel/${slug}` });
  })));

  server.registerTool('get_hospital_departments', {
    title: 'Hospital departments and slots',
    description: 'Departments of a hospital listed on BinaSmart with consultation fee (ETB), doctors, hours, floor/room and appointment slots left for a date. Use the slug from search_places (is_hospital = true).',
    inputSchema: { slug: z.string().min(1).max(60).describe('Hospital slug from search_places'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD (default today)') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_hospital_departments', guard(async ({ slug, date }) => {
    const b = (await db.query(SQL.building, [slug])).rows[0];
    if (!b) return toolError(`No hospital with slug "${slug}". Find it with search_places first.`);
    const day = date || new Date().toISOString().slice(0, 10);
    const next = new Date(day + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    const [deps, booked] = await Promise.all([db.query(SQL.departments, [b.id]), db.query(SQL.booked, [b.id, day, next.toISOString().slice(0, 10)])]);
    if (!deps.rows.length) return toolError(`"${b.name}" has no departments listed on BinaSmart.`);
    const used = Object.fromEntries(booked.rows.map(r => [r.departmentId, Number(r.n)]));
    return json({ hospital: { name: b.name, name_am: b.nameAm || undefined, city: b.city, sub_city: b.subCity || undefined }, date: day,
      departments: deps.rows.map(d => ({ name: d.name, name_am: d.nameAm || undefined, floor: d.floor, room: d.room || undefined, fee_etb: d.fee ?? undefined, doctors: d.doctors || [], hours: d.openHours || undefined, slots_left: Math.max(0, d.slotsPerDay - (used[d.id] || 0)) })),
      book_url: `${BASE}/hospital/${slug}`, source_url: `${BASE}/hospital/${slug}` });
  })));
}
