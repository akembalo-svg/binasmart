'use strict';
// Bini's hands. OpenAI-style function definitions (Gemini's OpenAI-compatible endpoint accepts them) and the
// executor that calls the app's own localhost API, so every limit, validation and side effect is the same one
// the web app and the MCP go through. Nothing here talks to the database except the tender search.
const ADDIS = { latMin: 8.5, latMax: 9.5, lngMin: 38.4, lngMax: 39.2 };
const TIERS = ['moto', 'bajaj', 'economy', 'comfort', 'xl'];

const DEFS = [
  { name: 'search_places', description: 'Find a place in Addis Ababa by name (building, hotel, shop, landmark, area) and get its coordinates. Call this BEFORE quote_ride for any pickup or drop-off the user names. Returns up to 5 matches; pick the one that matches the user\'s words and confirm if two look alike.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'Place name in Amharic, English or Afaan Oromoo, e.g. "Bole Medhanialem", "መገናኛ", "Edna Mall"' } }, required: ['q'] } },
  { name: 'quote_ride', description: 'Fixed upfront BinaRide fare between two points in Addis Ababa, for every tier (moto, bajaj, economy, comfort, XL). Fares are locked at request time and never change with traffic. Use the exact numbers returned; never estimate.',
    parameters: { type: 'object', properties: {
      pickup: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] },
      dropoff: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] } }, required: ['pickup', 'dropoff'] } },
  { name: 'request_ride', description: 'Book a real BinaRide car. ONLY after the user has seen the fare from quote_ride and explicitly said yes to pickup, drop-off, tier, fare and their Ethiopian phone number in this conversation. Never call it to "check"; it sends a real driver. Returns the ride id and status.',
    parameters: { type: 'object', properties: {
      pickup: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] },
      dropoff: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } }, required: ['lat', 'lng'] },
      tier: { type: 'string', enum: TIERS }, riderName: { type: 'string' }, riderPhone: { type: 'string', description: 'Ethiopian mobile, 09XXXXXXXX or +2519XXXXXXXX' },
      confirmed: { type: 'boolean', description: 'true only if the user explicitly confirmed fare, route, tier and phone' } }, required: ['pickup', 'dropoff', 'tier', 'riderPhone', 'confirmed'] } },
  { name: 'ride_status', description: 'Status of a ride (searching, assigned driver name/car/plate, arrived, on trip, completed, cancelled). Needs the ride id and the phone used to book.',
    parameters: { type: 'object', properties: { rideId: { type: 'string' }, phone: { type: 'string' } }, required: ['rideId', 'phone'] } },
  { name: 'pool_board', description: 'BinaPool (ጋራ ጉዞ / Imala Waliinii): corridors open right now with stops and the live seat-price ladder (1 to 4 riders), plus cars currently filling near a point if lat/lng are given. Use for any shared-ride or seat-price question.',
    parameters: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } } },
  { name: 'cinema_programme', description: 'What is showing in Addis Ababa cinemas from today: venue, film, showtimes, dates. Data comes from the cinemas\' own programmes; if a film is not listed, say so.',
    parameters: { type: 'object', properties: { venue: { type: 'string', description: 'optional venue name filter' } } } },
  { name: 'search_tenders', description: 'Search verified Ethiopian tenders that are still open (deadline not passed): by keyword, organisation or category. Returns title, organisation, category, deadline and the bina.et link.',
    parameters: { type: 'object', properties: { q: { type: 'string' }, category: { type: 'string' } } } },
  { name: 'watch_channels', description: 'BinaWatch (bina.et/watch): live Ethiopian TV channels, FM radio stations (Sheger FM, etc.), series playlists and kids channels, each with a direct open link. Call it for any request to watch, listen, open, play a TV channel, radio station, series or drama; answer with the openUrl so the user taps once. Never send users to outside websites for TV or radio.',
    parameters: { type: 'object', properties: { q: { type: 'string', description: 'channel, station or series name, e.g. "Sheger", "EBS", "ደራሽ"; empty = list all' }, kind: { type: 'string', enum: ['tv', 'radio', 'series', 'kids', 'all'] } } } },
  { name: 'remember', description: 'Save something about this user for next time: their name, phone, preferred language, home or work place, or a short note. For home/work pass the place NAME as value; this tool finds the coordinates itself, so do NOT call search_places first. Call it whenever the user says "remember", "my name is", "my home is", "my work is", "ቤቴ … ነው", "ስሜ … ነው", "manni koo …" — one call per fact.',
    parameters: { type: 'object', properties: { field: { type: 'string', enum: ['name', 'phone', 'lang', 'home', 'work', 'notes'] }, value: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }, required: ['field', 'value'] } },
  { name: 'contact_team', description: 'Hand the conversation to the BinaSmart team (a person) with a short summary, when the user asks for a human, has a complaint you cannot resolve, or needs something only the team can do (pricing for businesses, a refund, a partner request). Tell the user the team will reply on this chat or on WhatsApp.',
    parameters: { type: 'object', properties: { summary: { type: 'string' }, reason: { type: 'string' } }, required: ['summary'] } },
];

