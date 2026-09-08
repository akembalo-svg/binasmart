'use strict';
// @bina_smart_bot — the whole BinaSmart in Telegram: a service menu (each item opens a bina.et page as a
// Mini App) and Bini, the site's AI assistant, answering any typed message. Per-chat history is kept in
// memory (last 8 turns, 1 h TTL). Bini is reached through the app's own /api/assistant on localhost.
const MENU = [
  [{ text: '🚕 Ride · ታክሲ', path: '/ride' }, { text: '👥 Pool · ጋራ ጉዞ', path: '/ride?pool=1' }],
  [{ text: '🏨 Hotels · ሆቴል', path: '/hotel/bina-grand-hotel' }, { text: '✈️ Airport · አየር ማረፊያ', path: '/airport' }],
  [{ text: '🍽 Restaurants · ምግብ ቤት', path: '/restaurant/bina-restaurant' }, { text: '🏥 Hospitals · ሆስፒታል', path: '/hospital/bina-general-hospital' }],
  [{ text: '🎟 Cinema · ሲኒማ', path: '/cinema' }, { text: '▶️ Watch · ፊልም', path: '/watch' }],
  [{ text: '🏠 Property · ቤት', path: '/property' }],
  [{ text: '🚗 Cars · መኪና', path: '/cars' }, { text: '🛡 Insurance · ኢንሹራንስ', path: '/insurance' }],
  [{ text: '📚 Guides · መመሪያዎች', path: '/guides' }, { text: '🏢 Buildings · ህንፃ', path: '/b/darulle' }],
];
const COMMANDS = { cinema: '/cinema', watch: '/watch', films: '/watch', ride: '/ride', hotels: '/hotel/bina-grand-hotel', restaurants: '/restaurant/bina-restaurant', hospitals: '/hospital/bina-general-hospital', events: '/cinema', property: '/property', cars: '/cars', insurance: '/insurance', guides: '/guides', ai: '/ai' };
const HIST_MAX = 8, HIST_TTL_MS = 3600 * 1000;

