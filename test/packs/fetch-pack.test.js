'use strict';
// ops/packs/fetch-pack.js is the airline fetcher with the pack taken out of it. These are the three things
// the banking registry needs that the airline registry never did:
//   sitemaps   Coop Bank keeps its products and its FAQs in two separate sitemaps, and its index also lists
//              seven sitemaps of daily exchange-rate posts we refuse to download at all.
//   pathSlugs  Zemen's Amharic URLs are percent-encoded Ethiopic. The ordinary slug rule turns
//              /am/%e1%8b%a8%e1%89%a3%e1%8a%95%e1%8a%ad-... into 200 characters of hex, which is unreadable
//              in a gold set, in a Telegram note and in a git diff. So those paths are named by hand, and a
//              path that needs a name and does not have one stops the run rather than writing the hex.
//   titleSuffix  every site brands its <title> differently: " - Zemen Bank", " | Dashen Bank",
//              " – Ethiopian Capital Market Authority (ECMA) | Official". This used to be one hard-coded
//              regex for the airline; it is now the site's own business.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

test('forPack binds a pack to its registry and its output directory', () => {
  const b = P.forPack('banking');
  assert.ok(b.REGISTRY.endsWith(path.join('knowledge', 'banking', 'sources.json')));
  assert.ok(b.OUT_DIR.endsWith(path.join('knowledge', 'banking')));
  const t = P.forPack('travel');
  assert.ok(t.REGISTRY.endsWith(path.join('knowledge', 'travel', 'sources.json')));
});

test('forPack refuses a pack name that is not a plain word', () => {
  for (const bad of ['../etc', 'a/b', '', null, 'A B'])
    assert.throws(() => P.forPack(bad), /pack name/, 'accepted: ' + JSON.stringify(bad));
});

test('sitemapsOf takes one sitemap, a list of them, or neither', () => {
  assert.deepEqual(P.sitemapsOf({ sitemap: 'https://x/a.xml' }), ['https://x/a.xml']);
  assert.deepEqual(P.sitemapsOf({ sitemaps: ['https://x/a.xml', 'https://x/b.xml'] }), ['https://x/a.xml', 'https://x/b.xml']);
  assert.deepEqual(P.sitemapsOf({ sitemaps: ['https://x/a.xml'], sitemap: 'https://x/z.xml' }), ['https://x/a.xml'], 'sitemaps wins');
  assert.deepEqual(P.sitemapsOf({}), []);
});

test('assignSlugs uses the registry name for a path that has one', () => {
  const site = { pathSlugs: { '/am/%e1%8b%a8%e1%89%a3%e1%8a%95%e1%8a%ad-%e1%8a%a0%e1%8c%88': 'am-banking-service' } };
  const out = P.assignSlugs([
    { path: '/am/%e1%8b%a8%e1%89%a3%e1%8a%95%e1%8a%ad-%e1%8a%a0%e1%8c%88' },
    { path: '/banking-service/personal-banking-2/consumer-deposit' },
  ], site);
  const by = Object.fromEntries(out.map(p => [p.path, p.slug]));
  assert.equal(by['/am/%e1%8b%a8%e1%89%a3%e1%8a%95%e1%8a%ad-%e1%8a%a0%e1%8c%88'], 'am-banking-service');
  assert.equal(by['/banking-service/personal-banking-2/consumer-deposit'], 'personal-banking-2-consumer-deposit');
});

test('assignSlugs with no site behaves exactly as it always did', () => {
  const out = P.assignSlugs([{ path: '/et/information/baggage-information/free-baggage-allowance' }]);
  assert.equal(out[0].slug, 'baggage-information-free-baggage-allowance');
});

test('a percent-encoded path with no registry name stops the run', () => {
  assert.throws(() => P.assignSlugs([{ path: '/am/%e1%8b%a8%e1%89%a3%e1%8a%95%e1%8a%ad' }], { pathSlugs: {} }),
    /pathSlugs/, 'an unnamed Ethiopic path must refuse, not write hex');
});

test('two pages may not be given the same registry name', () => {
  assert.throws(() => P.assignSlugs([{ path: '/a' }, { path: '/b' }], { pathSlugs: { '/a': 'x', '/b': 'x' } }), /same slug/);
});

test('extract strips the title suffix the site names, and nothing else', () => {
  const html = '<html><head><title>Tariff - Zemen Bank</title></head><body><div><p>'
    + 'x'.repeat(500) + '</p></div></body></html>';
  assert.equal(P.extract(html, { titleSuffix: '\\s*[-|]\\s*Zemen Bank\\s*$' }).title, 'Tariff');
  assert.equal(P.extract(html).title, 'Tariff - Zemen Bank');
});

test('a soft 404 is still refused, and the 400-character floor still holds', () => {
  // extract refuses anything under 200 characters as 'empty' before it looks at the title at all, so both
  // fixtures are padded past that guard with a comment. htmlToText drops comments, so the visible text of the
  // second page is still five characters and it is still the 400-character floor that turns it away.
  const pad = '<!--' + 'x'.repeat(240) + '-->';
  assert.equal(P.extract('<html><head><title>Page Not Found</title></head><body><div>x</div>' + pad + '</body></html>').why, 'soft_404');
  assert.equal(P.extract('<html><body><div><p>short</p></div>' + pad + '</body></html>').why, 'thin');
});
