// BinaSmart Health for AI assistants (30 Sep 2026): the same search Bini uses (/api/health/search on the site).
// Hospitals, clinics, dentists, labs and health centres from the city map, plus the services and doctors that the
// facilities confirmed and the BinaSmart team checked (a doctor's licence is checked by a person before a profile shows).
// Only what the public pages show: landlines, page links, confirmed services. Never a licence number or a private mobile.
// Not medical advice, and an emergency is 907.
import { z } from 'zod';
import { toolError } from './ride.mjs';

const LOCAL = process.env.RIDE_API || 'http://127.0.0.1:4210';
async function get(path) {
  const r = await fetch(LOCAL + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
const ADDIS = { latMin: 8.5, latMax: 9.5, lngMin: 38.4, lngMax: 39.2 };   // the same box as Bini's tools (assistant/tools.js)
const inAddis = p => p && +p.lat >= ADDIS.latMin && +p.lat <= ADDIS.latMax && +p.lng >= ADDIS.lngMin && +p.lng <= ADDIS.lngMax;
const NOTE = 'From BinaSmart Health (bina.et/health): the city map (OpenStreetMap contributors) plus what facilities confirmed. '
  + 'Give each place with its phone and its url. Opening hours and night service are unknown unless "hours" is given: tell the user to call first. '
  + 'This is a directory, not medical advice. In an emergency in Addis Ababa call 907 (ambulance).';

export function registerHealthTools(server, { wrap, json }) {
  server.registerTool('search_health', {
    title: 'Hospitals, clinics, dentists and doctors in Addis Ababa',
    description: 'Find hospitals, clinics, dentists, laboratories, health centres and doctors in Addis Ababa from BinaSmart Health (bina.et/health, 250+ places from the city map plus services and doctors the facilities confirmed; doctors\' licences are checked by the BinaSmart team). Filter by kind, sub-city, a place to be near (nearest first) and a specialty (children, gynecology, eye, heart, bone, fertility, skin, mental health, blood test). Returns each place\'s bina.et/health page, landline, sub-city, distance, and its services and doctors when known. Not medical advice; emergencies: 907.',
    inputSchema: {
      kind: z.enum(['hospital', 'clinic', 'dentist', 'lab', 'doctor']).optional().describe('lab = laboratory or diagnostic centre; doctor = individual doctors\' profiles'),
      area: z.string().max(40).optional().describe('A sub-city: Bole, Kirkos, Arada, Yeka, Lideta, Gulele, Addis Ketema, Kolfe Keranio, Nifas Silk-Lafto, Akaki Kality, Lemi Kura (English or Amharic)'),
      near: z.string().max(80).optional().describe('A neighbourhood or landmark to be near, e.g. Piassa, CMC, Megenagna, Edna Mall. Nearest places first.'),
      specialty: z.string().max(60).optional().describe('A specialty, service or part of a name, e.g. children, gynecology, eye, blood test, Hayat'),
      limit: z.number().int().min(1).max(10).optional().describe('Max results, default 6'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('search_health', async ({ kind, area, near, specialty, limit }) => {
    let lat, lng, nearName;
    if (near) {
      try {
        const s = await get('/api/ride/search?' + qs({ q: near }));
        const p = (s.results || []).find(inAddis);
        if (p) { lat = p.lat; lng = p.lng; nearName = p.label || p.name; }
      } catch (e) { /* no point on the map: fall back to the words */ }
      if (lat == null && !area) area = near;
    }
    let d;
    try { d = await get('/api/health/search?' + qs({ kind, area, q: specialty, lat, lng, limit: limit || 6 })); }
    catch (e) { return toolError('BinaSmart Health search is temporarily unavailable. Browse https://bina.et/health.'); }
    if (!(d.results || []).length && !(d.doctors || []).length)
      return toolError('No place in BinaSmart Health matches' + (nearName ? ' near ' + nearName : '') + '. Try another sub-city or kind of place, or browse https://bina.et/health.');
    const out = { count: d.total, results: d.results, note: NOTE, source_url: d.more || 'https://bina.et/health' };
    if (nearName) out.near = nearName;
    if (d.nearest) { out.nearest = d.nearest; out.nearest_note = d.nearestNote; }
    if (d.relaxed) out.relaxed = d.relaxed;
    if ((d.doctors || []).length) out.doctors = d.doctors;
    return json(out);
  }));
}
