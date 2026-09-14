/* The logic of the /afiya and /asmat chat pages, with no DOM in it, so node:test can run it
   (test/agent-chat-core.test.js). The page loads it as /static/agent-chat-core.js and reads window.AgentChatCore;
   node reads module.exports. agent-chat.js draws what this decides.
   A reply is turned into a card model here; the page only ever puts card text into the page as TEXT. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AgentChatCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LANGS = ['am', 'en', 'om'];
  var MAX_CHATS = 20, MAX_MESSAGES = 40, TITLE_LEN = 60, MAX_QUESTION = 500, MAX_RECORD_SECONDS = 60;
  var KINDS = ['answer', 'emergency', 'urgent', 'redirect'];
  var URL_RE = /https?:\/\/[^\s<>"'`]+/g;
  var TEL_RE = /^\d{3,4}$/;

  function str(v) { return v == null ? '' : String(v); }

  // Markdown bold is stripped (as the old pages did); line breaks are kept, runs of blank lines are not.
  function cleanText(s) {
    return str(s).replace(/\*\*/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Text → [{type:'text', value}] and [{type:'link', href, value}] for http(s) links only. The page makes a
  // text node or an <a> from each; nothing is ever parsed as HTML.
  function linkify(text) {
    var s = str(text), out = [], last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(s))) {
      var url = m[0].replace(/[.,;:!?)\]}።፣]+$/, '');
      if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
      out.push({ type: 'link', href: url, value: url });
      last = m.index + url.length;
      URL_RE.lastIndex = last;
    }
    if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
    return out;
  }

  // The engine closes an answer with "\n\n" + the agent's disclosure. When the reply ends with one of the
  // disclosures the page was given (am, en, om), it is shown apart from the answer. Anything else — a
  // fallback that starts with the disclosure, a reply that is only the disclosure — is shown as it came.
  function splitDisclosure(text, disclosures) {
    var t = cleanText(text), keys = disclosures ? Object.keys(disclosures) : [];
    for (var i = 0; i < keys.length; i++) {
      var d = cleanText(disclosures[keys[i]]);
      if (d && t.length > d.length && t.slice(-d.length) === d) {
        var body = t.slice(0, -d.length).trim();
        if (body) return { body: body, disclosure: d };
      }
    }
    return { body: t, disclosure: '' };
  }

  function numbersIn(text, numbers) {
    var t = str(text), out = [];
    for (var i = 0; i < numbers.length; i++) {
      if (new RegExp('(^|\\D)' + numbers[i] + '(\\D|$)').test(t)) out.push(numbers[i]);
    }
    return out;
  }

  function uniqueTel(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { var n = str(list[i]); if (TEL_RE.test(n) && out.indexOf(n) < 0) out.push(n); }
    return out;
  }

  function cleanSources(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length && out.length < 2; i++) {
      var s = list[i];
      if (!s || typeof s !== 'object') continue;
      var url = str(s.url), title = cleanText(s.title).replace(/\s+/g, ' ').slice(0, 120);
      if (!/^https?:\/\/[^\s<>"']+$/i.test(url) || !title) continue;
      out.push({ title: title, url: url });
    }
    return out;
  }

  // One card model for a fresh reply and for a card read back from storage (which anyone with the phone
  // could have edited): same checks either way.
  function normaliseCard(card) {
    var c = card && typeof card === 'object' ? card : {};
    var kind = KINDS.indexOf(c.kind) >= 0 ? c.kind : 'answer';
    return {
      kind: kind,
      text: cleanText(c.text),
      disclosure: cleanText(c.disclosure),
      call: kind === 'emergency' || kind === 'urgent' ? uniqueTel(Array.isArray(c.call) ? c.call : []) : [],
      sources: kind === 'answer' ? cleanSources(c.sources) : []
    };
  }

  // A /api/afiya or /api/asmat response → card. Flags are compared with === true: a normal answer carries
  // emergency: false (Afiya) or urgent: false (Asmat).
  function toCard(d, cfg) {
    d = d && typeof d === 'object' ? d : {};
    cfg = cfg || {};
    var numbers = uniqueTel((cfg.emergency && cfg.emergency.numbers) || []);
    var parts = splitDisclosure(d.reply, cfg.disclosure);
    var kind = d.emergency === true ? 'emergency' : d.urgent === true ? 'urgent' : d.redirected === true ? 'redirect' : 'answer';
    var call = kind === 'emergency' ? [d.ambulance].concat(numbers)
      : kind === 'urgent' ? numbersIn(parts.body, numbers) : [];
    return normaliseCard({ kind: kind, text: parts.body, disclosure: parts.disclosure, call: call, sources: d.sources });
  }

  function titleOf(q) {
    var t = str(q).replace(/\s+/g, ' ').trim();
    return t.length > TITLE_LEN ? t.slice(0, TITLE_LEN - 1).trim() + '…' : t;
  }

  // Past chats, on this phone only. storage is localStorage in the page and a fake in tests; every read and
  // write is wrapped, so private browsing or a full disk means no history, never a broken page.
  function makeHistory(storage, key, now) {
    now = now || function () { return Date.now(); };
    function valid(c) { return c && typeof c === 'object' && typeof c.id === 'string' && Array.isArray(c.messages); }
    function read() {
      try {
        var raw = storage && storage.getItem(key);
        var v = raw ? JSON.parse(raw) : [];
        return Array.isArray(v) ? v.filter(valid) : [];
      } catch (e) { return []; }
    }
    function write(list) {
      try { if (!storage) return false; storage.setItem(key, JSON.stringify(list)); return true; } catch (e) { return false; }
    }
    function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }
    return {
      list: function () {
        return read().map(function (c) { return { id: c.id, title: titleOf(c.title), updated: Number(c.updated) || 0, count: c.messages.length }; });
      },
      get: function (id) {
        var list = read(), i = find(list, id);
        if (i < 0) return null;
        var msgs = [];
        for (var j = 0; j < list[i].messages.length; j++) {
          var m = list[i].messages[j];
          if (m && m.role === 'user') msgs.push({ role: 'user', text: cleanText(m.text).slice(0, MAX_QUESTION) });
          else if (m && m.role === 'agent') msgs.push({ role: 'agent', card: normaliseCard(m.card) });
        }
        return { id: list[i].id, title: titleOf(list[i].title), messages: msgs };
      },
      create: function (question) {
        var id = 'c' + now().toString(36) + Math.random().toString(36).slice(2, 7);
        write([{ id: id, title: titleOf(question), updated: now(), messages: [] }].concat(read()).slice(0, MAX_CHATS));
        return id;
      },
      add: function (id, message) {
        var list = read(), i = find(list, id);
        if (i < 0) return false;
        var chat = list[i];
        chat.messages.push(message);
        if (chat.messages.length > MAX_MESSAGES) chat.messages = chat.messages.slice(-MAX_MESSAGES);
        chat.updated = now();
        list.splice(i, 1);
        list.unshift(chat);
        return write(list);
      },
      remove: function (id) {
        var list = read(), i = find(list, id);
        if (i < 0) return false;
        list.splice(i, 1);
        return write(list);
      },
      clear: function () {
        try { if (storage) storage.removeItem(key); return true; } catch (e) { return false; }
      }
    };
  }

  function pickLang(value, fallback) {
    return LANGS.indexOf(value) >= 0 ? value : (LANGS.indexOf(fallback) >= 0 ? fallback : 'am');
  }
  function loadLang(storage, key, fallback) {
    try { return pickLang(storage && storage.getItem(key), fallback); } catch (e) { return pickLang(null, fallback); }
  }
  function saveLang(storage, key, lang) {
    if (LANGS.indexOf(lang) < 0) return false;
    try { if (!storage) return false; storage.setItem(key, lang); return true; } catch (e) { return false; }
  }

  // A per-language value from the page config. Oromo UI strings are not written yet (design §2): anything
  // without an 'om' falls back to English, and anything without the asked language falls back to English,
  // then Amharic.
  function pick(value, lang) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
    if (value[lang] != null) return value[lang];
    return value.en != null ? value.en : value.am;
  }

  function queryFrom(search) {
    var m = /[?&]q=([^&#]*)/.exec(str(search));
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim().slice(0, MAX_QUESTION); } catch (e) { return ''; }
  }

  // The first recording format this browser can make that the voice route accepts. '' = no microphone button.
  function pickMime(isTypeSupported) {
    var list = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    if (typeof isTypeSupported !== 'function') return '';
    for (var i = 0; i < list.length; i++) { try { if (isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return '';
  }
  function baseMime(m) { return str(m).split(';')[0].trim().toLowerCase(); }
  function formatTimer(seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  return {
    LANGS: LANGS, MAX_CHATS: MAX_CHATS, MAX_MESSAGES: MAX_MESSAGES, MAX_QUESTION: MAX_QUESTION, MAX_RECORD_SECONDS: MAX_RECORD_SECONDS,
    cleanText: cleanText, linkify: linkify, splitDisclosure: splitDisclosure, toCard: toCard, normaliseCard: normaliseCard,
    makeHistory: makeHistory, titleOf: titleOf, pickLang: pickLang, loadLang: loadLang, saveLang: saveLang, pick: pick,
    queryFrom: queryFrom, pickMime: pickMime, baseMime: baseMime, formatTimer: formatTimer
  };
});
