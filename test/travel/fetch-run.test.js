'use strict';
// The fetching loop, with an injected network and an injected clock: the pacing, the retry, the refusal to
// leave the host, and the one level of link discovery that is the only reason ShebaMiles, Ethiopian Holidays
// and the Skylight hotel are in the pack at all - the airline's sitemap does not list them.
const test = require('node:test');
const assert = require('node:assert');
const { makeFetcher, linksOn, fetchSite } = require('../../ops/travel/fetch-airline');

const html = (title, body) => '<!DOCTYPE html><html><head><title>' + title + ' | Ethiopian Airlines | ET</title></head><body>' +
  '<h1>' + title + '</h1><p>' + body + '</p><p>' + 'padding sentence to clear the four hundred character floor. '.repeat(12) + '</p></body></html>';

function net(map) {
  const asked = [];
  return { asked, impl: async url => {
    asked.push(String(url));
    const v = map[String(url)];
    if (v === undefined) return { status: 404, ok: false, headers: { get: () => 'text/html' }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    if (typeof v === 'number') return { status: v, ok: false, headers: { get: () => 'text/html' }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    return { status: 200, ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => v, arrayBuffer: async () => Buffer.from(v) };
  } };
}

test('makeFetcher waits the crawl delay between requests and not before the first', async () => {
  const slept = [];
  const n = net({ 'https://h/a': html('A', 'a'), 'https://h/b': html('B', 'b') });
  const get = makeFetcher({ fetchImpl: n.impl, sleep: async ms => slept.push(ms), delayMs: 5000 });
  await get('https://h/a');
  await get('https://h/b');
  assert.deepEqual(slept, [5000]);
});

test('makeFetcher retries once on a 5xx and gives up cleanly', async () => {
  const slept = [];
  const n = net({ 'https://h/a': 503 });
  const get = makeFetcher({ fetchImpl: n.impl, sleep: async ms => slept.push(ms), delayMs: 5000 });
  const r = await get('https://h/a');
  assert.equal(r.ok, false);
  assert.equal(r.why, 'http_503');
  assert.equal(n.asked.filter(u => u === 'https://h/a').length, 2, 'one retry, not a loop');
});

test('makeFetcher does not retry a 404', async () => {
  const n = net({});
  const get = makeFetcher({ fetchImpl: n.impl, sleep: async () => {}, delayMs: 0 });
  const r = await get('https://h/missing');
  assert.equal(r.why, 'http_404');
  assert.equal(n.asked.length, 1);
});

test('makeFetcher refuses a response that is not HTML', async () => {
  const get = makeFetcher({ delayMs: 0, sleep: async () => {},
    fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'application/pdf' }, text: async () => 'x', arrayBuffer: async () => Buffer.from('x') }) });
  assert.equal((await get('https://h/a.html')).why, 'not_html');
});

test('linksOn returns absolute same-host links only', () => {
  const body = '<a href="/et/explore/et-specials/et-holidays">Holidays</a>' +
    '<a href="https://shebamiles.ethiopianairlines.com/enrollment">Join</a>' +
    '<a href="https://www.ethiopianairlines.com/et/services/add-on-services/on-board-wifi#x">Wifi</a>' +
    '<a href="mailto:x@y.z">Mail</a>';
  const out = linksOn(body, 'https://www.ethiopianairlines.com/et/information/baggage-information/x');
  assert.deepEqual(out.sort(), [
    'https://www.ethiopianairlines.com/et/explore/et-specials/et-holidays',
    'https://www.ethiopianairlines.com/et/services/add-on-services/on-board-wifi',
  ]);
});

