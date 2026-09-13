'use strict';
// Approve who may use Bini for owners on a building, and switch it on or off. Run on the server only.
//
//   node ops/owner/access.js list    <slug>
//   node ops/owner/access.js add     <slug> <phone> <owner|staff> [label]
//   node ops/owner/access.js add-account-owner <slug>
//   node ops/owner/access.js revoke  <slug> <accessId>
//   node ops/owner/access.js enable  <slug>
//   node ops/owner/access.js disable <slug>
//
// Approvals are typed here by BinaSmart staff, never by the owner: the number is stored in full as E.164
// (toE164 from 'ops': 09… becomes +2519…, 00… becomes +…) and that is what a Telegram Share-my-phone must match.
// Remove in the owner dashboard only signs one Telegram account out; the number stays approved. `revoke` here is
// what ends a person's access: the approval is withdrawn, and when the number holds no other approval its
// Telegram accounts are signed out too (agents/owner/access.js revokeAccess, the one place that rule lives).
// `add-account-owner` approves the building owner account's own number as an owner, read from the account so
// nobody types it. Nothing is switched on for a building until `enable`. Every change goes to the building's audit log (actor ops).
// Nothing prints more than the last four digits of a number, and Telegram ids are never printed.
const { phoneKey } = require('../../ride/phone');
const { toE164, makeOwnerAccess, makeOwnerAccessStore } = require('../../agents/owner/access');

const USAGE = 'usage: node ops/owner/access.js list|enable|disable <slug>\n'
  + '       node ops/owner/access.js add <slug> <phone> <owner|staff> [label]\n'
  + '       node ops/owner/access.js add-account-owner <slug>\n'
  + '       node ops/owner/access.js revoke <slug> <accessId>';
const COMMANDS = ['list', 'add', 'add-account-owner', 'revoke', 'enable', 'disable'];
const last4 = s => String(s || '').replace(/\D/g, '').slice(-4);
const day = d => new Date(d).toISOString().slice(0, 10);

// Pure: argv (after `node access.js`) → what to do, or the error to print. No database.
function parseArgs(argv) {
  const [cmd, slug, a, b, ...rest] = argv || [];
  if (!COMMANDS.includes(cmd) || !slug) return { error: USAGE };
  if (cmd === 'add') {
    if (a == null || b == null) return { error: USAGE };
    const phoneE164 = toE164(a, { from: 'ops' });
    if (!phoneE164) return { error: 'not a phone number — use +<country><number> or 09…' };
    if (!['owner', 'staff'].includes(b)) return { error: 'role must be owner or staff\n' + USAGE };
    const label = rest.join(' ').trim().slice(0, 60) || null;
    return { cmd, slug, phoneE164, phoneKey: phoneKey(phoneE164), role: b, label };
  }
  if (cmd === 'revoke') {
    if (!a) return { error: USAGE };
    return { cmd, slug, accessId: a };
  }
  return { cmd, slug };
}

