'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tenantPoster } = require('../../messaging/tenant-poster');

test('the A4 poster carries the QR, the start link, Amharic and English, /stop, and is not indexed', () => {
  const html = tenantPoster({ building: { name: 'Demo Tower', nameAm: 'ዴሞ ታወር' }, startUrl: 'https://t.me/bina_smart_bot?start=tenant_demo-tower', qrSvg: '<svg id="qr"></svg>' });
  for (const s of ['<svg id="qr"></svg>', 'https://t.me/bina_smart_bot?start=tenant_demo-tower', 'Get your rent notices on Telegram', 'የኪራይ መልእክቶችዎን በቴሌግራም ያግኙ', '/stop', 'ዴሞ ታወር · Demo Tower', '@page{size:A4'])
    assert.ok(html.includes(s), s);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  // The page must not pass its address on as a Referer. The route also sends the header, but the dashboard writes the
  // fetched page into a new window, where only this meta tag applies.
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('a building name cannot inject markup', () => {
  const html = tenantPoster({ building: { name: '<img src=x onerror=alert(1)>', nameAm: '"><script>x</script>' }, startUrl: 'https://t.me/x', qrSvg: '' });
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<script>x'), false);
});
