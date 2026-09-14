'use strict';
// The chat's browser script cannot run under node without a DOM, so it is held to rules by reading it: it
// parses, it never turns text into HTML, it only links to what the core module checked, and the three files
// stay small. (That every fixed text it asks for exists in both pages is in agent-chat-pages.test.js.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const PUB = path.join(__dirname, '..', 'public');
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const UI = read('agent-chat.js'), CORE = read('agent-chat-core.js'), CSS = read('agent-chat.css');

test('both scripts parse, and the core also loads the browser way (window.AgentChatCore)', () => {
  new vm.Script(UI);
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(CORE, ctx);
  assert.equal(typeof ctx.self.AgentChatCore.toCard, 'function');
});

test('no HTML is ever built from a string', () => {
  for (const [name, src] of [['agent-chat.js', UI], ['agent-chat-core.js', CORE]])
    for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setAttribute(\'href\'', 'setAttribute("href"'])
      assert.equal(src.includes(bad), false, name + ' uses ' + bad);
});

test('links are made only from checked values', () => {
  const hrefs = [...UI.matchAll(/\.href = ([^;]+);/g)].map(m => m[1].trim()).sort();
  assert.deepEqual(hrefs, ["'tel:' + cfg.banner.call", "'tel:' + n", 's.url', 'segs[i].href']);
  assert.match(UI, /if \(\/\^\\d\{3,4\}\$\/\.test\(cfg\.banner\.call\)\)/, 'the banner number is checked before it becomes a tel: link');
  const srcs = [...UI.matchAll(/\.src = ([^;]+);/g)].map(m => m[1].trim());
  assert.deepEqual([...new Set(srcs)], ['cfg.avatar']);
});

test('the emergency card is announced, the log is live, and the future quota line stays hidden', () => {
  assert.match(UI, /box\.setAttribute\('role', 'alert'\)/);
  assert.match(UI, /log\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(UI, /quota\.hidden = true;/);
  assert.equal(/quota\.hidden = false/.test(UI), false);
});

test('size: the three chat files stay small on the wire', () => {
  const raw = Buffer.byteLength(UI) + Buffer.byteLength(CORE) + Buffer.byteLength(CSS);
  const gz = zlib.gzipSync(UI + CORE + CSS, { level: 9 }).length;
  assert.ok(gz < 13000, 'gzipped ' + gz + ' bytes (raw ' + raw + ')');
});
