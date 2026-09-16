#!/usr/bin/env node
'use strict';
// The Ethiopian Airlines knowledge pack. The machinery moved to ops/packs/fetch-pack.js when the banking pack
// was built on it; this file is the airline's binding of it, and stays because the cron line, the freshness
// job, the gold builder and eleven tests under test/travel/ name this path.
//
//   node ops/travel/fetch-airline.js                       fetch every site in the registry and write the pack
//   node ops/travel/fetch-airline.js --site ethiopian-airlines
//   node ops/travel/fetch-airline.js --dry-run             fetch, report, write nothing
//   node ops/travel/fetch-airline.js --limit 5 --dry-run   a five-page smoke test
// About 120 pages at 5 s apiece is roughly 14 minutes, so run it detached and poll the log.
const pack = require('../packs/fetch-pack.js').forPack('travel');

module.exports = pack;

if (require.main === module) pack.main().catch(e => { console.error('[travel] failed: ' + e.message); process.exit(1); });
