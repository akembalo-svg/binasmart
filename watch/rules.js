'use strict';
// The two rules that keep Watch honest, kept pure so they are tested in isolation:
//  - a film is public only with a rights note that has not expired
//  - a paid film plays only with an ACTIVE, unexpired rental of that film

function isPublic(film, now) {
  if (!film || film.status !== 'public') return false;
  if (!film.rights || !String(film.rights).trim()) return false;
  if (film.rightsUntil && new Date(film.rightsUntil).getTime() <= (now || Date.now())) return false;
  return true;
}

function canPlay(film, rental, now) {
  const t = now || Date.now();
  if (!isPublic(film, t)) return { ok: false, error: 'unavailable' };
  if (!film.priceEtb) return { ok: true, free: true };
  if (!rental || rental.filmId !== film.id) return { ok: false, error: 'rent' };
  if (rental.status !== 'ACTIVE') return { ok: false, error: rental.status === 'EXPIRED' ? 'expired' : 'rent' };
  if (!rental.expiresAt || new Date(rental.expiresAt).getTime() <= t) return { ok: false, error: 'expired' };
  return { ok: true, free: false, expiresAt: rental.expiresAt };
}

// YouTube: accept a watch URL, a youtu.be URL, an embed URL or a bare 11-char id.
function youtubeId(u) {
  const s = String(u || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function embedFor(film) {
  if (film.sourceKind === 'youtube') { const id = youtubeId(film.sourceUrl); return id ? { kind: 'youtube', id, url: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1' } : null; }
  if (film.sourceKind === 'mp4' || film.sourceKind === 'hls') return /^https:\/\//.test(film.sourceUrl) ? { kind: film.sourceKind, url: film.sourceUrl } : null;
  return null;
}

module.exports = { isPublic, canPlay, embedFor, youtubeId };
