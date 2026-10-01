'use strict';
// Bini takes Bini Browser (bina.et/agent) requests from offices and companies and pages the team once (1 Oct 2026).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../assistant/tools');
const { pickTools } = require('../assistant/tool-router');

const LEAD = { name: 'Test Person', organisation: 'Test Sub-city Office', kind: 'government', role: 'clerk', phone: '0900 000 061', need: 'renew trade licences on eTrade' };
const names = msg => pickTools(tools.toOpenAI(), { msg, hist: [] }).map(t => t.function.name);

test('the trigger knows English, Amharic and the address', () => {
  for (const m of ['Tell me about Bini Browser', 'ቢኒ ብራውዘር ለመሥሪያ ቤታችን እንፈልጋለን', 'I saw bina.et/agent', 'does it work as a chrome extension?', 'ቢና ኤጀንት'])
    assert.ok(tools.AGENT_RE.test(m), m);
  for (const m of ['taxi from Bole to Piassa', 'real estate agent in CMC', 'ስራ እፈልጋለሁ'])
    assert.ok(!tools.AGENT_RE.test(m), m);
});

test('the router offers the tool for Bini Browser questions and not for a ride', () => {
  assert.ok(names('we want Bini Browser for our office').includes('bini_browser_lead'));
  assert.ok(!names('taxi from Bole to Piassa').includes('bini_browser_lead'));
});

test('the facts never call it free and never quote a price', () => {
  assert.match(tools.AGENT_FACTS, /NOT free/);
  assert.doesNotMatch(tools.AGENT_FACTS, /\b(birr|ETB|USD|\$)\b/i);
});

test('an evaluation run sends nothing', async () => {
  let paged = 0;
  const run = tools.makeExecutor({ base: 'http://127.0.0.1:1', dryRun: true, handover: async () => { paged++; return true; } });
  const r = await run('bini_browser_lead', LEAD);
  assert.equal(r.ok, true); assert.equal(r.dryRun, true); assert.equal(r.wouldSend.organisation, LEAD.organisation);
  assert.equal(paged, 0);
});

test('a real lead pages the team once with the details', async () => {
  const sent = [];
  const run = tools.makeExecutor({ base: 'http://127.0.0.1:1', handover: async h => { sent.push(h); return true; } });
  const r = await run('bini_browser_lead', LEAD);
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].summary, /BINI BROWSER LEAD/);
  assert.match(sent[0].summary, /Test Sub-city Office \[government\]/);
  assert.match(sent[0].summary, /0900 000 061/);
  assert.equal(sent[0].explicit, true);
  const again = await run('bini_browser_lead', Object.assign({}, LEAD));
  assert.equal(again.ok, true); assert.equal(sent.length, 1, 'the same lead twice in one turn paged twice');
});

test('a second, different lead in the same reply still pages only once', async () => {
  let paged = 0;
  const run = tools.makeExecutor({ base: 'http://127.0.0.1:1', handover: async () => { paged++; return true; } });
  await run('bini_browser_lead', LEAD);
  const r = await run('bini_browser_lead', Object.assign({}, LEAD, { need: 'eGP tenders' }));
  assert.equal(r.ok, true); assert.match(r.note, /do NOT call/); assert.equal(paged, 1);
});

test('Amharic gets the immigration name, never refugees', () => {
  assert.match(tools.AGENT_FACTS, /ኢሚግሬሽን/);
});

test('a wrong phone or a missing office asks again and pages nobody', async () => {
  let paged = 0;
  const run = tools.makeExecutor({ base: 'http://127.0.0.1:1', handover: async () => { paged++; return true; } });
  assert.match((await run('bini_browser_lead', Object.assign({}, LEAD, { phone: '12345' }))).error, /phone/);
  assert.match((await run('bini_browser_lead', Object.assign({}, LEAD, { organisation: '' }))).error, /office or company/);
  assert.equal(paged, 0);
});
