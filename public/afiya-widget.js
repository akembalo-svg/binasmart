/* Dr Afiya on health pages (30 Sep 2026, Ibrahim: "AI Afiya not Bini" on hospital, clinic and doctor pages).
   A floating chat that talks to POST /api/afiya {message, user:{uid}} -> {reply, emergency, ambulance, sources}.
   Afiya is a guide to the health SYSTEM, not a clinician: the server answers emergencies without the model and
   refuses diagnosis and doses; this widget only shows what comes back, as TEXT (links are the only markup).
   The emergency number sits above the input at all times, and an emergency reply becomes a red card with a
   tap-to-call button.  Load: <script src="/static/afiya-widget.js?v=1" defer data-context="hospital"></script> */
(function () {
  if (window.__afiya) return; window.__afiya = true;
  var me = document.currentScript || {}, ctx = (me.getAttribute && me.getAttribute('data-context')) || 'health';
  var css = '.afy-b{position:fixed;right:18px;bottom:18px;z-index:80;display:flex;align-items:center;gap:10px;border:0;cursor:pointer;border-radius:999px;padding:10px 18px 10px 10px;'
    + 'background:linear-gradient(135deg,#1D4ED8,#10B981);color:#fff;font:700 15px Inter,"Noto Sans Ethiopic",system-ui,sans-serif;box-shadow:0 14px 34px -10px rgba(29,78,216,.6);transition:transform .25s}'
    + '.afy-b:hover{transform:translateY(-2px)}.afy-b i{width:36px;height:36px;border-radius:50%;background:#fff;display:grid;place-items:center;font-style:normal;font-size:20px;position:relative}'
    + '.afy-b i::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(255,255,255,.7);animation:afyp 2.2s ease-out infinite}@keyframes afyp{from{transform:scale(.85);opacity:1}to{transform:scale(1.35);opacity:0}}'
    + '.afy-p{position:fixed;right:18px;bottom:18px;z-index:81;width:min(390px,calc(100vw - 24px));height:min(620px,calc(100vh - 36px));background:#fff;border-radius:24px;box-shadow:0 30px 70px -20px rgba(11,27,58,.45);display:flex;flex-direction:column;overflow:hidden;'
    + 'transform:translateY(20px) scale(.97);opacity:0;pointer-events:none;transition:transform .3s cubic-bezier(.2,.8,.2,1),opacity .25s;font:15px Inter,"Noto Sans Ethiopic",system-ui,sans-serif;color:#0B1B3A}'
    + '.afy-p.on{transform:none;opacity:1;pointer-events:auto}'
    + '.afy-h{background:linear-gradient(135deg,#1D4ED8,#1e40af 60%,#0f766e);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px}'
    + '.afy-h .av{width:40px;height:40px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:22px}.afy-h b{display:block;font-size:16px}.afy-h small{opacity:.85;font-size:12.5px}'
    + '.afy-h button{margin-left:auto;border:0;background:rgba(255,255,255,.18);color:#fff;width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer}'
    + '.afy-e{display:flex;align-items:center;gap:8px;background:#FEF2F2;color:#991B1B;font-size:13px;font-weight:700;padding:8px 14px;border-bottom:1px solid #fecaca}.afy-e a{margin-left:auto;background:#DC2626;color:#fff;border-radius:999px;padding:5px 12px;text-decoration:none}'
    + '.afy-m{flex:1;overflow-y:auto;padding:14px;background:#F0F7FF;display:flex;flex-direction:column;gap:10px}'
    + '.afy-q,.afy-a{max-width:86%;padding:11px 14px;border-radius:18px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;animation:afyin .3s ease-out}@keyframes afyin{from{opacity:0;transform:translateY(6px)}}'
    + '.afy-q{align-self:flex-end;background:#1D4ED8;color:#fff;border-bottom-right-radius:6px}.afy-a{align-self:flex-start;background:#fff;border:1px solid #dbe7fb;border-bottom-left-radius:6px}'
    + '.afy-a a{color:#1D4ED8;font-weight:600}.afy-a .ds{display:block;margin-top:8px;font-size:12px;color:#64748b}'
    + '.afy-em{align-self:stretch;background:#DC2626;color:#fff;border-radius:18px;padding:14px;white-space:pre-wrap;line-height:1.5}.afy-em a{display:block;margin-top:10px;text-align:center;background:#fff;color:#DC2626;font-weight:800;border-radius:12px;padding:12px;text-decoration:none;font-size:17px}'
    + '.afy-t{align-self:flex-start;background:#fff;border:1px solid #dbe7fb;border-radius:18px;padding:12px 16px}.afy-t span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#10B981;animation:afyd 1.2s infinite}.afy-t span:nth-child(2){animation-delay:.15s}.afy-t span:nth-child(3){animation-delay:.3s}@keyframes afyd{50%{transform:translateY(-5px);opacity:.5}}'
    + '.afy-c{display:flex;flex-wrap:wrap;gap:6px}.afy-c button{border:1px solid #bfdbfe;background:#fff;color:#1D4ED8;border-radius:999px;padding:7px 12px;font:600 13px Inter,"Noto Sans Ethiopic",sans-serif;cursor:pointer}'
    + '.afy-f{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e2e8f0;background:#fff}.afy-f input{flex:1;border:1px solid #cbd5e1;border-radius:14px;padding:11px 13px;font:inherit;outline:0}.afy-f input:focus{border-color:#1D4ED8}'
    + '.afy-f button{border:0;border-radius:14px;padding:0 16px;background:linear-gradient(135deg,#1D4ED8,#10B981);color:#fff;font-weight:800;cursor:pointer}'
    + '.afy-n{font-size:11.5px;color:#64748b;text-align:center;padding:0 12px 10px;background:#fff}'
    + '@media (prefers-reduced-motion:reduce){.afy-b i::after,.afy-q,.afy-a,.afy-t span{animation:none}.afy-p{transition:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var STARTERS = {
    hospital: [['🏥 Which department?', 'Which department should I go to, and on which floor?'], ['📋 What to bring', 'What should I bring to my appointment?'], ['📅 ቀጠሮ', 'እዚህ ሆስፒታል ቀጠሮ እንዴት እይዛለሁ?']],
    health: [['🏥 Where to go', 'Which kind of clinic or hospital should I go to?'], ['🦷 Dentist', 'How do I find a dental clinic in Addis?'], ['🩺 ሐኪም', 'ለልጄ የትኛው ክፍል ነው የሚያስፈልገው?']],
    doctor: [['✍️ My profile', 'Help me write my doctor profile for BinaSmart in English and Amharic.'], ['🧾 Services list', 'Help me list the services my clinic offers.'], ['📞 Patient reply', 'Help me write a polite reply to a patient who asks for an appointment.']]
  }[ctx] || [];
  function uid() { try { var u = localStorage.getItem('afiya_uid'); if (!u) { u = 'afy' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('afiya_uid', u); } return u; } catch (e) { return 'afy-anon'; } }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  // text with http(s) links made clickable; nothing else is ever parsed as HTML
  function linked(parent, text) {
    var s = String(text || ''), re = /https?:\/\/[^\s<>"'`]+/g, last = 0, m;
    while ((m = re.exec(s))) { var url = m[0].replace(/[.,;:!?)\]}]+$/, ''); if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      var a = el('a', null, url); a.href = url; a.target = '_blank'; a.rel = 'noopener'; parent.appendChild(a); last = m.index + url.length; re.lastIndex = last; }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  }

  var btn = el('button', 'afy-b'); btn.type = 'button'; btn.setAttribute('aria-label', 'Ask Dr Afiya');
  btn.innerHTML = '<i>👩🏾‍⚕️</i><span>Ask Dr Afiya · <span style="font-family:\'Noto Sans Ethiopic\'">አፍያ</span></span>';
  var p = el('div', 'afy-p'); p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Dr Afiya');
  p.innerHTML = '<div class="afy-h"><span class="av">👩🏾‍⚕️</span><div><b>Dr Afiya · ዶ/ር አፍያ</b><small>Health guide · not a doctor · 24/7</small></div><button type="button" aria-label="Close">×</button></div>'
    + '<div class="afy-e">🚨 Emergency · ድንገተኛ<a href="tel:907">📞 907 Ambulance</a></div><div class="afy-m"></div>'
    + '<form class="afy-f"><input maxlength="500" placeholder="Ask in Amharic, English or Oromo…" aria-label="Your question"><button type="submit">➤</button></form>'
    + '<div class="afy-n">Afiya guides you to the right place. She does not diagnose or prescribe; ask a doctor for that.</div>';
  document.body.appendChild(btn); document.body.appendChild(p);
  var box = p.querySelector('.afy-m'), form = p.querySelector('form'), input = form.querySelector('input'), greeted = false, busy = false;

  function say(cls, text) { var b = el('div', cls); linked(b, text); box.appendChild(b); box.scrollTop = box.scrollHeight; return b; }
  function open() {
    p.classList.add('on'); btn.style.display = 'none';
    if (!greeted) { greeted = true;
      say('afy-a', 'ሰላም! እኔ ዶ/ር አፍያ ነኝ፤ ትክክለኛውን ክፍል፣ ሆስፒታል ወይም ክሊኒክ እንዲያገኙ እረዳለሁ።\n\nHi, I\'m Dr Afiya. I help you find the right department, hospital or clinic, what to bring and what it costs.');
      if (STARTERS.length) { var c = el('div', 'afy-c'); STARTERS.forEach(function (s) { var b = el('button', null, s[0]); b.type = 'button'; b.onclick = function () { c.remove(); ask(s[1]); }; c.appendChild(b); }); box.appendChild(c); }
    }
    setTimeout(function () { input.focus(); }, 250);
  }
  function close() { p.classList.remove('on'); btn.style.display = ''; }
  function ask(q) {
    q = String(q || '').trim().slice(0, 500); if (!q || busy) return; busy = true;
    say('afy-q', q); var t = el('div', 'afy-t'); t.innerHTML = '<span></span><span></span><span></span>'; box.appendChild(t); box.scrollTop = box.scrollHeight;
    fetch('/api/afiya', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: q, user: { uid: uid() } }) })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        t.remove(); busy = false;
        if (d && d.emergency === true) {
          var e = el('div', 'afy-em'); linked(e, d.reply || 'Call an ambulance now.');
          var num = String(d.ambulance || '907').replace(/[^\d]/g, '') || '907', a = el('a', null, '📞 Call ' + num + ' now'); a.href = 'tel:' + num; e.appendChild(a);
          box.appendChild(e); box.scrollTop = box.scrollHeight; return;
        }
        var b = say('afy-a', (d && d.reply) || 'Sorry, I could not answer just now. Please try again.');
      })
      .catch(function () { t.remove(); busy = false; say('afy-a', 'Connection problem. Please try again. · እባክዎ እንደገና ይሞክሩ።'); });
  }
  btn.onclick = open; p.querySelector('.afy-h button').onclick = close;
  form.onsubmit = function (e) { e.preventDefault(); var v = input.value; input.value = ''; ask(v); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && p.classList.contains('on')) close(); });
  window.AfiyaWidget = { open: open, ask: function (q) { open(); ask(q); } };
  if (/[?&]afiya=1\b/.test(location.search)) setTimeout(open, 600);
})();
