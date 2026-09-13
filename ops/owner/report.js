'use strict';
// Bini for owners — what happened in the last N days, as numbers. For Ibrahim and for the first week after a launch.
//   node ops/owner/report.js [days=1]
// Reads the audit log (owner questions, links, ops changes) and the last lines of the pm2 logs. Prints building
// names and counts only: never a question, a tenant name, a phone number or a Telegram id.
const fs = require('fs');

const LOGS = ['/root/.pm2/logs/binasmart-api-out.log', '/root/.pm2/logs/binasmart-api-error.log'];

function parseQuestion(detail) {
  const m = /^(owner-[a-z]+) · ([^·]+?) · /.exec(String(detail || ''));
  if (!m) return { channel: 'unknown', tools: [] };
  const tools = m[2].trim() === 'no tools' ? [] : m[2].split(',').map(s => s.trim()).filter(Boolean);
  return { channel: m[1], tools };
}

function logMetrics(lines) {
  const m = { usageCalls: 0, promptTokens: 0, completionTokens: 0, droppedUngrounded: 0, recordsUnavailable: 0, toolFailed: 0, agentFailed: 0, auditFailed: 0 };
  for (const line of lines) {
    const u = /\[bini\] usage owner prompt=(\d+) completion=(\d+)/.exec(line);
    if (u) { m.usageCalls++; m.promptTokens += +u[1]; m.completionTokens += +u[2]; continue; }
    if (line.includes('[owner] dropped ungrounded')) m.droppedUngrounded++;
    else if (line.includes('[owner] records unavailable')) m.recordsUnavailable++;
    else if (/\[owner\] tool \S+ failed/.test(line)) m.toolFailed++;
    else if (line.includes('[owner] audit failed')) m.auditFailed++;
    else if (line.includes('owner failed')) m.agentFailed++;
  }
  return m;
}

function format({ days, buildings, log }) {
  const out = ['Bini for owners — last ' + days + ' day(s)'];
  for (const b of buildings) {
    const q = b.questions || {};
    out.push('', '🏢 ' + b.name + ' · ' + (b.on ? 'ON' : 'OFF') + ' · approved owners ' + b.owners + ', staff ' + b.staff + ' · linked Telegram accounts ' + b.activeLinks,
      '   questions: web ' + (q['owner-web'] || 0) + ', telegram ' + (q['owner-telegram'] || 0) + ' · links made ' + b.linked + ', removed ' + b.unlinked,
      '   tools: ' + (Object.entries(b.tools || {}).map(([k, v]) => k + ' ' + v).join(', ') || 'none'));
  }
  const perCall = log.usageCalls ? Math.round((log.promptTokens + log.completionTokens) / log.usageCalls) : 0;
  out.push('', 'model calls ' + log.usageCalls + ' · tokens in ' + log.promptTokens + ', out ' + log.completionTokens + ' · per call ' + perCall
    + '  (from the last lines of the pm2 logs, not only this window)',
    'figures removed as unsupported ' + log.droppedUngrounded + ' · records unavailable ' + log.recordsUnavailable
    + ' · tool failures ' + log.toolFailed + ' · agent failures ' + log.agentFailed + ' · audit failures ' + log.auditFailed);
  return out.join('\n');
}

async function main(days) {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const since = new Date(Date.now() - days * 86400000);
    const switches = await p.agentSwitch.findMany({ where: { agent: 'owner', kind: 'building' } });
    const buildings = [];
    for (const sw of switches) {
      const b = await p.building.findUnique({ where: { id: sw.entityId }, select: { id: true, name: true } });
      if (!b) continue;
      const access = await p.ownerAccess.findMany({ where: { kind: 'building', entityId: b.id, revokedAt: null }, select: { role: true, phoneE164: true, createdAt: true } });
      let activeLinks = 0;
      for (const a of access) activeLinks += await p.ownerTgLink.count({ where: { phoneE164: a.phoneE164, revokedAt: null, linkedAt: { gte: a.createdAt } } });
      const audits = await p.auditLog.findMany({ where: { buildingId: b.id, createdAt: { gte: since }, action: { in: ['OWNER_BINI_Q', 'OWNER_TG_LINKED', 'OWNER_TG_UNLINKED'] } }, select: { action: true, detail: true } });
      const questions = {}, tools = {};
      for (const a of audits.filter(x => x.action === 'OWNER_BINI_Q')) {
        const { channel, tools: t } = parseQuestion(a.detail);
        questions[channel] = (questions[channel] || 0) + 1;
        for (const n of t) tools[n] = (tools[n] || 0) + 1;
      }
      buildings.push({ name: b.name, on: !sw.disabledAt, owners: access.filter(a => a.role === 'owner').length, staff: access.filter(a => a.role === 'staff').length,
        activeLinks, questions, tools, linked: audits.filter(a => a.action === 'OWNER_TG_LINKED').length, unlinked: audits.filter(a => a.action === 'OWNER_TG_UNLINKED').length });
    }
    const lines = [];
    for (const f of LOGS) { try { lines.push(...fs.readFileSync(f, 'utf8').split('\n').slice(-20000)); } catch (e) { /* no log */ } }
    console.log(format({ days, buildings, log: logMetrics(lines) }));
  } finally { await p.$disconnect(); }
}

if (require.main === module) main(Math.max(1, Math.min(90, Number(process.argv[2]) || 1))).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { parseQuestion, logMetrics, format };
