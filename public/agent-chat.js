/* The chat on /afiya and /asmat. Reads its config from <script id="agent-chat-config" type="application/json">,
   draws into #agent-chat, and decides nothing itself: replies become cards in agent-chat-core.js. Every piece
   of text from a reply, a transcript or storage goes into the page with textContent or a text node — never as
   HTML (test/agent-chat-ui.test.js holds the file to that). */
(function () {
  'use strict';
  var C = window.AgentChatCore, root = document.getElementById('agent-chat'), cfgEl = document.getElementById('agent-chat-config');
  if (!C || !root || !cfgEl) return;
  var cfg;
  try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }

  var store = null;
  try { store = window.localStorage; } catch (e) { store = null; }
  var LANG_KEY = 'bina_chat_lang';
  var lang = C.loadLang(store, LANG_KEY, document.documentElement.lang);
  var history = C.makeHistory(store, cfg.storageKey);
  var chatId = null, pending = false, rec = null, noteTimer = 0;
  var SVG = 'http://www.w3.org/2000/svg';
  var ICONS = { menu: 'M4 7h16M4 12h16M4 17h16', plus: 'M12 5v14M5 12h14', send: 'M5 12h13M13 6l6 6-6 6',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4', stop: 'M7 7h10v10H7z', close: 'M6 6l12 12M18 6L6 18' };
  var MIME = cfg.voice && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? C.pickMime(window.MediaRecorder.isTypeSupported ? function (m) { return window.MediaRecorder.isTypeSupported(m); } : null) : '';

  function ui(k) { var u = C.pick(cfg.ui, lang) || {}; return u[k] != null ? u[k] : ''; }
  function tr(field) { return C.pick(cfg[field], lang); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(name) {
    var s = document.createElementNS(SVG, 'svg'), p = document.createElementNS(SVG, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
    p.setAttribute('d', ICONS[name]); s.appendChild(p);
    return s;
  }
  function button(cls, label, onClick) {
    var b = el('button', cls); b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }
  function uid() { try { return (store && store.getItem('bina_uid')) || ''; } catch (e) { return ''; } }
  function appendText(node, text) {
    var segs = C.linkify(text);
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].type === 'link') {
        var a = el('a', null, segs[i].value);
        a.href = segs[i].href; a.rel = 'noopener';
        if (!/^https:\/\/bina\.et(\/|$)/.test(segs[i].href)) a.target = '_blank';
        node.appendChild(a);
      } else node.appendChild(document.createTextNode(segs[i].value));
    }
  }

  // ---------- skeleton ----------
  root.textContent = '';
  var head = el('header', 'ac-head');
  var menuBtn = button('ac-icon', '', openDrawer); menuBtn.appendChild(icon('menu'));
  var av = el('img', 'ac-av'); av.src = cfg.avatar; av.alt = ''; av.width = 40; av.height = 40;
  var who = el('div', 'ac-who'), whoName = el('b'), whoRole = el('span');
  who.appendChild(whoName); who.appendChild(whoRole);
  var newBtn = button('ac-icon', '', newChat); newBtn.appendChild(icon('plus'));
  head.appendChild(menuBtn); head.appendChild(av); head.appendChild(who); head.appendChild(newBtn);

  var log = el('main', 'ac-log');
  log.setAttribute('aria-live', 'polite');

  var bar = el('form', 'ac-bar');
  bar.setAttribute('autocomplete', 'off');
  var note = el('p', 'ac-note'); note.setAttribute('role', 'status'); note.hidden = true;
  var quota = el('p', 'ac-quota'); quota.hidden = true; // v2: "questions left today"; never shown in v1
  var langs = el('div', 'ac-langs'), langBtns = {};
  var LABELS = { am: 'አማ', en: 'EN', om: 'OM' };
  C.LANGS.forEach(function (l) {
    var b = button('ac-lang', '', function () { setLang(l); });
    b.textContent = LABELS[l]; b.lang = l; langBtns[l] = b; langs.appendChild(b);
  });
  var row = el('div', 'ac-row');
  var input = el('textarea', 'ac-in'); input.rows = 1; input.maxLength = C.MAX_QUESTION;
  var go = el('button', 'ac-go'); go.type = 'submit';
  row.appendChild(input); row.appendChild(go);
  var recRow = el('div', 'ac-rec'); recRow.hidden = true;
  var recTime = el('span', null, '0:00'), recStop = button('ac-icon', '', stopRec);
  recStop.appendChild(icon('stop'));
  recRow.appendChild(el('span', 'ac-dot')); recRow.appendChild(recTime); recRow.appendChild(recStop);
  bar.appendChild(note); bar.appendChild(quota); bar.appendChild(langs); bar.appendChild(row); bar.appendChild(recRow);

  root.appendChild(head); root.appendChild(log); root.appendChild(bar);

  // ---------- the frame's extras: a fixed footer under the bar, and feedback under a fresh answer.
  // Both are off unless the page's config asks for them, so /afiya and /asmat are untouched (Task 10).
  var foot = null;
  if (cfg.footer) { foot = el('p', 'ac-foot'); root.appendChild(foot); }
  function renderFoot() { if (foot) foot.textContent = tr('footer') || ''; }
  function addFeedback(w, question, card) {
    var row = el('div', 'ac-fb'), done = false;
    function post(body) {
      body.uid = uid(); body.lang = lang;
      return fetch(cfg.feedback.api, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cfg.headers || {}),
        body: JSON.stringify(body) }).catch(function () {});
    }
    function thanks() { row.textContent = ''; row.appendChild(el('span', null, ui('thanks'))); }
    function vote(v) { if (done) return; done = true; post({ vote: v }); thanks(); }
    var up = button('ac-fb-b', ui('up'), function () { vote('up'); }); up.textContent = '👍';
    var down = button('ac-fb-b', ui('down'), function () { vote('down'); }); down.textContent = '👎';
    var rep = button('ac-fb-r', '', function () {
      if (done) return;
      row.textContent = '';
      row.appendChild(el('span', null, ui('reportConsent')));
      var yes = button('ac-fb-b', '', function () { done = true; post({ vote: 'report', consent: true, question: question, answer: card.text, sources: card.sources }); thanks(); });
      yes.textContent = ui('reportYes');
      var no = button('ac-fb-b', '', function () { row.parentNode.removeChild(row); });
      no.textContent = ui('reportNo');
      row.appendChild(yes); row.appendChild(no);
    });
    rep.textContent = ui('report');
    row.appendChild(up); row.appendChild(down); row.appendChild(rep);
    w.appendChild(row);
  }

  // ---------- fixed texts, redrawn on a language change ----------
  function renderChrome() {
    renderFoot();
    whoName.textContent = tr('name'); whoRole.textContent = tr('role');
    menuBtn.setAttribute('aria-label', ui('chats'));
    newBtn.setAttribute('aria-label', ui('newChat'));
    recStop.setAttribute('aria-label', ui('stop'));
    input.placeholder = tr('placeholder');
    input.setAttribute('aria-label', tr('placeholder'));
    C.LANGS.forEach(function (l) { langBtns[l].setAttribute('aria-pressed', l === lang ? 'true' : 'false'); });
    syncGo();
  }
  function setLang(l) {
    lang = C.pickLang(l, lang); C.saveLang(store, LANG_KEY, lang);
    renderChrome();
    if (log.querySelector('.ac-empty')) renderEmpty();
    var chips = log.querySelector('.ac-chips');
    if (chips) { chips.parentNode.removeChild(chips); addChips(); }
  }
  function syncGo() {
    var voice = MIME && !input.value.trim();
    go.textContent = '';
    go.appendChild(icon(voice ? 'mic' : 'send'));
    go.setAttribute('aria-label', voice ? ui('mic') : ui('send'));
  }

  function showNote(text) {
    note.textContent = text; note.hidden = !text;
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(function () { note.hidden = true; }, 8000);
  }
  function scrollEnd(node) { try { node.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (e) { node.scrollIntoView(false); } }
  function setBusy(b) { pending = b; root.classList.toggle('ac-busy', b); }

  // ---------- empty screen ----------
  function renderEmpty() {
    log.textContent = '';
    var box = el('section', 'ac-empty');
    var big = el('img', 'ac-big'); big.src = cfg.avatar; big.alt = tr('name'); big.width = 96; big.height = 96;
    box.appendChild(big);
    box.appendChild(el('h1', null, tr('greeting')));
    box.appendChild(el('p', null, tr('intro')));
    if (cfg.banner) {
      // The line the old pages always showed: the number to call, before any question is asked.
      var bn = el('p', 'ac-banner', C.pick(cfg.banner.text, lang) + ' ');
      if (/^\d{3,4}$/.test(cfg.banner.call)) { var ca = el('a', null, cfg.banner.call); ca.href = 'tel:' + cfg.banner.call; bn.appendChild(ca); }
      box.appendChild(bn);
    }
    var sugs = el('div', 'ac-sugs');
    (tr('suggestions') || []).slice(0, 4).forEach(function (q) {
      sugs.appendChild(button('ac-sug', '', function () { send(q); })).textContent = q;
    });
    box.appendChild(sugs);
    box.appendChild(el('p', 'ac-local', ui('local')));
    log.appendChild(box);
  }

  // ---------- messages ----------
  function addUser(text) { var d = el('div', 'ac-user', text); log.appendChild(d); scrollEnd(d); }
  function calls(box, numbers) {
    var wrap = el('div', 'ac-calls'), all = (cfg.emergency && cfg.emergency.numbers) || [];
    var labels = C.pick(cfg.emergency && cfg.emergency.labels, lang) || [];
    numbers.forEach(function (n, i) {
      var a = el('a', 'ac-call' + (i === 0 ? ' ac-first' : ''), '📞 ' + ((labels[all.indexOf(n)] || '') + ' ' + n).trim());
      a.href = 'tel:' + n;
      wrap.appendChild(a);
    });
    box.appendChild(wrap);
  }
  function renderCard(card) {
    var w = el('article', 'ac-card ac-' + card.kind);
    if (card.kind === 'emergency' || card.kind === 'urgent') {
      var box = el('div', card.kind === 'emergency' ? 'ac-sos' : 'ac-warn');
      box.setAttribute('role', 'alert');
      box.appendChild(el('b', null, ui(card.kind === 'emergency' ? 'emergencyTitle' : 'urgentTitle')));
      if (card.call.length) calls(box, card.call);
      w.appendChild(box);
    }
    var body = el('div', 'ac-text'); appendText(body, card.text); w.appendChild(body);
    if (card.sources.length) {
      var src = el('p', 'ac-src', ui('from') + ' ');
      card.sources.forEach(function (s, i) {
        if (i) src.appendChild(document.createTextNode(' · '));
        var a = el('a', null, s.title); a.href = s.url; a.rel = 'noopener'; a.target = '_blank';
        src.appendChild(a);
        if (s.publisher || s.fetched) src.appendChild(document.createTextNode(' — ' + [s.publisher, s.fetched ? ui('fetched') + ' ' + s.fetched : ''].filter(Boolean).join(', ')));
      });
      w.appendChild(src);
    }
    if (card.disclosure) w.appendChild(el('p', 'ac-disc', card.disclosure));
    return w;
  }
  function addAgent(card) { var w = renderCard(card); log.appendChild(w); scrollEnd(w); return w; }
  function addChips() {
    var list = (tr('chips') || []).slice(0, 3);
    if (!list.length) return;
    var wrap = el('div', 'ac-chips');
    list.forEach(function (q) { wrap.appendChild(button('ac-chip', '', function () { send(q); })).textContent = q; });
    log.appendChild(wrap);
  }
  function removeChips() { var c = log.querySelectorAll('.ac-chips'); for (var i = 0; i < c.length; i++) c[i].parentNode.removeChild(c[i]); }
  function typing() {
    var t = el('div', 'ac-typing'); t.setAttribute('aria-label', ui('typing'));
    t.appendChild(el('i')); t.appendChild(el('i')); t.appendChild(el('i'));
    log.appendChild(t); scrollEnd(t); return t;
  }
  function addError(text) {
    var e = el('div', 'ac-err', ui('error'));
    e.setAttribute('role', 'alert');
    e.appendChild(button('', '', function () { if (pending) return; e.parentNode.removeChild(e); ask(text); })).textContent = ui('retry');
    log.appendChild(e); scrollEnd(e);
  }

  // ---------- asking ----------
  function send(text) {
    text = String(text || '').trim().slice(0, C.MAX_QUESTION);
    if (!text || pending || rec) return;
    if (log.querySelector('.ac-empty')) log.textContent = '';
    removeChips();
    if (!chatId) chatId = history.create(text);
    addUser(text);
    history.add(chatId, { role: 'user', text: text });
    input.value = ''; syncGo();
    ask(text);
  }
  function ask(text) {
    setBusy(true);
    var t = typing(), id = chatId;
    fetch(cfg.api, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, cfg.headers || {}),
      body: JSON.stringify({ message: text, user: { uid: uid() } }) })
      .then(function (r) {
        if (r.status === 401 && cfg.headers) { showNote(ui('expired')); setTimeout(function () { window.location.reload(); }, 800); throw new Error('expired'); }
        return r.json();
      })
      .then(function (d) {
        if (!d || typeof d.reply !== 'string' || !d.reply) throw new Error('no reply');
        t.parentNode.removeChild(t);
        var card = C.toCard(d, cfg);
        var drawn = addAgent(card);
        history.add(id, { role: 'agent', card: card });
        if (cfg.feedback && card.kind === 'answer' && drawn) addFeedback(drawn, text, card);
        if (card.kind === 'answer') addChips();
      })
      .catch(function () { if (t.parentNode) t.parentNode.removeChild(t); addError(text); })
      .then(function () { setBusy(false); });
  }

  bar.addEventListener('submit', function (e) {
    e.preventDefault();
    if (pending) return;
    if (input.value.trim()) send(input.value);
    else if (MIME) startRec();
  });
  input.addEventListener('input', function () {
    syncGo();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (input.value.trim()) send(input.value); }
  });

  // ---------- voice ----------
  function startRec() {
    if (pending || rec) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var chunks = [], started = Date.now(), mr;
      try { mr = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 32000 }); }
      catch (e) { mr = new MediaRecorder(stream); }
      rec = { mr: mr, timer: 0 };
      mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (tk) { tk.stop(); });
        clearInterval(rec.timer); rec = null;
        recRow.hidden = true; row.hidden = false;
        var blob = new Blob(chunks, { type: mr.mimeType || MIME });
        if (blob.size < 1000) return showNote(ui('unclear'));
        if (blob.size > 1000000) return showNote(ui('tooLong'));
        transcribe(blob);
      };
      mr.start(1000);
      row.hidden = true; recRow.hidden = false; recTime.textContent = '0:00';
      recStop.focus();
      rec.timer = setInterval(function () {
        var s = Math.floor((Date.now() - started) / 1000);
        recTime.textContent = C.formatTimer(s) + ' / ' + C.formatTimer(C.MAX_RECORD_SECONDS);
        if (s >= C.MAX_RECORD_SECONDS) stopRec();
      }, 250);
    }).catch(function () { showNote(ui('micDenied')); });
  }
  function stopRec() { if (rec && rec.mr.state !== 'inactive') rec.mr.stop(); }
  function transcribe(blob) {
    setBusy(true); showNote(ui('listening'));
    var fr = new FileReader();
    fr.onerror = function () { setBusy(false); showNote(ui('voiceError')); };
    fr.onload = function () {
      var b64 = String(fr.result || '').split(',')[1] || '';
      fetch(cfg.voiceApi, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audio: b64, mime: C.baseMime(blob.type), uid: uid() }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.text) {
            showNote(''); input.value = String(d.text).slice(0, C.MAX_QUESTION); syncGo(); input.focus();
          } else showNote(ui(d && d.error === 'unclear' ? 'unclear' : d && d.error === 'rate_limited' ? 'voiceBusy' : 'voiceError'));
        })
        .catch(function () { showNote(ui('voiceError')); })
        .then(function () { setBusy(false); });
    };
    fr.readAsDataURL(blob);
  }

  // ---------- new chat and past chats ----------
  function newChat() {
    if (pending || rec) return;
    chatId = null; renderEmpty(); input.value = ''; syncGo(); input.focus();
    window.scrollTo(0, 0);
  }
  var drawer = null;
  function openDrawer() {
    if (drawer || rec) return;
    drawer = el('div', 'ac-drawer');
    var panel = el('nav', 'ac-panel'); panel.setAttribute('aria-label', ui('chats'));
    var ph = el('div', 'ac-panel-head');
    ph.appendChild(el('h2', null, ui('chats')));
    var close = button('ac-icon', ui('close'), closeDrawer); close.appendChild(icon('close'));
    ph.appendChild(close); panel.appendChild(ph);
    var chats = history.list();
    if (!chats.length) panel.appendChild(el('p', 'ac-local', ui('noChats')));
    var ul = el('ul', 'ac-list');
    chats.forEach(function (c) {
      var li = el('li');
      li.appendChild(button('ac-open', '', function () { openChat(c.id); })).textContent = c.title;
      var del = button('ac-icon', ui('delete') + ': ' + c.title, function () { history.remove(c.id); if (c.id === chatId) newChat(); closeDrawer(); openDrawer(); });
      del.appendChild(icon('close'));
      li.appendChild(del); ul.appendChild(li);
    });
    panel.appendChild(ul);
    if (chats.length) panel.appendChild(button('ac-del-all', '', function () {
      if (!window.confirm(ui('deleteAllConfirm'))) return;
      history.clear(); closeDrawer(); newChat();
    })).textContent = ui('deleteAll');
    panel.appendChild(el('p', 'ac-local', ui('local')));
    drawer.appendChild(panel);
    drawer.addEventListener('click', function (e) { if (e.target === drawer) closeDrawer(); });
    document.addEventListener('keydown', escClose);
    root.appendChild(drawer); // inside .ac, so the chat styles (.ac button, .ac svg.i, .ac .ac-open) reach it
    close.focus();
  }
  function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
  function closeDrawer() {
    if (!drawer) return;
    document.removeEventListener('keydown', escClose);
    drawer.parentNode.removeChild(drawer); drawer = null; menuBtn.focus();
  }
  function openChat(id) {
    var chat = history.get(id);
    closeDrawer();
    if (!chat || pending) return;
    chatId = chat.id; log.textContent = '';
    chat.messages.forEach(function (m) {
      if (m.role === 'user') log.appendChild(el('div', 'ac-user', m.text));
      else log.appendChild(renderCard(m.card));
    });
    log.appendChild(el('p', 'ac-old', ui('oldChat')));
    input.focus();
  }

  // ---------- start ----------
  document.documentElement.classList.add('ac-js');
  renderChrome();
  renderEmpty();
  var q = C.queryFrom(window.location.search);
  if (q) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) {}
    send(q);
  }
})();
