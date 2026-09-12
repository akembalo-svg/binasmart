'use strict';
// Has the owner of this shop asked to be published?
//
// It decides four things, in four files: whether /shop/<slug> is indexable and carries
// LocalBusiness JSON-LD, whether the slug goes in the sitemap, whether the phone is returned by the
// public API and by the MCP directory, and whether the page may state that the shop is open.
//
// 50 of the 72 live listings are an individual's name with their own mobile on the page. They are
// tenants of buildings BinaSmart manages; none of them asked to be a business listing. So the
// default is: reachable, but not published and not announced.
//
// WHAT COUNTS AS PROOF. Something the owner DID.
//
//   claimedAt   they completed a claim - a code sent to the shop's phone and typed back, or Ibrahim
//               approving their claim from ops. Written by owners.approve() and nowhere else.
//   tgChatId    they pressed the link in the Telegram bot, which binds the shop to their chat.
//
// WHAT DOES NOT COUNT, and used to.
//
//   ownerPhone  the schema calls it "the phone that may claim this shop". It is ops writing down who
//               is ALLOWED to claim - a pre-authorisation, not an act by the owner. Reading it as
//               consent meant that the moment ops noted a number, that person's mobile would be
//               published and their page would ask to be indexed, without them having done
//               anything. It is null on every shop today, so removing it changes nothing now and
//               removes a trap later.
//
// The bug this replaces: the claim flow wrote NEITHER field, so an owner could claim their page,
// pass the code, load their dashboard and enter a full menu, and stay noindex with their phone
// stripped out. Kaldi's Cafe did exactly that on 5 September 2026.
function isClaimed(shop) {
  return !!(shop && (shop.claimedAt || shop.tgChatId));
}

// Columns any caller of isClaimed must load. A projection that forgets one silently answers "no",
// which fails safe but hides a claimed shop - so the SQL callers select from this list.
const CLAIM_FIELDS = ['claimedAt', 'tgChatId'];

module.exports = { isClaimed, CLAIM_FIELDS };
