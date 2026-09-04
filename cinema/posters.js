'use strict';
// Poster lookup for programme entries and Watch films.
//   1. TMDB (themoviedb.org) when TMDB_API_KEY is set — posters licensed for exactly this use,
//      credited on the page ("data from TMDB"). Search by title (+ year), take the best match.
//   2. Otherwise null: callers keep whatever poster the cinema/channel published. Never IMDb.
const IMG = 'https://image.tmdb.org/t/p/w500';

function makePosters({ apiKey, fetchImpl, cache }) {
  const key = apiKey || process.env.TMDB_API_KEY || '';
  const f = fetchImpl || fetch;
  const mem = cache || new Map();

  async function search(title, year) {
    if (!key || !title) return null;
    const ck = (title + '|' + (year || '')).toLowerCase();
    if (mem.has(ck)) return mem.get(ck);
    const u = 'https://api.themoviedb.org/3/search/movie?api_key=' + encodeURIComponent(key) + '&query=' + encodeURIComponent(title) + (year ? '&year=' + year : '') + '&include_adult=false';
    let out = null;
    try {
      const r = await f(u, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        const hit = (j.results || []).find(m => m.poster_path) || null;
        if (hit) out = { posterUrl: IMG + hit.poster_path, tmdbId: hit.id, title: hit.title, year: hit.release_date ? Number(hit.release_date.slice(0, 4)) : null, overview: hit.overview || null };
      }
    } catch (e) { /* offline or rate-limited: no poster this time */ }
    mem.set(ck, out);
    return out;
  }

  return { enabled: !!key, search };
}

module.exports = { makePosters, IMG };
