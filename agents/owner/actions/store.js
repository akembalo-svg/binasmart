'use strict';
// The pending owner actions (OwnerAction) and the two per-building switches, over Prisma.
//
// Status moves only forward, and every move is conditional on the status it leaves (updateMany … where status), so
// two presses, a press and the expiry sweep, or two servers can never both run one action:
//   pending → running → done | failed | refused | replaced        pending → cancelled | expired
//
// Switches are AgentSwitch rows (the table that switches Bini for owners on), no new columns:
//   agent 'owner-actions'        Bini may prepare and run actions for this building (the rollback switch; off by default)
//   agent 'owner-actions-staff'  staff approvals may confirm as well as prepare (off by default)
const ACTIONS_AGENT = 'owner-actions';
const STAFF_AGENT = 'owner-actions-staff';
// A bulk send that was confirmed counts toward the day's limit whether it finished, failed part-way, or is still running.
const BULK_COUNTED = ['running', 'done', 'failed'];

function makeOwnerActionStore(prisma) {
  return {
    create: data => prisma.ownerAction.create({ data, select: { id: true } }),
    get: id => prisma.ownerAction.findUnique({ where: { id: String(id) } }),
    transition: async (id, from, to, data = {}) =>
      (await prisma.ownerAction.updateMany({ where: { id: String(id), status: from }, data: { ...data, status: to } })).count,
    // pending and not expired → running, in one statement: the single-use guarantee.
    claim: async (id, at, data = {}) =>
      (await prisma.ownerAction.updateMany({ where: { id: String(id), status: 'pending', expiresAt: { gt: at } }, data: { ...data, status: 'running', confirmedAt: at } })).count,
    finish: async (id, status, result) =>
      (await prisma.ownerAction.updateMany({ where: { id: String(id), status: 'running' }, data: { status, result: result == null ? undefined : result } })).count,
    setCards: (id, cards) => prisma.ownerAction.update({ where: { id: String(id) }, data: { cards }, select: { id: true } }),
    countBulkSince: (buildingId, since, excludeId) => prisma.ownerAction.count({ where: { buildingId, bulk: true, status: { in: BULK_COUNTED },
      confirmedAt: { gte: since }, ...(excludeId ? { id: { not: String(excludeId) } } : {}) } }),
    expiredPending: (at, take = 100) => prisma.ownerAction.findMany({ where: { status: 'pending', expiresAt: { lte: at } }, take,
      select: { id: true, buildingId: true, kind: true, channel: true, preparedBy: true } }),
  };
}

function makeActionSwitches(prisma) {
  const enabled = async (agent, ids) => (await prisma.agentSwitch.findMany({ where: { agent, kind: 'building', entityId: { in: ids }, disabledAt: null },
    select: { entityId: true } })).map(r => r.entityId);
  return async function switches(buildingIds) {
    const ids = [...new Set((buildingIds || []).map(String))];
    if (!ids.length) return { on: [], staff: [] };
    const [on, staff] = await Promise.all([enabled(ACTIONS_AGENT, ids), enabled(STAFF_AGENT, ids)]);
    return { on, staff: staff.filter(id => on.includes(id)) };
  };
}

module.exports = { makeOwnerActionStore, makeActionSwitches, ACTIONS_AGENT, STAFF_AGENT, BULK_COUNTED };
