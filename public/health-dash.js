/* BinaSmart Health dashboard (30 Sep 2026). Everything here talks to health/dashboard.js; the account comes from the
   sign-in cookie, never from this script. Dr Afiya's panel calls /api/health/assist, which the server allows only for the
   owner of a checked profile. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var app = $('#app'), ME = null, CUR = null, F = null, DIRTY = false, TASK = 'chat', BUSY = false;
  var ERR = { bad_code: 'That code does not work. Check the letters, or ask our team for a new one.', slow_down: 'Too many tries. Please wait a little.',
    about_dose: 'Please do not put medicine doses on a public page.', phone: 'That phone number does not look right.', not_found: 'That profile is not linked to this account.',
    hidden_by_team: 'Our team has hidden this page. Send a change request and we will call you.', text: 'Please write a little more.', no_photo: 'The photo did not arrive. Please try again.' };

  function toast(t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove('on'); }, 2600); }
  function api(url, body) {
    return fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function uid() { try { var u = localStorage.getItem('afiya_uid'); if (!u) { u = 'afy' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('afiya_uid', u); } return u; } catch (e) { return 'afy-anon'; } }
  function rich(t) { return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); }
  window.addEventListener('beforeunload', function (e) { if (DIRTY) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- load ----------
  function load(sel) {
    api('/api/health/mine').then(function (j) {
      if (j._status === 401) return signedOut();
      if (!j.ok) return app.innerHTML = '<div class="dwrap"><div class="box">Something went wrong. Please reload.</div></div>';
      ME = j; account();
      if (!j.entries.length) return claimView();
      var id = sel || (CUR && CUR.id);
      CUR = j.entries.filter(function (e) { return e.id === id; })[0] || j.entries[0];
      editor();
    }).catch(function () { app.innerHTML = '<div class="dwrap"><div class="box">No connection. Please reload.</div></div>'; });
  }
  function account() {
    var a = $('#acct'); a.textContent = 'Sign out'; a.href = '#';
    a.onclick = function (e) { e.preventDefault(); fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).finally(function () { location.reload(); }); };
    // a phone-code account is named by its number: greet only a real name
    if (ME.name && !/^[+\d]/.test(ME.name.trim())) $('#hi').textContent = 'Selam, ' + ME.name.trim().split(/\s+/)[0];
  }
  function signedOut() {
    app.innerHTML = '<div class="dwrap"><div class="box" style="text-align:center;padding:28px 18px">'
      + '<img src="/static/agents/afiya.svg" alt="" width="84" height="84" style="border-radius:50%;background:#EEF4FF">'
      + '<h2 style="justify-content:center;margin-top:10px">Sign in to your dashboard<span class="am">ወደ ዳሽቦርድዎ ይግቡ</span></h2>'
      + '<p class="hint">Edit your services, hours and About text, and get Dr Afiya\'s help with your profile and patient messages.</p>'
      + '<a class="btn" href="/login?next=/health/dashboard">Sign in · ግባ</a>'
      + '<p class="hint" style="margin-top:18px">Not on BinaSmart Health yet?</p><div class="row2" style="justify-content:center"><a class="btn lite" href="/health?join=doctor">👩🏾‍⚕️ I am a doctor</a><a class="btn lite" href="/health?join=facility">🏥 My hospital or clinic</a></div>'
      + '</div></div>';
  }
  function claimView() {
    app.innerHTML = '<div class="dwrap"><div class="box stack">'
      + '<h2>Link your profile<span class="am">ፕሮፋይልዎን ያገናኙ</span></h2>'
      + '<p class="hint" style="margin:0">After our team checks your profile, they call you and give you an 8-letter dashboard code. Type it here once.</p>'
      + '<div class="fld"><input id="code" class="codein" maxlength="9" placeholder="XXXX-XXXX" autocomplete="one-time-code" inputmode="text"></div>'
      + '<button class="btn" id="claim">Link · አገናኝ</button><div class="err" id="cerr" style="color:var(--r);font-size:14px"></div>'
      + '<p class="hint">Signed in with the Telegram account whose phone our team called? It links by itself.</p>'
      + '<hr style="border:0;border-top:1px solid var(--ln);width:100%"><p class="hint" style="margin:0">Not on BinaSmart Health yet?</p>'
      + '<div class="row2" style="margin:0"><button class="btn lite" id="jd">👩🏾‍⚕️ I am a doctor</button><button class="btn lite" id="jf">🏥 My hospital or clinic</button></div>'
      + '</div></div>';
    var c = $('#code');
    c.addEventListener('input', function () { var v = c.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); c.value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; });
    $('#claim').onclick = function () {
      $('#cerr').textContent = '';
      api('/api/health/claim', { code: c.value }).then(function (j) { if (!j.ok) return $('#cerr').textContent = ERR[j.error] || 'That did not work.'; toast('Linked ✓'); load(j.id); });
    };
    $('#jd').onclick = function () { window.HealthJoin && window.HealthJoin('doctor'); };
    $('#jf').onclick = function () { window.HealthJoin && window.HealthJoin('facility'); };
  }

  // ---------- the editor ----------
  function fresh() {
    F = { services: (CUR.services || []).slice(), hours: CUR.hours || '', about: CUR.about || '' };
    if (CUR.type === 'doctor') Object.assign(F, { specialty: CUR.specialty || '', languages: (CUR.languages || []).slice(), fee: CUR.fee || '', showPhone: !!CUR.showPhone, whatsapp: !!CUR.whatsapp });
    else F.publicPhone = CUR.publicPhone || '';
    dirty(false);
  }
  function dirty(on) { DIRTY = on; var b = $('#save'), m = $('#sm'); if (b) b.disabled = !on; if (m) m.textContent = on ? 'Unsaved changes' : 'All changes saved · live'; }
  function editor() {
    var E = CUR, doc = E.type === 'doctor', status = { live: ['live', '● Live'], paused: ['paused', '⏸ Paused'], hidden: ['hidden', 'Hidden by our team'] }[E.status] || ['live', E.status];
    var pick = ME.entries.length > 1 ? '<div class="pick">' + ME.entries.map(function (e) { return '<button data-id="' + esc(e.id) + '" class="' + (e.id === E.id ? 'on' : '') + '">' + (e.type === 'doctor' ? '👩🏾‍⚕️ ' : '🏥 ') + esc(e.name) + '</button>'; }).join('') + '</div>' : '';
    var av = doc && E.photo ? '<img src="' + esc(E.photo) + '" alt="">' : '<span class="av">' + (doc ? esc(E.name.replace(/^dr\.?\s+/i, '').charAt(0).toUpperCase()) : '🏥') + '</span>';
    app.innerHTML = '<div class="dwrap"><div class="stack">' + pick
      + '<div class="box"><div class="phead">' + av + '<div><b>' + esc(E.name) + '</b><small>' + esc(doc ? E.professionLabel + (E.specialty ? ' · ' + E.specialty : '') : E.kindLabel) + (E.facility ? ' · ' + esc(E.facility.name) : '') + '</small><br><span class="st ' + status[0] + '">' + status[1] + '</span></div></div>'
      + '<div class="row2"><a class="btn lite" href="' + esc(E.url) + '" target="_blank" rel="noopener">View my page ↗</a>' + (E.status !== 'hidden' ? '<button class="btn lite" id="pause">' + (E.status === 'paused' ? '▶️ Show my page' : '⏸ Pause my page') + '</button>' : '') + '</div></div>'
      + '<div class="box stack"><div><h2>About<span class="am">ስለ ' + (doc ? 'እኔ' : 'እኛ') + '</span></h2><p class="hint">A few honest lines patients read first. English and Amharic both welcome.</p></div>'
      + '<div class="fld"><textarea id="about" maxlength="900" placeholder="' + (doc ? 'I am a dentist at … I see adults and children …' : 'We are a clinic in … open …') + '"></textarea><div class="cnt" id="acnt"></div></div>'
      + '<button class="ai" data-ai="about">✨ Ask Dr Afiya to write it</button></div>'
      + '<div class="box stack"><div><h2>Services<span class="am">አገልግሎቶች</span></h2><p class="hint">What patients can come to you for. Plain names work best.</p></div>'
      + '<div class="tags" id="svc"></div><div class="addrow"><input id="svcin" placeholder="Add a service…" maxlength="60"><button id="svcadd">+</button></div>'
      + '<div class="tags sugg" id="svcs"></div><button class="ai" data-ai="services">✨ Suggest services</button></div>'
      + '<div class="box stack"><h2>Details<span class="am">ዝርዝር</span></h2>'
      + (doc ? '<div class="fld"><label>Specialty</label><input id="spec" maxlength="60" placeholder="e.g. Orthodontics"></div>'
        + '<div class="fld"><label>Languages</label><div class="tags" id="lng"></div><div class="addrow"><input id="lngin" placeholder="Add a language…" maxlength="30"><button id="lngadd">+</button></div></div>' : '')
      + '<div class="fld"><label>Opening hours · የሥራ ሰዓት</label><input id="hours" maxlength="120" placeholder="Mon–Fri 8:30–17:30, Sat 9:00–13:00"></div>'
      + (doc ? '<div class="fld"><label>Consultation fee (optional)</label><input id="fee" maxlength="40" placeholder="e.g. 500 birr"></div>'
        + '<label class="tg"><input type="checkbox" id="shp"> Show my phone (' + esc(E.phone) + ') on my page</label><label class="tg"><input type="checkbox" id="wa"> …and a WhatsApp button</label>'
        + '<div class="fld"><label>Profile photo</label><input type="file" id="ph" accept="image/*"><span class="hint" id="phs">' + (E.photoPending ? '📷 A new photo is waiting for our team.' : 'Our team checks every photo before it shows.') + '</span></div>'
        : '<div class="fld"><label>Number patients call (shown on the page)</label><input id="pphone" type="tel" maxlength="20" placeholder="011 …"></div>')
      + '</div>'
      + (!doc ? '<div class="box stack"><h2>Doctors here<span class="am">እዚህ ያሉ ሐኪሞች</span></h2>'
        + ((E.doctors || []).length ? '<div class="tags">' + E.doctors.map(function (d) { return '<a href="/doctors/' + esc(d.slug) + '" target="_blank" style="text-decoration:none"><span>' + esc(d.name) + ' · ' + esc(d.profession) + '</span></a>'; }).join('') + '</div>' : '<p class="hint" style="margin:0">No doctor profiles here yet.</p>')
        + '<p class="hint" style="margin:0">Each doctor needs a licence number; our team calls them before the profile shows.</p><button class="btn" id="adddoc" style="justify-self:start">➕ Add a doctor</button></div>' : '')
      + '<div class="box stack"><h2>Checked by our team<span class="am">በቡድናችን የተረጋገጠ</span></h2><div class="facts">'
      + '<div><b>Name</b><span>' + esc(E.name) + '</span></div>'
      + (doc ? '<div><b>Profession</b><span>' + esc(E.professionLabel) + '</span></div><div><b>Licence</b><span>' + esc(E.licence) + ' · ' + esc(E.licenceIssuer) + ' 🔒</span></div>' : '<div><b>Type</b><span>' + esc(E.kindLabel) + '</span></div>')
      + '<div><b>' + (doc ? 'Works at' : 'Place') + '</b><span>' + esc(E.facility ? E.facility.name : 'Own practice') + '</span></div>'
      + (E.approvedAt ? '<div><b>Checked</b><span>' + esc(E.approvedAt) + '</span></div>' : '') + '</div>'
      + '<div class="fld"><label>Need to change one of these?</label><textarea id="rq" style="min-height:70px" maxlength="600" placeholder="What should change, and why"></textarea></div><button class="btn lite" id="rqsend" style="justify-self:start">Send to our team</button></div>'
      + '</div>' + afiyaPanel() + '</div>'
      + '<div class="savebar"><div style="display:flex;gap:10px;align-items:center"><span class="msg2" id="sm"></span><button class="btn" id="save" disabled>Save · አስቀምጥ</button></div></div>';
    fresh(); bind(); bindAfiya();
  }
  function tagsEditor(box, arr, input, addBtn) {
    function draw() { box.innerHTML = arr.map(function (t, i) { return '<span>' + esc(t) + '<button type="button" aria-label="Remove" data-i="' + i + '">×</button></span>'; }).join('') || '<span style="background:none;color:var(--mu);font-weight:500;padding-left:0">None yet</span>';
      $$('button', box).forEach(function (b) { b.onclick = function () { arr.splice(+b.getAttribute('data-i'), 1); draw(); dirty(true); }; }); }
    function add(v) { v = String(v || '').trim().slice(0, 60); if (v.length < 2 || arr.length >= 24) return false; if (arr.map(function (x) { return x.toLowerCase(); }).indexOf(v.toLowerCase()) < 0) { arr.push(v); draw(); dirty(true); } return true; }
    if (addBtn) { addBtn.onclick = function () { if (add(input.value)) input.value = ''; input.focus(); }; input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } }); }
    draw(); return { add: add, draw: draw };
  }
  var svcEd = null;
  function bind() {
    var E = CUR, doc = E.type === 'doctor';
    $$('.pick button').forEach(function (b) { b.onclick = function () { if (DIRTY && !confirm('Leave without saving?')) return; DIRTY = false; load(b.getAttribute('data-id')); }; });
    var ab = $('#about'), ac = $('#acnt'); ab.value = F.about; var cnt = function () { ac.textContent = ab.value.length + ' / 900'; }; cnt();
    ab.addEventListener('input', function () { F.about = ab.value; cnt(); dirty(true); });
    svcEd = tagsEditor($('#svc'), F.services, $('#svcin'), $('#svcadd'));
    var hr = $('#hours'); hr.value = F.hours; hr.addEventListener('input', function () { F.hours = hr.value; dirty(true); });
    if (doc) {
      var sp = $('#spec'); sp.value = F.specialty; sp.addEventListener('input', function () { F.specialty = sp.value; dirty(true); });
      tagsEditor($('#lng'), F.languages, $('#lngin'), $('#lngadd'));
      var fe = $('#fee'); fe.value = F.fee; fe.addEventListener('input', function () { F.fee = fe.value; dirty(true); });
      var sh = $('#shp'), wa = $('#wa'); sh.checked = F.showPhone; wa.checked = F.whatsapp; wa.disabled = !sh.checked;
      sh.onchange = function () { F.showPhone = sh.checked; if (!sh.checked) { wa.checked = false; F.whatsapp = false; } wa.disabled = !sh.checked; dirty(true); };
      wa.onchange = function () { F.whatsapp = wa.checked; dirty(true); };
      $('#ph').onchange = function (e) { var f = e.target.files && e.target.files[0]; if (!f) return; $('#phs').textContent = 'Uploading…'; photo(f); };
    } else {
      var pp = $('#pphone'); pp.value = F.publicPhone; pp.addEventListener('input', function () { F.publicPhone = pp.value; dirty(true); });
      var ad = $('#adddoc'); if (ad) ad.onclick = function () { window.HealthJoin && window.HealthJoin('doctor', E.facility && E.facility.ref); };
    }
    var pz = $('#pause'); if (pz) pz.onclick = function () { api('/api/health/mine/' + E.id + '/pause', { paused: E.status !== 'paused' }).then(function (j) { if (!j.ok) return toast(ERR[j.error] || 'Did not work'); toast(j.status === 'paused' ? 'Paused: your page is hidden' : 'Your page shows again'); load(E.id); }); };
    $('#rqsend').onclick = function () { var t = $('#rq').value.trim(); api('/api/health/mine/' + E.id + '/request', { text: t }).then(function (j) { if (!j.ok) return toast(ERR[j.error] || 'Did not work'); $('#rq').value = ''; toast('Sent: our team will call you'); }); };
    $('#save').onclick = save;
  }
  function save() {
    var b = $('#save'); b.disabled = true; b.textContent = 'Saving…';
    api('/api/health/mine/' + CUR.id, F).then(function (j) {
      b.textContent = 'Save · አስቀምጥ';
      if (!j.ok) { b.disabled = false; return toast(ERR[j.error] || 'Could not save'); }
      if (j.entry) { var keep = ME.entries.map(function (e) { return e.id === j.entry.id ? j.entry : e; }); ME.entries = keep; CUR = j.entry; }
      fresh(); toast(j.changed && j.changed.length ? 'Saved · live now ✓' : 'Nothing changed');
    }).catch(function () { b.textContent = 'Save · አስቀምጥ'; b.disabled = false; toast('No connection'); });
  }
  function photo(file) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      if (img.width < 600) { $('#phs').textContent = 'Please use a photo at least 600 pixels wide.'; return; }
      var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      var u = uid();
      api('/api/property/photo', { uid: u, image: c.toDataURL('image/jpeg', 0.88) }).then(function (j) {
        if (!j.ok) throw new Error(j.error || 'upload');
        return api('/api/health/mine/' + CUR.id + '/photo', { uid: u });
      }).then(function (j) { if (!j.ok) throw new Error(j.error); $('#phs').textContent = '📷 Sent. Our team checks it, then it shows on your page.'; toast('Photo sent for checking'); })
        .catch(function (e) { $('#phs').textContent = e.message === 'too_small' ? 'The photo is too small.' : 'The photo did not upload. Try another.'; });
    };
    img.onerror = function () { $('#phs').textContent = 'That file is not a photo.'; }; img.src = url;
  }

  // ---------- Dr Afiya, the professional's assistant ----------
  var HOLD = { reply: 'Paste the patient\'s message here. Leave out their name and phone.', standards: 'e.g. What must a medium clinic have for its laboratory?', chat: 'Ask Dr Afiya about your profile, services or patient messages…' };
  function afiyaPanel() {
    return '<div class="box apanel"><div class="ahd"><img src="/static/agents/afiya.svg" alt=""><div><b>Dr Afiya · ዶ/ር አፍያ</b><small>Your practice assistant · no diagnosis, no doses</small></div></div>'
      + '<div class="aq"><button data-t="about">✍️ Write my About</button><button data-t="services">🧾 Suggest services</button><button data-t="reply">💬 Reply to a patient</button><button data-t="standards">📋 MoH standards</button><button data-t="chat" class="on">💡 Ask</button></div>'
      + '<div class="alog" id="alog"><div class="am2 af">Selam! I help with your profile, your services, replies to patients, and the Ministry of Health standards for your facility. Clinical decisions stay with you.<br><span class="am" style="color:var(--mu);font-size:13px">ሰላም! በፕሮፋይልዎ፣ በአገልግሎቶችዎ፣ ለታካሚዎች በሚሰጡ መልሶችና በጤና ሚኒስቴር ደረጃዎች እረዳለሁ።</span></div></div>'
      + '<div class="aft"><textarea id="aq" placeholder="' + esc(HOLD.chat) + '" maxlength="2000"></textarea><button id="asend" aria-label="Send">➤</button></div>'
      + '<div class="anote">Drafts are for you to check. Phone numbers are removed before Afiya reads your message.</div></div>';
  }
  function bindAfiya() {
    var q = $('#aq');
    $$('.aq button').forEach(function (b) { b.onclick = function () {
      var t = b.getAttribute('data-t');
      if (t === 'about') return ask('Write the About text for my page.', 'about');
      if (t === 'services') return ask('Suggest services I could list.', 'services');
      TASK = t; $$('.aq button').forEach(function (x) { x.classList.toggle('on', x === b); }); q.placeholder = HOLD[t] || HOLD.chat; q.focus();
    }; });
    $$('[data-ai]').forEach(function (b) { b.onclick = function () { var t = b.getAttribute('data-ai'); ask(t === 'about' ? 'Write the About text for my page.' : 'Suggest services I could list.', t); if (innerWidth < 960) $('.apanel').scrollIntoView({ behavior: 'smooth' }); }; });
    $('#asend').onclick = function () { var v = q.value.trim(); if (!v) return; q.value = ''; ask(v, TASK); };
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && innerWidth >= 700) { e.preventDefault(); $('#asend').click(); } });
  }
  function bubble(html, cls) { var log = $('#alog'), m = document.createElement('div'); m.className = 'am2 ' + cls; m.innerHTML = html; log.appendChild(m); log.scrollTop = log.scrollHeight; return m; }
  function ask(text, task) {
    if (BUSY) return; BUSY = true;
    bubble(esc(text), 'me'); var w = bubble('<span class="dots"><i></i><i></i><i></i></span>', 'af');
    api('/api/health/assist', { entryId: CUR.id, task: task, message: text }).then(function (j) {
      BUSY = false;
      if (j._status === 401) { w.innerHTML = 'Please sign in again.'; return; }
      if (!j.reply) { w.innerHTML = esc(ERR[j.error] || 'Sorry, that did not work. Try again.'); return; }
      if (j.emergency) w.className = 'am2 er';
      w.innerHTML = rich(j.reply);
      var acts = document.createElement('div'); acts.className = 'acts2';
      if (task === 'about' && !j.emergency) {
        var en = (/English\s*[:：]\s*([\s\S]*?)(?=\n\s*አማርኛ\s*[:：፡]|$)/i.exec(j.reply) || [])[1], am = (/አማርኛ\s*[:：፡]\s*([\s\S]*)$/.exec(j.reply) || [])[1];
        var put = function (v) { F.about = v.replace(/\*\*/g, '').replace(/^\s*#+\s*/gm, '').trim().slice(0, 900); $('#about').value = F.about; $('#about').dispatchEvent(new Event('input')); toast('Put in your About box: check it, then Save'); $('#about').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
        if (en) acts.appendChild(btn('Use English', function () { put(en); }));
        if (en && am) acts.appendChild(btn('Use both', function () { put(en.trim() + '\n\n' + am.trim()); }, true));
      }
      if (task === 'services' && !j.emergency) {
        var items = j.reply.split('\n').map(function (l) { var m = /^\s*[-•*]\s*(.+?)\s*$/.exec(l); return m ? m[1].replace(/\*\*/g, '').slice(0, 60) : null; }).filter(Boolean);
        if (items.length) {
          var sg = $('#svcs'); sg.innerHTML = items.map(function (s, i) { return '<span>' + esc(s) + '<button type="button" data-i="' + i + '" aria-label="Add">+</button></span>'; }).join('');
          $$('button', sg).forEach(function (b) { b.onclick = function () { svcEd.add(items[+b.getAttribute('data-i')]); b.parentNode.remove(); }; });
          acts.appendChild(btn('Add all ' + items.length + ' to my services', function () { items.forEach(function (s) { svcEd.add(s); }); sg.innerHTML = ''; toast('Added: check them, then Save'); }));
        }
      }
      if (task === 'reply' && !j.emergency) acts.appendChild(btn('Copy the reply', function () { try { navigator.clipboard.writeText(j.reply); toast('Copied'); } catch (e) {} }));
      if (acts.children.length) w.appendChild(acts);
      $('#alog').scrollTop = $('#alog').scrollHeight;
    }).catch(function () { BUSY = false; w.innerHTML = 'No connection. Try again.'; });
  }
  function btn(label, fn, lite) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (lite) b.className = 'lt'; b.onclick = fn; return b; }

  load(new URLSearchParams(location.search).get('id'));
})();
