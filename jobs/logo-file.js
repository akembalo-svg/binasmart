'use strict';
// Saving a company's logo onto our own server.
//
// One copy of this, used by every harvester and every logo pass, because the rules are the same
// everywhere: never hotlink (their redesign must not empty our board, and our readers' addresses are not
// theirs to collect), refuse anything that is not really an image, and refuse the placeholders boards
// use for companies that never uploaded a mark - one grey square repeated across a hundred employers
// looks worse than initials and claims something untrue.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'logos');
const MAX_BYTES = 700 * 1024;
const MIN_BYTES = 700;
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; employer logo for the listing; contact https://t.me/Bina_smart)';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
const PLACEHOLDER = /(no[-_]?image|no[-_]?logo|placeholder|default[-_]?(logo|image)|company[-_]?default|\/Image\/seo\/)/i;

// Returns the public path we stored it at, or null. Never throws: a missing logo must not stop a
// vacancy being published.
async function saveLogo(url, slug, { timeout = 20000 } = {}) {
  if (!url || !slug || PLACEHOLDER.test(String(url))) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'image/*' } });
    if (!r.ok) return null;
    const ext = EXT[String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
    if (!ext) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, slug + '.' + ext), buf);
    return '/static/logos/' + slug + '.' + ext;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

module.exports = { saveLogo, DIR, PLACEHOLDER, EXT };
