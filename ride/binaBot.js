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
// Tenant-link errors are logged by kind (Prisma code or error name), never by message: messages can carry ids or numbers.
const errKind = e => String((e && (e.code || e.name)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';

function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey, owner, tenant, jobs, cv }) {
  const f = fetchImpl || fetch, clock = now || Date.now;
  const hist = new Map(); // chatId -> { turns: [{role, content}], t }
  const menuMarkup = () => ({ inline_keyboard: MENU.map(row => row.map(b => ({ text: b.text, web_app: { url: baseUrl + b.path } }))) });
  const WELCOME = 'ሰላም! 👋 BinaSmart — Ethiopia\'s all-in-one platform.\n🚕 Fixed-price rides · 🏨 hotels · 🍽 restaurants · 🏥 hospitals · 🎟 events · 🏠 property · 🚗 cars · 🛡 insurance · 📚 guides.\n\nPick a service below, or just type your question — Bini (ቢኒ), our assistant, answers in Amharic or English.\nከታች ይምረጡ ወይም ጥያቄዎን ይጻፉ — ቢኒ በአማርኛ ወይም በእንግሊዝኛ ይመልስልዎታል።';
  const share = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/' + (botUsername || 'bina_smart_bot')) + '&text=' + encodeURIComponent('BinaSmart — fixed-price rides, hotels, guides and more, inside Telegram');

  // ---- Bini for owners (owner Bini design §3). owner = { access, answer, health } from server.js; absent = off. ----
  // Only ever in a private chat: tenants' names and money never go where others can read them.
  const OWNER_START = '🏢 ቢኒ ለባለቤቶች · Bini for owners\n\nየተመዘገበውን ስልክ ቁጥርዎን ለማረጋገጥ ከታች «📱 ስልኬን አጋራ»ን ይጫኑ። ቴሌግራም ቁጥሩ የእርስዎ መሆኑን ያረጋግጣል።\nTap "📱 Share my phone" below. Telegram confirms the number is yours.';
  const SHARE_KB = { keyboard: [[{ text: '📱 ስልኬን አጋራ · Share my phone', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const NO_KB = { remove_keyboard: true };
  const NOT_LINKED = 'ከቢኒ ለባለቤቶች ጋር አልተገናኙም። ከባለቤት ዳሽቦርዱ «Connect Telegram»ን ይጫኑ። · You are not linked to Bini for owners. Use "Connect Telegram" in the owner dashboard.';
  const REFUSAL = {
    not_registered: 'ይህ ቁጥር ለማንኛውም ንግድ አልተመዘገበም። · This number is not registered for any business.',
    too_many: 'ብዙ ሙከራዎች ተደርገዋል፤ ከ15 ደቂቃ በኋላ እንደገና ይሞክሩ። · Too many attempts — try again in 15 minutes.',
    not_own_contact: 'እባክዎ የራስዎን ቁጥር በ«📱 ስልኬን አጋራ» ቁልፍ ያጋሩ። · Please share your own number with the button.',
    not_private: 'ይህን በግል ቻት ብቻ ያድርጉ። · Please do this in a private chat with the bot.',
    blocked: 'ይህ የቴሌግራም መለያ ከቢኒ ለባለቤቶች ተወግዷል። እባክዎ ቢናስማርትን ያነጋግሩ። · This Telegram account was removed from Bini for owners. Please contact BinaSmart.',
  };
  const isPrivate = msg => !!(msg && msg.chat && msg.chat.type === 'private');
  const PASS = Symbol('not an owner command');   // sendMessage may resolve to anything; this cannot collide
  const FAILED = Symbol('access lookup failed');
  const SORRY = 'ይቅርታ፣ እንደገና ይሞክሩ። · Sorry, please try again.';
  // When the records report cannot be built, the linked message still says what to do next.
  const HEALTH_FALLBACK = 'ስለ መዝገብዎ ይጠይቁ — ለምሳሌ «በዚህ ወር ስንት ተከፈለ?» · Ask about your records, e.g. "How much was paid this month?"'
    + '\n/bini — ቢኒ ለደንበኞች · customer Bini   /logout — ውጣ · sign out';

  // A shared contact is an owner link attempt ONLY right after /start owner. The ride, pool, cinema and watch
  // Mini Apps also drop the user's own contact into this chat (WebApp.requestContact); those keep their old reply
  // and never touch the link (no silent re-link after /logout, no flip out of /bini mode).
  const PENDING_MS = 10 * 60000;
  const pendingLink = new Map();   // String(from.id) -> clock() when /start owner was sent
  function markPending(fromId) {
    const t = clock();
    pendingLink.set(String(fromId), t);
    if (pendingLink.size > 5000) for (const [k, v] of pendingLink) if (t - v > PENDING_MS) pendingLink.delete(k);
  }
  function takePending(fromId) {
    const k = String(fromId), t = pendingLink.get(k);
    if (t == null) return false;
    pendingLink.delete(k);
    return clock() - t <= PENDING_MS;
  }

  // ---- Tenant notices (messaging design §2). tenant = messaging/tenant-link.js from server.js; absent = off. ----
  // The building poster opens t.me/bina_smart_bot?start=tenant_<slug>. A shared contact is a tenant link attempt only
  // within ten minutes of that command, and whichever start command came last (owner or tenant) decides.
  const TENANT_START = '🏢 የኪራይ መልእክቶች በቴሌግራም · Rent notices on Telegram\n\nበህንፃው የተመዘገበውን ስልክ ቁጥርዎን ለማረጋገጥ ከታች «📱 ስልኬን አጋራ»ን ይጫኑ።\nTap "📱 Share my phone" below. Telegram confirms the number is yours, and we match it to your tenancy.';
  const TENANT_NO_MATCH = 'ይህን ቁጥር ከህንፃው የተከራይ መዝገብ ጋር ማገናኘት አልተቻለም። ቁጥርዎ ከተቀየረ የህንፃውን አስተዳደር ያነጋግሩ። · We could not connect this number to the building\'s tenant records. If your number has changed, please ask the building management.';
  // expired: the link service found the start too old (it checks the window again). Still neutral, plus what to do.
  const TENANT_REFUSAL = { too_many: REFUSAL.too_many, not_own_contact: REFUSAL.not_own_contact, not_private: REFUSAL.not_private,
    expired: TENANT_NO_MATCH + '\n\nእባክዎ የህንፃውን QR እንደገና ይቃኙ ወይም ሊንኩን እንደገና ይጫኑ። · Please scan the building\'s QR code or press the start link again.' };
  const pendingTenant = new Map();   // String(from.id) -> { t: clock() when /start tenant_ was sent, slug }

  async function linkTenant(chatId, msg, slug, startedAt) {
    let r;
    try {
      // startedAt is required by messaging/tenant-link.js: without it the answer is 'expired', never a link.
      r = await tenant.linkFromContact({ slug, chat: msg.chat, from: msg.from, contact: msg.contact, startedAt,
        forwarded: !!(msg.forward_origin || msg.forward_from || msg.forward_date || msg.via_bot) });
    } catch (e) {
      console.error('[binaBot] tenant link: ' + errKind(e));
      return api.sendMessage(chatId, 'ይቅርታ፣ አሁን ማገናኘት አልተቻለም። · Sorry, linking failed just now.', { reply_markup: NO_KB });
    }
    if (r && r.ok) return api.sendMessage(chatId, '✅ ተገናኝቷል · Linked — ክፍል · unit ' + r.units.join(', ')
      + '\n\nየህንፃዎ የክፍያ መጠየቂያዎች፣ ደረሰኞችና ማሳሰቢያዎች ከአሁን በኋላ እዚህ ይደርሱዎታል። ለማቆም /stop ይጻፉ።\nInvoices, receipts and notices from your building will arrive here. Send /stop to stop.', { reply_markup: NO_KB });
    return api.sendMessage(chatId, TENANT_REFUSAL[r && r.reason] || TENANT_NO_MATCH, { reply_markup: NO_KB });
  }

  async function handleTenantCommand(chatId, msg, text) {
    const start = /^\/start\s+tenant_([A-Za-z0-9-]{1,60})(?:\s|$)/.exec(text);
    if (start) {
      const k = String(msg.from.id), t = clock();
      pendingLink.delete(k);
      pendingTenant.set(k, { t, slug: start[1] });
      if (pendingTenant.size > 5000) for (const [key, v] of pendingTenant) if (t - v.t > PENDING_MS) pendingTenant.delete(key);
      return api.sendMessage(chatId, TENANT_START, { reply_markup: SHARE_KB });
    }
    if (msg.contact) {
      const k = String(msg.from.id), p = pendingTenant.get(k);
      if (!p) return PASS;
      pendingTenant.delete(k);
      return clock() - p.t <= PENDING_MS ? linkTenant(chatId, msg, p.slug, p.t) : PASS;
    }
    if (/^\/stop\b/.test(text)) {
      pendingTenant.delete(String(msg.from.id));
      const n = await tenant.unlink(msg.from.id).catch(e => { console.error('[binaBot] tenant unlink: ' + errKind(e)); return FAILED; });
      if (n === FAILED) return api.sendMessage(chatId, SORRY, { reply_markup: NO_KB });
      return api.sendMessage(chatId, n
        ? 'የህንፃ መልእክቶች ቆመዋል። እንደገና ለመጀመር የህንፃውን QR ይቃኙ። · Building notices stopped. Scan your building\'s QR code to start again.'
        : 'እዚህ የህንፃ መልእክቶችን አይቀበሉም ነበር። · You were not receiving building notices here.', { reply_markup: NO_KB });
    }
    return PASS;
  }


  // Job alerts: /start jobs_<field> from the board, /jobs to choose, /stopjobs to stop. Private chats
  // only, and only when server.js passes the service. The board is full of vacancies and empty of
  // returning readers; this is the half that brings people back.
  async function handleJobsCommand(chatId, msg, text) {
    const start = /^\/start\s+jobs_([a-z]{2,20})(?:\s|$)/.exec(text);
    if (start) {
      const r = await jobs.subscribe({ chatId, field: start[1], lang: 'am' }).catch(() => null);
      if (!r || !r.ok) return api.sendMessage(chatId, 'ይቅርታ፣ አልተሳካም። እንደገና ይሞክሩ። · Sorry, that did not work.');
      const name = r.field === 'all' ? 'ሁሉም ዘርፎች' : jobLabel(r.field);
      return api.sendMessage(chatId,
        '🔔 ተመዝግበዋል — <b>' + name + '</b>\n\nአዲስ ክፍት የሥራ ቦታ ሲወጣ በየጠዋቱ እዚህ እነግርዎታለሁ።\nለማቆም /stopjobs ይጻፉ።',
        { parse_mode: 'HTML' });
    }
    if (/^\/stopjobs\b/.test(text)) {
      const n = await jobs.stop(chatId).catch(() => 0);
      return api.sendMessage(chatId, n
        ? '🔕 የሥራ ማሳወቂያ ቆሟል። እንደገና ለመጀመር bina.et/jobs ይክፈቱ።'
        : 'የሥራ ማሳወቂያ አልነበረዎትም። · You were not subscribed.');
    }
    if (/^\/jobs\b/.test(text)) {
      const mine = await jobs.listFor(chatId).catch(() => []);
      const head = mine.length
        ? '🔔 አሁን የሚደርስዎት፦ ' + mine.map(a => a.field === 'all' ? 'ሁሉም' : jobLabel(a.field)).join('፣ ') + '\n\n'
        : '';
      return api.sendMessage(chatId, head
        + '💼 <b>ክፍት የሥራ ቦታዎች</b>\n\nዘርፍ ይምረጡ — አዲስ ሲወጣ በየጠዋቱ እነግርዎታለሁ።',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: jobFieldRows() } });
    }
    return PASS;
  }

  // A CV spoken instead of typed: /cv, then one voice note, then one tap to share a number.
  // The written form asks the same person to type their education, work history and skills into a
  // phone in Ethiopic - which is why almost nobody finishes it. jobs/voice-cv.js holds the flow and
  // the state; this is only the Telegram half of it.
  async function handleCvCommand(chatId, msg, text) {
    if (/^\/start\s+cv\b/.test(text) || /^\/cv\b/.test(text)) {
      return api.sendMessage(chatId, await cv.begin(chatId), { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
    }
    const st = await cv.stateOf(chatId);
    if (!st) return PASS;

    if (/^\/cancel\b/.test(text)) {
      await cv.cancel(chatId);
      return api.sendMessage(chatId, 'እሺ፣ ቆሟል። በማንኛውም ጊዜ /cv ብለው እንደገና መጀመር ይችላሉ።', { reply_markup: { remove_keyboard: true } });
    }
    // Another command mid-flow is a change of mind, not an answer - let it through to its own handler.
    if (/^\//.test(text)) { await cv.cancel(chatId); return PASS; }

    if (st.state === 'cv_wait_name' && text) {
      const r = await cv.onName(chatId, text);
      if (!r.ok) return api.sendMessage(chatId, 'ሙሉ ስምዎን ይጻፉ።');
      return askPhone(chatId);
    }

    if (st.state === 'cv_wait_phone') {
      // Their own number only: a contact forwarded from somebody else would put a stranger's phone on
      // this CV, and the employer would ring them instead.
      if (msg.contact && msg.from && msg.contact.user_id && String(msg.contact.user_id) !== String(msg.from.id)) {
        return api.sendMessage(chatId, 'የራስዎን ስልክ ቁጥር ይላኩ።');
      }
      const raw = msg.contact ? msg.contact.phone_number : text;
      if (!raw) return PASS;
      if (!cv.normPhone(raw)) return api.sendMessage(chatId, 'ስልክ ቁጥሩ ትክክል አይደለም። 09… ወይም +2519… ይጻፉ።');
      await api.sendMessage(chatId, '⏳ ሲቪዎን በመጻፍ ላይ ነኝ — አንድ ደቂቃ ያህል ይወስዳል።', { reply_markup: { remove_keyboard: true } });
      const r = await cv.onPhone(chatId, raw);
      if (!r.ok) return api.sendMessage(chatId, 'ይቅርታ፣ ሲቪውን መሥራት አልቻልኩም። እባክዎ /cv ብለው እንደገና ይሞክሩ።');
      const url = baseUrl + r.pdf;
      try {
        await api.sendDocument(chatId, url, '📄 ' + r.who.name + ' — CV', {});
      } catch (e) {
        console.error('[binaBot] cv document: ' + e.message);
        await api.sendMessage(chatId, '📄 ሲቪዎ ተዘጋጅቷል፦ ' + url);
      }
      return api.sendMessage(chatId,
        '✅ <b>ሲቪዎ ተዘጋጅቷል።</b>\n\nከሲቪዎ ጋር የሚስማሙ ክፍት የሥራ ቦታዎችን እዚህ ይመልከቱ፦\n' + baseUrl + r.matches
        + '\n\nሲቪዎን በዚሁ ዘርፍ ለሚቀጥሩ ሌሎች ድርጅቶችም እንላክላቸው?',
        { parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[
            { text: '✅ አዎ፣ ይላኩልኝ', callback_data: 'cv:y:' + r.id },
            { text: '🔒 አይ፣ እኔው እመርጣለሁ', callback_data: 'cv:n:' + r.id }]] } });
    }
    return PASS;
  }

  function askPhone(chatId) {
    return api.sendMessage(chatId,
      '📱 አንድ ነገር ብቻ ቀረ — ቀጣሪው የሚደውልበት ስልክ ቁጥርዎ።',
      { reply_markup: { keyboard: [[{ text: '📱 ስልኬን አጋራ', request_contact: true }]],
        resize_keyboard: true, one_time_keyboard: true } });
  }

  // Two per row, the fields people ask for most first. Each button is a normal deep link, so the
  // subscription survives the person closing Telegram mid-way.
  function jobFieldRows() {
    const pick = ['accounting', 'engineering', 'banking', 'sales', 'it', 'health', 'admin', 'logistics', 'education', 'ngo'];
    const rows = [];
    for (let i = 0; i < pick.length; i += 2) {
      rows.push(pick.slice(i, i + 2).map(f => ({ text: jobLabel(f), url: 'https://t.me/' + (botUsername || 'bina_smart_bot') + '?start=jobs_' + f })));
    }
    rows.push([{ text: '🔔 ሁሉም ዘርፍ · All fields', url: 'https://t.me/' + (botUsername || 'bina_smart_bot') + '?start=jobs_all' }]);
    rows.push([{ text: '📋 ሁሉንም ክፍት ሥራ ይመልከቱ', web_app: { url: baseUrl + '/jobs' } }]);
    return rows;
  }
  const jobLabel = f => { try { return require('../jobs/categories').label(f, 'am'); } catch (e) { return f; } };

  // Owner answers keep their slashes: "/bini", "ETB 12,000 /month" and "Units 101 /102" are not bina.et paths.
  function forOwnerTelegram(text) {
    return String(text || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 — $2');
  }

  // Telegram caps a message at 4096 characters; split on paragraph breaks into pieces of at most `max`.
  function splitForTelegram(text, max = 3900) {
    const out = [];
    let cur = '';
    for (let part of String(text).split('\n\n')) {
      while (part.length > max) {                  // one paragraph longer than a message: cut at a line break
        if (cur) { out.push(cur); cur = ''; }
        let cut = part.lastIndexOf('\n', max);
        if (cut <= 0) cut = max;
        out.push(part.slice(0, cut));
        part = part.slice(cut).replace(/^\n/, '');
      }
      if (!cur) cur = part;
      else if (cur.length + 2 + part.length <= max) cur += '\n\n' + part;
      else { out.push(cur); cur = part; }
    }
    if (cur) out.push(cur);
    return out;
  }

  async function ownerScopeFor(msg) {
    if (!owner || !isPrivate(msg) || !msg.from || String(msg.chat.id) !== String(msg.from.id)) return null;
    const s = await owner.access.scopeFor(msg.from.id).catch(e => { console.error('[binaBot] owner scope: ' + e.message); return null; });
    return s && s.mode === 'owner' ? s : null;
  }

  // ---- Owner actions with ✅ confirm (owner actions design §3). owner.actions = agents/owner/actions/service.js. ----
  // A button carries only 'oa:<c|x|u>:<pending action id>'; who pressed, and whether the action may run, is decided by
  // owner.actions.press on the server — never by what the button says.
  const VERB_CODE = { confirm: 'c', cancel: 'x', urgent: 'u' };
  const CODE_VERB = { c: 'confirm', x: 'cancel', u: 'urgent' };
  const actionKeyboard = (id, buttons) => ({ inline_keyboard: (buttons || []).length
    ? [buttons.filter(b => VERB_CODE[b.verb]).map(b => ({ text: b.label, callback_data: 'oa:' + VERB_CODE[b.verb] + ':' + id }))] : [] });

  async function answerOwner(chatId, text, from, scope) {
    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});
    const out = await owner.answer({ text: text.slice(0, 1200), from, chatId, scope })
      .catch(e => { console.error('[binaBot] owner answer: ' + e.message); return null; });
    const reply = out && typeof out === 'object' ? out.reply : out;
    if (!reply) return api.sendMessage(chatId, 'ቢኒ ትንሽ ተጠምዷል፣ እባክዎ በደቂቃ ውስጥ እንደገና ይሞክሩ። · Bini is busy — please try again in a minute.');
    const action = out && typeof out === 'object' ? out.ownerAction : null;
    const withButtons = !!(action && action.id && (action.buttons || []).length && owner.actions);
    const sent = await api.sendMessage(chatId, forOwnerTelegram(reply), { disable_web_page_preview: true,
      reply_markup: withButtons ? actionKeyboard(action.id, action.buttons)
        : { inline_keyboard: [[{ text: '🏢 ዳሽቦርድ · Dashboard', url: baseUrl + '/owner' }]] } });
    if (withButtons && sent && sent.message_id != null)
      await owner.actions.attachCard(action.id, chatId, sent.message_id).catch(e => console.error('[binaBot] action card: ' + errKind(e)));
    // Prepared by staff: the card with the buttons goes to the owner's own chat.
    if (action && action.id && action.ownerConfirms && owner.actions) {
      const cards = await owner.actions.ownerCards(action.id).catch(e => { console.error('[binaBot] owner cards: ' + errKind(e)); return []; });
      for (const c of cards) {
        const m = await api.sendMessage(c.chatId, forOwnerTelegram(c.text), { disable_web_page_preview: true, reply_markup: actionKeyboard(action.id, c.buttons) })
          .catch(e => { console.error('[binaBot] owner card send: ' + errKind(e)); return null; });
        if (m && m.message_id != null) await owner.actions.attachCard(action.id, c.chatId, m.message_id).catch(e => console.error('[binaBot] action card: ' + errKind(e)));
      }
    }
    return sent;
  }

  async function pressOwnerAction(cq, code, id) {
    const chat = cq.message.chat || {};
    // Answered at once so the button stops spinning; sending to many tenants can take longer than Telegram waits.
    try { await api.answerCallbackQuery(cq.id, '⏳'); } catch (e) { /* ignore */ }
    if (chat.type !== 'private' || !cq.from) return null;
    let r;
    try {
      r = await owner.actions.press({ id, verb: CODE_VERB[code],
        actor: { channel: 'owner-telegram', telegramId: String(cq.from.id), chatId: String(chat.id), messageId: cq.message.message_id } });
    } catch (e) {
      console.error('[binaBot] owner action press: ' + errKind(e));
      return api.sendMessage(String(chat.id), SORRY);
    }
    for (const e of (r && r.edits) || [])
      await api.editMessageText(e.chatId, e.messageId, forOwnerTelegram(e.text), { disable_web_page_preview: true, reply_markup: actionKeyboard(e.id, e.buttons) })
        .catch(err => console.error('[binaBot] action card edit: ' + errKind(err)));
    if (r && r.toast && !(r.edits || []).length) return api.sendMessage(String(chat.id), r.toast);
    return r;
  }

  async function linkOwner(chatId, msg) {
    let r;
    try {
      r = await owner.access.linkFromContact({ chat: msg.chat, from: msg.from, contact: msg.contact,
        // forward_origin is the current Bot API; forward_from/forward_date are the legacy fields; via_bot means an
        // inline bot composed it. None of these is the sender sharing their own number.
        forwarded: !!(msg.forward_origin || msg.forward_from || msg.forward_date || msg.via_bot) });
    } catch (e) {
      console.error('[binaBot] owner link: ' + e.message);
      return api.sendMessage(chatId, 'ይቅርታ፣ አሁን ማገናኘት አልተቻለም። · Sorry, linking failed just now.', { reply_markup: NO_KB });
    }
    if (!r || !r.ok) return api.sendMessage(chatId, REFUSAL[(r && r.reason) || 'not_registered'] || REFUSAL.not_registered, { reply_markup: NO_KB });
    const report = await owner.health(r.scope).catch(e => { console.error('[binaBot] owner health: ' + e.message); return null; });
    const parts = splitForTelegram('✅ ተገናኝቷል · Linked\n\n' + (report || HEALTH_FALLBACK));
    let last;
    for (let i = 0; i < parts.length; i++) last = await api.sendMessage(chatId, parts[i], i === 0 ? { reply_markup: NO_KB } : {});
    return last;
  }

  async function handleOwnerCommand(chatId, msg, text) {
    // t.me/bina_smart_bot?start=owner or ?start=owner_<building> (e.g. owner_darulle, a link Ibrahim sends one owner).
    // The suffix only makes the link recognisable; access is still decided by the approved phone number alone.
    if (/^\/start\s+owner(?:_[A-Za-z0-9-]{1,40})?(?:\s|$)/.test(text)) {
      pendingTenant.delete(String(msg.from.id));   // the newest start command decides what a contact means
      markPending(msg.from.id);
      return api.sendMessage(chatId, OWNER_START, { reply_markup: SHARE_KB });
    }
    if (msg.contact) return takePending(msg.from.id) ? linkOwner(chatId, msg) : PASS;
    if (/^\/logout\b/.test(text)) {
      pendingLink.delete(String(msg.from.id));
      const done = await owner.access.unlink(msg.from.id).catch(e => { console.error('[binaBot] owner unlink: ' + e.message); return FAILED; });
      if (done === FAILED) return api.sendMessage(chatId, SORRY, { reply_markup: NO_KB });
      return api.sendMessage(chatId, done ? 'ከቢኒ ለባለቤቶች ወጥተዋል። · Signed out of Bini for owners.' : NOT_LINKED, { reply_markup: NO_KB });
    }
    const m = /^\/(bini|owner)\b/.exec(text);
    if (m) {
      const done = await owner.access.setMode(msg.from.id, m[1]).catch(e => { console.error('[binaBot] owner mode: ' + e.message); return FAILED; });
      if (done === FAILED) return api.sendMessage(chatId, SORRY);
      if (!done) return api.sendMessage(chatId, NOT_LINKED);
      return api.sendMessage(chatId, m[1] === 'bini'
        ? 'ቢኒ ለደንበኞች ተመልሷል። ወደ ባለቤት ቢኒ ለመመለስ /owner ይጻፉ። · Customer Bini is back. Type /owner to return to Bini for owners.'
        : '🏢 ቢኒ ለባለቤቶች ተመልሷል። · Bini for owners is back.');
    }
    return PASS;
  }

  function turns(chatId) {
    const h = hist.get(chatId);
    if (h && clock() - h.t < HIST_TTL_MS) { h.t = clock(); return h.turns; }
    const n = { turns: [], t: clock() }; hist.set(chatId, n);
    if (hist.size > 5000) for (const [k, v] of hist) if (clock() - v.t > HIST_TTL_MS) hist.delete(k);
    return n.turns;
  }

  // A station / channel answer should read like a player, not a link: drop the URL from the text (the button carries it).
  function forMedia(text) {
    const s = String(text || '');
    if (!/\/watch\?open=(radio|tv|series|kids)\//.test(s)) return null;
    return s.replace(/\[([^\]]+)\]\((?:https?:\/\/bina\.et)?\/watch\?open=[^)]+\)/g, '$1')
      .replace(/(?:https?:\/\/bina\.et)?\/watch\?open=[a-z0-9\/_-]+[።.,]?/g, '')
      .replace(/(ከታች ያለውን ሊንክ|ይህን ሊንክ|the link below|this link|linkii kana|liinkii kana)/gi, 'ከታች ያለውን ቁልፍ')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n\n👇';
  }
  // Bini writes markdown links like [text](/ride); Telegram plain text needs full URLs.
  function forTelegram(text) {
    const m = forMedia(text); if (m) return m;
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
      const media = /^\/watch\?open=(radio|tv|series|kids)\//.exec(path);
      const label = media ? (media[1] === 'radio' ? '▶️ አጫውት · Play' : '▶️ ክፈት · Open') : /^\/watch/.test(path) ? '▶️ BinaWatch ክፈት · Open' : /^\/tenders/.test(path) ? '📋 ጨረታ · Open tender' : /^\/cinema/.test(path) ? '🎬 ሲኒማ · Open' : /^\/pool/.test(path) ? '👥 ጋራ ጉዞ · Open' : '🔗 ክፈት · Open ' + path.split(/[?#]/)[0];
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
    // Somebody speaking their working life needs longer than somebody asking a question.
    const cvState = cv ? await cv.stateOf(chatId).catch(() => null) : null;
    const speakingCv = !!(cvState && cvState.state === 'cv_wait_voice');
    const maxSec = speakingCv ? 240 : 120;
    if (!v || (v.duration && v.duration > maxSec)) return api.sendMessage(chatId,
      speakingCv ? 'የድምጽ መልእክቱ በጣም ረጅም ነው (እስከ 4 ደቂቃ)። · Voice note too long (max 4 minutes).'
                 : 'የድምጽ መልእክቱ በጣም ረጅም ነው (እስከ 2 ደቂቃ)። · Voice note too long (max 2 minutes).');
    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});
    try {
      const file = await api.getFile(v.file_id);
      const buf = await api.downloadFile(file.file_path);
      const r = await f(assistantUrl.replace(/\/api\/assistant$/, '/api/assistant/transcribe'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-key': internalKey || '' }, body: JSON.stringify({ audio: buf.toString('base64'), mime: v.mime_type || 'audio/ogg' }) });
      const d = await r.json().catch(() => ({}));
      const text = d && d.ok ? String(d.text || '').trim() : '';
      if (!text || /^\[unclear\]/i.test(text) || isNoise(text)) return api.sendMessage(chatId, 'ይቅርታ፣ ድምጹን መስማት አልቻልኩም። እባክዎ ይጻፉ ወይም እንደገና ይሞክሩ። · Sorry, I could not hear that. Please type it or try again.');
      // A spoken CV (jobs/voice-cv.js), not a question - the transcript goes to the CV writer.
      if (speakingCv) {
        const r = await cv.onTranscript(chatId, text).catch(() => ({ ok: false }));
        if (!r.ok) return api.sendMessage(chatId,
          'ትንሽ አጭር ነው። ስምዎን፣ የሠሩትን ሥራ፣ የት እና መቼ፣ እንዲሁም ትምህርትዎን ጨምረው እንደገና ይናገሩ።');
        if (r.need === 'name') return api.sendMessage(chatId, 'ጥሩ። ሙሉ ስምዎን ይጻፉልኝ።');
        return askPhone(chatId);
      }
      const ownerScope = await ownerScopeFor(msg);
      if (ownerScope) return answerOwner(chatId, text, msg.from, ownerScope);
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
    // Tenant notices: /start tenant_<slug>, the shared contact, /stop — private chats only, and only when server.js
    // passes the tenant link service.
    if (tenant && isPrivate(msg) && msg.from) {
      const handled = await handleTenantCommand(chatId, msg, text);
      if (handled !== PASS) return handled;
    }
    // A CV spoken into the bot: /cv, the voice note, the name, the shared contact — private chats only.
    if (cv && isPrivate(msg) && msg.from) {
      const handled = await handleCvCommand(chatId, msg, text);
      if (handled !== PASS) return handled;
    }
    // Job alerts: /start jobs_<field>, /jobs, /stopjobs — private chats only.
    if (jobs && isPrivate(msg) && msg.from) {
      const handled = await handleJobsCommand(chatId, msg, text);
      if (handled !== PASS) return handled;
    }
    // Bini for owners: /start owner, the shared contact, /logout, /bini, /owner — private chats only, and only
    // when server.js passes the owner service.
    if (owner && isPrivate(msg) && msg.from) {
      const handled = await handleOwnerCommand(chatId, msg, text);
      if (handled !== PASS) return handled;
    }
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
    const ownerScope = await ownerScopeFor(msg);
    if (ownerScope) return answerOwner(chatId, text, msg.from, ownerScope);
    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});
    const reply = await askBini(chatId, text.slice(0, 1200), msg.from);
    if (!reply) return api.sendMessage(chatId, 'Bini is busy for a moment — please try again in a minute, or open bina.et. · ቢኒ ትንሽ ተጠምዷል፣ እባክዎ በደቂቃ ውስጥ እንደገና ይሞክሩ።', { reply_markup: menuMarkup() });
    return api.sendMessage(chatId, forTelegram(reply), { reply_markup: replyMarkup(reply, text), disable_web_page_preview: true });
  }

  async function handleCallback(cq) {
    if (!cq || !cq.message) return;
    const oa = /^oa:([cxu]):([A-Za-z0-9_-]{22})$/.exec(String(cq.data || ''));
    if (oa && owner && owner.actions) return pressOwnerAction(cq, oa[1], oa[2]);
    // Consent for a spoken CV, asked after the person has the PDF in their hand rather than before.
    const cvc = /^cv:([yn]):([A-Za-z0-9_-]{10,40})$/.exec(String(cq.data || ''));
    if (cvc && cv) {
      try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
      const yes = cvc[1] === 'y';
      await cv.setConsent(cvc[2], yes);
      return api.sendMessage(String(cq.message.chat.id), yes
        ? '✅ እሺ። በዘርፍዎ ለሚቀጥሩ ድርጅቶች ሲቪዎን እንልካለን። ሐሳብዎን ከቀየሩ ይጻፉልን።'
        : '🔒 እሺ። ሲቪዎ ለማንም አይላክም — እርስዎ ሲያመለክቱ ብቻ ነው የሚሄደው።');
    }
    try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
    if (cq.data === 'menu') return api.sendMessage(String(cq.message.chat.id), 'Pick a service · አገልግሎት ይምረጡ 👇', { reply_markup: menuMarkup() });
  }

  return { handleUpdate: u => (u && u.callback_query ? handleCallback(u.callback_query) : handleUpdate(u)), forTelegram, forOwnerTelegram, _hist: hist, MENU, COMMANDS };
}
module.exports = { makeBinaBot, MENU, COMMANDS };
