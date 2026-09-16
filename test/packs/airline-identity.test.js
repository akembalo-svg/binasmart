'use strict';
// The airline pack must not move. ops/packs/fetch-pack.js was split out of ops/travel/fetch-airline.js so the
// banking pack could reuse it; the price of getting that wrong is every airline document re-rendered, re-chunked and
// re-embedded, and a travel benchmark that moves for a reason that has nothing to do with the airline.
// So: the renderer, the header and the title cleaner are held to exactly what they produced before the split.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'airline-render.json'), 'utf8'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'travel', 'sources.json'), 'utf8'));
const site = reg.sites.find(s => s.id === fx.site);

// Through the shim, which is the path every existing travel test and the cron line still use.
const airline = require(path.join(ROOT, 'ops', 'travel', 'fetch-airline.js'));

test('the shim still exports everything the travel tests and the cron use', () => {
  for (const k of ['sitemapUrls', 'pathOf', 'selectUrls', 'slugFor', 'assignSlugs', 'cleanTitle', 'extract',
    'stripPackBoilerplate', 'splitThin', 'contentHash', 'frontMatter', 'readMeta', 'bodyOf', 'header',
    'pageHeadings', 'PACK_FORMAT', 'renderDoc', 'touchLastChecked', 'clearMissed', 'writePack', 'makeFetcher',
    'linksOn', 'fetchSite', 'main', 'UA', 'REGISTRY', 'OUT_DIR', 'ROOT', 'MIN_CHARS', 'MASS_LOSS_FLOOR'])
    assert.ok(airline[k] !== undefined, 'the shim lost export: ' + k);
});

test('the shim still points at the travel registry and the travel directory', () => {
  assert.equal(airline.REGISTRY, path.join(ROOT, 'knowledge', 'travel', 'sources.json'));
  assert.equal(airline.OUT_DIR, path.join(ROOT, 'knowledge', 'travel'));
});

test('renderDoc produces the same bytes it produced before the split', () => {
  const out = airline.renderDoc(fx.page, site, fx.opts);
  assert.equal(out, fx.expected);
});

test('and those bytes are still what is on disk', () => {
  const disk = fs.readFileSync(path.join(ROOT, 'knowledge', 'travel', fx.page.slug + '.md'), 'utf8');
  assert.equal(fx.expected, disk);
});

test('the header is unchanged, Amharic sentence included', () => {
  assert.equal(airline.header(fx.page, site, fx.opts.today), fx.headerOnly);
  assert.match(fx.headerOnly, /[ሀ-፿]/);
});

test('the title cleaner still strips the airline suffix', () => {
  assert.equal(airline.cleanTitle('Free Baggage Allowance | Ethiopian Airlines'), fx.title);
  assert.equal(airline.cleanTitle('Free Baggage Allowance | Ethiopian Airlines | AM'), fx.title);
});

test('the front matter still says the airline fetcher generated it', () => {
  assert.match(fx.expected, /generated_by: "ops\/travel\/fetch-airline\.js"/);
  assert.match(fx.expected, /packFormat: "2"/);
});
