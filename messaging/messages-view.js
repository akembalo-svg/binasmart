'use strict';
// What the owner's Messages tab reads (owner actions and messaging design §4). Read only: nothing here writes, sends,
// or calls a provider. Task 2 adds the store and the view on top of these; this half has no database and no clock.
//
// ONE ROW, ONE BUCKET. delivery.js tallies a not-reachable recipient in BOTH counts.none and counts.failed, which is
// right for its own "did everything go?" question and wrong for a list the owner reads: the same tenant would be
// counted twice. Here every OutboundMessage row is put in exactly one bucket, so a batch's numbers add up to its total.
//
//   delivered     the SMS operator's delivery report said so           (status delivered)
//   reached       Telegram accepted it, or the SMS provider did        (status sent)
//   queued        the provider took it but the record write after it failed — it may have gone, so it is never
//                 offered for sending again                            (status queued)
//   failed        it did not go                                        (status failed, on a telegram or sms row)
//   notReachable  no Telegram link and no mobile the provider can reach (channel none)
//   test          recorded only; nothing left the server               (status test)
//
// No phone number, no user id, no provider id and no tenancy id passes through this module. The only tenant-identifying
// thing it yields is a unit number, which the Tenants tab already shows.

const KINDS = ['notice', 'reminder', 'invoice', 'receipt'];   // OutboundBatch.kind for a tenant message; otp is not a building's
const PAGE = 20;            // batches per page (design §4: newest first, 20 per page)
const ROWS_PAGE = 100;      // recipients per page inside one batch
const MAX_MONTHS = 24;      // how far the month filter goes back
// What uses up a building's monthly SMS limit. Fixed at these three in every mode — messaging/delivery.js COUNTED.
const COUNTED = ['queued', 'sent', 'delivered'];
// Batch actors that are not an OwnerAccess id (server.js, building/invoice-ops.js, the daily checks, the ops scripts).
const FIXED_ACTORS = ['dashboard', 'cron', 'ops'];
const ADDIS_MS = 3 * 3600000;   // UTC+3, no daylight saving

function presentOf(channel, status) {
  if (channel === 'none') return 'notReachable';
  if (status === 'delivered') return 'delivered';
  if (status === 'sent') return 'reached';
  if (status === 'queued') return 'queued';
  if (status === 'test') return 'test';
  return 'failed';
}

const zeroCounts = () => ({ delivered: 0, reached: 0, queued: 0, failed: 0, notReachable: 0, test: 0,
  telegram: 0, sms: 0, none: 0, total: 0 });

// rows: [{ channel, status, count }] — a groupBy result, already flattened.
function countsOf(rows) {
  const c = zeroCounts();
  for (const r of rows || []) {
    const n = Number(r && r.count) || 0;
    c[presentOf(r.channel, r.status)] += n;
    if (r.channel === 'telegram' || r.channel === 'sms' || r.channel === 'none') c[r.channel] += n;
    c.total += n;
  }
  return c;
}

// An OutboundBatch.actor or an OwnerAction.confirmedBy as a word the owner can read. An OwnerAccess id that does not
// resolve — revoked, another building's, or simply unknown — becomes 'unknown'. The id itself is never returned.
function whoLabel(actor, roleById) {
  const a = String(actor == null ? '' : actor);
  if (!a) return 'unknown';
  if (FIXED_ACTORS.includes(a)) return a;
  const role = (roleById || {})[a];
  return role === 'owner' || role === 'staff' ? role : 'unknown';
}

// 'YYYY-MM' → the half-open range of that calendar month in Addis Ababa, or null. Nothing is guessed: a malformed
// month means no filter at all, not "this month".
function addisMonthRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym == null ? '' : ym));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { from: new Date(Date.UTC(y, mo - 1, 1) - ADDIS_MS), to: new Date(Date.UTC(y, mo, 1) - ADDIS_MS) };
}
const addisMonthOf = d => new Date(new Date(d).getTime() + ADDIS_MS).toISOString().slice(0, 7);

// The months the filter offers: this Addis month back to the oldest batch, newest first, capped.
function monthList(oldest, now, max = MAX_MONTHS) {
  const first = oldest ? addisMonthOf(oldest) : addisMonthOf(now);
  const out = [];
  let cur = addisMonthOf(now);
  while (out.length < max) {
    out.push(cur);
    if (cur <= first) break;
    const [y, m] = cur.split('-').map(Number);
    cur = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  }
  return out;
}

// A page number that always exists: never negative, never past the last page, never NaN.
function pageOf(n, total, size) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / size));
  return Math.min(Math.max(0, Math.floor(Number(n) || 0)), pages - 1);
}

module.exports = { presentOf, countsOf, whoLabel, addisMonthRange, addisMonthOf, monthList, pageOf, zeroCounts,
  KINDS, PAGE, ROWS_PAGE, MAX_MONTHS, COUNTED, FIXED_ACTORS };
