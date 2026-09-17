'use strict';
// The no-duplicate rule, enforced by the index itself: a knowledge/web directory whose host is already
// owned by a curated sector pack is not loaded, so the crawler cannot split retrieval between a whole
// curated document and a truncated crawled copy of the same page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readSources, curatedHosts, curatedSkip, normaliseHost } = require('../knowledge/index');

const REPO = path.join(__dirname, '..');
const CLI = path.join(REPO, 'ops', 'knowledge', 'curated-hosts.js');

function page(url, name) {
  return '---\nurl: "' + url + '"\ntitle: "' + name + ' page"\nsource_name: "' + name + '"\nlang: en\n---\n'
    + (name + ' publishes this notice about fees, opening hours and where to file the form. ').repeat(12) + '\n';
}

function fakeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curated-'));
  const k = p => { const d = path.join(root, 'knowledge', p); fs.mkdirSync(d, { recursive: true }); return d; };

  // pack A owns nbe.gov.et by host, and says nothing about the host it only has by hand
  fs.writeFileSync(path.join(k('banking'), 'sources.json'), JSON.stringify({ pack: { id: 'banking' }, sites: [
    { id: 'nbe', fetch: 'dir', host: 'nbe.gov.et', dir: 'nbe.gov.et' },
    { id: 'awash', fetch: 'manual', host: 'awashbank.com' },
  ] }));
  // pack B owns www.poessa.gov.et (registry says www., the crawl says bare) and one host via its sitemaps
  fs.writeFileSync(path.join(k('business'), 'sources.json'), JSON.stringify({ pack: { id: 'business' }, sites: [
    { id: 'poessa', fetch: 'dir', host: 'www.poessa.gov.et', dir: 'www.poessa.gov.et' },
    { id: 'eccsa', fetch: 'sitemap', host: 'ethiopianchamber.com', sitemaps: ['https://ethiopianchamber.com/sitemap_index.xml'] },
  ] }));

  // three crawled directories: dir name never equals the host
  fs.mkdirSync(path.join(root, 'knowledge', 'web', 'nbe'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'web', 'nbe', 'aaaa.md'), page('https://nbe.gov.et/directives', 'National Bank'));
  fs.mkdirSync(path.join(root, 'knowledge', 'web', 'poessa'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'web', 'poessa', 'bbbb.md'), page('https://poessa.gov.et/services', 'POESSA'));
  fs.mkdirSync(path.join(root, 'knowledge', 'web', 'moh'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'web', 'moh', 'cccc.md'), page('https://www.moh.gov.et/news', 'Ministry of Health'));

  // the crawl registry maps id -> url for nbe only; poessa and moh must be resolved from front matter
  fs.writeFileSync(path.join(root, 'knowledge', 'sources-am.json'), JSON.stringify({ sources: [
    { id: 'nbe', crawl: true, url: 'https://www.nbe.gov.et/' },
  ] }));
  return root;
}

function withoutEnv(fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'KNOWLEDGE_WEB_KEEP_CURATED');
  const old = process.env.KNOWLEDGE_WEB_KEEP_CURATED;
  delete process.env.KNOWLEDGE_WEB_KEEP_CURATED;
  try { return fn(); } finally { if (had) process.env.KNOWLEDGE_WEB_KEEP_CURATED = old; }
}

test('a crawled directory whose host a pack owns is not loaded', () => {
  const root = fakeRoot();
  const lines = [];
  const log = console.log; console.log = m => lines.push(String(m));
  let docs;
  try { docs = withoutEnv(() => readSources(root, ['web'])); } finally { console.log = log; }

  assert.deepStrictEqual(docs.map(d => d.slug), ['moh/cccc']);
  assert.ok(lines.includes('[knowledge] web: skipped nbe (nbe.gov.et) — curated by banking'), lines.join('\n'));
  assert.ok(lines.includes('[knowledge] web: skipped poessa (poessa.gov.et) — curated by business'), lines.join('\n'));
  assert.deepStrictEqual(Object.keys(readSources.lastHygiene.curated).sort(), ['nbe', 'poessa']);
});

test('the escape hatch loads the duplicates again, for measurement', () => {
  const root = fakeRoot();
  const had = Object.prototype.hasOwnProperty.call(process.env, 'KNOWLEDGE_WEB_KEEP_CURATED');
  const old = process.env.KNOWLEDGE_WEB_KEEP_CURATED;
  process.env.KNOWLEDGE_WEB_KEEP_CURATED = '1';
  try {
    const docs = readSources(root, ['web']);
    assert.deepStrictEqual(docs.map(d => d.slug).sort(), ['moh/cccc', 'nbe/aaaa', 'poessa/bbbb']);
  } finally { if (had) process.env.KNOWLEDGE_WEB_KEEP_CURATED = old; else delete process.env.KNOWLEDGE_WEB_KEEP_CURATED; }
});

test('a manual site does not claim its host', () => {
  const hosts = curatedHosts(fakeRoot());
  assert.strictEqual(hosts.get('nbe.gov.et').pack, 'banking');
  assert.strictEqual(hosts.get('poessa.gov.et').pack, 'business');
  assert.strictEqual(hosts.get('ethiopianchamber.com').pack, 'business');
  assert.strictEqual(hosts.has('awashbank.com'), false);   // fetch: manual — the crawl may still cover it
});

test('the crawler asks the same question before it fetches', () => {
  const hosts = curatedHosts(fakeRoot());
  assert.deepStrictEqual(curatedSkip(hosts, 'https://www.nbe.gov.et/am/'), { host: 'nbe.gov.et', pack: 'banking', site: 'nbe' });
  assert.strictEqual(curatedSkip(hosts, 'https://www.moh.gov.et/'), null);
  assert.strictEqual(curatedSkip(hosts, 'https://awashbank.com/'), null);
  assert.strictEqual(normaliseHost('https://WWW.Poessa.GOV.et:443/x'), 'poessa.gov.et');
});

test('the CLI prints the host to pack table', () => {
  const out = execFileSync(process.execPath, [CLI, fakeRoot()], { encoding: 'utf8' });
  assert.match(out, /^host\s+pack\s+site$/m);
  assert.match(out, /nbe\.gov\.et\s+banking\s+nbe/);
  assert.match(out, /poessa\.gov\.et\s+business\s+poessa/);
  assert.ok(!/awashbank\.com/.test(out), out);
});
