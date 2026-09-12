'use strict';
// Which shops can take a flight request. Only the ones somebody named.
//
// This test used to live inline inside /api/flights-options, which listed partners and published
// nothing sensitive. The agency page — /api/flights/:slug, which publishes a phone, a unit number and
// a floor — never had it, and matched on `contains` against every live shop. A single letter was
// enough: /api/flights/a returned a pharmacy's phone and floor, /api/flights/e a bank's. JJ Darule's
// 71 tenants are real businesses and named individuals.
//
// 2026-09-12: there used to be a second way to qualify — the shop's name containing travel, tour or
// ጉዞ. It was opt-out-by-nobody. A tenant moving in tomorrow as "X Travel" would have become a
// bookable partner with their phone published, and no person would have decided it. Ibrahim named
// Hanud in FLIGHT_PARTNERS and asked for the fallback dropped, so consent is now recorded in
// configuration rather than inferred from a company name.
//
// Fail-closed by design: an empty or missing FLIGHT_PARTNERS means no partners at all, so a config
// mistake takes the flights pages offline rather than quietly publishing somebody. server.js says so
// at startup.
function partnerSlugs(env) {
  return String((env || process.env).FLIGHT_PARTNERS || '').split(',').map(x => x.trim()).filter(Boolean);
}

// `named` may be passed in when the caller already computed it, so a list of shops is not re-reading
// the environment once per row.
function isFlightPartner(shop, named, env) {
  if (!shop || !shop.slug) return false;
  return (named || partnerSlugs(env)).includes(shop.slug);
}

module.exports = { partnerSlugs, isFlightPartner };
