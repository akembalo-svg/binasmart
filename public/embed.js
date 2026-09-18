/* BinaSmart business assistant bubble. Usage on a client's website:
     <script src="https://bina.et/embed.js" data-key="bpk_…" defer></script>
   Optional: data-lang="am|en|om", data-position="left". Everything is drawn inside a shadow root so the host
   page's styles cannot break it, and every piece of text is inserted with textContent, never as HTML. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me || window.__binaBubble) return;
  window.__binaBubble = true;
  var KEY = me.getAttribute('data-key') || '';
  var API = (me.getAttribute('data-api') || 'https://bina.et').replace(/\/+$/, '');
  var LEFT = me.getAttribute('data-position') === 'left';
  if (!/^bpk_[A-Za-z0-9_-]{20,}$/.test(KEY)) return;

  var T = {
    am: { ph: 'ጥያቄዎን ይጻፉ…', send: 'ላክ', err: 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም።', by: 'በ BinaSmart AI', hi: 'ሰላም! እንዴት ልርዳዎ?' },
    en: { ph: 'Type your question…', send: 'Send', err: 'Sorry, I could not answer right now.', by: 'Powered by BinaSmart AI', hi: 'Hello! How can I help?' },
    om: { ph: 'Gaaffii keessan barreessaa…', send: 'Ergi', err: 'Dhiifama, amma deebii kennuu hin dandeenye.', by: 'BinaSmart AI', hi: 'Akkam! Maal isin gargaaru?' }
  };
  var uid = null;
  try { uid = localStorage.getItem('bina_ws_uid'); if (!uid) { uid = 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bina_ws_uid', uid); } } catch (e) { uid = null; }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  fetch(API + '/api/ws/site', { headers: { 'x-bina-site-key': KEY } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) { if (cfg && cfg.ok) draw(cfg); })
    .catch(function () {});

  function draw(cfg) {
    var lang = me.getAttribute('data-lang') || cfg.lang || 'en';
    var t = T[lang] || T.en;
    var color = /^#[0-9a-f]{6}$/i.test(cfg.color || '') ? cfg.color : '#059669';
    var host = el('div'); host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;' + (LEFT ? 'left' : 'right') + ':20px';
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
    var css = el('style');
    css.textContent = [
      ':host,*{box-sizing:border-box;font-family:Geist,Inter,"Noto Sans Ethiopic",system-ui,sans-serif}',
      '.fab{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:' + color + ';box-shadow:0 10px 30px rgba(0,0,0,.25);display:grid;place-items:center;transition:transform .15s}',
      '.fab:hover{transform:scale(1.06)}',
      '.fab svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
      '.box{position:absolute;bottom:72px;' + (LEFT ? 'left' : 'right') + ':0;width:min(370px,calc(100vw - 32px));height:min(540px,calc(100vh - 110px));background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;color:#0f172a}',
      '.box.on{display:flex}',
      '.hd{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}',
      '.hd b{font-size:15px;flex:1}.hd button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}',
      '.log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f8fafc}',
      '.m{max-width:85%;padding:10px 12px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}',
      '.u{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}',
      '.a{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}',
      '.src{display:block;margin-top:6px;font-size:12px;color:#64748b}',
      '.src a{color:' + color + '}',
      '.dots{opacity:.6}',
      'form{display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}',
      'input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;font-size:14px;outline:none}',
      'input:focus{border-color:' + color + '}',
      'form button{background:' + color + ';color:#fff;border:0;border-radius:10px;padding:0 14px;font-weight:600;cursor:pointer}',
      '.by{text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;background:#fff}',
      '.by a{color:inherit}'
    ].join('');
    root.appendChild(css);

    var fab = el('button', 'fab'); fab.setAttribute('aria-label', cfg.name);
    fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
    var box = el('div', 'box');
    var hd = el('div', 'hd'); var title = el('b', null, cfg.name); var x = el('button', null, '×'); x.setAttribute('aria-label', 'close');
    hd.appendChild(title); hd.appendChild(x);
    var log = el('div', 'log');
    var form = el('form'); var input = el('input'); input.placeholder = t.ph; input.maxLength = 1000;
    var send = el('button', null, t.send); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    var by = el('div', 'by'); var bya = el('a', null, t.by); bya.href = 'https://bina.et/ai'; bya.target = '_blank'; bya.rel = 'noopener'; by.appendChild(bya);
    box.appendChild(hd); box.appendChild(log); box.appendChild(form); box.appendChild(by);
    root.appendChild(box); root.appendChild(fab);

    // The answer appears word by word. The whole text is already here — it is revealed, never streamed —
    // so the safety filters on the server still ran on the complete answer before anything was shown.
    function type(node, text) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = text; return; }
      var words = String(text).split(/(\s+)/), i = 0;
      node.textContent = '';
      (function step() {
        var chunk = '';
        for (var n = 0; n < 2 && i < words.length; n++, i++) chunk += words[i];
        node.textContent += chunk;
        log.scrollTop = log.scrollHeight;
        if (i < words.length) setTimeout(step, 28);
      })();
    }
    function add(cls, text, sources, typed) {
      var m = el('div', 'm ' + cls, typed ? '' : text);
      if (typed) type(m, text);
      if (sources && sources.length) {
        var s = el('span', 'src');
        sources.forEach(function (x, i) {
          if (i) s.appendChild(document.createTextNode(' · '));
          if (x.url && /^https?:\/\//.test(x.url)) { var a = el('a', null, x.title); a.href = x.url; a.target = '_blank'; a.rel = 'noopener'; s.appendChild(a); }
          else s.appendChild(document.createTextNode(x.title));
        });
        m.appendChild(s);
      }
      log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
    }
    var opened = false;
    function toggle() {
      box.classList.toggle('on');
      if (!opened) { opened = true; add('a', cfg.welcome || t.hi); }
      if (box.classList.contains('on')) input.focus();
    }
    fab.addEventListener('click', toggle); x.addEventListener('click', toggle);

    var busy = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim(); if (!q || busy) return;
      busy = true; input.value = ''; add('u', q);
      var wait = add('a dots', '…');
      fetch(API + '/api/ws/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bina-site-key': KEY },
        body: JSON.stringify({ message: q, user: uid ? { uid: uid } : {} }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { wait.remove(); add('a', (d && (d.reply || d.error)) || t.err, d && d.sources, true); })
        .catch(function () { wait.remove(); add('a', t.err); })
        .then(function () { busy = false; });
    });
  }
})();
