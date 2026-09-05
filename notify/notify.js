'use strict';
// Where a notification goes, and the rule that nothing is lost quietly.
//
// Order: Telegram first (if the party has linked the bot), WhatsApp second (the sender number gets
// banned by Meta from time to time, so it is the backup, not the main road), and whatever happened,
// a copy to the admin chats stamped with the outcome. Before this, sendWa swallowed its failure and
// a customer's flight request, order or maintenance call could sit in the database with nobody
// told — the page said "sent", the row existed, and the owner never heard.
//
// Pure: both senders are injected, so the order and the fallback are tested without a network.
function makeNotify({ sendTg, sendWa, adminChatId, adminChatIds, log }) {
  const say = log || (() => {});
  const tryTg = (chat, text) => sendTg(chat, text).catch(() => false);
  const tryWa = (phone, text, ch) => sendWa(phone, text, ch).catch(() => false);
  // one or several admin chats; duplicates and blanks dropped
  const admins = [...new Set([].concat(adminChatIds || [], adminChatId || []).map(x => String(x || '').trim()).filter(Boolean))];

  // party: { id, name, phone, tgChatId }. Returns { ok, via } — via is 'telegram', 'whatsapp' or null.
  // linkHint: what to tell the admin the party can do to get on Telegram (e.g. '/start shop_<id>').
  async function notifyParty(party, text, waChannel, linkHint) {
    let via = null;
    if (party && party.tgChatId && await tryTg(party.tgChatId, text)) via = 'telegram';
    if (!via && party && party.phone && await tryWa(party.phone, text, waChannel)) via = 'whatsapp';
    const who = (party && (party.name || party.id)) || 'unknown';
    const head = via
      ? '✅ ' + who + ' — notified via ' + via
      : '⚠️ COULD NOT REACH ' + who + ' (' + ((party && party.phone) || 'no phone') + ')' + (linkHint ? ' — ' + linkHint : '');
    for (const a of admins) await tryTg(a, head + '\n\n' + text);
    if (!via) say('[notify] unreachable ' + who + ': ' + String(text).slice(0, 80));
    return { ok: !!via, via };
  }

  // A shop: same thing, with the dashboard's link command as the hint.
  const notifyShop = (shop, text, waChannel) =>
    notifyParty(shop, text, waChannel, shop && shop.id ? 'they can link Telegram with /start shop_' + shop.id : '');

  // Same ladder, no admin copy: for the many small messages to tenants (rent reminders, receipts)
  // where a copy of each one would bury the admins. Failures are logged and returned, not mirrored.
  async function notifyQuiet(party, text, waChannel) {
    let via = null;
    if (party && party.tgChatId && await tryTg(party.tgChatId, text)) via = 'telegram';
    if (!via && party && party.phone && await tryWa(party.phone, text, waChannel)) via = 'whatsapp';
    if (!via) say('[notify] unreachable ' + ((party && (party.name || party.id)) || 'unknown') + ': ' + String(text).slice(0, 80));
    return { ok: !!via, via };
  }

  // Something only the admins need to know (a lead, a report). Returns how many chats took it.
  async function notifyAdmins(text) {
    let n = 0;
    for (const a of admins) if (await tryTg(a, text)) n++;
    if (!n && admins.length) say('[notify] no admin chat reachable: ' + String(text).slice(0, 80));
    return n;
  }

  return { notifyParty, notifyShop, notifyQuiet, notifyAdmins, admins };
}
module.exports = { makeNotify };
