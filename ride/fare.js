'use strict';
// Fixed upfront fare: base + perKm*km + perMin*min, rounded to the nearest 5 ETB,
// floored at the tier minimum. Quoted once and locked at request time (no surge).
const TIERS = ['moto', 'bajaj', 'economy', 'comfort', 'xl'];

function roundTo5(n) { return Math.round(n / 5) * 5; }

function quoteFare(settings, tier, distanceM, durationS) {
  const t = settings && settings.tiers && Object.prototype.hasOwnProperty.call(settings.tiers, tier) && settings.tiers[tier];
  if (!t) throw new Error('unknown_tier');
  const km = Math.max(0, Number(distanceM) || 0) / 1000;
  const mins = Math.max(0, Number(durationS) || 0) / 60;
  const raw = t.base + t.perKm * km + t.perMin * mins;
  const fareEtb = Math.max(t.min, roundTo5(raw));
  const commissionPct = Number(settings.commissionPct) || 0;
  const driverTakeEtb = Math.round(fareEtb * (1 - commissionPct / 100));
  return { tier, fareEtb, driverTakeEtb, km: Number(km.toFixed(2)), etaMin: Math.round(mins) };
}

function quoteAll(settings, distanceM, durationS) {
  return TIERS.map(t => quoteFare(settings, t, distanceM, durationS));
}

module.exports = { TIERS, roundTo5, quoteFare, quoteAll };
