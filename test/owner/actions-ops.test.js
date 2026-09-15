'use strict';
// ops/owner/actions.js: what each command line means, and what it writes — over a Prisma double, no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, run, USAGE } = require('../../ops/owner/actions');
const { ACTIONS_AGENT, STAFF_AGENT } = require('../../agents/owner/actions/store');

test('each command names the switch it moves; anything else is the usage message', () => {
  assert.deepEqual(parseArgs(['on', 'demo-tower']), { cmd: 'on', slug: 'demo-tower', agent: ACTIONS_AGENT, enable: true });
  assert.deepEqual(parseArgs(['off', 'demo-tower']), { cmd: 'off', slug: 'demo-tower', agent: ACTIONS_AGENT, enable: false });
  assert.deepEqual(parseArgs(['staff-on', 'demo-tower']), { cmd: 'staff-on', slug: 'demo-tower', agent: STAFF_AGENT, enable: true });
  assert.deepEqual(parseArgs(['staff-off', 'demo-tower']), { cmd: 'staff-off', slug: 'demo-tower', agent: STAFF_AGENT, enable: false });
  assert.deepEqual(parseArgs(['list', 'demo-tower']), { cmd: 'list', slug: 'demo-tower', agent: null, enable: false });
  for (const argv of [[], ['on'], ['enable', 'demo-tower'], ['list']]) assert.equal(parseArgs(argv).error, USAGE, JSON.stringify(argv));
});

function fake({ building = { id: 'b1', name: 'Demo Tower' }, switches = [] } = {}) {
  const writes = [], audits = [], out = [];
  const prisma = {
    building: { findUnique: async () => building },
    agentSwitch: {
      findUnique: async q => switches.find(s => s.agent === q.where.agent_kind_entityId.agent) || null,
      upsert: async q => { writes.push(q); return { id: 'S1' }; },
    },
    auditLog: { create: async q => { audits.push(q.data); return q.data; } },
    ownerAction: { count: async () => 0 },
  };
  return { prisma, writes, audits, out, log: m => out.push(m) };
}

test('on writes the switch and the building\'s audit row; off closes it', async () => {
  const f = fake();
  assert.deepEqual(await run(parseArgs(['on', 'demo-tower']), { prisma: f.prisma, out: f.log }), { ok: true });
  assert.equal(f.writes[0].where.agent_kind_entityId.agent, ACTIONS_AGENT);
  assert.equal(f.writes[0].update.disabledAt, null);
  assert.deepEqual(f.audits.map(a => [a.buildingId, a.actor, a.action, a.detail]), [['b1', 'ops', 'OWNER_ACTIONS_ENABLED', ACTIONS_AGENT + ' on']]);

  const g = fake();
  await run(parseArgs(['off', 'demo-tower']), { prisma: g.prisma, out: g.log });
  assert.ok(g.writes[0].update.disabledAt instanceof Date);
  assert.equal(g.audits[0].action, 'OWNER_ACTIONS_DISABLED');
});

test('list writes nothing and says where both switches stand', async () => {
  const f = fake({ switches: [{ agent: ACTIONS_AGENT, enabledAt: new Date('2026-09-16T00:00:00Z'), disabledAt: null }] });
  await run(parseArgs(['list', 'demo-tower']), { prisma: f.prisma, out: f.log });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.audits, []);
  assert.match(f.out[0], /Owner actions ON since 2026-09-16/);
  assert.match(f.out[1], /Staff may confirm OFF/);
  assert.match(f.out[2], /pending previews: 0/);
});

test('a building that is not there is refused before anything is written', async () => {
  const f = fake({ building: null });
  const r = await run(parseArgs(['on', 'nope']), { prisma: f.prisma, out: f.log });
  assert.match(r.error, /^building not found: nope/);
  assert.deepEqual(f.writes, []);
});
