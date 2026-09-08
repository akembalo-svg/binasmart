import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerKnowledgeTools } from '../tools/knowledge.mjs';
const json = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

function build(api) {
  const tools = {};
  const server = { registerTool: (name, cfg, fn) => { tools[name] = fn; } };
  registerKnowledgeTools(server, { api, wrap: (n, f) => f, json });
  return tools;
}

test('search_knowledge returns passages with source urls and a no-invent note', async () => {
  const t = build({ knowledge: async (q, k) => ({ ok: true, results: [{ title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide', text: 'Megenagna is the eastern hub', score: 0.8 }] }) });
  const r = JSON.parse((await t.search_knowledge({ query: 'Megenagna' })).content[0].text);
  assert.equal(r.results[0].source_url, 'https://bina.et/living-working-in-ethiopia-guide');
  assert.match(r.note, /override model memory/);
});

test('search_knowledge degrades to a tool error when the API is down', async () => {
  const t = build({ knowledge: async () => { throw new Error('network'); } });
  const r = await t.search_knowledge({ query: 'anything' });
  assert.equal(r.isError, true); assert.match(r.content[0].text, /llms\.txt/);
});

test('list_pool_corridors and find_pool_groups shape the board', async () => {
  const board = { ok: true, direction: 'in', peak: true, corridors: [{ key: 'megenagna-bole', ladder: [] }], groups: [{ id: 'p1', seatsLeft: 2 }] };
  const t = build({ poolBoard: async () => board });
  const c = JSON.parse((await t.list_pool_corridors({})).content[0].text);
  assert.equal(c.corridors.length, 1); assert.equal(c.join_url, 'https://bina.et/ride?pool=1');
  const g = JSON.parse((await t.find_pool_groups({ lat: 9.02, lng: 38.8 })).content[0].text);
  assert.equal(g.groups[0].share_url, 'https://bina.et/pool/p1'); assert.equal(g.count, 1);
  const none = JSON.parse((await build({ poolBoard: async () => ({ ok: true, groups: [] }) }).find_pool_groups({ lat: 9, lng: 38.8 })).content[0].text);
  assert.match(none.note, /start one/);
});