function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey }) {
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
      .replace(/(^|[\s(])(\/[a-z0-9][a-z0-9\-\/]*?)(?![a-z0-9\-\/])/gi, (m, pre, p) => pre + baseUrl + p);
  }

  async function askBini(chatId, message, from) {
    const t = turns(chatId);
    const user = from ? { telegramId: String(from.id || chatId), name: [from.first_name, from.last_name].filter(Boolean).join(' ').slice(0, 60), username: from.username || '' } : { telegramId: chatId };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await f(assistantUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': 'tg-' + chatId }, body: JSON.stringify({ message, history: t.slice(-HIST_MAX), user }), signal: ctl.signal });
      const d = await r.json().catch(() => ({}));
      const reply = d && d.reply ? String(d.reply) : null;
      if (reply) { t.push({ role: 'user', content: message }, { role: 'assistant', content: reply }); while (t.length > HIST_MAX * 2) t.shift(); }
      return reply;
    } catch (e) { console.error('[ride/binaBot] Bini call failed: ' + e.message); return null; }
    finally { clearTimeout(timer); }
  }

  // /start ticket_BINA-XXXXXX comes from the "Send to Telegram" button on /ticket/<code>.
  async function sendTicket(chatId, code) {
    const F = typeof f === 'function' ? f : fetch;
    try {
      const r = await F(baseUrl + '/api/cinema/tickets/' + code); const d = await r.json().catch(() => ({}));
      if (!d.ok) return api.sendMessage(chatId, 'ትኬት አልተገኘም · Ticket not found: ' + code);
      const t = d.ticket, sh = t.show || {}, e = sh.event || {}, v = sh.venue || {};
      const when = new Date(sh.startsAt).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const st = { RESERVED: t.payMethod === 'chapa' ? '⏳ Chapa · awaiting payment' : '🏪 በካውንተር ይክፈሉ · pay at the counter', CONFIRMED: '✅ ተከፍሏል · paid', CHECKED_IN: '🎬 ገብተዋል · checked in', CANCELLED: '❌ ተሰርዟል · cancelled' }[t.status] || t.status;
      const text = ['🎟️ ' + (e.titleAm || e.title || 'Ticket'), '📍 ' + (v.nameAm || v.name || '') + (sh.hall && sh.hall.name ? ' · ' + sh.hall.name : ''), '🕒 ' + when, '💺 ' + (t.seats || []).join(', '), '💰 ' + t.total + ' ብር · ' + st, '', 'ኮድ · Code: ' + t.code].join('\n');
      return api.sendMessage(chatId, text, { reply_markup: { inline_keyboard: [[{ text: '🎟️ ትኬቴን ክፈት · Open ticket (QR)', web_app: { url: baseUrl + '/ticket/' + t.code } }], [{ text: '🎬 ሌላ ትርዒት · More shows', web_app: { url: baseUrl + '/cinema' } }]] } });
    } catch (err) { console.error('[binaBot] ticket ' + code + ': ' + err.message); return api.sendMessage(chatId, baseUrl + '/ticket/' + code); }
  }

  // Same small keyboard for typed and spoken questions: a ride button when the topic is a ride, else just Menu.
  // The first bina.et link Bini mentions becomes a one-tap button (Mini App): a radio station, a tender, a guide…
  function replyMarkup(reply, text) {
    const r = String(reply || '');
    const m = /(?:https?:\/\/bina\.et)?(\/(?:watch|cinema|tenders|guides|pool|airport|hotels|insurance|property|cars|flights|news|[a-z0-9][a-z0-9\-]*)(?:\/[a-z0-9\-]+)*(?:\?[a-z0-9=&_\/-]+)?(?:#[a-z0-9\/\-]+)?)/i.exec(r);
    const path = m && !/^\/(static|api|mcp)\b/.test(m[1]) ? m[1].replace(/[።.,)\]]+$/, '') : null;
    const rows = [];
    const wantsRide = /ride|taxi|ታክሲ|ጉዞ|\/ride/i.test(r + ' ' + String(text));
    if (path && !/^\/ride\b/.test(path)) {
      const label = /^\/watch/.test(path) ? '▶️ BinaWatch ክፈት · Open' : /^\/tenders/.test(path) ? '📋 ጨረታ · Open tender' : /^\/cinema/.test(path) ? '🎬 ሲኒማ · Open' : /^\/pool/.test(path) ? '👥 ጋራ ጉዞ · Open' : '🔗 ክፈት · Open ' + path.split(/[?#]/)[0];
      rows.push([{ text: label.slice(0, 60), web_app: { url: baseUrl + path } }]);
    }
    if (wantsRide) rows.push([{ text: '🚕 Book a ride · ጉዞ ይያዙ', web_app: { url: baseUrl + (path && /^\/ride/.test(path) ? path : '/ride') } }]);
    rows.push([{ text: '☰ Menu · ዝርዝር', callback_data: 'menu' }]);
    return { inline_keyboard: rows };
  }
  // A hum or noise comes back from the transcriber as one repeated letter ("እህህህህ…"); treat it as unclear.
  function isNoise(t) {
    const s = String(t).replace(/[\s.…]/g, ''); if (s.length < 4) return false;
    const counts = {}; for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    return Math.max(...Object.values(counts)) / s.length > 0.6;
  }

  // A voice note: download from Telegram, transcribe through the app (Gemini), then answer it like typed text.
  async function handleVoice(chatId, msg) {
    const v = msg.voice || msg.audio;
    if (!v || (v.duration && v.duration > 120)) return api.sendMessage(chatId, 'የድምጽ መልእክቱ በጣም ረጅም ነው (እስከ 2 ደቂቃ)። · Voice note too long (max 2 minutes).');
    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const file = await api.getFile(v.file_id);
      const buf = await api.downloadFile(file.file_path);
      const r = await f(assistantUrl.replace(/\/api\/assistant$/, '/api/assistant/transcribe'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-key': internalKey || '' }, body: JSON.stringify({ audio: buf.toString('base64'), mime: v.mime_type || 'audio/ogg' }) });
      const d = await r.json().catch(() => ({}));
      const text = d && d.ok ? String(d.text || '').trim() : '';
      if (!text || /^\[unclear\]/i.test(text) || isNoise(text)) return api.sendMessage(chatId, 'ይቅርታ፣ ድምጹን መስማት አልቻልኩም። እባክዎ ይጻፉ ወይም እንደገና ይሞክሩ። · Sorry, I could not hear that. Please type it or try again.');
      const reply = await askBini(chatId, text.slice(0, 1200), msg.from);
      // No transcript echo (Ibrahim, 9 Sep 2026): answer the voice note directly, like a typed message.
      if (!reply) return api.sendMessage(chatId, 'ቢኒ ትንሽ ተጠምዷል፣ እባክዎ በደቂቃ ውስጥ እንደገና ይሞክሩ።');
      return api.sendMessage(chatId, forTelegram(reply), { reply_markup: replyMarkup(reply, text) });
    } catch (e) { console.error('[binaBot] voice: ' + e.message); return api.sendMessage(chatId, 'ይቅርታ፣ የድምጽ መልእክቱን ማንበብ አልቻልኩም። እባክዎ ይጻፉ። · Sorry, I could not read that voice note. Please type it.'); }
  }

  async function handleUpdate(update) {
    const msg = update && update.message;
    if (!msg || !msg.chat) return;
    const chatId = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    // A shop owner pressed the dashboard's link: t.me/bina_smart_bot?start=shop_<id>. From now on that
    // shop's orders and requests come to this chat instead of a WhatsApp number that may be banned.
    const sl = /^\/start\s+shop_([A-Za-z0-9]+)\b/.exec(text);
    if (sl && linkShop) {
      const shop = await linkShop(sl[1], chatId).catch(() => null);
      return api.sendMessage(chatId, shop
        ? '🔔 ' + (shop.nameAm || shop.name) + ' — ትዕዛዞችና ጥያቄዎች ከአሁን ጀምሮ እዚህ ይደርሱዎታል።\nOrders and requests for this page will arrive here from now on.'
        : 'ይህ ገጽ አልተገኘም። · That page was not found. Open bina.et/business and press the Telegram button again.');
    }
    const tk = /^\/start\s+ticket_(BINA-?[A-Z0-9]{6})\b/i.exec(text);
    if (tk) return sendTicket(chatId, tk[1].toUpperCase().replace(/^BINA-?/, 'BINA-'));
    if (!text && (msg.voice || msg.audio)) return handleVoice(chatId, msg);
    if (!text || /^\/start\b/.test(text) || /^\/(help|menu)\b/.test(text)) {
      hist.delete(chatId);
      const u = msg.from || {};
      console.log('[binaBot] start chat=' + chatId + ' user=' + (u.username ? '@' + u.username : '') + ' ' + [u.first_name, u.last_name].filter(Boolean).join(' ') + ' lang=' + (u.language_code || '?'));
      return api.sendMessage(chatId, WELCOME, { reply_markup: { inline_keyboard: [...menuMarkup().inline_keyboard, [{ text: '📣 Share BinaSmart · ያጋሩ', url: share }]] } });
    }
    const cmd = /^\/(\w+)/.exec(text);
    if (cmd && COMMANDS[cmd[1].toLowerCase()]) {
      const path = COMMANDS[cmd[1].toLowerCase()];
      return api.sendMessage(chatId, 'Open it here · እዚህ ይክፈቱ 👇', { reply_markup: { inline_keyboard: [[{ text: '🔗 ' + baseUrl.replace('https://', '') + path, web_app: { url: baseUrl + path } }]] } });
    }
    if (cmd) return api.sendMessage(chatId, 'Unknown command. Type /menu to see all services, or just ask me a question. · /menu ይጻፉ');
    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});
    const reply = await askBini(chatId, text.slice(0, 1200), msg.from);
    if (!reply) return api.sendMessage(chatId, 'Bini is busy for a moment — please try again in a minute, or open bina.et. · ቢኒ ትንሽ ተጠምዷል፣ እባክዎ በደቂቃ ውስጥ እንደገና ይሞክሩ።', { reply_markup: menuMarkup() });
    return api.sendMessage(chatId, forTelegram(reply), { reply_markup: replyMarkup(reply, text), disable_web_page_preview: true });
  }

  async function handleCallback(cq) {
    if (!cq || !cq.message) return;
    try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
    if (cq.data === 'menu') return api.sendMessage(String(cq.message.chat.id), 'Pick a service · አገልግሎት ይምረጡ 👇', { reply_markup: menuMarkup() });
  }

  return { handleUpdate: u => (u && u.callback_query ? handleCallback(u.callback_query) : handleUpdate(u)), forTelegram, _hist: hist, MENU, COMMANDS };
}
module.exports = { makeBinaBot, MENU, COMMANDS };
