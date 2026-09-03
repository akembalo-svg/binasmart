'use strict';
// @bina_smart_bot chat side. The app itself is the Mini App; the chat only needs to open it.
function makeRiderBot({ api, baseUrl, botUsername }) {
  const WELCOME = 'ሰላም! 🚕 BinaSmart — fixed-price rides in Addis Ababa. No surge, no app to download.\nቋሚ ዋጋ፣ ያለ ጭማሪ፣ መተግበሪያ ማውረድ አያስፈልግም።\n\nTap below to book · ለመያዝ ከታች ይጫኑ';
  const share = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/' + botUsername) + '&text=' + encodeURIComponent('Fixed-price rides in Addis Ababa — BinaSmart');
  async function handleUpdate(update) {
    const msg = update && update.message;
    if (!msg || !msg.chat) return;
    await api.sendMessage(String(msg.chat.id), WELCOME, { reply_markup: { inline_keyboard: [
      [{ text: '🚕 Book a ride · ጉዞ ይያዙ', web_app: { url: baseUrl + '/ride' } }],
      [{ text: '📣 Share BinaSmart · ያጋሩ', url: share }],
    ] } });
  }
  return { handleUpdate };
}
module.exports = { makeRiderBot };