const toOpenAI = () => DEFS.map(d => ({ type: 'function', function: d }));

function inAddis(p) { return p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && +p.lat >= ADDIS.latMin && +p.lat <= ADDIS.latMax && +p.lng >= ADDIS.lngMin && +p.lng <= ADDIS.lngMax; }
const clean = p => ({ lat: +p.lat, lng: +p.lng, label: String(p.label || '').slice(0, 80) });

// executor factory. ctx: { base, fetchImpl, prisma, memory, user, ip, handover, log }
function makeExecutor(ctx) {
  const f = ctx.fetchImpl || fetch;
  async function api(method, path, body, phone) {
    const r = await f(ctx.base + path, { method, headers: { 'content-type': 'application/json', 'x-real-ip': phone ? 'bini-' + String(phone).replace(/\D/g, '').slice(-9) : (ctx.ip || 'bini') }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (d && d.error) || ('http_' + r.status) };
    return d;
  }
  const H = {
    async search_places({ q }) {
      const d = await api('GET', '/api/ride/search?q=' + encodeURIComponent(String(q || '').slice(0, 80)));
      if (d.error) return d;
      return { results: (d.results || []).slice(0, 5).map(p => ({ name: p.label || p.name, nameAm: p.labelAm || null, kind: p.kind, lat: p.lat, lng: p.lng, area: p.sub || '' })) };
    },
    async quote_ride({ pickup, dropoff }) {
      if (!inAddis(pickup) || !inAddis(dropoff)) return { error: 'pickup and dropoff must be inside Addis Ababa; use search_places first' };
      const d = await api('POST', '/api/ride/quote', { pickup: clean(pickup), dropoff: clean(dropoff) });
      if (d.error) return d;
      if (ctx.memory) ctx.memory.touch({ lastPickup: clean(pickup), lastDropoff: clean(dropoff) }).catch(() => {});
      return { distanceKm: +(d.distanceM / 1000).toFixed(1), minutes: Math.round(d.durationS / 60), fares: (d.quotes || []).map(q => ({ tier: q.tier, label: q.label, labelAm: q.labelAm, seats: q.seats, etb: q.fareEtb != null ? q.fareEtb : (q.fare != null ? q.fare : q.etb) })), note: 'Fixed fares, locked at booking; cash to the driver.' };
    },
    async request_ride({ pickup, dropoff, tier, riderName, riderPhone, confirmed }) {
      if (!confirmed) return { error: 'not_confirmed: ask the user to confirm fare, route, tier and phone first' };
      if (!inAddis(pickup) || !inAddis(dropoff)) return { error: 'pickup and dropoff must be inside Addis Ababa' };
      if (!TIERS.includes(tier)) return { error: 'tier must be one of ' + TIERS.join(', ') };
      const ph = String(riderPhone || '').replace(/[^\d+]/g, '');
      if (!/^(\+?251|0)9\d{8}$/.test(ph)) return { error: 'riderPhone must be an Ethiopian mobile (09XXXXXXXX)' };
      const d = await api('POST', '/api/ride/request', { pickup: clean(pickup), dropoff: clean(dropoff), tier, riderName: String(riderName || (ctx.user && ctx.user.name) || 'Bini rider').slice(0, 60), riderPhone: ph, paymentMethod: 'cash', source: 'bini' }, ph);
      if (d.error) return d;
      if (ctx.memory) ctx.memory.touch({ phone: ph, name: riderName || undefined }).catch(() => {});
      const r = d.ride || d;
      return { rideId: r.id, status: r.status, fareEtb: r.fareEtb || r.fare, trackUrl: (ctx.publicBase || 'https://bina.et') + '/ride?id=' + r.id, note: 'Tell the user the ride id and that the driver name, car and plate will appear on the tracking link and on Telegram.' };
    },
    async ride_status({ rideId, phone }) {
      const d = await api('GET', '/api/ride/' + encodeURIComponent(String(rideId || '').slice(0, 40)) + '?phone=' + encodeURIComponent(String(phone || '')));
      if (d.error) return d;
      const r = d.ride || {};
      return { status: r.status, driver: r.driver ? { name: r.driver.name, car: r.driver.car || r.driver.vehicle, plate: r.driver.plate, phone: r.driver.phone } : null, fareEtb: r.fareEtb, pickup: r.pickup && r.pickup.label, dropoff: r.dropoff && r.dropoff.label };
    },
    async pool_board({ lat, lng }) {
      const qs = (Number.isFinite(+lat) && Number.isFinite(+lng)) ? '?lat=' + (+lat) + '&lng=' + (+lng) : '';
      const d = await api('GET', '/api/pool/board' + qs);
      if (d.error) return d;
      return { direction: d.direction, peak: d.peak, corridors: (d.corridors || []).map(c => ({ name: c.name, nameAm: c.nameAm, stops: (c.stops || []).map(s => s.label), seatPrices: (c.ladder || []).map(l => ({ riders: l.n, seatEtb: l.seatEtb })), filling: c.open || c.filling || null })), nearby: (d.groups || []).map(g => ({ id: g.id, to: g.destLabel || g.to || g.name, seatsLeft: g.seatsLeft, seatEtb: g.seatEtb || g.seatFareEtb, womenOnly: !!g.womenOnly, joinUrl: (ctx.publicBase || 'https://bina.et') + '/pool/' + g.id })), joinUrl: (ctx.publicBase || 'https://bina.et') + '/ride?pool=1' };
    },
    async cinema_programme({ venue }) {
      const d = await api('GET', '/api/cinema/programme');
      if (d.error) return d;
      let venues = d.venues || [];
      if (venue) { const v = String(venue).toLowerCase(); venues = venues.filter(x => (x.venue.name + ' ' + (x.venue.nameAm || '') + ' ' + (x.venue.area || '')).toLowerCase().includes(v)); }
      return { today: d.today, venues: venues.slice(0, 8).map(x => ({ venue: x.venue.name, area: x.venue.area, films: (x.films || []).slice(0, 8).map(p => ({ title: p.title, titleAm: p.titleAm, times: p.times, from: p.dateFrom, to: p.dateTo, hall: p.hallName })) })), bookUrl: (ctx.publicBase || 'https://bina.et') + '/cinema' };
    },
    async search_tenders({ q, category }) {
      if (!ctx.prisma) return { error: 'tenders unavailable' };
      const term = String(q || '').trim().slice(0, 60);
      const where = { published: true, OR: [{ deadline: null }, { deadline: { gte: new Date() } }] };
      if (category) where.category = { contains: String(category).slice(0, 40), mode: 'insensitive' };
      if (term) where.AND = [{ OR: [{ title: { contains: term, mode: 'insensitive' } }, { titleAm: { contains: term, mode: 'insensitive' } }, { org: { contains: term, mode: 'insensitive' } }, { summary: { contains: term, mode: 'insensitive' } }] }];
      const rows = await ctx.prisma.tender.findMany({ where, orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }], take: 6 });
      return { count: rows.length, tenders: rows.map(t => ({ title: t.titleAm || t.title, org: t.org, category: t.category, region: t.region, deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null, url: (ctx.publicBase || 'https://bina.et') + '/tenders/' + t.slug })), allUrl: (ctx.publicBase || 'https://bina.et') + '/tenders' };
    },
    async watch_channels({ q, kind }) {
      let data;
      try { data = JSON.parse(require('fs').readFileSync(ctx.channelsFile || require('path').join(__dirname, '..', 'watch', 'channels.json'), 'utf8')); } catch (e) { return { error: 'channel list unavailable' }; }
      const base = (ctx.publicBase || 'https://bina.et') + '/watch';
      const term = String(q || '').trim().toLowerCase();
      const hit = s => !term || String(s || '').toLowerCase().includes(term);
      const want = k => !kind || kind === 'all' || kind === k;
      const out = [];
      if (want('tv')) for (const c of data.tv || []) if (hit(c.name) || hit(c.nameAm) || hit(c.id)) out.push({ kind: 'tv', name: c.name, nameAm: c.nameAm, tag: c.tag, openUrl: base + '#tv/' + c.id });
      if (want('radio')) for (const c of data.radio || []) if (hit(c.name) || hit(c.nameAm) || hit(c.id)) out.push({ kind: 'radio', name: c.name, nameAm: c.nameAm, tag: c.tag, openUrl: base + '#radio/' + c.id });
      if (want('kids')) for (const c of data.kids || []) if (hit(c.name) || hit(c.nameAm) || hit(c.id)) out.push({ kind: 'kids', name: c.name, nameAm: c.nameAm, openUrl: base + '#kids/' + c.id });
      if (want('series')) for (const s of data.series || []) if (hit(s.title) || hit(s.titleAm) || hit(s.id)) out.push({ kind: 'series', name: s.title, nameAm: s.titleAm, genre: s.kind, openUrl: base + '#series/' + s.id });
      return { count: out.length, items: out.slice(0, 12), allUrl: base, note: out.length ? 'Give the openUrl; it opens inside BinaWatch (free, Ethiopian content only).' : 'Not on BinaWatch; say so and offer the full list at /watch. Do not link outside sites.' };
    },
    async remember({ field, value, lat, lng }) {
      if (!ctx.memory || !ctx.memory.persistent) return { ok: false, note: 'This channel has no stable identity; nothing saved. Suggest the Telegram bot @bina_smart_bot for memory.' };
      const patch = {};
      if (field === 'home' || field === 'work') {
        let place = { label: String(value).slice(0, 80), lat: Number.isFinite(+lat) ? +lat : null, lng: Number.isFinite(+lng) ? +lng : null };
        if (place.lat == null) { // resolve the name ourselves so "remember my home is CMC" saves coordinates in one step
          const s = await H.search_places({ q: value });
          const first = s && s.results && s.results[0];
          if (first) place = { label: first.name, lat: first.lat, lng: first.lng };
        }
        patch[field] = place;
        await ctx.memory.touch(patch);
        return { ok: true, saved: field, place: place.label, hasCoordinates: place.lat != null, note: place.lat == null ? 'Place not found on the map; saved the name only.' : 'Saved with coordinates; from now on quote_ride can use it directly.' };
      }
      patch[field] = String(value).slice(0, field === 'notes' ? 400 : 80);
      await ctx.memory.touch(patch);
      return { ok: true, saved: field };
    },
    async contact_team({ summary, reason }) {
      if (ctx.handover) await ctx.handover({ summary: String(summary || '').slice(0, 600), reason: String(reason || 'user asked for a person').slice(0, 120), explicit: true }).catch(() => {});
      return { ok: true, note: 'The team has the summary. Tell the user someone will reply here or on WhatsApp +251 911 244 344, and ask nothing more unless needed.' };
    },
  };
  return async function execute(name, args) {
    const fn = H[name]; if (!fn) return { error: 'unknown_tool' };
    try { return await fn(args || {}); } catch (e) { return { error: 'tool_failed: ' + (e && e.message || e) }; }
  };
}

module.exports = { DEFS, toOpenAI, makeExecutor, inAddis, TIERS };
