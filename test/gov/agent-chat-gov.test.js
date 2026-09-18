'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../../public/agent-chat-core.js');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'agent-chat.js'), 'utf8');

test('sources keep a publisher and a well-formed fetched date, up to three, and nothing else', () => {
  const card = C.toCard({ reply: 'x', sources: [
    { title: 'A', url: 'https://a.example', publisher: 'Negarit', fetched: '2026-09-17', evil: '<b>' },
    { title: 'B', url: 'https://b.example', fetched: 'yesterday' },
    { title: 'C', url: 'https://c.example' }, { title: 'D', url: 'https://d.example' }] }, {});
  assert.deepEqual(card.sources, [
    { title: 'A', url: 'https://a.example', publisher: 'Negarit', fetched: '2026-09-17' },
    { title: 'B', url: 'https://b.example' }, { title: 'C', url: 'https://c.example' }]);
});

test('an answer without the new fields has exactly the old shape', () => {
  const card = C.toCard({ reply: 'x', sources: [{ title: 'A', url: 'https://a.example' }] }, {});
  assert.deepEqual(card.sources, [{ title: 'A', url: 'https://a.example' }]);
});

test('the chat merges cfg.headers, reloads on an expired frame, and draws the footer and feedback only when asked', () => {
  assert.match(src, /Object\.assign\(\{ 'content-type': 'application\/json' \}, cfg\.headers \|\| \{\}\)/);
  assert.match(src, /r\.status === 401/);
  assert.match(src, /if \(cfg\.footer\)/);
  assert.match(src, /if \(cfg\.feedback/);
  assert.match(src, /reportConsent/);
  assert.ok(!/innerHTML/.test(src), 'text only, as test/agent-chat-ui.test.js requires');
});
