'use strict';
// Switch owner actions on or off for one building, and see what is pending. Run on the server only.
//
//   node ops/owner/actions.js list     <slug>
//   node ops/owner/actions.js on       <slug>          Bini may prepare actions; the owner confirms each one with ✅
//   node ops/owner/actions.js off      <slug>          the rollback switch: Bini answers as before and prepares nothing
//   node ops/owner/actions.js staff-on <slug>          staff approvals may confirm too (off by default)
//   node ops/owner/actions.js staff-off <slug>
//
// Both switches are AgentSwitch rows, like Bini for owners itself ('owner' / ops/owner/access.js enable). Turning
// actions on for a REAL building means the owner's ✅ reaches tenants, so it is done only with Ibrahim's word; a demo
// building runs everything through the delivery layer in test mode. Every change is written to the building's audit log
// (actor ops). Nothing here prints a phone number, a Telegram id or a message text.
const { ACTIONS_AGENT, STAFF_AGENT } = require('../../agents/owner/actions/store');

const USAGE = 'usage: node ops/owner/actions.js list|on|off|staff-on|staff-off <slug>';
const COMMANDS = ['list', 'on', 'off', 'staff-on', 'staff-off'];
const AGENT = { on: ACTIONS_AGENT, off: ACTIONS_AGENT, 'staff-on': STAFF_AGENT, 'staff-off': STAFF_AGENT };
const day = d => new Date(d).toISOString().slice(0, 10);

function parseArgs(argv) {
  const [cmd, slug] = argv || [];
  if (!COMMANDS.includes(cmd) || !slug) return { error: USAGE };
  return { cmd, slug, agent: AGENT[cmd] || null, enable: cmd === 'on' || cmd === 'staff-on' };
}

async function run(args, { prisma: p, out = console.log }) {
  const b = await p.building.findUnique({ where: { qrSlug: args.slug }, select: { id: true, name: true } });
  if (!b) return { error: 'building not found: ' + args.slug + '\n' + USAGE };
  const state = async agent => p.agentSwitch.findUnique({ where: { agent_kind_entityId: { agent, kind: 'building', entityId: b.id } } });
  const show = async () => {
    for (const [agent, label] of [[ACTIONS_AGENT, 'Owner actions'], [STAFF_AGENT, 'Staff may confirm']]) {
      const sw = await state(agent);
      out(b.name + ' · ' + label + ' ' + (sw && !sw.disabledAt ? 'ON since ' + day(sw.enabledAt) : 'OFF' + (sw ? ' since ' + day(sw.disabledAt) : '')));
    }
    const pending = await p.ownerAction.count({ where: { buildingId: b.id, status: 'pending' } });
    const today = await p.ownerAction.count({ where: { buildingId: b.id, status: { in: ['done', 'running', 'failed'] }, confirmedAt: { gte: new Date(Date.now() - 86400000) } } });
    out('  pending previews: ' + pending + ' · confirmed in the last 24 h: ' + today);
  };
  if (args.cmd === 'list') { await show(); return { ok: true }; }

  const now = new Date();
  await p.agentSwitch.upsert({
    where: { agent_kind_entityId: { agent: args.agent, kind: 'building', entityId: b.id } },
    create: { agent: args.agent, kind: 'building', entityId: b.id, enabledAt: now, disabledAt: args.enable ? null : now },
    update: args.enable ? { enabledAt: now, disabledAt: null } : { disabledAt: now },
  });
  await p.auditLog.create({ data: { buildingId: b.id, actor: 'ops', action: args.enable ? 'OWNER_ACTIONS_ENABLED' : 'OWNER_ACTIONS_DISABLED',
    detail: args.agent + (args.enable ? ' on' : ' off') } });
  await show();
  return { ok: true };
}

module.exports = { parseArgs, run, USAGE, COMMANDS };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.log(args.error); process.exit(1); }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run(args, { prisma })
    .then(r => { if (r && r.error) { console.log(r.error); process.exitCode = 1; } })
    .catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
