import { createHash } from 'node:crypto';

export class RideApiError extends Error {
  constructor(message, { status = 0, kind = 'http', body = null } = {}) { super(message); this.status = status; this.kind = kind; this.body = body; }
}

// The ride API keys its per-caller limits on X-Real-IP (set by nginx for internet traffic).
// We talk to it directly on localhost, so we set a synthetic, phone-derived value: the
// 5-requests-per-10-min-per-phone rule then governs bookings coming through assistants.
export function syntheticIp(phone) {
  return 'mcp-' + createHash('sha1').update(String(phone)).digest('hex').slice(0, 12);
}

export function makeRideApi({ baseUrl, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  async function call(method, path, { body, phone } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res, text;
    try {
      const headers = { accept: 'application/json' };
      if (body) headers['content-type'] = 'application/json';
      if (phone) headers['x-real-ip'] = syntheticIp(phone);
      res = await fetchImpl(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      text = await res.text();
    } catch (e) {
      const kind = e.name === 'AbortError' ? 'timeout' : 'network';
      throw new RideApiError(kind, { kind });
    } finally { clearTimeout(timer); }
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) throw new RideApiError((json && json.error) || `HTTP ${res.status}`, { status: res.status, body: json });
    return json;
  }
  const enc = encodeURIComponent;
  return {
    search: (q, bias) => call('GET', `/api/ride/search?q=${enc(q)}` + (bias ? `&lat=${bias.lat}&lng=${bias.lng}` : '')),
    quote: (pickup, dropoff) => call('POST', '/api/ride/quote', { body: { pickup, dropoff } }),
    request: b => call('POST', '/api/ride/request', { body: b, phone: (b.passenger && b.passenger.phone) || b.riderPhone }),
    status: (id, phone) => call('GET', `/api/ride/${enc(id)}?phone=${enc(phone)}`),
    cancel: (id, phone) => call('POST', `/api/ride/${enc(id)}/cancel`, { body: { phone }, phone }),
    settings: () => call('GET', '/api/ride/settings'),
  };
}
