'use strict';
// One source or the other, never both. A host curated into knowledge/business must not also be crawled into
// knowledge/web, because the crawled copy is gitignored, truncated at 20,000 characters and undated per
// section, and two copies of one page in the index is the duplication the whole pack exists to avoid.
//
// knowledge/sources-am.json is gitignored, so this test is written to pass whether or not the file is on the
// machine running it: if the crawler registry is absent, the directory half is still checked.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'business', 'sources.json'), 'utf8'));
const CURATED_HOSTS = reg.sites.filter(s => s.fetch !== 'manual').map(s => s.host.replace(/^www\./, ''));

test('no host this pack curates is still a crawl target in knowledge/sources-am.json', () => {
  const f = path.join(ROOT, 'knowledge', 'sources-am.json');
  if (!fs.existsSync(f)) return; // gitignored; nothing to check on a fresh clone
  const am = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const s of am.sources || []) {
    if (!s.crawl) continue;
    const host = String(s.url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    assert.equal(CURATED_HOSTS.includes(host), false,
      'sources-am.json still crawls ' + host + ' (id ' + s.id + '), which knowledge/business curates');
  }
});

test('no host this pack curates still has a knowledge/web directory', () => {
  const wdir = path.join(ROOT, 'knowledge', 'web');
  if (!fs.existsSync(wdir)) return;
  // knowledge/web directories are named by the sources-am id, not by the host, so the ids are named here.
  // motl is on this list only if Task 1 actually took it as a curated site; it did not, so motl stays a
  // crawl target and keeps its knowledge/web directory. The edit script of Step 3 filters the same way.
  const curatedIds = new Set(reg.sites.filter(s => s.fetch !== 'manual').map(s => s.id));
  const ids = ['motri', 'mols', 'eic', 'motl'].filter(id => curatedIds.has(id));
  for (const id of ids) {
    const d = path.join(wdir, id);
    if (!fs.existsSync(d)) continue;
    const n = fs.readdirSync(d).filter(f => f.endsWith('.md')).length;
    assert.equal(n, 0, 'knowledge/web/' + id + ' still holds ' + n + ' crawled pages; delete the directory');
  }
});

test('the registry records the removal so the next engineer can check the server against it', () => {
  const r = reg.references.find(x => x.id === 'web-crawl');
  assert.ok(r, 'references.web-crawl is the durable record of a change to a gitignored file');
  assert.match(r.note, /sources-am\.json/);
  assert.match(r.note, /DELETES|deletes|delete/);
  assert.match(r.note, /20,000|20000/);
});
