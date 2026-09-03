'use strict';
// @bina_smart_bot — the whole BinaSmart in Telegram: a service menu (each item opens a bina.et page as a
// Mini App) and Bini, the site's AI assistant, answering any typed message. Per-chat history is kept in
// memory (last 8 turns, 1 h TTL). Bini is reached through the app's own /api/assistant on localhost.
const MENU = [
  [{ text: '🚕 Ride · ታክሲ', path: '/ride' }, { text: '🏨 Hotels · ሆቴል', path: '/hotel/bina-grand-hotel' }],
  [{ text: '🍽 Restaurants · ምግብ ቤት', path: '/restaurant/bina-restaurant' }, { text: '🏥 Hospitals · ሆስፒታል', path: '/hospital/bina-general-hospital' }],
  [{ text: '🎟 Events · ዝግጅቶች', path: '/events' }, { text: '🏠 Property · ቤት', path: '/property' }],
  [{ text: '🚗 Cars · መኪና', path: '/cars' }, { text: '🛡 Insurance · ኢንሹራንስ', path: '/insurance' }],
  [{ text: '📚 Guides · መመሪያዎች', path: '/guides' }, { text: '🏢 Buildings · ህንፃ', path: '/b/darulle' }],
];
const COMMANDS = { ride: '/ride', hotels: '/hotel/bina-grand-hotel', restaurants: '/restaurant/bina-restaurant', hospitals: '/hospital/bina-general-hospital', events: '/events', property: '/property', cars: '/cars', insurance: '/insurance', guides: '/guides', ai: '/ai' };
const HIST_MAX = 8, HIST_TTL_MS = 3600 * 1000;

function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername }) {
  const f = fetchImpl || fetch, clock = now || Date.now;
  const hist = new Map(); // chatId -> { turns: [{role, content}], t }
  const menuMarkup = () => ({ inline_keyboard: MENU.map(row => row.map(b => ({ text: b.text, web_app: { url: baseUrl + b.path } }))) });
  const WELCOME = 'ሰላም! 👋 BinaSmart — Ethiopia\'s all-in-one platform.\n🚕 Fixed-price rides · 🏨 hotels · 🍽 restaurants · 🏥 hospitals · 🎟 events · 🏠 property · 🚗 cars · 🛡 insurance · 📚 guides.\n\nPick a service below, or just type your question — Bini (ቢኒ), our assistant, answers in Amharic or English.\nከታች ይምረጡ ወይም ጥያቄዎን ይጻፉ — ቢኒ በአማርኛ ወይም በእንግሊዝኛ ይመልስልዎታል።';
  const share = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/' + (botUsername || 'bina_smart_bot')) + '&text=' + encodeURIComponent('BinaSmart — fixed-price rides, hotels, guides and more, inside Telegram');

  function turns(chatId) {
    const h = hist.get(chatId);
    if (h && clock() - h.t < HIST_TTL_MS) { h.t = clock(); return h.turns; }
    const n = { turns: [], t: clock() }; hist.set(chatId, n);
    if (hist.size > 5000) for (const [k, v] of hist) if (clock() - v.t > HIST_TTL_MS) hist.delete(k);
    return n.turns;
  }

  // Bini writes markdown links like [text](/ride); Telegram plain text needs full URLs.
  function forTelegram(text) {
    return String(text || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 — $2')
      .replace(/\[([^\]]+)\]\((\/[^)]*)\)/g, (m, t, p) => t + ' — ' + baseUrl + p)
      .replace(/(^|[\s(])(\/[a-z0-9][a-z0-9\-\/]*)(?=[\s.,)]|$)/gi, (m, pre, p) => pre + baseUrl + p);
  }

  async function askBini(chatId, message) {
    const t = turns(chatId);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await f(assistantUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': 'tg-' + chatId }, body: JSON.stringify({ message, history: t.slice(-HIST_MAX) }), signal: ctl.signal });
      const d = await r.json().catch(() => ({}));
      const reply = d && d.reply ? String(d.reply) : null;
      if (reply) { t.push({ role: 'user', content: message }, { role: 'assistant', content: reply }); while (t.length > HIST_MAX * 2) t.shift(); }
      return reply;
    } catch (e) { console.error('[ride/binaBot] Bini call failed: ' + e.message); return null; }
    finally { clearTimeout(timer); }
  }

  async function handleUpdate(update) {
    const msg = update && update.message;
    if (!msg || !msg.chat) return;
    const chatId = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    if (!text || /^\/start\b/.test(text) || /^\/(help|menu)\b/.test(text)) {
      hist.delete(chatId);
      return api.sendMessage(chatId, WELCOME, { reply_markup: { inline_keyboard: [...menuMarkup().inline_keyboard, [{ text: '📣 Share BinaSmart · ያጋሩ', url: share }]] } });
    }
    const cmd = /^\/(\w+)/.exec(text);
    if (cmd && COMMANDS[cmd[1].toLowerCase()]) {
      const path = COMMANDS[cmd[1].toLowerCase()];
      return api.sendMessage(chatId, 'Open it here · እዚህ ይክፈቱ 👇', { reply_markup: { inline_keyboard: [[{ text: '🔗 ' + baseUrl.replace('https://', '') + path, web_app: { url: baseUrl + path } }]] } });
    }
    if (cmd) return api.sendMessage(chatId, 'Unknown command. Type /menu to see all services, or just ask me a question. · /menu ይጻፉ');
    const reply = await askBini(chatId, text.slice(0, 1200));
    if (!reply) return api.sendMessage(chatId, 'Bini is busy for a moment — please try again in a minute, or open bina.et. · ቢኒ ትንሽ ተጠምዷል፣ እባክዎ በደቂቃ ውስጥ እንደገና ይሞክሩ።', { reply_markup: menuMarkup() });
    const wantsRide = /ride|taxi|ታክሲ|ጉዞ|\/ride/i.test(reply + ' ' + text);
    return api.sendMessage(chatId, forTelegram(reply), { reply_markup: { inline_keyboard: wantsRide ? [[{ text: '🚕 Book a ride · ጉዞ ይያዙ', web_app: { url: baseUrl + '/ride' } }], [{ text: '☰ Menu · ዝርዝር', callback_data: 'menu' }]] : [[{ text: '☰ Menu · ዝርዝር', callback_data: 'menu' }]] }, disable_web_page_preview: true });
  }

  async function handleCallback(cq) {
    if (!cq || !cq.message) return;
    try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
    if (cq.data === 'menu') return api.sendMessage(String(cq.message.chat.id), 'Pick a service · አገልግሎት ይምረጡ 👇', { reply_markup: menuMarkup() });
  }

  return { handleUpdate: u => (u && u.callback_query ? handleCallback(u.callback_query) : handleUpdate(u)), forTelegram, _hist: hist, MENU, COMMANDS };
}
module.exports = { makeBinaBot, MENU, COMMANDS };
