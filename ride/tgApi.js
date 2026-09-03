'use strict';
// Minimal Telegram Bot API client. One instance per bot token. fetchImpl is injectable for tests.
function makeTgApi({ token, fetchImpl, apiBase, timeoutMs }) {
  const f = fetchImpl || fetch, base = apiBase || 'https://api.telegram.org', tmo = timeoutMs || 10000;
  async function call(method, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), tmo);
    try {
      const r = await f(base + '/bot' + token + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl.signal });
      const j = await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
      if (!j.ok) throw new Error('tg ' + method + ': ' + (j.description || 'unknown error'));
      return j.result;
    } finally { clearTimeout(t); }
  }
  async function downloadFile(filePath) {
    const r = await f(base + '/file/bot' + token + '/' + filePath);
    if (!r.ok) throw new Error('tg download: HTTP ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  return {
    call,
    sendMessage: (chat_id, text, extra) => call('sendMessage', Object.assign({ chat_id, text }, extra || {})),
    sendChatAction: (chat_id, action) => call('sendChatAction', { chat_id, action: action || 'typing' }),
    sendPhoto: (chat_id, photo, caption, extra) => call('sendPhoto', Object.assign({ chat_id, photo, caption }, extra || {})),
    getFile: file_id => call('getFile', { file_id }),
    downloadFile,
    setWebhook: (url, secret_token) => call('setWebhook', { url, secret_token, allowed_updates: ['message', 'callback_query'] }),
    setChatMenuButton: (url, text) => call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } }),
    setMyCommands: commands => call('setMyCommands', { commands }),
    answerCallbackQuery: (callback_query_id, text, show_alert) => call('answerCallbackQuery', { callback_query_id, text, show_alert: !!show_alert }),
    // Turning a live offer card into a settled one is the clearest signal a driver can get.
    editMessageText: (chat_id, message_id, text, extra) => call('editMessageText', Object.assign({ chat_id, message_id, text }, extra || {})),
  };
}
module.exports = { makeTgApi };
