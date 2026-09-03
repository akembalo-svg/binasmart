// Sliding window: allows `max` hits per `windowMs` per key. `now` is injectable for tests.
export function makeLimiter(windowMs, max, now = Date.now) {
  const m = new Map();
  return key => {
    const t = now();
    const hits = (m.get(key) || []).filter(x => t - x < windowMs);
    if (hits.length >= max) { m.set(key, hits); return false; }
    hits.push(t); m.set(key, hits);
    if (m.size > 5000) for (const [k, v] of m) { if (!v.length || t - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}
