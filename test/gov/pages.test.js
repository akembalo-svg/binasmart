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
  assert.match(html, /<html lang="en" class="ac-page">/);
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

// Found in a browser on 2026-09-18: the frame's language row offered OM although mols has Oromo off (Y8).
// The row is built from the languages the frame is told about, so the frame names them, and the ones the
// tenant does not enable are not drawn.
test('the frame offers only the languages the tenant enables', () => {
  const cfgOf = html => JSON.parse(/<script id="agent-chat-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const html = frameHtml(office, 't.x', 'am');
  assert.deepEqual(cfgOf(html).langs, ['am', 'en'], 'om is off for this tenant (Y8)');
  assert.match(html, /\.ac-langs \.ac-lang\[lang="om"\]\{display:none\}/, 'and the OM button is not drawn');

  const three = { ...office, tenant: { ...tenant, languages: ['am', 'en', 'om'] } };
  const htmlThree = frameHtml(three, 't.x', 'am');
  assert.deepEqual(cfgOf(htmlThree).langs, ['am', 'en', 'om'], 'a tenant with om on gets all three');
  assert.ok(!/display:none/.test(htmlThree), 'and nothing is hidden');
  assert.equal(cfgOf(htmlThree).footer.om, tenant.footer.om);
});

test('an unknown language falls back to am', () => {
  assert.match(frameHtml(office, 't.x', 'fr'), /<html lang="am" class="ac-page">/);
  assert.match(frameHtml(office, 't.x', 'om'), /<html lang="am" class="ac-page">/, 'om is off for this tenant (Y8)');
});

// Measured in a headless browser on 2026-09-18: without these the frame has no colour tokens at all
// (agent-chat.css puts them on html.ac-page, which /afiya and /asmat set and the frame did not), and the
// page itself scrolls, so the fixed footer sat 160px below the fold instead of under the input bar.
test('the frame carries the chat colour tokens and lets only the log scroll', () => {
  const html = frameHtml(office, 't.x', 'am');
  assert.match(html, /<html lang="am" class="ac-page">/);
  assert.ok(html.includes('--ac:' + tenant.brand.color), 'the office colour is the chat colour');
  assert.match(html, /\.ac\{[^}]*height:100%/);
  assert.match(html, /\.ac-log\{[^}]*min-height:0[^}]*overflow-y:auto/, 'the log scrolls, not the page');
  assert.match(html, /\.ac-log>\*\{flex:0 0 auto\}/, 'and a long answer is not squashed by the column that holds it');
  assert.match(html, /\.ac-foot\{/, 'and the footer is drawn under the bar');
});

test('the demo is labelled a mock, has no logo and no ministry image, and embeds the real loader', () => {
  const html = demoHtml(office);
  assert.match(html, /MOCK/);
  assert.match(html, /not the Ministry of Labour and Skills/);
  assert.ok(!/<img/i.test(html), 'no images at all');
  assert.ok(html.includes('<script src="/w/mols.js" async></script>'));
});
