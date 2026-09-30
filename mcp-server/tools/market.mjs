// Homes, cars and places to stay on BinaSmart, for AI assistants: the same live searches Bini uses
// (/api/properties/search, /api/cars/search and /api/hotels/search on the site). The listings come from the companies',
// dealers' and hotels' own websites and the city map; the contacts returned are THEIR own - BinaSmart is not the agent.
import { z } from 'zod';
import { toolError } from './ride.mjs';

const LOCAL = process.env.RIDE_API || 'http://127.0.0.1:4210';
async function get(path) {
  const r = await fetch(LOCAL + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString();
const RO = { readOnlyHint: true, openWorldHint: false };

export function registerMarketTools(server, { wrap, json }) {
  server.registerTool('search_properties', {
    title: 'Homes, land and shops for sale or rent in Addis Ababa',
    description: 'Live listings on bina.et/property from Addis Ababa real-estate companies\' own websites, checked every week: title, price as the company wrote it (some per m² or in USD), bedrooms, size, area, the listing company with its own phone and WhatsApp, the date the company last updated it, and a bina.et link with every photo. Use for "apartment for rent in Bole", "3 bedroom for sale", "ቤት ኪራይ". Never invent a listing or a price.',
    inputSchema: {
      listing: z.enum(['sale', 'rent']).optional().describe('Buy (sale) or rent'),
      type: z.enum(['Apartment', 'Condominium', 'House / Villa', 'Land', 'Commercial', 'Building']).optional(),
      area: z.string().max(40).optional().describe('Neighbourhood in English or Amharic, e.g. Bole, Sarbet, CMC, Ayat, ሳርቤት'),
      beds: z.number().int().min(0).max(10).optional().describe('At least this many bedrooms (0 = studio)'),
      max_price: z.number().positive().optional().describe('Highest price in birr (total for sale, per month for rent)'),
      query: z.string().max(60).optional().describe('Other words: a building, project or company name'),
      limit: z.number().int().min(1).max(8).optional().describe('Max results, default 5'),
    },
    annotations: RO,
  }, wrap('search_properties', async ({ listing, type, area, beds, max_price, query, limit }) => {
    let d; try { d = await get('/api/properties/search?' + qs({ listing, type, area, beds, maxPrice: max_price, q: query, limit: limit || 5 })); }
    catch (e) { return toolError('BinaSmart property search is temporarily unavailable. Browse https://bina.et/property.'); }
    if (!d.results || !d.results.length) return toolError('No listing matches that on BinaSmart right now. Try another area or a higher budget, or browse https://bina.et/property.');
    return json({ count: d.total, results: d.results, note: 'From the companies\' own websites. The buyer contacts the listing company directly (its own phone/WhatsApp); BinaSmart is not the agent and takes no fee. Prices exactly as the company wrote them.', source_url: 'https://bina.et/property' });
  }));

  server.registerTool('search_cars', {
    title: 'Cars for sale in Addis Ababa',
    description: 'Live new and used cars on bina.et/cars from Addis Ababa dealers\' and car markets\' own websites, checked every week: make, model, year, price, mileage, fuel, gearbox, the dealer with its own phone and WhatsApp, and a bina.et link with every photo. Use for "used Toyota", "SUV under 10 million birr", "electric car price", "BYD". Not for taxi rides.',
    inputSchema: {
      make: z.string().max(30).optional().describe('Brand, e.g. Toyota, Suzuki, BYD, Hyundai, Ford'),
      model: z.string().max(40).optional(),
      body: z.enum(['SUV', 'Sedan', 'Hatchback', 'Pickup', 'Van / Bus', 'Truck', 'EV']).optional(),
      fuel: z.enum(['Petrol', 'Diesel', 'Hybrid', 'Electric']).optional(),
      condition: z.enum(['New', 'Used']).optional(),
      min_year: z.number().int().min(1990).max(2100).optional(),
      max_price: z.number().positive().optional().describe('Highest price in birr'),
      cheapest_first: z.boolean().optional(),
      limit: z.number().int().min(1).max(8).optional().describe('Max results, default 5'),
    },
    annotations: RO,
  }, wrap('search_cars', async ({ make, model, body, fuel, condition, min_year, max_price, cheapest_first, limit }) => {
    let d; try { d = await get('/api/cars/search?' + qs({ make, model, body, fuel, condition, minYear: min_year, maxPrice: max_price, sort: cheapest_first ? 'cheap' : '', limit: limit || 5 })); }
    catch (e) { return toolError('BinaSmart car search is temporarily unavailable. Browse https://bina.et/cars.'); }
    if (!d.results || !d.results.length) return toolError('No car matches that on BinaSmart right now. Try another make or a higher budget, or browse https://bina.et/cars.');
    return json({ count: d.total, results: d.results, note: 'From the dealers\' own websites. The buyer contacts the dealer directly; BinaSmart is not the seller. Prices exactly as the dealer wrote them.', source_url: 'https://bina.et/cars' });
  }));

  server.registerTool('search_hotels', {
    title: 'Hotels and guest houses in Addis Ababa',
    description: 'Hotels, guest houses, pensions, hostels and furnished apartments in Addis Ababa from BinaSmart\'s directory (1,000+ places from the city map): name, type, sub-city, stars, the hotel\'s own office phone and website, and its bina.et page. It has NO prices or free rooms - tell the guest to call the hotel.',
    inputSchema: {
      area: z.string().max(40).optional().describe('Sub-city or area in English or Amharic, e.g. Bole, Kirkos, Arada, ቦሌ'),
      kind: z.enum(['hotel', 'guest_house', 'hostel', 'motel', 'apartment']).optional(),
      min_stars: z.number().int().min(1).max(5).optional(),
      name: z.string().max(60).optional().describe('Part of the hotel name'),
      limit: z.number().int().min(1).max(10).optional().describe('Max results, default 6'),
    },
    annotations: RO,
  }, wrap('search_hotels', async ({ area, kind, min_stars, name, limit }) => {
    let d; try { d = await get('/api/hotels/search?' + qs({ area, kind, minStars: min_stars, q: name, limit: limit || 6 })); }
    catch (e) { return toolError('BinaSmart hotel search is temporarily unavailable. Browse https://bina.et/hotels.'); }
    if (!d.results || !d.results.length) return toolError('No place in the BinaSmart directory matches. Try another area or type, or browse https://bina.et/hotels.');
    return json({ count: d.total, results: d.results, note: 'From the city map (OpenStreetMap contributors), not a booking system: no prices or free rooms. Call the hotel.', source_url: 'https://bina.et/hotels' });
  }));
}
