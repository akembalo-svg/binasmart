'use strict';
const test = require('node:test');
const assert = require('node:assert');
const lg = require('../assistant/linkGuard');

const LIVE = new Set(['/jobs', '/employers', '/health', '/health?q=hospital', '/hotel/ghion-hotel-w1', '/ride', '/ride?pool=1']);
const opts = { exists: async p => LIVE.has(p) };
const fresh = () => lg._cache.clear();

test('a markdown link to a missing page keeps only its label', async () => {
  fresh();
  assert.strictEqual(await lg.fix('Open [Cashier Secretary](/Cashier) now.', opts), 'Open Cashier Secretary now.');
});

test('a bare missing path becomes plain words', async () => {
  fresh();
  assert.strictEqual(await lg.fix('See /Cashier for details.', opts), 'See Cashier for details.');
});

test('a full bina.et URL to a missing page keeps the site address', async () => {
  fresh();
  assert.strictEqual(await lg.fix('Apply at https://bina.et/Cashier.', opts), 'Apply at https://bina.et.');
  assert.strictEqual(await lg.fix('Apply at bina.et/no-such-page', opts), 'Apply at bina.et');
});

test('real pages, routes, slugs and query links are left alone', async () => {
  fresh();
  const t = 'Jobs: https://bina.et/jobs · companies: /employers · [Ghion](/hotel/ghion-hotel-w1) · all: https://bina.et/health?q=hospital · pool /ride?pool=1';
  assert.strictEqual(await lg.fix(t, opts), t);
});

test('words with slashes, other sites and numbers are not links', async () => {
  fresh();
  const t = 'Call 0911/223344, ask ChatGPT/Claude, open https://t.me/Bina_smart or wa.me/251911 and pay 1/2.';
  assert.strictEqual(await lg.fix(t, opts), t);
});

test('when the check cannot tell (network error), the link stays', async () => {
  fresh();
  const t = 'Go to /maybe-page now.';
  assert.strictEqual(await lg.fix(t, { exists: async () => true }), t);
});

test('a trailing Amharic full stop is not part of the path', async () => {
  fresh();
  assert.strictEqual(await lg.fix('ዝርዝሩን በ bina.et/jobs። ይመልከቱ', opts), 'ዝርዝሩን በ bina.et/jobs። ይመልከቱ');
  assert.strictEqual(await lg.fix('ዝርዝሩን በ bina.et/Cashier። ይመልከቱ', opts), 'ዝርዝሩን በ bina.et። ይመልከቱ');
});