async function run(args, { prisma: p, out = console.log }) {
  const withOwner = args.cmd === 'add-account-owner';
  const bld = await p.building.findUnique({ where: { qrSlug: args.slug },
    select: { id: true, name: true, ...(withOwner ? { owner: { select: { phone: true } } } : {}) } });
  if (!bld) return { error: 'building not found: ' + args.slug + '\n' + USAGE };
  const log = (buildingId, action, detail) =>
    p.auditLog.create({ data: { buildingId, actor: 'ops', action, detail: String(detail).slice(0, 200) } });

  if (args.cmd === 'list') {
    const sw = await p.agentSwitch.findUnique({ where: { agent_kind_entityId: { agent: 'owner', kind: 'building', entityId: bld.id } } });
    out(bld.name + ' · Bini for owners ' + (sw && !sw.disabledAt ? 'ON since ' + day(sw.enabledAt)
      : 'OFF' + (sw ? ' since ' + day(sw.disabledAt) : '')));
    const rows = await p.ownerAccess.findMany({ where: { kind: 'building', entityId: bld.id }, orderBy: { createdAt: 'asc' } });
    if (!rows.length) out('  no approved numbers');
    for (const r of rows) {
      // A link carries this approval only if it was made on or after the approval (scopeFor's rule).
      const links = await p.ownerTgLink.count({ where: { phoneE164: r.phoneE164, revokedAt: null, linkedAt: { gte: r.createdAt } } });
      out('  ' + r.id + ' · ' + r.role + (r.label ? ' (' + r.label + ')' : '') + ' · …' + last4(r.phoneE164)
        + (r.revokedAt ? ' · REVOKED ' + day(r.revokedAt) : '') + ' · telegram links ' + links);
    }
    return { ok: true };
  }

  // One approval path for `add` and `add-account-owner`: a duplicate prints the existing id, never a second row.
  const approve = async ({ phoneE164, phoneKey: key, role, label }) => {
    const dup = await p.ownerAccess.findFirst({ where: { kind: 'building', entityId: bld.id, phoneE164, revokedAt: null } });
    if (dup) { out('already approved: ' + dup.id + ' · ' + dup.role + ' · …' + last4(dup.phoneE164)); return { ok: true }; }
    const r = await p.ownerAccess.create({ data: { kind: 'building', entityId: bld.id, phoneE164,
      phoneKey: key, role, label, addedBy: 'ops' } });
    await log(bld.id, 'OWNER_ACCESS_ADDED', role + ' · phone …' + last4(phoneE164));
    out('added ' + r.id + ' · ' + role + ' · …' + last4(phoneE164));
    return { ok: true };
  };

  if (args.cmd === 'add') return approve(args);

  if (args.cmd === 'add-account-owner') {
    // The number comes from the owner account itself: never typed, never printed or logged in full.
    const phoneE164 = toE164(bld.owner && bld.owner.phone, { from: 'ops' });
    if (!phoneE164) return { error: 'the owner account has no usable phone number' };
    return approve({ phoneE164, phoneKey: phoneKey(phoneE164), role: 'owner', label: 'account owner' });
  }

  if (args.cmd === 'revoke') {
    // revokeAccess takes no building, so the approval must be shown to belong to this one first.
    const row = await p.ownerAccess.findUnique({ where: { id: args.accessId } });
    if (!row || row.kind !== 'building' || row.entityId !== bld.id) return { error: 'no approval ' + args.accessId + ' on ' + args.slug };
    if (row.revokedAt) return { error: 'approval ' + row.id + ' was already revoked ' + day(row.revokedAt) };
    const access = makeOwnerAccess({ store: makeOwnerAccessStore(p), audit: log });
    const res = await access.revokeAccess(row.id, { by: 'ops' });
    if (!res.ok) return { error: 'could not revoke ' + row.id };
    const still = await p.ownerAccess.count({ where: { phoneE164: row.phoneE164, revokedAt: null } });
    out('revoked ' + row.id + ' · …' + last4(row.phoneE164) + ' · telegram links signed out ' + res.linksRevoked
      + (still ? ' (the number is still approved elsewhere)' : ''));
    return { ok: true };
  }

  const on = args.cmd === 'enable';
  const at = new Date();
  await p.agentSwitch.upsert({ where: { agent_kind_entityId: { agent: 'owner', kind: 'building', entityId: bld.id } },
    create: { agent: 'owner', kind: 'building', entityId: bld.id, enabledAt: at, disabledAt: on ? null : at },
    update: on ? { enabledAt: at, disabledAt: null } : { disabledAt: at } });
  await log(bld.id, on ? 'OWNER_BINI_ENABLED' : 'OWNER_BINI_DISABLED', 'Bini for owners ' + (on ? 'on' : 'off'));
  out(bld.name + ' · Bini for owners ' + (on ? 'ON' : 'OFF'));
  return { ok: true };
}

module.exports = { parseArgs, run, USAGE };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error(args.error); process.exit(1); }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run(args, { prisma })
    .then(res => { if (res && res.error) { console.error(res.error); process.exitCode = 1; } })
    .catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
