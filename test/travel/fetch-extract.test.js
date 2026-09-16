'use strict';
// HTML in, indexable text out. The fixtures are written by hand rather than saved from the live site: they
// are small enough to read, they exercise one rule each, and they never go stale. The real site is checked
// separately, live, in Task 3 Step 5 - a fixture proves the rule, a live page proves the site.
const test = require('node:test');
const assert = require('node:assert');
const { cleanTitle, extract } = require('../../ops/travel/fetch-airline');

const page = (title, body) => '<!DOCTYPE html><html lang="en"><head><title>' + title +
  '</title><meta name="x" content="y"><style>.a{color:red}</style></head><body>' +
  '<nav><a href="/et/book">Book</a><a href="/et/manage">Manage</a></nav>' + body +
  '<footer><p>&copy; Ethiopian Airlines</p></footer><script>var a=1;</script></body></html>';

const BAGGAGE = page('Free Baggage Allowance | Ethiopian Airlines | ET', `
  <h1>Free Baggage Allowance</h1>
  <h2>Checked baggage</h2>
  <p>Maximum total size: 62 inches (158 cm), including handles and wheels. Maximum weight: 50 lbs (23 kg).</p>
  <h2>Carry-on baggage</h2>
  <ul><li>Economy: 1 piece, 7kg</li><li>Business: 2 pieces, 7kg each</li></ul>
  <h3>Dimensions</h3>
  <table><tr><th>Class</th><th>Pieces</th><th>Weight</th></tr>
  <tr><td>Economy</td><td>2</td><td>23 kg each</td></tr>
  <tr><td>Cloud Nine</td><td>2</td><td>32 kg each</td></tr></table>
  <p>Some weight systems depend on the route on which you are travelling. Where the weight system applies,
  the allowance is expressed in kilograms for the whole journey rather than as a number of pieces, and the
  two cannot be combined on one ticket. Check the ticket before travelling.</p>`);

test('cleanTitle drops the airline suffix and decodes entities', () => {
  assert.equal(cleanTitle('Free Baggage Allowance | Ethiopian Airlines | ET'), 'Free Baggage Allowance');
  assert.equal(cleanTitle('Lost &amp; Found | Ethiopian Airlines'), 'Lost & Found');
  assert.equal(cleanTitle('\n\tPage  Not   Found\n'), 'Page Not Found');
  assert.equal(cleanTitle('Cargo Services | Ethiopian Cargo Website'), 'Cargo Services');
});

test('extract keeps the headings', () => {
  const r = extract(BAGGAGE);
  assert.equal(r.ok, true);
  assert.equal(r.title, 'Free Baggage Allowance');
  const heads = r.text.split('\n').filter(l => /^#{1,3} /.test(l));
  assert.deepEqual(heads, ['# Free Baggage Allowance', '## Checked baggage', '## Carry-on baggage', '### Dimensions']);
});

test('extract keeps the figures a traveller came for', () => {
  const r = extract(BAGGAGE);
  for (const fact of ['158 cm', '23 kg', '7kg', '32 kg']) assert.ok(r.text.includes(fact), 'lost ' + fact);
});

test('extract keeps list items and table rows', () => {
  const r = extract(BAGGAGE);
  assert.ok(r.text.includes('- Economy: 1 piece, 7kg'), 'list item');
  assert.ok(/Cloud Nine \| 2 \| 32 kg each/.test(r.text), 'table row: ' + r.text);
});

test('extract drops script, style, nav and footer', () => {
  const r = extract(BAGGAGE);
  assert.ok(!r.text.includes('var a=1'), 'script');
  assert.ok(!r.text.includes('color:red'), 'style');
  assert.ok(!r.text.includes('Manage'), 'nav');
  assert.ok(!r.text.includes('Ethiopian Airlines'), 'footer');
});

test('extract refuses the soft 404 the airline serves at HTTP 200', () => {
  const body = '<h1>Page Not Found</h1><p>' + 'The page you are looking for is not here. '.repeat(30) + '</p>';
  const r = extract(page('Page Not Found | Ethiopian Airlines | AM', body));
  assert.equal(r.ok, false);
  assert.equal(r.why, 'soft_404');
});

test('extract refuses an application shell with nothing to read', () => {
  const r = extract(page('Book | Ethiopian Cargo Website', '<div><a href="/track">Track</a></div>'));
  assert.equal(r.ok, false);
  assert.equal(r.why, 'thin');
});

test('extract refuses bytes that are not a page at all', () => {
  assert.equal(extract('').why, 'empty');
  assert.equal(extract('{"error":"nope"}').why, 'empty');
});

test('extract reports how much it kept, so a run can be read at a glance', () => {
  const r = extract(BAGGAGE);
  assert.equal(typeof r.chars, 'number');
  assert.equal(r.chars, r.text.length);
});
