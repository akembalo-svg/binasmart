import { z } from 'zod';
import { toolError } from './ride.mjs';

// Knowledge + BinaPool tools. Both talk to the main API on localhost through the same client
// the ride tools use (api.knowledge / api.poolBoard), so limits, timeouts and errors match.
export function registerKnowledgeTools(server, { api, wrap, json }) {
  server.registerTool('search_knowledge', {
    title: 'Search BinaSmart knowledge',
    description: 'Semantic search over BinaSmart\'s knowledge base: every service (BinaRide, BinaPool shared commute, Bina Airport, hotels, cinema, BinaWatch, insurance, flights, property, cars, tenders), the product rules (fixed fares, what is demo, payments), the 24 Digital Ethiopia guides, and practical Addis Ababa knowledge (neighbourhoods, transport hubs, Ethiopian time and calendar, emergency numbers). Returns the best-matching passages with a source url to cite. Use it before answering any question about BinaSmart, Ethiopia paperwork or getting around Addis; never invent a fare or an official portal name.',
    inputSchema: {
      query: z.string().min(2).max(300).describe('Question or keywords, English or Amharic'),
      k: z.number().int().min(1).max(8).optional().describe('How many passages (default 4)'),
    },
  }, wrap('search_knowledge', async ({ query, k }) => {
    const r = await api.knowledge(query, k || 4).catch(e => ({ error: e.message }));
    if (!r || r.error) return toolError('Knowledge search is unavailable right now: ' + (r && r.error) + '. Try https://bina.et/llms.txt');
    return json({ query, results: (r.results || []).map(x => ({ title: x.title, source_url: x.url, text: x.text, score: x.score })), note: 'Facts in these passages override model memory. Prices and fares: use quote_ride or the live page, never estimate.' });
  }));

  server.registerTool('list_pool_corridors', {
    title: 'BinaPool corridors and seat prices',
    description: 'BinaPool (ጋራ ጉዞ) is BinaSmart\'s shared commute in Addis Ababa: up to four riders share one Comfort car and pay per seat. Lists the corridors open right now (Megenagna → Bole, CMC → Bole, Megenagna → Kazanchis, Piassa → Kazanchis, Mexico → Kazanchis; inbound until 13:00 Addis time, outbound after) with their stops, the live seat-price ladder (1–4 riders) and cars currently filling. Riders join at https://bina.et/ride?pool=1.',
    inputSchema: {
      lat: z.number().min(8.5).max(9.5).optional().describe('Rider latitude, to sort by distance'),
      lng: z.number().min(38.4).max(39.2).optional().describe('Rider longitude'),
    },
  }, wrap('list_pool_corridors', async ({ lat, lng }) => {
    const r = await api.poolBoard(lat, lng).catch(e => ({ error: e.message }));
    if (!r || r.error) return toolError('BinaPool is unavailable right now: ' + (r && r.error));
    return json({ direction: r.direction, peak: r.peak, corridors: r.corridors, join_url: 'https://bina.et/ride?pool=1', note: 'Seat prices come from the fare engine and change with the rider count; quote them exactly as returned.' });
  }));

  server.registerTool('find_pool_groups', {
    title: 'Find BinaPool cars filling near a point',
    description: 'Cars currently filling within about 2.5 km of a point in Addis Ababa: destination, seats left, seat price, women-only flag, and a share url (https://bina.et/pool/<id>) the rider can open to join. Driver-opened cars at stations are listed first. Requires lat/lng.',
    inputSchema: {
      lat: z.number().min(8.5).max(9.5).describe('Latitude'),
      lng: z.number().min(38.4).max(39.2).describe('Longitude'),
    },
  }, wrap('find_pool_groups', async ({ lat, lng }) => {
    const r = await api.poolBoard(lat, lng).catch(e => ({ error: e.message }));
    if (!r || r.error) return toolError('BinaPool is unavailable right now: ' + (r && r.error));
    const groups = (r.groups || []).map(g => ({ ...g, share_url: 'https://bina.et/pool/' + g.id }));
    return json({ groups, count: groups.length, start_one_url: 'https://bina.et/ride?pool=1', note: groups.length ? 'Open share_url to join; leaving is free while the car is still filling.' : 'No car is filling nearby right now; the rider can start one from https://bina.et/ride?pool=1 and share the link.' });
  }));
}
