'use strict';
// /property and /cars: the listing cards, the request form, and the route both forms post to.
//
// The cards are built as HTML strings in an inline script, so the only way to test them is to lift the
// functions out of the page and run them. The route is guarded by reading server.js, like the other
// wiring tests, because a valid request to it messages the admins and a phone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function lift(page, names) {
  const html = read(page);
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const ctx = {};
  vm.createContext(ctx);
  for (const n of names) {
    const at = script.indexOf('function ' + n + '(');
    assert.ok(at >= 0, page + ': function ' + n + ' not found');
    let depth = 0, i = script.indexOf('{', at);
    for (; i < script.length; i++) { if (script[i] === '{') depth++; else if (script[i] === '}' && --depth === 0) break; }
    vm.runInContext(script.slice(at, i + 1), ctx);
  }
  return { ctx, script };
}

const NASTY = "Bole's 3-bed <img src=x onerror=alert(1)> \"view\"";

for (const [page, fn, extra] of [['public/property.html', 'card', {}], ['public/cars.html', 'card', { slug: 'x' }]]) {
  test(page + ': a title with an apostrophe or markup cannot break or script the Enquire button', () => {
    const { ctx } = lift(page, ['esc', 'cssUrl', fn]);
    const html = ctx[fn](Object.assign({ title: NASTY, imageUrl: 'https://img.example/a.jpg', price: '1', city: 'Addis' }, extra));
    assert.equal(/<img/i.test(html), false, 'markup from the title reached the page');
    const btn = html.match(/<button class="b1"[^>]*>/)[0];
    assert.match(btn, /onclick="enquire\([^"]*this\.getAttribute\('data-t'\)\)"/, 'the title must not be written into the onclick');
    assert.equal(btn.includes('Bole'), true);
    assert.equal(btn.split('onclick=')[1].includes('Bole'), false);
  });

  test(page + ': only a web address can become a background image, and it cannot close url()', () => {
    const { ctx } = lift(page, ['esc', 'cssUrl']);
    assert.equal(ctx.cssUrl('javascript:alert(1)'), '');
    assert.equal(ctx.cssUrl('data:image/svg+xml,<svg>'), '');
    assert.equal(ctx.cssUrl(null), '');
    const u = ctx.cssUrl("https://a.example/x.jpg) ; background:url('https://evil.example/t.gif");
    assert.equal(/[()'"\s]/.test(u), false, 'url() could be closed: ' + u);
    assert.equal(ctx.cssUrl('https://a.example/x.jpg'), 'https://a.example/x.jpg');
  });

  test(page + ': the form says "got it" only when the server accepted the request', () => {
    const { script } = lift(page, ['esc']);
    const send = script.slice(script.indexOf("fetch('/api/market-lead'"), script.indexOf("fetch('/api/market-lead'") + 900);
    assert.match(send, /if\(!r\.ok\)throw/, 'a 400 or 429 must not show the success panel');
    assert.match(script, /if\(sending\)return;sending=true;/, 'a double tap must not send two leads');
  });
}

test('server.js: /api/market-lead validates before it stores or notifies', () => {
  const src = read('server.js');
  const at = src.indexOf("fastify.post('/api/market-lead'");
  const route = src.slice(at, src.indexOf('\n});', at));
  const create = route.indexOf('marketLead.create');
  for (const [re, why] of [
    [/if \(b\.kind !== 'car' && b\.kind !== 'property'\)/, 'kind is car or property'],
    [/if \(!phoneOk\(b\.phone\)\)/, 'the phone must look like a phone'],
    [/if \(!leadRL\(phoneKey\(/, 'the per-phone limit applies to every request'],
  ]) {
    const m = route.match(re);
    assert.ok(m, why);
    assert.ok(m.index < create, why + ' — and before anything is stored');
  }
  assert.equal(/leadPk &&/.test(route), false, 'the per-phone limit is conditional again');
});

test('server.js: admin listing routes refuse an imageUrl that is not a web address', () => {
  const src = read('server.js');
  for (const r of ["fastify.post('/api/admin/property'", "fastify.post('/api/admin/car'"]) {
    const at = src.indexOf(r);
    assert.match(src.slice(at, at + 900), /!httpUrl\(data\.imageUrl\)/, r);
  }
});

test('server.js: the sitemap leaves out /cars and /property while nothing is listed', () => {
  const src = read('server.js');
  assert.match(src, /u !== 'https:\/\/bina\.et\/cars' \|\| carsListed/);
  assert.match(src, /u !== 'https:\/\/bina\.et\/property' \|\| propsListed/);
});
