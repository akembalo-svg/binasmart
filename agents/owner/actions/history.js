'use strict';
// The owner's own record of what they confirmed (owner actions design §3.3: every prepare, confirm, cancel, expiry and
// execution is "shown in the dashboard activity log").
//
// A preview card lives ten minutes and the chat scrolls away; this is where the owner finds out, afterwards, what an
// action actually did — how many were reached, which units were not, what a refusal was about.
//
// WHAT IT NEVER CARRIES, and why:
//   id           22 random characters that are the whole content of a Telegram confirm button — a secret, not a label
//   args         what the owner asked for, unvalidated, as the model handed it over
//   payload      resolved recipients: tenancy ids and invoice ids
//   fingerprint  the hash the confirm is checked against
//   text         the notice itself — it is kept once on the batch, and the Messages drill-down shows it there
//   cardText     the preview the owner read; it may hold an occupant's name, and no name leaves this table
//   preparedBy   an OwnerAccess id; the role beside it (preparedRole) is what a person needs
//   preparedTg   a Telegram account id
// confirmedBy IS read, because there is no confirmedRole column — and it is turned into a role before it leaves,
// against the approvals of THIS building only.
const { whoLabel } = require('../../../messaging/messages-view');

const PAGE = 20;
// Exactly the columns the dashboard shows. There is no `include` anywhere: a column added to OwnerAction later cannot
// reach an owner's browser by accident.
const SELECT = { createdAt: true, kind: true, status: true, channel: true, preparedRole: true,
  confirmedBy: true, confirmedAt: true, bulk: true, urgent: true, result: true };

const num = v => (Number.isFinite(v) ? v : null);

function shapeAction(a, roleById) {
  const r = a && a.result && typeof a.result === 'object' && !Array.isArray(a.result) ? a.result : {};
  const c = r.counts && typeof r.counts === 'object' ? r.counts : null;
  const none = Number(c && c.none) || 0;
  return {
    at: new Date(a.createdAt).toISOString(),
    kind: a.kind,
    status: a.status,
    channel: a.channel,
    preparedBy: a.preparedRole || 'unknown',
    confirmedBy: a.confirmedBy ? whoLabel(a.confirmedBy, roleById) : null,
    confirmedAt: a.confirmedAt ? new Date(a.confirmedAt).toISOString() : null,
    bulk: a.bulk === true,
    urgent: a.urgent === true,
    // messaging/delivery.js counts a not-reachable recipient in BOTH none and failed, so the two are separated here;
    // otherwise the owner would see the same tenant twice and the numbers would not add up to the recipients.
    counts: c ? { sent: Number(c.sent) || 0, test: Number(c.test) || 0,
      failed: Math.max(0, (Number(c.failed) || 0) - none), notReachable: none } : null,
    notReached: Array.isArray(r.notReached) ? r.notReached.map(String) : null,
    created: num(r.created),
    skipped: num(r.skipped),
    month: typeof r.month === 'string' ? r.month : null,
    unit: typeof r.unit === 'string' ? r.unit : null,
    totalEtb: num(r.totalEtb),
    reason: typeof r.error === 'string' ? r.error : null,
    batchIds: Array.isArray(r.batchIds) ? r.batchIds.map(String).slice(0, 5) : [],
  };
}

function makeActionHistory({ prisma, page = PAGE }) {
  async function list({ buildingId, page: n = 0 } = {}) {
    const where = { buildingId };
    const total = await prisma.ownerAction.count({ where });
    const pages = Math.max(1, Math.ceil(total / page));
    const p = Math.min(Math.max(0, Math.floor(Number(n) || 0)), pages - 1);
    const rows = total ? await prisma.ownerAction.findMany({ where, orderBy: { createdAt: 'desc' },
      skip: p * page, take: page, select: SELECT }) : [];
    const ids = [...new Set(rows.map(a => a.confirmedBy).filter(x => x && x !== 'dashboard'))];
    const roleRows = ids.length ? await prisma.ownerAccess.findMany({
      where: { id: { in: ids }, kind: 'building', entityId: buildingId }, select: { id: true, role: true } }) : [];
    const roleById = Object.fromEntries(roleRows.map(x => [x.id, x.role]));
    return { page: p, pages, total, actions: rows.map(a => shapeAction(a, roleById)) };
  }
  return { list };
}

module.exports = { makeActionHistory, shapeAction, SELECT, PAGE };
