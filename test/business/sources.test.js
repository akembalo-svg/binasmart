'use strict';
// knowledge/business/sources.json drives ops/packs/fetch-pack.js --pack business. An entry that is wrong here
// becomes a page fetched that should not have been, or a whole ministry silently missing from the pack. The
// shape is pinned, and so are the four rules this sector adds:
//   - this pack INFORMS. No page that files, submits, logs in, pays or applies is ever fetched, because Bini
//     must never look like a way to register a business;
//   - a source we cannot reach is listed as manual with a MEASURED reason and with what its absence costs,
//     never deleted;
//   - a publisher who says no to AI crawlers in robots.txt gets doNotFetch: true with the file quoted, so
//     nobody turns it on later by "fixing" an empty fetch;
//   - every source already in the repository is listed under references, so the pack never duplicates it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'knowledge', 'business', 'sources.json');
const reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const fetched = reg.sites.filter(s => s.fetch !== 'manual');
const manual = reg.sites.filter(s => s.fetch === 'manual');

test('the registry has a version, a note, a pack block and a list of sites', () => {
  assert.equal(typeof reg.version, 'number');
  assert.ok(reg._about.length > 200, 'the note has to say what the file is for');
  assert.ok(Array.isArray(reg.sites) && reg.sites.length >= 10);
  assert.equal(reg.pack.id, 'business');
  assert.equal(reg.pack.generatedBy, 'ops/packs/fetch-pack.js --pack business');
  assert.equal(reg.pack.logPrefix, 'business');
  assert.equal(reg.pack.amHeaders, true, 'the Amharic key-fact header is the whole cross-lingual lever');
});

test('every site has an id, a name, an Amharic name, a host, a reach and the date it was checked', () => {
  const ids = new Set();
  for (const s of reg.sites) {
    assert.ok(s.id && !ids.has(s.id), 'duplicate or missing id: ' + s.id);
    ids.add(s.id);
    assert.ok(s.name && s.nameAm, s.id + ' needs a name and nameAm');
    assert.ok(/[ሀ-፿]/.test(s.nameAm), s.id + ' nameAm must be Amharic');
    assert.ok(/^[a-z0-9.-]+$/.test(s.host), s.id + ' host looks wrong: ' + s.host);
    assert.ok(['up', 'up but client-rendered', 'unreachable from this server and from the laptop',
      'robots forbids AI crawlers', 'retired'].includes(s.reach), s.id + ' reach: ' + s.reach);
    assert.equal(s.checked, '2026-09-17');
    assert.ok(Number(s.crawlDelaySeconds) >= 5, s.id + ' must pace at 5 s or more');
  }
});

