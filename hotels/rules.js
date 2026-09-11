'use strict';
// Two rules the hotel routes depend on, kept where they can be tested.
//
// Both are the quiet kind. A timezone rule is wrong for three hours a night and right the rest of
// the time, so it survives every casual check. A disclosure rule is invisible until the day it stops
// firing — and the first person to notice is a guest standing in a lobby that does not exist.

// Is this building a demonstration rather than a hotel someone can actually stay in?
//
// The listing at /hotels puts a DEMO badge on it and the hotel page says so in words; both read this
// so they cannot drift apart. It is a guess over two free-text fields, which is the weakness: the day
// a demo building is given a real sub-city, this returns false and every warning disappears at once.
// A `demo` column on Building would be the honest fix — until then, this is the single place to change.
function isDemo(building) {
  const b = building || {};
  return /demo|sample/i.test((b.subCity || '') + ' ' + (b.name || ''));
}

// What day is it where the hotel is?
//
// Not where the server is. `new Date().toISOString()` is UTC and Ethiopia is UTC+3, so from midnight
// to 3am in Addis Ababa the UTC date is still yesterday — and a check-in date the guest has already
// lived through passes the past-date guard. Measured on the live server at 01:56 Addis on 12 Sep
// 2026: the guard called it the 11th and the booking page pre-filled the 11th.
//
// 'en-CA' is the locale that formats as YYYY-MM-DD, which is what the rest of the code compares.
function addisDay(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' });
}

module.exports = { isDemo, addisDay };
