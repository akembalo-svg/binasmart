'use strict';
// A tender deadline is a DATE, not an instant.
//
// All 206 dated tenders are stored at exactly 00:00:00 UTC, because what the source says is "bids
// close 20 September" — not "bids close at midnight UTC". Addis Ababa is UTC+3, so 00:00Z on the
// 20th is three o'clock on the MORNING of the 20th in Ethiopia. Every comparison of the form
// `deadline < now` therefore called a tender closed for the whole of its own working day:
//
//   03:00 EAT   the site says "this tender has closed", drops it out of /tenders, and withdraws it
//               from the sitemap
//   09:00 EAT   the procurement office opens and accepts bids
//   17:00 EAT   bids actually close
//
// 21 hours, on the one day the page matters most. The server and the browser did not even agree with
// each other: the countdown script computed Math.ceil((deadline - now) / day), which still showed
// "0 ቀናት ቀርተዋል · 0 days left" on a page whose banner said the tender was closed.
//
// So a date-only deadline closes at the END of that day in Addis — 21:00 UTC, which is midnight EAT.
//
// A deadline that carries a real time of day is left exactly as it is. If a source ever says "14:00
// on the 20th", that is an instant and it means it; only a bare date needs interpreting.
const DAY = 86400000;
const ADDIS_OFFSET_MS = 3 * 3600000;   // UTC+3, no daylight saving in Ethiopia

// Midnight UTC is what a bare date becomes, and the epoch is itself midnight UTC, so a date-only
// value is exactly one that divides into whole days.
const isDateOnly = d => d instanceof Date && !isNaN(d.getTime()) && d.getTime() % DAY === 0;

const asDate = v => { if (v == null) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d; };

// The moment bidding actually stops.
function closesAt(deadline) {
  const d = asDate(deadline);
  if (!d) return null;
  return isDateOnly(d) ? new Date(d.getTime() + DAY - ADDIS_OFFSET_MS) : d;
}

// A tender with no deadline is never closed: the document carries the date and the page says so.
function isClosed(deadline, now = Date.now()) {
  const c = closesAt(deadline);
  if (!c) return false;
  return c.getTime() <= (now instanceof Date ? now.getTime() : now);
}

// The widest a date-only deadline can be pushed past the naive comparison. Database filters use this
// to fetch generously and then let isClosed() decide exactly, so no query has to model a timezone.
const OPEN_GRACE_MS = DAY - ADDIS_OFFSET_MS;   // 21 hours
const openSince = (now = Date.now()) => new Date((now instanceof Date ? now.getTime() : now) - OPEN_GRACE_MS);

// ---- An advert that never stated a closing date ----
//
// isClosed() says a listing with no deadline is never closed, and for a TENDER that is right: the bid
// document carries the date and the page says so. For a VACANCY it is not. Nothing ever expires it, so
// it sits on the board for ever. On 2026-09-26 that was 427 EthioJobsHub vacancies whose page states no
// date anywhere - the other 892 had one printed on them and we simply could not read it until the
// parser was widened that day; those are now filled in from the employer's own page.
//
// So an undated vacancy is treated as closed 90 days after it was published. Ibrahim chose 90 on
// 2026-09-26, the long end of the two options put to him, and long is the right way to lean: hiding a
// vacancy that is still open costs somebody a job, showing a dead one costs them an evening.
//
// This is a DISPLAY rule and it stays one. We do not write a made-up deadline into the row - the
// employer never gave one, and a guessed date on a job page is exactly the thing the rest of this
// codebase refuses to do. The stored value stays null and the page can still be reached directly.
//
// The sitemap has used a stricter 45 days for undated rows since before this; that is deliberate and
// left alone. A sitemap is a request to INDEX, which is a stronger claim than showing a listing.
const UNDATED_JOB_DAYS = 90;
const undatedJobsSince = (now = Date.now()) =>
  new Date((now instanceof Date ? now.getTime() : now) - UNDATED_JOB_DAYS * DAY);

// The `where` fragment every job listing should use: dated and still open, OR undated and still young.
const openJobsWhere = (now = Date.now()) => ({
  OR: [
    { deadline: null, publishedAt: { gte: undatedJobsSince(now) } },
    { deadline: { gte: openSince(now) } },
  ],
});

module.exports = { closesAt, isClosed, openSince, isDateOnly, OPEN_GRACE_MS, ADDIS_OFFSET_MS,
  UNDATED_JOB_DAYS, undatedJobsSince, openJobsWhere };
