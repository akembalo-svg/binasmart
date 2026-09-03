import { createHash } from 'node:crypto';
// Same rider + same pickup/dropoff (to ~10 m) inside the same 10-minute bucket → same key,
// so an assistant retrying or looping "confirm? yes" cannot create two rides. The ride API
// stores idemKey UNIQUE and returns the existing ride with duplicate:true.
export function idemKey(phone, from, to, nowMs = Date.now()) {
  const r = n => Number(n).toFixed(4);
  const s = `${phone}|${r(from.lat)},${r(from.lng)}|${r(to.lat)},${r(to.lng)}|${Math.floor(nowMs / 600_000)}`;
  return createHash('sha1').update(s).digest('hex');
}
