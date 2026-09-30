'use strict';
// bina.et/cars/<slug> - one car in full, with the same page as /property/<slug> (property/detail.js renders both):
// every photo, year / km / fuel / gearbox, the specifications, the description, and the DEALER's own contacts.
// Data from ops/places/car-import.js (CarListing.details), taken from the dealer's own website. noindex.
const { page, ic, monthYear, priceValue } = require('../property/detail');

// Our own words for a car, from its facts (what search engines read; the dealer's text loads only on request).
function carSummary(p, d, n) {
  if (/china/i.test(p.city || '')) {
    const who = p.dealer || 'the importer', kf = [p.year, p.mileage, p.bodyType].filter(Boolean).join(', ');
    const en = [(p.condition ? p.condition + ' ' : '') + p.title + ' (electric), in China, offered for import to Ethiopia by ' + who
        + (p.price ? ': ' + p.price + ' in China, before shipping, customs duty and taxes' : '') + (kf ? ' (' + kf + ')' : '') + '.',
      'Ethiopia allows only electric cars to be imported. ' + who + ' ships the car to Addis Ababa through Djibouti; ask for the full price in birr, with shipping, duty and taxes, before you pay.',
      'BinaSmart shows it with ' + n + (n === 1 ? ' photo' : ' photos') + '. Contact ' + who + ' directly: BinaSmart is not the seller.'].join(' ');
    const am = 'ይህ መኪና ቻይና ውስጥ ነው። ' + p.title + (p.price ? ' — የቻይና ዋጋ፦ ' + p.price : '')
      + '። ትራንስፖርት፣ ቀረጥና ግብር አልተጨመረበትም። ' + who + ' በጅቡቲ በኩል ወደ አዲስ አበባ ያመጣል።';
    return { en, am };
  }
  const facts = [p.year, p.mileage, p.fuel && p.fuel.toLowerCase(), p.transmission && p.transmission.toLowerCase()].filter(Boolean).join(', ');
  const en = [(p.condition ? p.condition + ' ' : '') + p.title + ' for sale in Addis Ababa' + (p.price ? ', ' + p.price : '') + (facts ? ' (' + facts + ')' : '') + '.',
    'Sold by ' + (p.dealer || 'the dealer') + ', listed on its own website' + (d.updated ? ' (updated ' + monthYear(d.updated) + ')' : '') + '; BinaSmart shows it with '
      + n + (n === 1 ? ' photo' : ' photos') + ' and the dealer\'s own phone.',
    'Contact ' + (p.dealer || 'the dealer') + ' directly: BinaSmart is not the seller. Check the libre and the car before you pay.'].join(' ');
  const am = ['በአዲስ አበባ የሚሸጥ ' + p.title + (p.year ? ' (' + p.year + ')' : '') + '።', p.price ? 'ዋጋ፦ ' + p.price + '።' : '', 'ሻጭ፦ ' + (p.dealer || 'አከፋፋዩ') + '።',
    'ሻጩን በቀጥታ ያነጋግሩ — ቢናስማርት ሻጭ አይደለም። ከመክፈልዎ በፊት ሊብሬውንና መኪናውን ያረጋግጡ።'].filter(Boolean).join(' ');
  return { en, am };
}
function carLd(p, d, url, photos, sum) {
  const pv = priceValue(p.price), km = Number(String(p.mileage || '').replace(/[^\d]/g, '')) || null;
  return { '@context': 'https://schema.org', '@type': 'Car', name: p.title, url, description: sum.en, image: photos.slice(0, 6).map(u => u.split('?')[0]),
    brand: p.make ? { '@type': 'Brand', name: p.make } : undefined, model: p.model || undefined, vehicleModelDate: p.year || undefined,
    mileageFromOdometer: km != null ? { '@type': 'QuantitativeValue', value: km, unitCode: 'KMT' } : undefined, fuelType: p.fuel || undefined,
    vehicleTransmission: p.transmission || undefined, bodyType: p.bodyType || undefined,
    itemCondition: p.condition === 'New' ? 'https://schema.org/NewCondition' : p.condition === 'Used' ? 'https://schema.org/UsedCondition' : undefined,
    offers: pv ? { '@type': 'Offer', price: pv.n, priceCurrency: pv.cur, availability: /china/i.test(p.city || '') ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock',
      availableAtOrFrom: /china/i.test(p.city || '') ? { '@type': 'Place', name: 'China' } : undefined, seller: { '@type': 'AutoDealer', name: p.dealer || undefined } } : undefined };
}
const CARS = { section: 'cars', summary: carSummary, ld: carLd, base: '/cars', badge: '🚗 መኪና · Cars', allLabel: '← All cars', similar: 'Similar cars · ተመሳሳይ መኪኖች',
  ask: '✨ Ask Bini about this car', gone: 'This car is no longer on the dealer\'s website - it may be sold. Similar cars are below. · ይህ መኪና ከአከፋፋዩ ድረ-ገጽ ተነስቷል።',
  notice: p => /china/i.test(p.city || '') ? '<div class="gone" style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412">🇨🇳 <b>This car is in China.</b> The price is the China price in US dollars, <b>before shipping, customs duty and taxes</b>. ' + String(p.dealer || 'The importer').replace(/[<>&]/g, '') + ' ships it to Addis Ababa through Djibouti. Ask for the full price in birr before you pay. Ethiopia allows only electric cars to be imported.<br>ይህ መኪና ቻይና ውስጥ ነው። ዋጋው የቻይና ዋጋ ነው፣ ትራንስፖርት፣ ቀረጥና ግብር አልተጨመረበትም።</div>' : '',
  typeLine: p => [p.condition, p.bodyType, p.fuel].filter(Boolean).join(' · ') || 'Car',
  facts: (p) => [
    p.year && [ic('year'), p.year, 'Year'], p.mileage && [ic('gauge'), p.mileage, 'Mileage'], p.fuel && [ic('fuel'), p.fuel, 'Fuel'],
    p.transmission && [ic('gear'), p.transmission, 'Gearbox'], p.condition && [ic('shield'), p.condition, 'Condition'],
    p.make && [ic('car'), p.make + (p.model ? ' ' + p.model : ''), 'Make & model'],
  ] };
