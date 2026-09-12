'use strict';
// Proof that a caller opened a building page, rather than read its API.
//
// /api/b/:slug used to return every tenant's phone number to anyone who asked — 71 of them for JJ
// Darule in one unauthenticated request, named individuals among them. The phones are the point of
// the page: the Call button, the WhatsApp order links, the directory listing. What could go is
// handing all 71 to a caller who never opened it.
//
// The printed QR codes encode a bare /b/<slug>, so a secret cannot live in the QR without physically
// reprinting the stickers in the building. The token is minted when /b/:slug serves the page — which
// already templates that HTML for its meta tags — and spent by the page's own fetch. Every printed
// code keeps working.
//
// ⚠️ What this is and is not. It ends the one-request bulk dump, and it binds a token to one building
// so a single page visit cannot be replayed across the other 28. It does NOT stop someone willing to
// fetch each page and read the token out of it. Sealing that needs a secret in the printed code.
//
// Stateless on purpose: an HMAC over slug and hour, no table, nothing to clean up. The previous hour
// is accepted as well as the current one, so a page left open across the boundary does not suddenly
// lose its Call buttons.
const crypto = require('crypto');

const HOUR = 3600000;

function makeVisit(secret, now = Date.now) {
  if (!secret) throw new Error('makeVisit needs a secret');
  const at = (slug, bucket) => crypto.createHmac('sha256', secret)
    .update(String(slug) + '|' + bucket).digest('base64url').slice(0, 22);

  return {
    // The token to hand to the page for this building, now.
    mint: slug => at(slug, Math.floor(now() / HOUR)),
    // Was this token minted for THIS building, within the last hour or two?
    check: (slug, tok) => {
      if (!tok || typeof tok !== 'string') return false;
      const b = Math.floor(now() / HOUR);
      return tok === at(slug, b) || tok === at(slug, b - 1);
    },
    _at: at,
  };
}

module.exports = { makeVisit, HOUR };
