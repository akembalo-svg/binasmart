'use strict';
// knowledge/banking/sources.json drives ops/packs/fetch-pack.js --pack banking. An entry that is wrong here
// becomes a page fetched that should not have been, or a whole bank silently missing from the pack. So the
// shape is pinned, and so are the rules this sector adds to the travel pack's rules:
//   - account, login, transaction and application-form pages are never fetched (this pack informs, it does
//     not bank);
//   - a source we cannot reach from this server is listed as manual with a measured reason, never dropped;
//   - a host that is measurably NOT the bank (awashbank.com serves someone else's blocked.html today) is
//     listed with an explicit do-not-fetch flag so nobody "fixes" it later by turning fetching on;
//   - every source already in the repo is listed under references, so the pack never duplicates it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'knowledge', 'banking', 'sources.json');
const reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const fetched = reg.sites.filter(s => s.fetch !== 'manual');
const manual = reg.sites.filter(s => s.fetch === 'manual');

test('the registry has a version, a note, a pack block and a list of sites', () => {
  assert.equal(typeof reg.version, 'number');
  assert.ok(reg._about.length > 200, 'the note has to say what the file is for');
  assert.ok(Array.isArray(reg.sites) && reg.sites.length >= 10);
  assert.equal(reg.pack.id, 'banking');
  assert.equal(typeof reg.pack.generatedBy, 'string');
  assert.equal(typeof reg.pack.logPrefix, 'string');
});

test('every site has an id, a name, an Amharic name, a host, a reach and the date it was checked', () => {
  const ids = new Set();
  for (const s of reg.sites) {
    assert.ok(s.id && !ids.has(s.id), 'duplicate or missing id: ' + s.id);
    ids.add(s.id);
    assert.ok(s.name && s.nameAm, s.id + ' needs a name and nameAm');
    assert.ok(/^[a-z0-9.-]+$/.test(s.host), s.id + ' host looks wrong: ' + s.host);
    assert.ok(['up', 'unreachable from this server', 'blocked', 'not this bank'].includes(s.reach), s.id + ' reach: ' + s.reach);
    assert.equal(s.checked, '2026-09-16');
    assert.ok(Number(s.crawlDelaySeconds) >= 5, s.id + ' must pace at 5 s or more');
  }
});

test('a fetched site names how it is fetched and where its pages come from', () => {
  assert.ok(fetched.length >= 5, 'this pack fetches at least five sites');
  for (const s of fetched) {
    assert.ok(['sitemap', 'urls'].includes(s.fetch), s.id + ' fetch: ' + s.fetch);
    if (s.fetch === 'sitemap') {
      const list = [].concat(s.sitemaps || s.sitemap || []);
      assert.ok(list.length >= 1, s.id + ' needs a sitemap or sitemaps');
      for (const u of list) assert.ok(u.startsWith('https://' + s.host + '/'), s.id + ' sitemap is off-host: ' + u);
    } else {
      assert.ok(Array.isArray(s.urls) && s.urls.length >= 1, s.id + ' fetch: urls needs urls');
      for (const u of s.urls) assert.ok(u.startsWith('https://' + s.host + '/'), s.id + ' url is off-host: ' + u);
    }
    assert.ok(Array.isArray(s.allow) && s.allow.length, s.id + ' needs an allow list');
    assert.ok(Array.isArray(s.deny) && s.deny.length, s.id + ' needs a deny list');
    assert.ok(Array.isArray(s.sections) && s.sections.length, s.id + ' needs sections');
    assert.ok(Number(s.maxPages) > 0, s.id + ' needs maxPages');
    for (const p of [...s.allow, ...s.deny]) assert.doesNotThrow(() => new RegExp(p), s.id + ' bad regex: ' + p);
    for (const sec of s.sections) {
      assert.ok(sec.key && sec.titleAm && sec.match, s.id + ' section needs key, titleAm, match');
      assert.ok(/[ሀ-፿]/.test(sec.titleAm), s.id + '/' + sec.key + ' titleAm must be Amharic');
      assert.doesNotThrow(() => new RegExp(sec.match));
    }
  }
});