// A car row in the shape the shared page expects (it was written for PropertyListing).
const asListing = c => Object.assign({}, c, { listingType: 'sale', propertyType: c.make, location: c.city, agency: c.dealer,
  agencyPhone: c.dealerPhone, agencyWhatsapp: c.dealerWhatsapp, agencyTelegram: c.dealerTelegram });

module.exports = function carDetail(fastify, { prisma }, done) {
  fastify.get('/api/listing-text/cars/:slug', async (req, reply) => {
    const c = await prisma.carListing.findUnique({ where: { slug: String(req.params.slug || '').slice(0, 100) }, select: { details: true } }).catch(() => null);
    reply.header('X-Robots-Tag', 'noindex');
    return { text: (c && c.details && c.details.description) || '' };
  });
  fastify.get('/cars/:slug', async (req, reply) => {
    const slug = String(req.params.slug || '').slice(0, 100);
    const c = await prisma.carListing.findUnique({ where: { slug } }).catch(() => null);
    if (!c) return reply.code(404).type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">This car was not found. <a href="/cars">See all cars for sale</a></p>');
    const all = (await prisma.carListing.findMany({ where: { active: true }, take: 500,
      select: { slug: true, title: true, price: true, city: true, dealer: true, imageUrl: true, make: true } }))
      .map(x => ({ slug: x.slug, title: x.title, price: x.price, location: x.city, agency: x.dealer, imageUrl: x.imageUrl, listingType: 'sale', propertyType: x.make }));
    return reply.type('text/html; charset=utf-8').send(page(asListing(c), all, CARS));
  });
  done();
};