test('fetchSite fetches the sitemap, follows the index it points at, and keeps only allowlisted pages', async () => {
  const H = 'https://www.ethiopianairlines.com';
  const n = net({
    [H + '/et/sitemap/sitemap-index.xml']: '<sitemapindex><sitemap><loc>' + H + '/et/sitemap/sitemap.xml</loc></sitemap></sitemapindex>',
    [H + '/et/sitemap/sitemap.xml']: '<urlset>' +
      '<url><loc>' + H + '/et/information/baggage-information/free-baggage-allowance</loc></url>' +
      '<url><loc>' + H + '/et/home-page/save-10</loc></url></urlset>',
    [H + '/et/information/baggage-information/free-baggage-allowance']: html('Free Baggage Allowance', 'Maximum weight 23 kg.'),
  });
  const site = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', host: 'www.ethiopianairlines.com',
    fetch: 'sitemap', sitemap: H + '/et/sitemap/sitemap-index.xml', discoverLinks: false, maxPages: 50, crawlDelaySeconds: 5,
    lang: 'en', allow: ['^/et/information(/|$)'], deny: ['^/et/home-page(/|$)'], sections: [{ key: 'baggage', titleAm: 'ሻንጣ', match: '^/et/information/baggage-information/' }] };
  const r = await fetchSite(site, { fetchImpl: n.impl, sleep: async () => {} });
  assert.deepEqual(r.pages.map(p => p.slug), ['baggage-information-free-baggage-allowance']);
  assert.equal(r.failed.length, 0);
  assert.ok(!n.asked.includes(H + '/et/home-page/save-10'), 'a denied page was requested anyway');
});

test('fetchSite finds the pages the sitemap forgot, one level deep and no further', async () => {
  const H = 'https://www.ethiopianairlines.com';
  const n = net({
    [H + '/et/sitemap/sitemap.xml']: '<urlset><url><loc>' + H + '/et/information/baggage-information/a</loc></url></urlset>',
    [H + '/et/information/baggage-information/a']: html('A', 'text <a href="/et/explore/et-specials/et-holidays">Holidays</a>'),
    [H + '/et/explore/et-specials/et-holidays']: html('Ethiopian Holidays', 'packages <a href="/et/information/baggage-information/deep">Deeper</a>'),
    [H + '/et/information/baggage-information/deep']: html('Deep', 'should never be fetched'),
  });
  const site = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', host: 'www.ethiopianairlines.com',
    fetch: 'sitemap', sitemap: H + '/et/sitemap/sitemap.xml', discoverLinks: true, maxPages: 50, crawlDelaySeconds: 5,
    lang: 'en', allow: ['^/et/information(/|$)', '^/et/explore/et-specials(/|$)'], deny: [], sections: [] };
  const r = await fetchSite(site, { fetchImpl: n.impl, sleep: async () => {} });
  assert.deepEqual(r.pages.map(p => p.slug).sort(), ['baggage-information-a', 'et-specials-et-holidays']);
  assert.ok(!n.asked.includes(H + '/et/information/baggage-information/deep'), 'discovery went two levels deep');
});

test('fetchSite records why a page produced no document instead of losing it', async () => {
  const H = 'https://www.ethiopianairlines.com';
  const n = net({
    [H + '/et/sitemap/sitemap.xml']: '<urlset>' +
      '<url><loc>' + H + '/et/information/a</loc></url>' +
      '<url><loc>' + H + '/et/information/b</loc></url></urlset>',
    [H + '/et/information/a']: html('Page Not Found', 'nothing here at all but plenty of words'),
    [H + '/et/information/b']: 500,
  });
  const site = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', host: 'www.ethiopianairlines.com',
    fetch: 'sitemap', sitemap: H + '/et/sitemap/sitemap.xml', discoverLinks: false, maxPages: 50, crawlDelaySeconds: 5,
    lang: 'en', allow: ['^/et/information(/|$)'], deny: [], sections: [] };
  const r = await fetchSite(site, { fetchImpl: n.impl, sleep: async () => {} });
  assert.equal(r.pages.length, 0);
  assert.deepEqual(r.failed.map(f => f.why).sort(), ['http_500', 'soft_404']);
});
