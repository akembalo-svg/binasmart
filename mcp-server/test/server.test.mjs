import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const guides = new Map([['fayda', { slug: 'fayda', title: 'Fayda', summary: 'ID', url: 'https://bina.et/fayda', text: '# Fayda\nHello' }]]);
const db = { query: async () => ({ rows: [] }) };
const api = { search: async () => ({ ok: true, results: [] }), quote: async () => ({}), request: async () => ({}), status: async () => ({}), cancel: async () => ({}), settings: async () => ({ ok: true }) };
const app = createApp({ rideApi: api, db, guides, callLimit: { windowMs: 60_000, max: 3 } });
const srv = app.listen(0, '127.0.0.1');
await new Promise(r => srv.once('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/mcp`;
after(() => srv.close());

async function rpc(method, params, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await res.text();
  const line = text.split('\n').find(l => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5) : text);
}

test('GET /mcp serves markdown docs; /mcp/health answers', async () => {
  const r = await fetch(url); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /markdown/);
  assert.match(await r.text(), /BinaSmart/);
  const h = await fetch(url + '/health'); assert.equal(h.status, 200); assert.deepEqual(await h.json(), { ok: true, db: true, ride_api: true });
});

test('initialize + tools/list exposes exactly the 9 tools with annotations', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'binasmart');
  assert.match(init.result.instructions, /Addis Ababa/);
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['cancel_ride', 'get_ethiopia_guide', 'get_hospital_departments', 'get_hotel_rooms', 'get_ride_status', 'list_events', 'quote_ride', 'request_ride', 'search_places']);
  const req = list.result.tools.find(t => t.name === 'request_ride');
  assert.equal(req.annotations.readOnlyHint, false);
  assert.equal(list.result.tools.find(t => t.name === 'cancel_ride').annotations.destructiveHint, true);
});

test('tools/call runs a tool; per-caller limit returns a tool error after max calls', async () => {
  const h = { 'mcp-session-id': 'sess-A' };
  const r1 = await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: { slug: 'fayda' } }, h);
  assert.match(r1.result.content[0].text, /"title": "Fayda"/);
  await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, h);
  await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, h);
  const r4 = await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, h);
  assert.equal(r4.result.isError, true); assert.match(r4.result.content[0].text, /slow down/i);
  const other = await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, { 'mcp-session-id': 'sess-B' });
  assert.notEqual(other.result.isError, true, 'independent caller unaffected');
});

test('invalid arguments are rejected before the handler runs', async () => {
  const r = await rpc('tools/call', { name: 'quote_ride', arguments: { pickup: 'x' } }, { 'mcp-session-id': 'sess-C' });
  assert.ok(r.error || r.result.isError, 'zod rejects missing dropoff');
  assert.match(JSON.stringify(r), /dropoff/);
});