test('this pack informs: no account, login, transaction or application-form path is ever allowed', () => {
  const forbidden = ['/login', '/signin', '/sign-in', '/register', '/account/open', '/onlinebanking',
    '/apply', '/application-form', '/transfer', '/payment', '/checkout', '/my-account'];
  for (const s of fetched) {
    const probes = forbidden.concat(s.probePaths || []);
    const allow = s.allow.map(p => new RegExp(p)), deny = s.deny.map(p => new RegExp(p));
    for (const p of probes) {
      const allowed = allow.some(r => r.test(p)) && !deny.some(r => r.test(p));
      assert.equal(allowed, false, s.id + ' would fetch an account/transaction path: ' + p);
    }
  }
});

test('the daily exchange-rate post stream is dropped up front, on every site that has one', () => {
  const churn = { coopbank: ['/exchange_rate/2026-09-15', '/exchange_rate-sitemap3.xml'],
    zemen: ['/media-and-news/gallery', '/press-releases/some-release'],
    dashen: ['/press-releases', '/photo-gallery'] };
  for (const [id, paths] of Object.entries(churn)) {
    const s = reg.sites.find(x => x.id === id);
    assert.ok(s, 'missing site ' + id);
    const allow = s.allow.map(p => new RegExp(p)), deny = s.deny.map(p => new RegExp(p));
    for (const p of paths) assert.equal(allow.some(r => r.test(p)) && !deny.some(r => r.test(p)), false, id + ' would fetch churn: ' + p);
  }
});

test('every manual site says, in its own words, what was measured and what it costs us', () => {
  assert.ok(manual.length >= 7, 'at least seven sources are out of reach today');
  for (const s of manual) {
    assert.ok(String(s.why || '').length > 120, s.id + ' needs a measured reason, not a shrug');
    assert.ok(/2026-09-16/.test(s.why), s.id + ' reason must name the day it was measured');
    assert.ok(String(s.costsUs || '').length > 20, s.id + ' must say what the pack cannot answer without it');
  }
  for (const id of ['nbe', 'ethiotelecom', 'safaricom', 'awash', 'abyssinia', 'edif', 'fis'])
    assert.ok(manual.some(s => s.id === id), 'missing manual entry: ' + id);
});

test('a host that is not the bank is flagged so nobody turns fetching on later', () => {
  const awash = reg.sites.find(s => s.id === 'awash');
  assert.equal(awash.reach, 'not this bank');
  assert.equal(awash.doNotFetch, true);
  assert.match(awash.why, /technobros\.au/);
});

test('Zemen has an Amharic locale and an explicit slug for every Amharic page it fetches', () => {
  const z = reg.sites.find(s => s.id === 'zemen');
  assert.equal(z.hasAmharic, true);
  assert.ok(z.allow.some(p => /\^\\\/am\\?\//.test(p) || p.includes('/am/')), 'zemen must allow /am/');
  assert.ok(z.pathSlugs && Object.keys(z.pathSlugs).length >= 2, 'zemen needs a pathSlugs table');
  for (const [p, slug] of Object.entries(z.pathSlugs)) {
    assert.ok(p.startsWith('/'), 'pathSlugs key must be a path: ' + p);
    assert.match(slug, /^[a-z0-9-]{3,60}$/, 'pathSlugs value must be a readable ascii slug: ' + slug);
  }
  const slugs = Object.values(z.pathSlugs);
  assert.equal(new Set(slugs).size, slugs.length, 'two Amharic pages cannot share a slug');
});

test('references name what the repo already holds, so the pack never fetches it twice', () => {
  assert.ok(Array.isArray(reg.references) && reg.references.length >= 5);
  const ids = reg.references.map(r => r.id);
  for (const id of ['web-nbe', 'web-ethiotelecom', 'eservices-cbe', 'law-tax', 'bina-guides'])
    assert.ok(ids.includes(id), 'missing reference: ' + id);
  for (const r of reg.references) {
    assert.equal(r.fetch, 'none');
    assert.ok(String(r.note || '').length > 60, r.id + ' needs a note saying where it lives and why it is not re-fetched');
  }
});

test('the pack block carries the dated honesty line every document will show', () => {
  assert.ok(/[ሀ-፿]/.test(reg.pack.disclaimerAm), 'the Amharic disclaimer must be Amharic');
  assert.match(reg.pack.disclaimerEn, /change/i);
  assert.match(reg.pack.disclaimerEn, /confirm/i);
});
