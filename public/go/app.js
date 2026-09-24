/* Bina (the customer app) — /go. One big box to ask Bini, which opens into the whole screen as a chat.
   Talks to POST /api/assistant with the last turns (the server keeps 6) and, for the microphone, to
   POST /api/assistant/voice, which only transcribes: the words land in the box and the person sends
   them, so the emergency and politics gates in /api/assistant apply to speech exactly as to typing.
   Recording helpers come from agent-chat-core.js (shared with /afiya and /asmat, used read-only here).
   Every piece of text from a reply or from storage is put in the page as a text node or textContent —
   never as HTML. The pure helpers at the top are exported for node:test (test/go-page.test.js). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GoApp = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var STORE_KEY = 'bina_go_chat_v1', MAX_KEEP = 30, HISTORY_TURNS = 6, KEEP_MS = 7 * 864e5, MAX_Q = 1000;
  var SITE = 'https://bina.et';
  var SRC_RE = /^(ምንጭ|ምንጮች|ዋቢ|source|sources|madda|maddawwan)(?=\s|[:፦-]|$)/i;
  var PAGES = { '/ride': 'ራይድ ይዘዙ', '/pool': 'ጋራ ጉዞ', '/news': 'ዜና', '/tenders': 'ጨረታዎች', '/guides': 'መመሪያዎች',
    '/jobs': 'ሥራ', '/cinema': 'ሲኒማ', '/watch': 'ቢናዋች', '/hotels': 'ሆቴሎች', '/airport': 'ኤርፖርት', '/passport': 'ፓስፖርት', '/fayda': 'ፋይዳ' };

  function str(v) { return v == null ? '' : String(v); }

  // A link Bini wrote → something safe to put in href, or null. Site paths become bina.et links.
  function safeHref(u) {
    u = str(u).trim();
    if (/^\/[^\s/\\][^\s<>"']*$/.test(u) || u === '/') return SITE + u;
    if (/^https?:\/\/[^\s<>"'`]+$/i.test(u)) return u;
    if (/^tel:\+?\d{3,15}$/.test(u)) return u;
    return null;
  }
  function isInternal(href) { return /^https:\/\/(www\.)?bina\.et(\/|$|\?|#)/i.test(str(href)); }
  function shortUrl(href) { return str(href).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''); }
  // How a bare link is shown: no scheme, no www, a long path cut short (the href stays whole).
  function showUrl(href) { var s = shortUrl(href), i = s.indexOf('/'); return i > 0 && s.length > 40 ? s.slice(0, i) + '/…' : s; }

  // One line of Bini's text → [{t:'text'|'b'|'a', v, href}]. Handles **bold**, [label](url), bare links,
  // "bina.et/passport" written without https (Bini does that), and makes birr amounts bold so a reader
  // scanning a long fee answer finds the figures. No lookbehind: old Android Chrome would reject the file.
  var INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|(https?:\/\/[^\s<>"'`]+)|(^|[\s(«"'])((?:www\.)?bina\.et\/[^\s<>"'`]*)|(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?(?:ብር|birr|ETB|Br)(?![A-Za-z]))/gi;
  function trimUrl(u) { return u.replace(/[.,;:!?)\]}።፣]+$/, ''); }
  function inline(text) {
    var s = str(text), out = [], last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(s))) {
      var start = m.index, seg = null, end = m.index + m[0].length;
      if (m[1] != null) seg = { t: 'b', v: m[1] };
      else if (m[2] != null) {
        var h = safeHref(m[3]);
        seg = h ? { t: 'a', v: m[2], href: h } : { t: 'text', v: m[2] };
      } else if (m[4] != null) {
        var url = trimUrl(m[4]);
        end = start + url.length;
        seg = { t: 'a', v: showUrl(url), href: url };
      } else if (m[6] != null) {
        start = m.index + m[5].length;
        var bare = trimUrl(m[6]);
        end = start + bare.length;
        seg = { t: 'a', v: shortUrl('https://' + bare), href: 'https://' + bare.replace(/^www\./i, '') };
      } else seg = { t: 'b', v: m[7] + m[8] };
      if (start > last) out.push({ t: 'text', v: s.slice(last, start) });
      out.push(seg);
      last = end; INLINE.lastIndex = end;
    }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
    return out.filter(function (x) { return x.v !== ''; });
  }

  // Bini's reply → blocks: paragraphs, bullet lists, numbered lists, and a quieter "source" line.
  function blocks(text) {
    // Bini sometimes starts a list on the same line as its lead-in ("…ይለያያሉ፦ * **ሞተር:** 205 ብር"):
    // a bullet straight after a colon or ፦ begins a new line.
    var lines = str(text).replace(/\r\n?/g, '\n').replace(/([፦:])[ \t]+[*•][ \t]+(?=\S)/g, '$1\n* ').split('\n'), out = [], cur = null;
    function flush() { if (cur) { out.push(cur); cur = null; } }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/\s+$/, ''), m;
      if (!l.trim()) { flush(); continue; }
      l = l.replace(/^#{1,6}\s+/, '');
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) {
        if (!cur || cur.type !== 'ul') { flush(); cur = { type: 'ul', items: [] }; }
        cur.items.push(inline(m[1])); continue;
      }
      if ((m = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(l))) {
        if (!cur || cur.type !== 'ol') { flush(); cur = { type: 'ol', items: [] }; }
        cur.items.push(inline(m[2])); continue;
      }
      var plain = l.replace(/\*\*/g, '').trim();
      if (SRC_RE.test(plain)) { flush(); out.push({ type: 'src', items: [inline(l.trim())] }); continue; }
      if (!cur || cur.type !== 'p') { flush(); cur = { type: 'p', items: [] }; }
      cur.items.push(inline(l.trim()));
    }
    flush();
    return out.reduce(function (acc, b) { acc.push(b); var t = listTail(b); if (t) acc.push(t); return acc; }, []);
  }
  // "* **XL:** 915 ብር This price is locked…" - a model often runs its closing sentence into the last
  // bullet. When the last item is "label + value" followed by a long sentence, the sentence becomes a paragraph.
  function listTail(b) {
    if (b.type !== 'ul' && b.type !== 'ol') return null;
    var segs = b.items[b.items.length - 1];
    if (!segs.length || segs[0].t !== 'b') return null;
    for (var i = 1; i < segs.length && i < 4; i++) {
      if (segs[i].t !== 'text' || segs[i - 1].t !== 'b') continue;
      var v = segs[i].v;
      if (/^\s/.test(v) && v.trim().length > 30 && /[።.?!]/.test(v)) {
        b.items[b.items.length - 1] = segs.slice(0, i);
        return { type: 'p', items: [[{ t: 'text', v: v.trim() }].concat(segs.slice(i + 1))] };
      }
    }
    return null;
  }

  // Which page a tool Bini used belongs to: a fare quote gets a "book a ride" button even when the
  // reply names no link.
  var TOOL_PAGES_LIST = ['/ride', '/pool', '/tenders', '/cinema'];
  var TOOL_PAGES = { quote_ride: '/ride', request_ride: '/ride', ride_status: '/ride', pool_board: '/pool',
    search_tenders: '/tenders', cinema_programme: '/cinema' };
  function pageForTools(tools) {
    if (!Array.isArray(tools)) return undefined;
    for (var i = 0; i < tools.length; i++) if (TOOL_PAGES[tools[i]]) return TOOL_PAGES[tools[i]];
    return undefined;
  }

  // Up to two bina.et pages named in a reply, as one-tap buttons under it (never /go itself).
  function opensFrom(text, page) {
    var out = [], seen = {}, bl = blocks(text);
    if (page && PAGES[page]) { seen[page] = 1; out.push({ href: SITE + page, label: PAGES[page] }); }
    bl.forEach(function (b) { b.items.forEach(function (segs) { segs.forEach(function (s) {
      if (s.t !== 'a' || !isInternal(s.href) || out.length >= 2) return;
      var path = s.href.replace(/^https:\/\/(www\.)?bina\.et/i, '').split('#')[0] || '/';
      var base = path.split('?')[0].replace(/\/$/, '') || '/';
      if (base === '/' || base === '/go' || /^\/(api|login|ops|static)\b/.test(base) || seen[path]) return;
      seen[path] = 1;
      out.push({ href: SITE + path, label: PAGES[base] || shortUrl(SITE + base) });
    }); }); });
    return out;
  }

  // What /api/assistant expects: [{role:'user'|'assistant', content}], last turns only, answered turns only.
  function historyFor(msgs) {
    var out = [];
    (msgs || []).forEach(function (m) {
      if (!m || typeof m.t !== 'string' || !m.t) return;
      if (m.r === 'u') out.push({ role: 'user', content: m.t.slice(0, 1200) });
      else if (m.r === 'b' && m.k !== 'err') out.push({ role: 'assistant', content: m.t.slice(0, 1200) });
    });
    return out.slice(-HISTORY_TURNS);
  }

  function loadChat(storage, now) {
    try {
      var v = JSON.parse((storage && storage.getItem(STORE_KEY)) || 'null');
      if (!v || !Array.isArray(v.msgs) || (now || Date.now()) - Number(v.at || 0) > KEEP_MS) return [];
      return v.msgs.filter(function (m) { return m && (m.r === 'u' || m.r === 'b') && typeof m.t === 'string' && m.t; })
        .map(function (m) { return { r: m.r, t: m.t.slice(0, 6000), k: m.k === 'sos' ? 'sos' : undefined, go: TOOL_PAGES_LIST.indexOf(m.go) >= 0 ? m.go : undefined, amb: /^\d{3,4}$/.test(str(m.amb)) ? str(m.amb) : undefined }; })
        .slice(-MAX_KEEP);
    } catch (e) { return []; }
  }
  function saveChat(storage, msgs, now) {
    try { if (!storage) return false; storage.setItem(STORE_KEY, JSON.stringify({ at: now || Date.now(), msgs: (msgs || []).slice(-MAX_KEEP) })); return true; }
    catch (e) { return false; }
  }

  var api = { STORE_KEY: STORE_KEY, HISTORY_TURNS: HISTORY_TURNS, MAX_Q: MAX_Q, safeHref: safeHref, isInternal: isInternal,
    inline: inline, blocks: blocks, opensFrom: opensFrom, historyFor: historyFor, pageForTools: pageForTools, loadChat: loadChat, saveChat: saveChat };
  if (typeof document !== 'undefined' && document.getElementById('ask')) boot(api);
  return api;

  // ------------------------------------------------------------------ the page
  function boot(G) {
    var C = window.AgentChatCore || null;
    var $ = function (id) { return document.getElementById(id); };
    var ask = $('ask'), log = $('log'), form = $('form'), q = $('q'), send = $('send'), mic = $('mic'),
      note = $('note'), rec = $('rec'), recTime = $('recTime'), resume = $('resume');
    var store = null; try { store = window.localStorage; } catch (e) {}
    var msgs = G.loadChat(store), busy = false, isOpen = false, spacer = null, recState = null, noteT = 0;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var SVG = 'http://www.w3.org/2000/svg';

    try { if (/[?&]src=app\b/.test(location.search)) sessionStorage.setItem('bina_app', '1'); } catch (e) {}

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function icon(d) {
      var s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
      var p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.appendChild(p); return s;
    }
    function uid() {
      try { var k = 'bina_uid', v = store.getItem(k); if (!v) { v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); store.setItem(k, v); } return v; }
      catch (e) { return ''; }
    }
    function showNote(t) { note.textContent = t || ''; clearTimeout(noteT); if (t) noteT = setTimeout(function () { note.textContent = ''; }, 7000); }
    function toast(t) {
      var x = el('div', 'toast', t); x.setAttribute('role', 'status'); document.body.appendChild(x);
      setTimeout(function () { if (x.parentNode) x.parentNode.removeChild(x); }, 4500);
    }

    // ---------- drawing ----------
    function segsInto(node, segs) {
      segs.forEach(function (s) {
        if (s.t === 'b') node.appendChild(el('strong', null, s.v));
        else if (s.t === 'a') {
          var a = el('a', null, s.v); a.href = s.href; a.rel = 'noopener';
          if (!G.isInternal(s.href) && !/^tel:/.test(s.href)) a.target = '_blank';
          node.appendChild(a);
        } else node.appendChild(document.createTextNode(s.v));
      });
    }
    function bodyOf(text) {
      var body = el('div', 'body');
      G.blocks(text).forEach(function (b) {
        if (b.type === 'ul' || b.type === 'ol') {
          var list = el(b.type);
          b.items.forEach(function (segs) { var li = el('li'); segsInto(li, segs); list.appendChild(li); });
          body.appendChild(list);
        } else {
          var p = el('p', b.type === 'src' ? 'src' : null);
          b.items.forEach(function (segs, i) { if (i) p.appendChild(el('br')); segsInto(p, segs); });
          body.appendChild(p);
        }
      });
      return body;
    }
    function bini(node) { var w = el('div', 'msg b'), m = el('span', 'bm', 'ቢ'); m.setAttribute('aria-hidden', 'true'); w.appendChild(m); w.appendChild(node); return w; }
    function drawUser(t) { var w = el('div', 'msg u'); w.appendChild(el('p', null, t)); log.appendChild(w); return w; }
    function drawBini(m) {
      var body;
      if (m.k === 'sos') {
        body = el('div', 'body');
        var box = el('div', 'sos'); box.setAttribute('role', 'alert');
        box.appendChild(bodyOf(m.t));
        if (m.amb) { var c = el('a', 'call', '📞 ' + m.amb); c.href = 'tel:' + m.amb; box.appendChild(c); }
        body.appendChild(box);
      } else {
        body = bodyOf(m.t);
        var opens = G.opensFrom(m.t, m.go);
        if (opens.length) {
          var row = el('div', 'opens');
          opens.forEach(function (o) { var a = el('a'); a.href = o.href; a.appendChild(document.createTextNode(o.label)); a.appendChild(icon('M9 5l7 7-7 7')); row.appendChild(a); });
          body.appendChild(row);
        }
      }
      var w = bini(body); log.appendChild(w); return w;
    }
    function drawAll() {
      log.textContent = '';
      log.appendChild(el('p', 'disc', 'ቢኒ AI ነው፤ ክፍያና ቀን ከምንጩ ያረጋግጡ · Bini is AI: check fees and dates with the source'));
      msgs.forEach(function (m) { if (m.r === 'u') drawUser(m.t); else drawBini(m); });
    }
    function toEnd(node, smooth) {
      if (!node) { log.scrollTop = log.scrollHeight; return; }
      // Show the start of a long answer, not its end: people read from the top.
      var top = node.offsetTop - 12;
      try { log.scrollTo({ top: top, behavior: smooth && !reduce ? 'smooth' : 'auto' }); } catch (e) { log.scrollTop = top; }
    }
    function syncSend() { send.disabled = busy || !q.value.trim(); }
    function syncResume() { resume.hidden = isOpen || !msgs.length; }

    // ---------- open / close: the same box grows to the whole screen ----------
    function fit() {
      if (!isOpen) return;
      var vv = window.visualViewport;
      ask.style.top = (vv ? vv.offsetTop : 0) + 'px';
      ask.style.height = (vv ? vv.height : window.innerHeight) + 'px';
    }
    function open(push) {
      if (isOpen) return;
      isOpen = true;
      var r = ask.getBoundingClientRect();
      spacer = el('div'); spacer.style.height = r.height + 'px'; ask.parentNode.insertBefore(spacer, ask);
      ask.classList.add('open');
      ask.style.top = r.top + 'px'; ask.style.left = r.left + 'px'; ask.style.width = r.width + 'px'; ask.style.height = r.height + 'px';
      ask.style.borderRadius = '28px';
      document.body.classList.add('chat');
      drawAll(); syncResume();
      q.rows = 1; q.style.height = '';
      q.placeholder = 'ጥያቄዎን ይጻፉ…';
      requestAnimationFrame(function () {
        if (!reduce) ask.classList.add('anim');
        requestAnimationFrame(function () {
          ask.style.left = '0px'; ask.style.width = '100%'; ask.style.borderRadius = '0px';
          fit(); toEnd(log.lastElementChild, false);
        });
      });
      setTimeout(function () { ask.classList.remove('anim'); toEnd(log.lastElementChild, false); }, reduce ? 0 : 380);
      if (push !== false) { try { history.pushState({ chat: 1 }, '', '#chat'); } catch (e) {} }
    }
    function close(fromPop) {
      if (!isOpen) return;
      if (!fromPop && location.hash === '#chat') { history.back(); return; }   // popstate calls close(true)
      stopRec(true);
      var r = spacer.getBoundingClientRect();
      if (!reduce) ask.classList.add('anim');
      ask.style.top = r.top + 'px'; ask.style.left = r.left + 'px'; ask.style.width = r.width + 'px'; ask.style.height = r.height + 'px';
      ask.style.borderRadius = '28px';
      setTimeout(function () {
        ask.classList.remove('open', 'anim'); ask.removeAttribute('style');
        if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer); spacer = null;
        document.body.classList.remove('chat');
        isOpen = false; q.rows = 2; q.style.height = ''; q.placeholder = 'ምን ልርዳዎ?';
        log.textContent = ''; syncResume();
      }, reduce ? 0 : 350);
    }
    window.addEventListener('popstate', function () { if (isOpen && location.hash !== '#chat') close(true); else if (!isOpen && location.hash === '#chat') open(false); });
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }
    window.addEventListener('resize', fit);
    $('back').addEventListener('click', function () { close(false); });
    $('fresh').addEventListener('click', function () {
      if (busy) return;
      msgs = []; G.saveChat(store, msgs); drawAll(); q.value = ''; syncSend(); q.focus();
    });
    resume.addEventListener('click', function () { open(); });

    // ---------- asking ----------
    function submit(text) {
      text = String(text || '').trim().slice(0, G.MAX_Q);
      if (!text || busy) return;
      var hist = G.historyFor(msgs);
      if (!isOpen) open();
      var um = { r: 'u', t: text }; msgs.push(um); G.saveChat(store, msgs);
      var node = drawUser(text);
      q.value = ''; q.style.height = ''; syncSend();
      setTimeout(function () { toEnd(node, true); }, isOpen ? 60 : 400);
      ask_(text, hist);
    }
    function ask_(text, hist) {
      busy = true; syncSend(); ask.setAttribute('aria-busy', 'true');
      var t = el('div', 'msg b'), tb = el('div', 'body typing');
      tb.appendChild(el('i')); tb.appendChild(el('i')); tb.appendChild(el('i')); tb.appendChild(el('span', null, 'ቢኒ እየመለሰ ነው…'));
      var mk = el('span', 'bm', 'ቢ'); mk.setAttribute('aria-hidden', 'true'); t.appendChild(mk); t.appendChild(tb); log.appendChild(t);
      setTimeout(function () { toEnd(t, true); }, 420);
      var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, 60000);
      fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl ? ctl.signal : undefined,
        body: JSON.stringify({ message: text, history: hist, user: { uid: uid() } }) })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (d) {
          if (!d || typeof d.reply !== 'string' || !d.reply.trim()) throw new Error('empty');
          var m = { r: 'b', t: d.reply.trim() };
          var go = G.pageForTools(d.tools); if (go) m.go = go;
          if (d.emergency === true) { m.k = 'sos'; if (/^\d{3,4}$/.test(String(d.ambulance || ''))) m.amb = String(d.ambulance); }
          msgs.push(m); G.saveChat(store, msgs);
          t.parentNode.removeChild(t);
          toEnd(drawBini(m), true);
        })
        .catch(function () {
          if (t.parentNode) t.parentNode.removeChild(t);
          var e = el('div', 'err', navigator.onLine === false ? 'ኢንተርኔት የለም። ሲመለስ እንደገና ይሞክሩ። · You are offline.' : 'መልሱ አልደረሰም። እንደገና ይሞክሩ። · The answer did not arrive.');
          e.setAttribute('role', 'alert');
          var again = el('button', null, 'እንደገና ሞክር · Try again'); again.type = 'button';
          again.addEventListener('click', function () { if (busy) return; w.parentNode.removeChild(w); ask_(text, hist); });
          e.appendChild(again);
          var w = bini(e); log.appendChild(w); toEnd(w, true);
        })
        .then(function () { clearTimeout(timer); busy = false; syncSend(); ask.removeAttribute('aria-busy'); });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(q.value); });
    q.addEventListener('input', function () {
      syncSend();
      if (isOpen) { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight + 2, window.innerHeight * 0.3) + 'px'; }
    });
    q.addEventListener('keydown', function (e) {
      // On a phone Enter is a new line (people write long Amharic questions); on a keyboard Enter sends.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); submit(q.value); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.try'), function (b) {
      b.addEventListener('click', function () { submit(b.textContent); });
    });

    // ---------- voice: record, transcribe, put the words in the box ----------
    var MIME = C && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? C.pickMime(window.MediaRecorder.isTypeSupported ? function (m) { return window.MediaRecorder.isTypeSupported(m); } : null) : '';
    if (MIME) mic.hidden = false;
    function recUI(on) { rec.hidden = !on; q.hidden = on && isOpen; $('acts').hidden = on; }
    mic.addEventListener('click', function () {
      if (busy || recState) return;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var chunks = [], started = Date.now(), mr;
        try { mr = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 32000 }); } catch (e) { mr = new MediaRecorder(stream); }
        recState = { mr: mr, timer: 0, cancel: false };
        mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
        mr.onstop = function () {
          stream.getTracks().forEach(function (tk) { tk.stop(); });
          var st = recState; clearInterval(st.timer); recState = null; recUI(false);
          if (st.cancel) return;
          var blob = new Blob(chunks, { type: mr.mimeType || MIME });
          if (blob.size < 1000) return showNote('አልተሰማም፤ እንደገና ይሞክሩ · Could not hear that');
          if (blob.size > 1000000) return showNote('በጣም ረጅም ነው · Too long, keep it under a minute');
          transcribe(blob);
        };
        mr.start(1000); recUI(true); $('recStop').focus();
        recState.timer = setInterval(function () {
          var s = Math.floor((Date.now() - started) / 1000);
          recTime.textContent = C.formatTimer(s) + ' / ' + C.formatTimer(C.MAX_RECORD_SECONDS);
          if (s >= C.MAX_RECORD_SECONDS) stopRec();
        }, 250);
      }).catch(function () { (isOpen ? toast : showNote)('ማይክሮፎን አልተፈቀደም · Microphone not allowed'); });
    });
    function stopRec(cancel) { if (recState && recState.mr.state !== 'inactive') { recState.cancel = !!cancel; recState.mr.stop(); } }
    $('recStop').addEventListener('click', function () { stopRec(false); });
    function transcribe(blob) {
      busy = true; syncSend(); (isOpen ? toast : showNote)('እያዳመጥኩ ነው… · Listening');
      var fr = new FileReader();
      fr.onerror = function () { busy = false; syncSend(); };
      fr.onload = function () {
        var b64 = String(fr.result || '').split(',')[1] || '';
        fetch('/api/assistant/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: b64, mime: C.baseMime(blob.type), uid: uid() }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.ok && d.text) { showNote(''); q.value = String(d.text).slice(0, G.MAX_Q); q.dispatchEvent(new Event('input')); q.focus(); }
            else (isOpen ? toast : showNote)(d && d.error === 'rate_limited' ? 'ትንሽ ቆይተው ይሞክሩ · Too many voice notes, try later' : 'አልተሰማም፤ እንደገና ይሞክሩ · Could not hear that');
          })
          .catch(function () { (isOpen ? toast : showNote)('አልተላከም · Voice note failed'); })
          .then(function () { busy = false; syncSend(); });
      };
      fr.readAsDataURL(blob);
    }

    // ---------- the account chip: a name when signed in, never a wall ----------
    try {
      fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.ok || !j.me) return;
          var name = String(j.me.name || '').trim().split(/\s+/)[0].slice(0, 16);
          var me = $('me'); me.href = '/account';
          $('meName').textContent = name || 'መለያ';
          if (name) { var av = me.querySelector('.av'); av.textContent = name.charAt(0).toUpperCase(); }
          me.setAttribute('aria-label', 'መለያ · Account' + (name ? ': ' + name : ''));
        }).catch(function () {});
    } catch (e) {}

    syncSend(); syncResume();
    if (location.hash === '#chat' && msgs.length) open(false);
    else if (location.hash === '#chat') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  }
});
