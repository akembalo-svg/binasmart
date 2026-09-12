'use strict';
// 09XXXXXXXX | 251XXXXXXXXX | +251XXXXXXXXX → +251XXXXXXXXX, else null. Shared by routes and the driver bot.
function normPhone(s) { s = String(s || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1); if (/^251\d{9}$/.test(s)) s = '+' + s; return /^\+251\d{9}$/.test(s) ? s : null; }

// A rate-limit key, not a validator. Digits only, last nine, so 0911244344, +251911244344 and
// 251 911 244 344 are one caller rather than three. Deliberately NOT normPhone: that returns null for
// anything not Ethiopian, and a foreign number must still be limited rather than refused — a booking
// from a UAE number is a customer. null when the input is too short to identify anyone, so junk does
// not all land in one shared bucket.
function phoneKey(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 7 ? 'ph:' + d.slice(-9) : null;
}
module.exports = { normPhone, phoneKey };
