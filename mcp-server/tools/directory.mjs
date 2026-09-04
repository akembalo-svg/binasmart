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
  events: `SELECT s.id, s."startsAt", s.prices, e.slug, e.title, e."titleAm", e.kind, e.descr, e."runtimeMin", h.name AS hall, h.capacity, h.layout,
                  v.name AS venue, v."nameAm" AS "venueAm", v.address,
                  COALESCE((SELECT SUM(cardinality(t.seats)) FROM "Ticket" t WHERE t."showId" = s.id AND t.status IN ('RESERVED','CONFIRMED','CHECKED_IN')), 0)::int AS sold
           FROM "Show" s JOIN "Event" e ON e.id = s."eventId" JOIN "Hall" h ON h.id = s."hallId" JOIN "Venue" v ON v.id = h."venueId"
           WHERE s.status = 'onsale' AND s."startsAt" > now() ORDER BY s."startsAt" LIMIT 50`,
  films: `SELECT slug, title, "titleAm", year, "runtimeMin", rating, language, genre, descr, "posterUrl", "sourceKind", "priceEtb", "rentHours", views, "createdAt"
          FROM "Film" WHERE status = 'public' AND rights IS NOT NULL AND rights <> '' AND ("rightsUntil" IS NULL OR "rightsUntil" > now())
          AND ($1::text IS NULL OR title ILIKE $1 OR "titleAm" LIKE $1 OR genre ILIKE $1) ORDER BY "createdAt" DESC LIMIT $2`,
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
    description: 'Upcoming films, concerts, theatre and events on BinaSmart in Addis Ababa with venue, hall, start time, prices per tier and seats left. Seats are chosen and paid at the url returned (Chapa or at the counter); the ticket is a QR code.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_events', guard(async () => {
    const { rows } = await db.query(SQL.events, []);
    const events = rows.map(s => {
      const prices = s.prices && typeof s.prices === 'object' ? s.prices : {};
      const vals = Object.values(prices).map(Number).filter(Number.isFinite);
      return { show_id: s.id, slug: s.slug, title: s.title, title_am: s.titleAm || undefined, kind: s.kind, venue: s.venue, venue_am: s.venueAm || undefined, address: s.address || undefined, hall: s.hall,
        description: s.descr || undefined, starts_at: s.startsAt, runtime_min: s.runtimeMin || undefined, general_admission: !!(s.layout && s.layout.kind === 'ga'),
        price_from_etb: vals.length ? Math.min(...vals) : undefined, prices_etb: prices, seats_left: Math.max(0, (s.capacity || 0) - (s.sold || 0)), url: `${BASE}/cinema/${s.id}` };
    });
    return json({ count: events.length, events, book_hint: 'Seats are chosen and paid on the url (Chapa or at the counter); the ticket is a QR code.', source_url: `${BASE}/cinema` });
  })));

  server.registerTool('list_films', {
    title: 'Amharic films to watch online',
    description: 'Licensed Amharic (Ethiopian) films that can be watched online on BinaSmart Watch (bina.et/watch): title in Amharic and English, year, genre, whether it is free or rented for 48 hours (ETB), and the watch url. Free titles are public YouTube releases played through the YouTube player; rentals need Chapa. Optional search by title or genre.',
    inputSchema: { query: z.string().max(60).optional().describe('Title (Amharic or English) or genre to filter by; omit for the latest films'), limit: z.number().int().min(1).max(50).optional().describe('Max films, default 20') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_films', guard(async ({ query, limit }) => {
    const { rows } = await db.query(SQL.films, [query ? like(query) : null, limit || 20]);
    const films = rows.map(f => ({ slug: f.slug, title: f.title, title_am: f.titleAm || undefined, year: f.year || undefined, runtime_min: f.runtimeMin || undefined, rating: f.rating || undefined, language: f.language, genre: f.genre || undefined,
      description: f.descr || undefined, poster_url: f.posterUrl || undefined, source: f.sourceKind === 'youtube' ? 'YouTube player' : 'stream', free: !f.priceEtb,
      rental: f.priceEtb ? { price_etb: f.priceEtb, hours: f.rentHours } : undefined, views: f.views, url: `${BASE}/watch/${f.slug}` }));
    if (!films.length) return toolError(query ? `No film matching "${query}" on BinaSmart Watch. Browse ${BASE}/watch.` : `No films on BinaSmart Watch yet. Browse ${BASE}/watch.`);
    return json({ count: films.length, films, watch_hint: 'Open the url to watch; free films play at once, rentals are paid on Chapa for 48 hours.', source_url: `${BASE}/watch` });
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
