#!/usr/bin/env node
'use strict';
// The weekly freshness check for the travel knowledge pack.
//
//   node --env-file=.env ops/travel/freshness.js             re-fetch, update, re-ingest, tell Ibrahim if something moved
//   node --env-file=.env ops/travel/freshness.js --dry-run   do all of it and write, ingest and send NOTHING
//
// Cron, Sunday 05:00 UTC — an hour after knowledge/crawl.js at 04:00, so the two are never fetching at once:
//   0 5 * * 0 cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/travel/freshness.js >> /var/log/bina-travel-freshness.log 2>&1
//
// The machinery moved to ops/packs/freshness.js when the banking pack needed the same weekly check. This file
// stays because the cron line above names it, and because a cron line is not a thing to edit casually.
const F = require('../packs/freshness.js');

module.exports = { ...F, run: opts => F.run({ packId: 'travel', ...(opts || {}) }) };

if (require.main === module) F.run({ packId: 'travel', dryRun: process.argv.includes('--dry-run') })
  .catch(e => { console.error('[travel-freshness] failed: ' + e.message); process.exit(1); });
