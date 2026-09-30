// search_health for AI assistants (30 Sep 2026): the site's /api/health/search, a "near" place resolved on the map first,
// and only what the public pages show.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHealthTools } from '../tools/health.mjs';

function harness(routes) {
  const tools = {}, calls = [];
  const server = { registerTool(name, def, fn) { tools[name] = { def, fn }; } };
  registerHealthTools(server, { wrap: (n, fn) => fn, json: d => ({ content: [{ type: 'text', text: JSON.stringify(d) }] }) });
  const real = globalThis.fetch;
  globalThis.fetch = async url => { calls.push(String(url)); const u = new URL(url); const body = routes(u); return { ok: true, json: async () => body }; };
  return { tools, calls, restore: () => { globalThis.fetch = real; } };
}
const out = r => JSON.parse(r.content[0].text);

test('near a place: the point comes from the map, then the nearest places; the note says no medical advice and 907', async () => {
  const h = harness(u => u.pathname === '/api/ride/search' ? { results: [{ label: 'Piassa', lat: 9.0365, lng: 38.7512 }] }
    : { total: 2, results: [{ name: 'Near Hospital', km: 0.9, url: 'https://bina.et/health/near-hospital-w1' }], more: 'https://bina.et/health?q=hospital' });
  try {
    const r = out(await h.tools.search_health.fn({ kind: 'hospital', near: 'Piassa' }));
    assert.equal(r.near, 'Piassa'); assert.equal(r.results[0].name, 'Near Hospital'); assert.match(r.note, /907/); assert.match(r.note, /not medical advice/);
    const q = new URL(h.calls[1]).searchParams;
    assert.equal(q.get('kind'), 'hospital'); assert.equal(q.get('lat'), '9.0365'); assert.equal(q.get('lng'), '38.7512');
    assert.equal(h.tools.search_health.def.annotations.readOnlyHint, true);
  } finally { h.restore(); }
});

test('a place outside Addis is not a point; nothing found is a clear error with the directory link', async () => {
  const h = harness(u => u.pathname === '/api/ride/search' ? { results: [{ label: 'Hawassa', lat: 7.06, lng: 38.47 }] } : { total: 0, results: [], doctors: [] });
  try {
    const r = await h.tools.search_health.fn({ near: 'Hawassa' });
    assert.equal(r.isError, true); assert.match(r.content[0].text, /bina\.et\/health/);
    const q = new URL(h.calls[1]).searchParams;
    assert.equal(q.get('lat'), null); assert.equal(q.get('area'), 'Hawassa');
  } finally { h.restore(); }
});
