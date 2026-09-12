'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// JSON inside <script> is not JSON. A "</script>" anywhere in a string value ends the block early and
// the browser parses the rest as HTML, so one headline, building name or film title is enough to
// inject markup into the page. watch/, cinema/ and business/ each escaped "<" for this. The news
// article, the building page and content-routes.js did not — three modules had learned it and three
// had not, which is how this codebase keeps finding the same bug in a sixth place.
//
// Checked by reading the source rather than by rendering, because the values that would trigger it
// are the ones nobody has typed yet: all 90 news posts and 244 tenders are clean today.
const ROOT = path.join(__dirname, '..');
const FILES = ['server.js', 'content-routes.js', 'watch/index.js', 'cinema/routes.js', 'business/index.js'];

// An emission is safe when the JSON that fills it has been through a "<" replacement — directly, or
// via a named helper that does it.
const HELPERS = /\b(ldScript|ldJson)\s*\(/;
const INLINE_ESCAPE = /JSON\.stringify\([^;]*\)\s*\.replace\(\/<\/g,\s*'\\\\u003c'\)/;

test('nothing writes a JSON-LD block without escaping "<" first', () => {
  const offenders = [];
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const line of src.split('\n')) {
      if (!line.includes('application/ld+json')) continue;
      if (HELPERS.test(line) || INLINE_ESCAPE.test(line)) continue;
      // A line that only opens the tag and is filled by an already-escaped variable is fine; that
      // shows up as the tag with no JSON.stringify on the same line.
      if (!/JSON\.stringify/.test(line)) continue;
      offenders.push(rel + ': ' + line.trim().slice(0, 110));
    }
  }
  assert.deepEqual(offenders, [], 'unescaped JSON-LD:\n  ' + offenders.join('\n  '));
});

// The building page used to build two blocks by writing a literal </script> between them, which is
// the same trick the bug relies on — worth pinning that it stopped.
test('no page closes a script tag by hand to start the next one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const hand = src.split('\n').filter(l => /'<\/script>[^']*<script type="application\/ld\+json">'/.test(l));
  assert.deepEqual(hand, [], 'a hand-written </script> between two JSON-LD blocks: ' + hand.join(' / '));
});

// The write side of the same habit: `const { silent, ...data } = b` put every column of NewsPost and
// Tender under the caller's control, and enrolled any column added later automatically.
test('the admin write routes name the columns they accept', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const route of ["fastify.post('/api/admin/news'", "fastify.post('/api/admin/tender'"]) {
    const at = src.indexOf(route);
    assert.ok(at > 0, route + ' not found');
    const body = src.slice(at, at + 1400);
    assert.equal(/const \{[^}]*\.\.\.data \} = b/.test(body), false, route + ' still spreads the request body into Prisma');
    assert.match(body, /pickFields\(b, (NEWS|TENDER)_FIELDS\)/, route + ' should pick named fields');
    assert.match(body, /badSlug\(/, route + ' should check the slug shape');
  }
});

// The slug is concatenated into the sitemap and into every canonical without escaping, so an "&" in
// one makes the sitemap invalid XML and Google drops the whole file rather than that one url.
test('the slug rule accepts real slugs and refuses anything that would break the sitemap', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = src.match(/const SLUG_RE = (\/.*\/);/);
  assert.ok(m, 'SLUG_RE not found');
  const re = eval(m[1]);   // eslint-disable-line no-eval -- reading our own source, not input
  for (const good of ['fayda-national-id-guide', 'telebirr', 'investment-reg-586-2026', 'a1']) {
    assert.equal(re.test(good), true, good + ' is a real slug in use');
  }
  for (const bad of ['', 'Has Capitals', 'has spaces', 'amp&ersand', 'a/b', '-leading', 'trailing-',
    'double--hyphen', 'quote"s', '<script>', 'ጽሑፍ']) {
    assert.equal(re.test(bad), false, JSON.stringify(bad) + ' must not become a url');
  }
});

// It rewrote .env and set process.env, with nothing but an obscure path in front of it.
test('the Facebook bootstrap endpoint is behind the owner key, both halves', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const verb of ['get', 'post']) {
    const at = src.indexOf("fastify." + verb + "('/fb-setup-x7k2'");
    assert.ok(at > 0, verb + ' /fb-setup-x7k2 not found');
    const head = src.slice(at, at + 400);
    assert.match(head, /authFail\(req, reply\)/, verb.toUpperCase() + ' /fb-setup-x7k2 has no gate');
  }
});
