'use strict';
// The pool fare ladder. One rule makes riders and drivers both want a full car:
//   driver total(n) = car fare + bonus x (n - 1)      bonus = 10% of the car fare, rounded to 5 ETB
//   seat price(n)   = driver total(n) / n, rounded UP to 5 ETB
// Car fare 380 -> 1 rider 380 / 2 riders 210 each (driver 420) / 3: 155 (460) / 4: 125 (500).
// Every extra seat lowers each rider's price and raises the driver's take. Computed here and nowhere else.
const { roundTo5 } = require('../fare');

function up5(n) { return Math.ceil(n / 5) * 5; }

function ladder(carFareEtb, seats, commissionPct) {
  const F = Math.max(0, Math.round(Number(carFareEtb) || 0));
  const cap = Math.max(1, Math.min(20, Math.round(Number(seats) || 1)));
  const c = Number(commissionPct) || 0;
  const bonus = roundTo5(F * 0.1);
  const rows = [];
  for (let n = 1; n <= cap; n++) {
    const driverTotal = F + bonus * (n - 1);
    const seat = up5(driverTotal / n);
    rows.push({ n, seatEtb: seat, driverTotalEtb: driverTotal, driverTakeEtb: Math.round(driverTotal * (1 - c / 100)), riderTotalEtb: seat * n });
  }
  return { carFareEtb: F, bonusEtb: bonus, seats: cap, rows };
}

function rowFor(l, n) { return l.rows[Math.max(1, Math.min(l.seats, n)) - 1]; }

module.exports = { ladder, rowFor, up5 };
