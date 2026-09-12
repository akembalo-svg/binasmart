'use strict';
// Which shops can take a flight request.
//
// This test used to live inline inside /api/flights-options, which listed partners and published
// nothing sensitive. The agency page — /api/flights/:slug, which publishes a phone, a unit number and
// a floor — never had it, and matched on `contains` against every live shop. A single letter was
// enough: /api/flights/a returned a pharmacy's phone and floor, /api/flights/e a bank's. JJ Darule's
// 71 tenants are real businesses and named individuals.
//
// So it lives here now, where both routes read it and a test can hold it still.
//
// Two ways to qualify:
//   FLIGHT_PARTNERS  a comma-separated list of slugs. Explicit, and the only one that records that a
//                    person decided. Currently unset.
//   the trade        the shop's name says travel. "air" on its own matched a spa and "ticket" a park
//                    ticket office, so the test names the trade rather than the product.
//
// ⚠️ The second is opt-out-by-nobody: a tenant who moves in tomorrow calling themselves "X Travel" is
// enrolled as a bookable partner, and their phone is published, without anyone deciding. Today it
// matches exactly one shop — Hanud Travel Agency, which has a printed QR poster — so the mechanism
// has not yet cost anything. Naming partners in FLIGHT_PARTNERS and dropping the trade fallback is
// the safer shape, and it is a decision about a live commercial page rather than a bug fix.
const FLIGHT_TRADE = /travel|tour|ጉዞ/i;

// The slugs named explicitly in the environment.
function partnerSlugs(env) {
  return String((env || process.env).FLIGHT_PARTNERS || '').split(',').map(x => x.trim()).filter(Boolean);
}

// `named` may be passed in when the caller already computed it, so a list of shops is not re-reading
// the environment once per row.
function isFlightPartner(shop, named, env) {
  if (!shop) return false;
  const slugs = named || partnerSlugs(env);
  if (slugs.includes(shop.slug || '')) return true;
  return FLIGHT_TRADE.test((shop.name || '') + ' ' + (shop.nameAm || ''));
}

module.exports = { FLIGHT_TRADE, partnerSlugs, isFlightPartner };
