import { z } from 'zod';
import { normPhone } from '../lib/phone.mjs';
import { idemKey } from '../lib/idem.mjs';
import { RideApiError } from '../lib/rideApi.mjs';

export const BASE = 'https://bina.et';
export const WHATSAPP = 'https://wa.me/251911244344';
export const TIERS = ['moto', 'bajaj', 'economy', 'comfort', 'xl']; // verified against ride/fare.js TIERS (2026-09-03)
const BOX = { minLat: 8.5, maxLat: 9.5, minLng: 38.4, maxLng: 39.2 }; // same as ride/routes.js point()

export function toolError(text) { return { content: [{ type: 'text', text }], isError: true }; }

export function parsePlace(s) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(s || ''));
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (lat < BOX.minLat || lat > BOX.maxLat || lng < BOX.minLng || lng > BOX.maxLng) return null;
  return { lat, lng };
}

// A place is "lat,lng" or a name. Names go through the ride API's search (directory first, then OSM).
// Exactly one hit, or a first hit whose label equals the query → use it. Several → hand back candidates.
export async function resolvePlace(api, text) {
  const q = String(text || '').trim();
  const p = parsePlace(q);
  if (p) return { ok: true, point: { ...p, label: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` } };
  if (q.length < 2) return { ok: false, error: 'not_found' };
  const r = await api.search(q);
  const hits = (r && r.results) || [];
  if (!hits.length) return { ok: false, error: 'not_found' };
  const pick = h => ({ ok: true, point: { lat: h.lat, lng: h.lng, label: h.label } });
  if (hits.length === 1 || hits[0].label.toLowerCase() === q.toLowerCase()) return pick(hits[0]);
  return { ok: false, candidates: hits.slice(0, 5).map(h => ({ name: h.label, name_am: h.labelAm || undefined, area: h.sub || undefined, coords: `${h.lat},${h.lng}` })) };
}

function apiErrorToTool(e, ctx) {
  if (!(e instanceof RideApiError)) throw e;
  if (e.status === 429) return toolError('Slow down — too many ride requests for this phone or session. Try again in a few minutes.');
  if (e.status === 404) return toolError(`Ride not found, or the phone does not match the ride ${ctx || ''}. Check both.`.replace('  ', ' '));
  if (e.status === 409) return toolError('This ride can no longer be cancelled (it has already started or finished).');
  if (e.status >= 400 && e.status < 500) return toolError(`BinaSmart Ride rejected the request: ${e.message}`);
  return toolError(`BinaSmart Ride is temporarily unavailable — book at ${BASE}/ride or WhatsApp ${WHATSAPP}.`);
}

async function resolveBoth(api, pickup, dropoff) {
  const [a, b] = await Promise.all([resolvePlace(api, pickup), resolvePlace(api, dropoff)]);
  for (const [which, r, raw] of [['pickup', a, pickup], ['dropoff', b, dropoff]]) {
    if (r.ok) continue;
    if (r.candidates) return { err: toolError(`"${raw}" is ambiguous for the ${which}. Ask the user which one, then call again with its coords:\n` + r.candidates.map(c => `- ${c.name}${c.name_am ? ' / ' + c.name_am : ''}${c.area ? ' (' + c.area + ')' : ''} → ${c.coords}`).join('\n')) };
    return { err: toolError(`Could not find "${raw}" in Addis Ababa for the ${which}. Ask for a landmark, building or "lat,lng".`) };
  }
  return { from: a.point, to: b.point };
}

function pubQuote(q) { return { tier: q.tier, label: q.label, label_am: q.labelAm, seats: q.seats, fare_etb: q.fareEtb, eta_min: q.etaMin }; }
function pubRide(r) {
  return { ride_id: r.id, status: r.status, tier: r.tier, fare_etb: r.fareEtb, payment_method: r.paymentMethod, payment_status: r.paymentStatus,
    pickup: r.pickup && r.pickup.label, dropoff: r.dropoff && r.dropoff.label, requested_at: r.requestedAt, concierge: r.concierge,
    driver: r.driver ? { name: r.driver.name, phone: r.driver.phone, vehicle: r.driver.vehicle, plate: r.driver.plate, rating: r.driver.rating } : null,
    tracking_url: `${BASE}/ride?id=${r.id}` };
}

const placeDesc = which => `${which}: a place name in Addis Ababa (e.g. "Edna Mall", "Bole Airport", "Piassa") or "lat,lng" like "9.0108,38.7578".`;
const PHONE_MSG = 'rider_phone must be an Ethiopian mobile number: 09XXXXXXXX or +2519XXXXXXXX (10 digits after +251). Ask the user for it.';

export function registerRideTools(server, { api, wrap, json }) {
  server.registerTool('quote_ride', {
    title: 'Quote a BinaSmart ride',
    description: 'Fixed upfront price for a ride inside Addis Ababa, Ethiopia — no surge, cash or telebirr/Chapa. Returns distance, ETA and the fare for every vehicle tier (moto, bajaj, economy, comfort, XL). Call this before request_ride and read the fare to the user.',
    inputSchema: { pickup: z.string().min(2).max(120).describe(placeDesc('Pickup')), dropoff: z.string().min(2).max(120).describe(placeDesc('Drop-off')) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('quote_ride', async ({ pickup, dropoff }) => {
    try {
      const r = await resolveBoth(api, pickup, dropoff); if (r.err) return r.err;
      const q = await api.quote(r.from, r.to);
      return json({ pickup: r.from.label, dropoff: r.to.label, distance_km: Math.round(q.distanceM / 100) / 10, eta_min: Math.round(q.durationS / 60), estimate: !!q.estimate,
        quotes: q.quotes.map(pubQuote), note: 'Fixed price, no surge. Pay cash or telebirr/Chapa. Addis Ababa only.', pickup_coords: `${r.from.lat},${r.from.lng}`, dropoff_coords: `${r.to.lat},${r.to.lng}`, source_url: `${BASE}/ride` });
    } catch (e) { return apiErrorToTool(e); }
  }));

  server.registerTool('request_ride', {
    title: 'Book a BinaSmart ride',
    description: 'Books a ride in Addis Ababa at the fixed fare from quote_ride. ALWAYS confirm pickup, drop-off, tier, fare and the rider\'s Ethiopian phone number with the user before calling. A dispatcher assigns a driver; the rider is contacted on the phone given. Returns the ride id and a live tracking link. To book for someone else (e.g. a relative in Addis while you are abroad), pass passenger_name and passenger_phone; rider_name/rider_phone are then the booker and may be a foreign number.',
    inputSchema: {
      tier: z.enum(TIERS).describe('Vehicle tier from quote_ride'),
      pickup: z.string().min(2).max(120).describe(placeDesc('Pickup') + ' Prefer the pickup_coords from quote_ride.'),
      dropoff: z.string().min(2).max(120).describe(placeDesc('Drop-off') + ' Prefer the dropoff_coords from quote_ride.'),
      rider_name: z.string().min(1).max(60).describe('Rider\'s name (or the booker\'s name when booking for someone else)'),
      rider_phone: z.string().min(9).max(20).describe('Ethiopian mobile: 09XXXXXXXX or +2519XXXXXXXX (any number if booking for someone else)'),
      payment_method: z.enum(['cash', 'chapa']).optional().describe('cash (default) or chapa (telebirr/card link)'),
      passenger_name: z.string().min(1).max(60).optional().describe('Book for someone else: the passenger\'s name (the driver calls the passenger)'),
      passenger_phone: z.string().min(9).max(20).optional().describe('Book for someone else: the passenger\'s Ethiopian mobile (09… or +2519…)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, wrap('request_ride', async ({ tier, pickup, dropoff, rider_name, rider_phone, payment_method, passenger_name, passenger_phone }) => {
    const passenger = (passenger_name || passenger_phone) ? { name: String(passenger_name || '').trim(), phone: normPhone(passenger_phone) } : null;
    if (passenger && (!passenger.name || !passenger.phone)) return toolError('To book for someone else, give both passenger_name and an Ethiopian passenger_phone (09XXXXXXXX or +2519XXXXXXXX).');
    const phone = passenger ? String(rider_phone || '').replace(/[^\d+]/g, '') : normPhone(rider_phone);
    if (!phone) return toolError(PHONE_MSG + ' If the booker is abroad, use passenger_name and passenger_phone for the person riding.');
    try {
      const r = await resolveBoth(api, pickup, dropoff); if (r.err) return r.err;
      const res = await api.request({ tier, pickup: r.from, dropoff: r.to, riderName: String(rider_name).trim(), riderPhone: phone, paymentMethod: payment_method || 'cash', idemKey: idemKey(passenger ? passenger.phone : phone, r.from, r.to), ...(passenger ? { passenger } : {}) });
      const ride = pubRide(res.ride);
      return json({ ...ride, duplicate: !!res.duplicate, booked_for: passenger ? passenger.name : undefined,
        next_step: `Read the fare (${ride.fare_etb} ETB) and ride id back to the user. A BinaSmart dispatcher will call ${passenger ? passenger.phone + ' (the passenger)' : phone} to confirm the driver. Track at ${ride.tracking_url}.`,
        source_url: `${BASE}/ride`, whatsapp: WHATSAPP });
    } catch (e) { return apiErrorToTool(e); }
  }));

  server.registerTool('get_ride_status', {
    title: 'Ride status',
    description: 'Current status of a BinaSmart ride (dispatching, assigned, arriving, arrived, ontrip, completed, cancelled) with driver name, vehicle and plate once assigned. Needs the ride id and the rider phone used to book.',
    inputSchema: { ride_id: z.string().min(5).max(40), rider_phone: z.string().min(9).max(20) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_ride_status', async ({ ride_id, rider_phone }) => {
    const phone = normPhone(rider_phone);
    if (!phone) return toolError(PHONE_MSG);
    try { const res = await api.status(ride_id, phone); return json({ ...pubRide(res.ride), source_url: `${BASE}/ride?id=${ride_id}` }); }
    catch (e) { return apiErrorToTool(e, ride_id); }
  }));

  server.registerTool('cancel_ride', {
    title: 'Cancel a ride',
    description: 'Cancels a BinaSmart ride that has not started yet. Confirm with the user first. Needs the ride id and the rider phone used to book.',
    inputSchema: { ride_id: z.string().min(5).max(40), rider_phone: z.string().min(9).max(20) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, wrap('cancel_ride', async ({ ride_id, rider_phone }) => {
    const phone = normPhone(rider_phone);
    if (!phone) return toolError(PHONE_MSG);
    try { const res = await api.cancel(ride_id, phone); return json({ ...pubRide(res.ride), source_url: `${BASE}/ride` }); }
    catch (e) { return apiErrorToTool(e, ride_id); }
  }));
}
