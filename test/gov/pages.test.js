'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loaderScript, frameHtml, demoHtml } = require('../../gov/pages');
const { excludeFor } = require('../../gov/registry');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(t => t.id === 'mols');
const office = { tenant, exclude: excludeFor(tenant), ops: { id: 'mols', status: 'demo', origins: ['https://mols.gov.et'], publicKey: 'pk_0123456789abcdef', quotaPerDay: 500 } };

test('the loader template never writes HTML into the office page and never evaluates strings', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'loader.js'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setTimeout("'])
    assert.ok(!src.includes(bad), bad);
  assert.equal(src.split('__CFG__').length, 2, 'exactly one config placeholder');
});

test('the loader carries the frame url with the public key, and escapes <', () => {
  const js = loaderScript(office);
  assert.ok(js.includes('https://bina.et/w/mols/frame?k=pk_0123456789abcdef'));
  assert.ok(!js.includes('__CFG__'));
  const evil = loaderScript({ ...office, tenant: { ...tenant, brand: { ...tenant.brand, label: { am: '</script><b>', en: 'x' } } } });
  assert.ok(!evil.includes('</script>'));
});

test('the frame: config inlined safely, token in the headers, footer, no voice, no Gemini voice api', () => {
  const html = frameHtml(office, 'TOKEN.abc', 'en');
  assert.match(html, /<html lang="en">/);
  const cfg = JSON.parse(/<script id="agent-chat-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(cfg.api, '/api/w/mols/ask');
  assert.deepEqual(cfg.headers, { 'x-bina-frame': 'TOKEN.abc' });
  assert.equal(cfg.feedback.api, '/api/w/mols/feedback');
  assert.equal(cfg.voice, false);
  assert.equal(cfg.voiceApi, undefined);
  assert.equal(cfg.sources, true);
  assert.deepEqual(cfg.footer, Object.fromEntries(tenant.languages.map(l => [l, tenant.footer[l]])), 'the fixed footer, in the office languages only');
  assert.equal(cfg.footer.om, undefined, 'om is off for this tenant (Y8)');
  assert.deepEqual(cfg.emergency.numbers, ['907', '991'], 'no unapproved contact');
  assert.ok(html.includes('/static/w/frame.js') && html.includes('/static/agent-chat.js'));
  assert.ok(html.indexOf('/static/w/frame.js') < html.indexOf('/static/agent-chat.js'), 'the device id exists before the chat reads it');
  assert.ok(!/<script>(?!\s*<\/script>)/.test(html), 'no inline executable script (CSP script-src self)');
});

test('an unknown language falls back to am', () => {
  assert.match(frameHtml(office, 't.x', 'fr'), /<html lang="am">/);
  assert.match(frameHtml(office, 't.x', 'om'), /<html lang="am">/, 'om is off for this tenant (Y8)');
});

test('the demo is labelled a mock, has no logo and no ministry image, and embeds the real loader', () => {
  const html = demoHtml(office);
  assert.match(html, /MOCK/);
  assert.match(html, /not the Ministry of Labour and Skills/);
  assert.ok(!/<img/i.test(html), 'no images at all');
  assert.ok(html.includes('<script src="/w/mols.js" async></script>'));
});
