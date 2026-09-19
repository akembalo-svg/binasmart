'use strict';
// Routing check for owner Bini: which tool answers which kind of question. It asks the owner's real phrasings
// through the live dashboard route of a DEMO building and reads the tool names Bini recorded in the audit log.
// A named tenant or office must go to find_tenant (never data_health); a list of who owes must go to a read tool
// (never a prepare_* action); a general question may still start with data_health; an explicit request to remind
// still prepares reminders. Evaluation traffic is marked (x-binasmart-eval) so nothing pages anyone; the throwaway
// owner key, the audit rows and the previews it made are removed at the end. Prints tool names, never a name.
//   node ops/owner/routing-check.js century-mall
const { PrismaClient } = require('@prisma/client');
const { mintKey, hashKey } = require('../../building/ownerKeys');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 4210);
const REFUSE = new Set(['darulle']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const READ_LIST = ['unpaid', 'late_payers', 'rent_month'];

(async () => {
  const slug = process.argv[2];
  if (!slug || REFUSE.has(slug)) { console.log('usage: node ops/owner/routing-check.js <demo-slug>'); process.exit(1); }
  const p = new PrismaClient();
  const started = new Date();
  let keyHash = null, buildingId = null;
  try {
    const b = await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true } });
    if (!b) throw new Error('demo building not found');
    buildingId = b.id;
    const ts = await p.tenancy.findMany({ where: { active: true, unit: { buildingId } }, include: { shop: { select: { name: true, nameAm: true } } } });
    const t = ts.find(x => x.shop && x.shop.nameAm && x.shop.name);
    if (!t) throw new Error('no shop tenant with both names in ' + slug);
    const am = t.shop.nameAm, en = t.shop.name;
    const cases = [
      { id: 'named-full-info-am', q: 'ስለ ' + am + ' ሙሉ መረጃ ስጠኝ', use: ['find_tenant', 'unit'], not: ['data_health'] },
      // the owner's own words, 2026-09-19 (an office whose name sounds like a document service; a business asked for in full)
      { id: 'verbatim-doc-office-am', q: 'የሰነዶች ማረጋገጫ መረጃ ስጠኝ', use: ['find_tenant'], not: ['data_health'] },
      { id: 'verbatim-full-info-am', q: 'ስለ ሀኑድ ሙሉ መረጃ ስጠኝ', use: ['find_tenant'], not: ['data_health'] },
      { id: 'named-info-am', q: 'የ' + am + ' መረጃ ስጠኝ', use: ['find_tenant'], not: ['data_health'] },
      { id: 'named-en', q: 'Give me full information about ' + en, use: ['find_tenant', 'unit'], not: ['data_health'] },
      { id: 'named-where-am', q: am + ' የት ነው?', use: ['find_tenant'], not: ['data_health'] },
      { id: 'due-list-am', q: 'አሁን የክፍያ ቀናቸው የደረሱትን ደንበኞች ዝርዝር ስጠኝ', useAny: READ_LIST, notPrefix: 'prepare_' },
      { id: 'due-list-am-2', q: 'ክፍያ ያልከፈሉ ተከራዮች እነማን ናቸው?', useAny: READ_LIST, notPrefix: 'prepare_' },
      { id: 'due-list-en', q: 'List the tenants whose payment date has come', useAny: READ_LIST, notPrefix: 'prepare_' },
      { id: 'control-general-am', q: 'የመዝገቤ ሁኔታ እንዴት ነው?', useAny: ['data_health', 'overview'] },
      { id: 'control-remind-am', q: 'ክፍያ ላልከፈሉ ተከራዮች አስታዋሽ አዘጋጅ', use: ['prepare_reminders'] },
    ];
    const key = mintKey(slug);
    keyHash = hashKey(key);
    await p.ownerKey.create({ data: { buildingId, keyHash, label: 'owner-routing' } });
    let bad = 0;
    for (const c of cases) {
      const from = new Date();
      let status = 0;
      try {
        const r = await fetch(BASE + '/api/owner/' + slug + '/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-key': key, 'x-binasmart-eval': '1' }, body: JSON.stringify({ message: c.q }) });
        status = r.status; await r.json().catch(() => ({}));
      } catch (e) {}
      await sleep(1500);
      const rows = await p.auditLog.findMany({ where: { buildingId, action: 'OWNER_BINI_Q', createdAt: { gte: from } }, orderBy: { createdAt: 'asc' } });
      const tools = [...new Set(rows.flatMap(r => String(r.detail || '').split(' · ').slice(1, -1).flatMap(s => s.split(/[ ,+]+/)).filter(x => /^[a-z_]+$/.test(x))))];
      const fails = [];
      for (const u of c.use || []) if (!tools.includes(u)) fails.push('missing ' + u);
      if (c.useAny && !c.useAny.some(u => tools.includes(u))) fails.push('none of ' + c.useAny.join('/'));
      for (const n of c.not || []) if (tools.includes(n)) fails.push('used ' + n);
      if (c.notPrefix && tools.some(x => x.startsWith(c.notPrefix))) fails.push('used a ' + c.notPrefix + ' tool');
      if (fails.length) bad++;
      console.log((fails.length ? 'FAIL ' : 'ok   ') + c.id + ' · http ' + status + ' · tools [' + tools.join(', ') + ']' + (fails.length ? ' · ' + fails.join('; ') : ''));
      await sleep(4000);
    }
    console.log(bad ? bad + ' of ' + cases.length + ' routed wrongly' : 'all ' + cases.length + ' routed correctly');
    process.exitCode = bad ? 2 : 0;
  } finally {
    if (keyHash) await p.ownerKey.deleteMany({ where: { keyHash } });
    if (buildingId) {
      await p.auditLog.deleteMany({ where: { buildingId, action: { startsWith: 'OWNER_' }, createdAt: { gte: started } } });
      await p.ownerAction.deleteMany({ where: { buildingId, createdAt: { gte: started } } });
    }
    await p.$disconnect();
  }
})().catch(e => { console.log('ERR', String(e.message).slice(0, 300)); process.exit(1); });
