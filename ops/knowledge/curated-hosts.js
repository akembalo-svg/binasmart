#!/usr/bin/env node
'use strict';
// Prints the host -> pack table that knowledge/index.js enforces, so another session can see which hosts are
// already covered by a curated sector pack before it adds them to a crawl.
//   node ops/knowledge/curated-hosts.js [root]
// A host in this table is fetched whole by ops/packs/fetch-pack.js, with a header, a Source line and a fetch
// date. A crawled copy of the same host would be a second, truncated document competing with it in
// retrieval, so knowledge/index.js does not read knowledge/web/<dir> for these hosts and knowledge/crawl.js
// does not fetch them. Hosts listed with `fetch: "manual"` in a pack are deliberately NOT here: the pack
// holds only what a human carried in, and a crawl that reaches the host is new material.
const path = require('path');
const { curatedHosts } = require('../../knowledge/index');

const root = process.argv[2] || path.join(__dirname, '..', '..');
const rows = [...curatedHosts(root)].map(([host, o]) => ({ host, pack: o.pack, site: o.site }))
  .sort((a, b) => (a.pack + a.host).localeCompare(b.pack + b.host));

if (!rows.length) { console.log('no curated hosts found under ' + path.join(root, 'knowledge') + '/*/sources.json'); process.exit(0); }
const w = Math.max(4, ...rows.map(r => r.host.length));
const wp = Math.max(4, ...rows.map(r => r.pack.length));
console.log('host'.padEnd(w) + '  ' + 'pack'.padEnd(wp) + '  site');
console.log('-'.repeat(w) + '  ' + '-'.repeat(wp) + '  ' + '----');
for (const r of rows) console.log(r.host.padEnd(w) + '  ' + r.pack.padEnd(wp) + '  ' + r.site);
console.log('');
console.log(rows.length + ' curated hosts. These are not crawled into knowledge/web and a crawled copy of one is not indexed.');
