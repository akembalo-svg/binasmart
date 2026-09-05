'use strict';
// Where a shop's notification goes, and the rule that nothing is lost quietly.
//
// Order: Telegram first (if the owner pressed the bot's link), WhatsApp second (the sender number
// gets banned by Meta from time to time, so it is the backup, not the main road), and whatever
// happened, a copy to the admin chat stamped with the outcome. Before this, sendWa swallowed its
// failure and a customer's flight request or order could sit in the database with nobody told —
// the page said "sent", the row existed, and the owner never heard.
//
// Pure: both senders are injected, so the order and the fallback are tested without a network.
function makeNotify({ sendTg, sendWa, adminChatId, log }) {
  const say = log || (() => {});
  const tryTg = (chat, text) => sendTg(chat, text).catch(() => false);
  const tryWa = (phone, text, ch) => sendWa(phone, text, ch).catch(() => false);

  // shop: { id, name, phone, tgChatId }. Returns { ok, via } — via is 'telegram', 'whatsapp' or null.
  async function notifyShop(shop, text, waChannel) {
    let via = null;
    if (shop && shop.tgChatId && await tryTg(shop.tgChatId, text)) via = 'telegram';
    if (!via && shop && shop.phone && await tryWa(shop.phone, text, waChannel)) via = 'whatsapp';
    if (adminChatId) {
      const who = (shop && (shop.name || shop.id)) || 'unknown shop';
      const head = via
        ? '✅ ' + who + ' — notified via ' + via
        : '⚠️ COULD NOT REACH ' + who + ' (' + ((shop && shop.phone) || 'no phone') + ')'
          + (shop && shop.id ? ' — they can link Telegram with /start shop_' + shop.id : '');
      await tryTg(adminChatId, head + '\n\n' + text);
    }
    if (!via) say('[notify] unreachable shop ' + (shop && shop.id) + ': ' + String(text).slice(0, 80));
    return { ok: !!via, via };
  }
  return { notifyShop };
}
module.exports = { makeNotify };
