'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makePosters } = require('../../cinema/posters');

test('without a key the lookup is disabled and returns null', async () => {
  const p = makePosters({ apiKey: '', fetchImpl: async () => { throw new Error('must not be called'); } });
  assert.equal(p.enabled, false);
  assert.equal(await p.search('Mutiny', 2026), null);
});
test('with a key: searches TMDB by title and year, returns the first result that has a poster, caches', async () => {
  const calls = [];
  const fetchImpl = async u => { calls.push(u); return { ok: true, json: async () => ({ results: [{ id: 1, title: 'Mutiny (fan cut)', poster_path: null }, { id: 2, title: 'Mutiny', poster_path: '/abc.jpg', release_date: '2026-08-01', overview: 'x' }] }) }; };
  const p = makePosters({ apiKey: 'k', fetchImpl });
  const r = await p.search('Mutiny', 2026);
  assert.deepEqual(r, { posterUrl: 'https://image.tmdb.org/t/p/w500/abc.jpg', tmdbId: 2, title: 'Mutiny', year: 2026, overview: 'x' });
  assert.match(calls[0], /api\.themoviedb\.org\/3\/search\/movie\?api_key=k&query=Mutiny&year=2026/);
  await p.search('mutiny', 2026);
  assert.equal(calls.length, 1, 'cached, case-insensitive');
});
test('network failure or no results -> null, never a throw', async () => {
  const p = makePosters({ apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(await p.search('X'), null);
  const q = makePosters({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }) });
  assert.equal(await q.search('Nothing'), null);
});