test('a fetched site names how it is fetched and where its pages come from', () => {
  assert.ok(fetched.length >= 5, 'this pack fetches at least five sites');
  for (const s of fetched) {
    assert.ok(['sitemap', 'urls', 'dir'].includes(s.fetch), s.id + ' fetch: ' + s.fetch);
    if (s.fetch === 'sitemap') {
      const list = [].concat(s.sitemaps || s.sitemap || []);
      assert.ok(list.length >= 1, s.id + ' needs a sitemap or sitemaps');
      for (const u of list) assert.ok(u.startsWith('https://' + s.host + '/'), s.id + ' sitemap is off-host: ' + u);
    } else if (s.fetch === 'urls') {
      assert.ok(Array.isArray(s.urls) && s.urls.length >= 1, s.id + ' fetch: urls needs urls');
      for (const u of s.urls) assert.ok(u.startsWith('https://' + s.host + '/'), s.id + ' url is off-host: ' + u);
      // Three hosts here publish no sitemap AND time out on guessed deep paths. Link discovery is the only way in.
      assert.equal(s.discoverLinks, true, s.id + ' fetches by urls and must discover links from them');
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

test('this pack informs: no path that files, submits, logs in, pays or applies is ever allowed', () => {
  const forbidden = ['/login', '/signin', '/sign-in', '/register-account', '/my-account', '/dashboard',
    '/apply', '/application-form', '/submit', '/payment', '/checkout', '/e-payment',
    '/declaration/new', '/renew/start', '/user/login', '/wp-login.php', '/wp-admin/'];
  for (const s of fetched) {
    const probes = forbidden.concat(s.probePaths || []);
    const allow = s.allow.map(p => new RegExp(p)), deny = s.deny.map(p => new RegExp(p));
    for (const p of probes) {
      const allowed = allow.some(r => r.test(p)) && !deny.some(r => r.test(p));
      assert.equal(allowed, false, s.id + ' would fetch a transactional path: ' + p);
    }
  }
});

test('the news and jobs streams are dropped up front, on every site that has one', () => {
  const churn = {
    eic: ['/news/some-story', '/2026/09/17/press-release', '/author/admin'],
    aaccsa: ['/jobs/accountant-wanted', '/jobs_category/finance', '/category/news'],
    eccsa: ['/portfolio/member-of-the-month', '/2026/09/16/magazine'],
    mols: ['/job-openings/', '/news/'],
  };
  for (const [id, paths] of Object.entries(churn)) {
    const s = reg.sites.find(x => x.id === id);
    assert.ok(s, 'missing site ' + id);
    const allow = s.allow.map(p => new RegExp(p)), deny = s.deny.map(p => new RegExp(p));
    for (const p of paths) assert.equal(allow.some(r => r.test(p)) && !deny.some(r => r.test(p)), false, id + ' would fetch churn: ' + p);
  }
});

test('every manual site says, in its own words, what was measured and what it costs us', () => {
  assert.ok(manual.length >= 5, 'at least five sources are out of reach today');
  for (const s of manual) {
    assert.ok(String(s.why || '').length > 120, s.id + ' needs a measured reason, not a shrug');
    assert.ok(/2026-09-17/.test(s.why), s.id + ' reason must name the day it was measured');
    assert.ok(String(s.costsUs || '').length > 20, s.id + ' must say what the pack cannot answer without it');
  }
  for (const id of ['etrade', 'ecc', 'eipo', 'mor', 'moj'])
    assert.ok(manual.some(s => s.id === id), 'missing manual entry: ' + id);
});

test('etrade is recorded as reachable-but-client-rendered, and the laptop route is recorded as no help', () => {
  const e = reg.sites.find(s => s.id === 'etrade');
  assert.equal(e.fetch, 'manual');
  assert.equal(e.reach, 'up but client-rendered');
  assert.match(e.why, /200/);
  assert.match(e.why, /thin|zero characters/i);
  assert.match(e.why, /laptop/i, 'the fact that a laptop harvest does NOT fix this is the point');
  assert.ok(e.needsRenderedCapture === true, 'say what it would take, so nobody retries the plain fetch');
});

test('a publisher who says no to AI crawlers is honoured, and the file is quoted', () => {
  const e = reg.sites.find(s => s.id === 'efda');
  assert.equal(e.doNotFetch, true);
  assert.equal(e.reach, 'robots forbids AI crawlers');
  assert.match(e.why, /ClaudeBot/);
});

test('hosts that do not resolve are recorded so nobody chases them', () => {
  assert.ok(Array.isArray(reg.deadHosts) && reg.deadHosts.length >= 8);
  for (const d of reg.deadHosts) {
    assert.ok(d.host && d.what && d.checked === '2026-09-17', 'bad deadHosts entry: ' + JSON.stringify(d));
  }
  const hosts = reg.deadHosts.map(d => d.host);
  for (const h of ['eic.gov.et', 'possa.gov.et', 'esa.gov.et', 'daro.gov.et', 'addisababa.gov.et', 'chamber.org.et'])
    assert.ok(hosts.includes(h), 'missing dead host: ' + h);
});

test('references name what the repo already holds, so the pack never fetches it twice', () => {
  assert.ok(Array.isArray(reg.references) && reg.references.length >= 6);
  const ids = reg.references.map(r => r.id);
  for (const id of ['eservices-offices', 'law-tax-and-labour', 'mor-library', 'web-crawl', 'bina-guides', 'fayda'])
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

test('at least one fetched site is genuinely Amharic, or the Amharic slice cannot be built', () => {
  const am = fetched.filter(s => s.hasAmharic === true);
  assert.ok(am.length >= 2, 'measured: motri 43% Ethiopic and poessa 62% Ethiopic; both must be flagged');
  for (const s of am) assert.ok(String(s.langNote || '').length > 80, s.id + ' must say what was measured');
});
