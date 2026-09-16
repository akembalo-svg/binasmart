'use strict';
// Which pages the travel fetcher will ask for, decided from bytes alone. A mistake here is either a booking
// page in the knowledge index or a whole section of the airline's site silently missing, and neither shows
// up as an error, so the rules are pinned here rather than discovered on the live site.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs } = require('../../ops/travel/fetch-airline');
const reg = require('../../knowledge/travel/sources.json');
const ET = reg.sites.find(s => s.id === 'ethiopian-airlines');

const SITEMAP = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.ethiopianairlines.com/et</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/information/baggage-information/free-baggage-allowance</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/home-page/save-10</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/book/booking/flight</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/book/check-in/online-check-in</loc></url>
</urlset>`;

const INDEX = `<?xml version="1.0" encoding="utf-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.ethiopianairlines.com/et/sitemap/sitemap.gz</loc></sitemap>
</sitemapindex>`;

test('sitemapUrls reads a urlset', () => {
  assert.equal(sitemapUrls(Buffer.from(SITEMAP)).urls.length, 5);
  assert.deepEqual(sitemapUrls(Buffer.from(SITEMAP)).indexes, []);
});

test('sitemapUrls reads a sitemap index as indexes, not as pages', () => {
  const r = sitemapUrls(Buffer.from(INDEX));
  assert.deepEqual(r.urls, []);
  assert.deepEqual(r.indexes, ['https://www.ethiopianairlines.com/et/sitemap/sitemap.gz']);
});

test('sitemapUrls gunzips a gzipped sitemap, because the airline serves sitemap.gz', () => {
  const r = sitemapUrls(zlib.gzipSync(Buffer.from(SITEMAP)));
  assert.equal(r.urls.length, 5);
});

test('sitemapUrls survives a byte-order mark and CDATA', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<urlset><url><loc><![CDATA[https://www.ethiopianairlines.com/et/services]]></loc></url></urlset>')]);
  assert.deepEqual(sitemapUrls(bom).urls, ['https://www.ethiopianairlines.com/et/services']);
});

test('pathOf returns the path with no query, no fragment and no trailing slash', () => {
  assert.equal(pathOf('https://www.ethiopianairlines.com/et/services/?x=1#a'), '/et/services');
  assert.equal(pathOf('https://www.ethiopianairlines.com/'), '/');
  assert.equal(pathOf('not a url'), null);
});

test('selectUrls keeps information pages and drops booking, promo and the site root', () => {
  const picked = selectUrls(ET, sitemapUrls(Buffer.from(SITEMAP)).urls);
  assert.deepEqual(picked.map(p => p.path), [
    '/et/book/check-in/online-check-in',
    '/et/information/baggage-information/free-baggage-allowance',
  ]);
});

test('selectUrls refuses another host, whatever the allowlist says', () => {
  const picked = selectUrls(ET, ['https://evil.example.com/et/information/baggage-information/x',
    'https://www.ethiopianairlines.com.evil.com/et/information/y']);
  assert.deepEqual(picked, []);
});

test('selectUrls drops duplicates, normalises to https and sorts by path so a run is reproducible', () => {
  const picked = selectUrls(ET, [
    'https://www.ethiopianairlines.com/et/services/on-board-services/allergy-policy',
    'http://www.ethiopianairlines.com/et/services/on-board-services/allergy-policy/',
    'https://www.ethiopianairlines.com/et/information/baggage-information/extra-baggage',
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0].path, '/et/information/baggage-information/extra-baggage');
  assert.equal(picked[0].url, 'https://www.ethiopianairlines.com/et/information/baggage-information/extra-baggage');
});

test('selectUrls stops at maxPages', () => {
  const many = [];
  for (let i = 0; i < 300; i++) many.push('https://www.ethiopianairlines.com/et/information/essential-information/p' + i);
  assert.equal(selectUrls({ ...ET, maxPages: 5 }, many).length, 5);
});

test('selectUrls tags each page with the section it belongs to', () => {
  const [bag] = selectUrls(ET, ['https://www.ethiopianairlines.com/et/information/baggage-information/restricted-items']);
  assert.equal(bag.section, 'baggage');
  assert.equal(bag.sectionTitleAm, 'ሻንጣ');
});

test('slugFor drops the locale and keeps the last two path segments', () => {
  assert.equal(slugFor('/et/information/baggage-information/free-baggage-allowance'), 'baggage-information-free-baggage-allowance');
  assert.equal(slugFor('/et/services/help-and-contact/frequently-asked-questions/shebamiles-faqs'), 'frequently-asked-questions-shebamiles-faqs');
  assert.equal(slugFor('/et/meet-and-greet-services-at-addis-ababa-airport'), 'meet-and-greet-services-at-addis-ababa-airport');
  assert.equal(slugFor('/et'), '');
});

test('assignSlugs lengthens a colliding slug instead of overwriting a file', () => {
  const out = assignSlugs([{ path: '/et/a/shared/name' }, { path: '/et/b/shared/name' }]);
  assert.deepEqual(out.map(p => p.slug).sort(), ['a-shared-name', 'b-shared-name']);
});

test('assignSlugs falls back to the whole path when even that collides', () => {
  const out = assignSlugs([{ path: '/et/x/a/shared/name' }, { path: '/et/y/a/shared/name' }]);
  assert.equal(new Set(out.map(p => p.slug)).size, 2);
  assert.ok(out.every(p => /^[a-z0-9-]+$/.test(p.slug)), 'slugs stay filename-safe');
});

test('assignSlugs does not depend on the order it was given', () => {
  const a = assignSlugs([{ path: '/et/a/shared/name' }, { path: '/et/b/shared/name' }]);
  const b = assignSlugs([{ path: '/et/b/shared/name' }, { path: '/et/a/shared/name' }]);
  assert.deepEqual(a.map(p => p.path + '=' + p.slug).sort(), b.map(p => p.path + '=' + p.slug).sort());
});
