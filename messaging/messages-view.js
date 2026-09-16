'use strict';
// What the owner's Messages tab reads (owner actions and messaging design §4). Read only: nothing here writes, sends,
// or calls a provider.
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
//
//   makeMessagesStore(prisma)                                 every query the tab makes, and nothing else
//   makeMessagesView({ store, now }).list({ buildingId, page, kind, month })   batches, newest first
//                                   .one({ buildingId, batchId, page })        one batch, by unit
//                                   .smsMonth({ buildingId, limit, real, mode, tiers })
const { addisMonthStart, COUNTED } = require('./delivery');
const { smsUnitPrice } = require('./sms');

const KINDS = ['notice', 'reminder', 'invoice', 'receipt'];   // OutboundBatch.kind for a tenant message; otp is not a building's
const PAGE = 20;            // batches per page (design §4: newest first, 20 per page)
const ROWS_PAGE = 100;      // recipients per page inside one batch
const MAX_MONTHS = 24;      // how far the month filter goes back
// What uses up a building's monthly SMS limit is delivery.js's own list (queued, sent, delivered in every mode, never
// a test row), imported above rather than copied, so the tab can never count a month differently from the sender.
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

// Every database call the tab makes. Each one names its columns: there is no `include`, so a column added to
// OutboundMessage or Tenancy later cannot appear in an owner's browser by accident.
function makeMessagesStore(prisma) {
  return {
    countBatches: where => prisma.outboundBatch.count({ where }),
    batches: (where, skip, take) => prisma.outboundBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take,
      select: { id: true, createdAt: true, kind: true, source: true, actor: true, total: true } }),
    counts: batchIds => prisma.outboundMessage.groupBy({ by: ['batchId', 'channel', 'status'],
      where: { batchId: { in: batchIds } }, _count: true }),
    // findFirst with the building in the where: a batch id from another building is simply not found.
    batch: (buildingId, id) => prisma.outboundBatch.findFirst({ where: { id, buildingId },
      select: { id: true, createdAt: true, kind: true, source: true, actor: true, total: true, text: true } }),
    countRows: batchId => prisma.outboundMessage.count({ where: { batchId } }),
    rows: (batchId, skip, take) => prisma.outboundMessage.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' },
      skip, take, select: { tenancyId: true, channel: true, status: true, errorKind: true, createdAt: true } }),
    units: (tenancyIds, buildingId) => prisma.tenancy.findMany({ where: { id: { in: tenancyIds }, unit: { buildingId } },
      select: { id: true, unit: { select: { number: true } } } }),
    roles: (ids, buildingId) => prisma.ownerAccess.findMany({ where: { id: { in: ids }, kind: 'building', entityId: buildingId },
      select: { id: true, role: true } }),
    oldestBatchAt: async buildingId => {
      const r = await prisma.outboundBatch.findFirst({ where: { buildingId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      return r ? r.createdAt : null;
    },
    smsParts: async where => (await prisma.outboundMessage.aggregate({ where, _sum: { smsParts: true } }))._sum.smsParts || 0,
  };
}

function makeMessagesView({ store, now = () => new Date() }) {
  const idsToAsk = actors => [...new Set(actors.filter(a => a && !FIXED_ACTORS.includes(a)))];
  const byId = rows => Object.fromEntries((rows || []).map(r => [r.id, r.role]));

  async function list({ buildingId, page = 0, kind = '', month = '' } = {}) {
    const where = { buildingId };
    if (KINDS.includes(kind)) where.kind = kind;
    const range = addisMonthRange(month);
    if (range) where.createdAt = { gte: range.from, lt: range.to };

    const total = await store.countBatches(where);
    const p = pageOf(page, total, PAGE);
    const rows = total ? await store.batches(where, p * PAGE, PAGE) : [];
    const ask = idsToAsk(rows.map(b => b.actor));
    const [grouped, roleRows, oldest] = await Promise.all([
      rows.length ? store.counts(rows.map(b => b.id)) : [],
      ask.length ? store.roles(ask, buildingId) : [],
      store.oldestBatchAt(buildingId),
    ]);
    const roleById = byId(roleRows);
    const per = new Map(rows.map(b => [b.id, []]));
    for (const g of grouped || []) if (per.has(g.batchId)) per.get(g.batchId).push({ channel: g.channel, status: g.status, count: g._count });

    return { page: p, pages: Math.max(1, Math.ceil(total / PAGE)), total, kinds: KINDS, months: monthList(oldest, now()),
      kind: KINDS.includes(kind) ? kind : '', month: range ? String(month) : '',
      batches: rows.map(b => ({ id: b.id, at: b.createdAt.toISOString(), kind: b.kind, source: b.source,
        by: whoLabel(b.actor, roleById), total: b.total, counts: countsOf(per.get(b.id) || []) })) };
  }

  async function one({ buildingId, batchId, page = 0 } = {}) {
    const id = String(batchId == null ? '' : batchId);
    if (!id) return null;
    const b = await store.batch(buildingId, id);
    if (!b) return null;
    const total = await store.countRows(b.id);
    const p = pageOf(page, total, ROWS_PAGE);
    const rows = total ? await store.rows(b.id, p * ROWS_PAGE, ROWS_PAGE) : [];
    const tenancyIds = [...new Set(rows.map(r => r.tenancyId).filter(Boolean))];
    const ask = idsToAsk([b.actor]);
    const [unitRows, grouped, roleRows] = await Promise.all([
      tenancyIds.length ? store.units(tenancyIds, buildingId) : [],
      store.counts([b.id]),
      ask.length ? store.roles(ask, buildingId) : [],
    ]);
    const unitOf = Object.fromEntries((unitRows || []).map(u => [u.id, u.unit.number]));
    return { id: b.id, at: b.createdAt.toISOString(), kind: b.kind, source: b.source, by: whoLabel(b.actor, byId(roleRows)),
      // A notice's text is the owner's own words and is kept once on the batch; an invoice or receipt has none.
      text: b.kind === 'notice' ? String(b.text || '') : '',
      total: b.total, counts: countsOf((grouped || []).map(g => ({ channel: g.channel, status: g.status, count: g._count }))),
      page: p, pages: Math.max(1, Math.ceil(total / ROWS_PAGE)),
      rows: rows.map(r => ({ unit: unitOf[r.tenancyId] || '—', channel: r.channel, status: r.status,
        present: presentOf(r.channel, r.status), reason: r.errorKind || null, at: r.createdAt.toISOString() })) };
  }

  // The SMS month as the limit itself counts it: queued, sent and delivered, never test. Test parts are returned
  // separately and labelled on the page, because counting them would tell an owner the month is full when the
  // server sent nothing at all. The tier is an estimate: GeezSMS prices by the whole account's monthly count.
  async function smsMonth({ buildingId, limit, real, mode, tiers } = {}) {
    const from = addisMonthStart(now());
    const [parts, testParts, accountParts] = await Promise.all([
      store.smsParts({ buildingId, channel: 'sms', status: { in: COUNTED }, createdAt: { gte: from } }),
      store.smsParts({ buildingId, channel: 'sms', status: 'test', createdAt: { gte: from } }),
      store.smsParts({ channel: 'sms', status: { in: COUNTED }, createdAt: { gte: from } }),
    ]);
    const lim = Math.max(0, Math.floor(Number(limit) || 0));
    const unitPriceEtb = smsUnitPrice(accountParts, tiers);
    return { mode: real === true ? (mode === 'live' ? 'live' : 'test') : 'test', parts, testParts, limit: lim,
      remaining: Math.max(0, lim - parts), unitPriceEtb, costEtb: Math.round(parts * unitPriceEtb * 100) / 100 };
  }

  return { list, one, smsMonth };
}

module.exports = { makeMessagesStore, makeMessagesView, presentOf, countsOf, whoLabel, addisMonthRange, addisMonthOf,
  monthList, pageOf, zeroCounts, KINDS, PAGE, ROWS_PAGE, MAX_MONTHS, COUNTED, FIXED_ACTORS };
