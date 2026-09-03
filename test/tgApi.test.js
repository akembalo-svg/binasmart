'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTgApi } = require('../ride/tgApi');

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return handler(url, init); };
  f.calls = calls; return f;
}
const okJson = result => ({ ok: true, json: async () => ({ ok: true, result }), arrayBuffer: async () => new ArrayBuffer(0) });

test('sendMessage posts JSON to the right URL and returns result', async () => {
  const fetchImpl = fakeFetch(() => okJson({ message_id: 7 }));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  const r = await api.sendMessage('123', 'hi', { parse_mode: 'HTML' });
  assert.equal(r.message_id, 7);
  assert.equal(fetchImpl.calls[0].url, 'https://api.telegram.org/botT:1/sendMessage');
  assert.deepEqual(fetchImpl.calls[0].body, { chat_id: '123', text: 'hi', parse_mode: 'HTML' });
});

test('API error becomes a thrown Error with Telegram description', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) }));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  await assert.rejects(api.sendMessage('1', 'x'), /chat not found/);
});

test('getFile + downloadFile use the file endpoint', async () => {
  const fetchImpl = fakeFetch(url => url.includes('/getFile') ? okJson({ file_path: 'photos/a.jpg' })
    : ({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  const f = await api.getFile('F1');
  const buf = await api.downloadFile(f.file_path);
  assert.equal(buf.length, 3);
  assert.equal(fetchImpl.calls[1].url, 'https://api.telegram.org/file/botT:1/photos/a.jpg');
});

test('setWebhook / setChatMenuButton / setMyCommands build the right bodies', async () => {
  const fetchImpl = fakeFetch(() => okJson(true));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  await api.setWebhook('https://bina.et/api/tg/rider', 'sekret');
  await api.setChatMenuButton('https://bina.et/ride', '🚕 Book a ride');
  await api.setMyCommands([{ command: 'start', description: 'Book a ride' }]);
  assert.deepEqual(fetchImpl.calls[0].body, { url: 'https://bina.et/api/tg/rider', secret_token: 'sekret', allowed_updates: ['message', 'callback_query'] });
  assert.deepEqual(fetchImpl.calls[1].body, { menu_button: { type: 'web_app', text: '🚕 Book a ride', web_app: { url: 'https://bina.et/ride' } } });
  assert.deepEqual(fetchImpl.calls[2].body, { commands: [{ command: 'start', description: 'Book a ride' }] });
});
