// The same rule as business/claimed.js, for the MCP server — a separate process, ESM, its own
// node_modules, so it cannot require the CommonJS one. test/business/claimed.test.js reads both
// files and fails if they stop naming the same fields.
//
// Has the owner of this shop asked to be published? Only something the owner DID counts:
//   claimedAt   they completed a claim with the code sent to the Telegram id on the shop record.
//               Written by business/owners.js approve(). An ops approval does not write it.
//   tgChatId    they pressed the link in the Telegram bot.
//
// ownerPhone does NOT count. The schema calls it "the phone that may claim this shop" — ops writing
// down who is ALLOWED to claim. It used to count here, which meant the moment ops noted a number,
// that person's mobile went out to every assistant on the internet without them doing anything.
export const isClaimed = r => !!(r && (r.claimedAt || r.tgChatId));

// Every column isClaimed reads. The SQL above must select all of them: a query that drops one makes
// this answer "no", which fails safe but silently unlists a shop whose owner did claim it.
export const CLAIM_COLUMNS = ['claimedAt', 'tgChatId'];
