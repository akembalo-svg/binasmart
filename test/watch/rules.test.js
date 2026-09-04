'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPublic, canPlay, embedFor, youtubeId } = require('../../watch/rules');

const NOW = 1_000_000_000_000;
const film = (o) => ({ id: 'f1', status: 'public', rights: 'Licence from Producer X, Ethiopia, 2026-09-01', rightsUntil: null, priceEtb: 0, ...o });

test('visibility: draft, no rights, or expired rights are never public', () => {
  assert.equal(isPublic(film({}), NOW), true);
  assert.equal(isPublic(film({ status: 'draft' }), NOW), false);
  assert.equal(isPublic(film({ rights: '' }), NOW), false);
  assert.equal(isPublic(film({ rights: '   ' }), NOW), false);
  assert.equal(isPublic(film({ rightsUntil: new Date(NOW - 1) }), NOW), false);
  assert.equal(isPublic(film({ rightsUntil: new Date(NOW + 86400000) }), NOW), true);
  assert.equal(isPublic(null, NOW), false);
});
test('play: free plays; paid needs an ACTIVE unexpired rental of the same film', () => {
  assert.deepEqual(canPlay(film({}), null, NOW), { ok: true, free: true });
  const paid = film({ priceEtb: 80 });
  assert.deepEqual(canPlay(paid, null, NOW), { ok: false, error: 'rent' });
  assert.deepEqual(canPlay(paid, { filmId: 'f2', status: 'ACTIVE', expiresAt: new Date(NOW + 1000) }, NOW), { ok: false, error: 'rent' });
  assert.deepEqual(canPlay(paid, { filmId: 'f1', status: 'PENDING', expiresAt: null }, NOW), { ok: false, error: 'rent' });
  assert.equal(canPlay(paid, { filmId: 'f1', status: 'ACTIVE', expiresAt: new Date(NOW + 1000) }, NOW).ok, true);
  assert.deepEqual(canPlay(paid, { filmId: 'f1', status: 'ACTIVE', expiresAt: new Date(NOW - 1) }, NOW), { ok: false, error: 'expired' });
  assert.deepEqual(canPlay(paid, { filmId: 'f1', status: 'EXPIRED', expiresAt: new Date(NOW - 1) }, NOW), { ok: false, error: 'expired' });
  assert.deepEqual(canPlay(film({ status: 'draft' }), null, NOW), { ok: false, error: 'unavailable' });
});
test('sources: youtube ids from every URL shape; mp4/hls must be https; junk is null', () => {
  for (const u of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ']) assert.equal(youtubeId(u), 'dQw4w9WgXcQ', u);
  assert.equal(youtubeId('https://vimeo.com/123'), null);
  assert.equal(embedFor({ sourceKind: 'youtube', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }).url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1');
  assert.deepEqual(embedFor({ sourceKind: 'mp4', sourceUrl: 'https://cdn.example.com/f.mp4' }), { kind: 'mp4', url: 'https://cdn.example.com/f.mp4' });
  assert.equal(embedFor({ sourceKind: 'mp4', sourceUrl: 'http://insecure/f.mp4' }), null);
  assert.equal(embedFor({ sourceKind: 'torrent', sourceUrl: 'x' }), null);
});
