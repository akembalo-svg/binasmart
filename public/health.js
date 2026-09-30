/* BinaSmart Health pages (30 Sep 2026): scroll reveal, the directory's filters/search/"show all", and "Join with Dr Afiya",
   a guided sign-up for doctors and facilities. It is a fixed list of questions (no AI model in the loop), so it cannot
   invent anything, and it ends in POST /api/health/submit. Nothing goes live until the team has called and approved. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // ---- reveal on scroll ----
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' }) : null;
  function watch(root) { $$('.rv:not(.in)', root).forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); }); }
  watch();

  // ---- directory data (loaded once, on demand) ----
  var DIR = null, dirWait = null;
  function dir() { if (DIR) return Promise.resolve(DIR); if (!dirWait) dirWait = fetch('/api/health/directory').then(function (r) { return r.json(); }).then(function (d) { DIR = d; return d; }); return dirWait; }
  var KI = { hospital: ['🏥', 'Hospital', 'ሆስፒታል'], clinic: ['🩺', 'Clinic', 'ክሊኒክ'], dentist: ['🦷', 'Dental clinic', 'የጥርስ ክሊኒክ'], doctors: ['👩🏾‍⚕️', "Doctor's clinic", 'የሐኪም ክሊኒክ'], lab: ['🔬', 'Laboratory', 'ላቦራቶሪ'] };
  function card(f) {
    var K = KI[f.kind] || KI.clinic;
    return '<a class="fc rv" href="/health/' + esc(f.slug) + '" data-k="' + esc(f.kind) + '" data-q="' + esc((f.name + ' ' + (f.nameAm || '') + ' ' + (f.sub || '') + ' ' + K[1] + ' ' + (f.services || []).join(' ')).toLowerCase()) + '">'
      + '<span class="ki">' + K[0] + '</span><span class="tx"><b>' + esc(f.name) + '</b>' + (f.nameAm ? '<small class="am">' + esc(f.nameAm) + '</small>' : '')
      + '<em>' + K[0] + ' ' + K[1] + ' · <span class="am">' + K[2] + '</span>' + (f.sub ? ' · ' + esc(f.sub) : '') + '</em>' + ((f.services || []).length ? '<i class="sv">' + esc(f.services.slice(0, 3).join(' · ')) + '</i>' : '')
      + '<span class="bd">' + (f.confirmed ? '<u class="ok">✓ Confirmed</u>' : '') + (f.doctors ? '<u>👩🏾‍⚕️ ' + f.doctors + '</u>' : '') + (f.phone ? '<u>☎️ Phone</u>' : '') + (f.emergency ? '<u class="er">🚑 Emergency</u>' : '') + '</span></span></a>';
  }

  // ---- the directory's filters ----
  var fg = $('#fg'), hq = $('#hq'), more = $('#more'), kind = '', all = false;
  function loadAll() {
    if (all || !fg) return Promise.resolve();
    all = true; if (more) more.hidden = true;
    return dir().then(function (d) { fg.innerHTML = d.facilities.map(card).join(''); watch(fg); });
  }
  function apply() {
    var q = (hq && hq.value || '').trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean), shown = 0;
    $$('.fc,.dc').forEach(function (el) {
      var k = el.getAttribute('data-k'), txt = el.getAttribute('data-q') || '';
      var ok = (!kind || k === kind) && words.every(function (w) { return txt.indexOf(w) >= 0; });
      el.hidden = !ok; if (ok) { shown++; el.classList.add('in'); }
    });
    $$('.fg,.dg').forEach(function (g) { var h = g.previousElementSibling, any = $$('.fc,.dc', g).some(function (c) { return !c.hidden; }); g.hidden = !any; if (h && h.classList.contains('h2')) h.hidden = !any; });
    var none = $('#none'); if (none) none.hidden = shown > 0;
  }
  if (fg) {
    $$('#hk button').forEach(function (b) { b.addEventListener('click', function () {
      $$('#hk button').forEach(function (x) { x.classList.toggle('on', x === b); }); kind = b.getAttribute('data-k') || ''; loadAll().then(apply); apply(); }); });
    var t; if (hq) hq.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { loadAll().then(apply); apply(); }, 160); });
    if (more) more.addEventListener('click', function () { loadAll().then(apply); });
    var q0 = new URLSearchParams(location.search).get('q'); if (q0 && hq) { hq.value = q0; loadAll().then(apply); }
  }

  // ======================= Join with Dr Afiya =======================
  var PROS = [['gp', 'General practitioner', 'ጠቅላላ ሐኪም'], ['specialist', 'Specialist doctor', 'ስፔሻሊስት ሐኪም'], ['dentist', 'Dentist', 'የጥርስ ሐኪም'], ['nurse', 'Nurse', 'ነርስ'], ['midwife', 'Midwife', 'አዋላጅ'],
    ['pharmacist', 'Pharmacist', 'ፋርማሲስት'], ['physio', 'Physiotherapist', 'ፊዚዮቴራፒስት'], ['psych', 'Psychologist', 'ሳይኮሎጂስት'], ['optometrist', 'Optometrist', 'የዓይን ባለሙያ'], ['lab', 'Lab professional', 'የላብራቶሪ ባለሙያ'], ['other', 'Other health professional', 'ሌላ የጤና ባለሙያ']];
  var SPEC = { specialist: ['Internal medicine', 'Paediatrics', 'Obstetrics & gynaecology', 'General surgery', 'Cardiology', 'Dermatology', 'ENT', 'Ophthalmology', 'Orthopaedics', 'Psychiatry', 'Neurology', 'Radiology', 'Urology'],
    dentist: ['General dentistry', 'Orthodontics', 'Oral surgery', "Children's dentistry", 'Prosthodontics'] };
  var SERV = {
    gp: ['General consultation', 'Health check-ups', 'Chronic care (diabetes, blood pressure)', 'Child health', 'Home visits', 'Phone or video consultation'],
    specialist: ['Consultation', 'Follow-up care', 'Procedures', 'Second opinion', 'Phone or video consultation'],
    dentist: ['Check-up & cleaning', 'Fillings', 'Root canal', 'Extraction', 'Braces', 'Crowns & bridges', 'Dentures', 'Teeth whitening', "Children's dentistry"],
    nurse: ['Home nursing', 'Wound care', 'Injections', 'Elderly care'], midwife: ['Antenatal care', 'Delivery support', 'Postnatal care', 'Family planning'],
    pharmacist: ['Medicine counselling', 'Chronic medicine refills'], physio: ['Back & neck pain', 'Sports injuries', 'Rehabilitation after surgery', 'Stroke rehabilitation', 'Home visits'],
    psych: ['Counselling', 'Anxiety & depression', 'Family & couples', 'Children & teens', 'Online sessions'], optometrist: ['Eye test', 'Glasses & lenses', "Children's eye test"],
    lab: ['Blood tests', 'Home sample collection'], other: [],
    hospital: ['Emergency 24/7', 'Outpatient (OPD)', 'Maternity & delivery', 'Paediatrics', 'Surgery', 'Internal medicine', 'Laboratory', 'X-ray & ultrasound', 'Pharmacy', 'Dental', 'Eye clinic', 'ICU', 'Dialysis', 'Physiotherapy', 'Vaccination'],
    clinic: ['General consultation', 'Laboratory', 'Ultrasound', 'Pharmacy', 'Maternal & child health', 'Family planning', 'Vaccination', 'Minor procedures', 'Chronic care (diabetes, blood pressure)', 'Home visits'],
    doctors: ['General consultation', 'Laboratory', 'Ultrasound', 'Chronic care (diabetes, blood pressure)', 'Home visits'],
    lab_f: ['Blood tests', 'Urine & stool tests', 'Hormone tests', 'Pathology', 'Home sample collection', 'Results by phone or Telegram']
  };
  var LANGS = ['Amharic', 'English', 'Afaan Oromo', 'Tigrinya', 'Somali', 'Arabic', 'French'];
  var SUBS = ['Addis Ketema', 'Akaki Kality', 'Arada', 'Bole', 'Gulele', 'Kirkos', 'Kolfe Keranio', 'Lideta', 'Nifas Silk-Lafto', 'Yeka', 'Lemi Kura'];
  var ERR = { name: 'Please type the full name.', phone: 'Please type an Ethiopian phone number, like 09xx xxx xxx.', licence: 'Please give the licence number and who issued it.',
    profession: 'Please choose a profession.', facility: 'Please type the name of the place.', slow_down: 'Too many tries. Please wait a little and try again.' };
  function uid() { try { var u = localStorage.getItem('afiya_uid'); if (!u) { u = 'afy' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('afiya_uid', u); } return u; } catch (e) { return 'afy-anon'; } }
  var q2 = function (en, am) { return esc(en) + (am ? '<small class="am">' + esc(am) + '</small>' : ''); };

  function steps(type) {
    if (type === 'doctor') return [
      { k: 'profession', ask: q2('What is your profession?', 'ሙያዎ ምንድነው?'), t: 'choice', opts: PROS.map(function (p) { return [p[0], p[1] + ' · ' + p[2]]; }) },
      { k: 'specialty', ask: q2('Your specialty? Pick one or type it. Skip if none.', 'ስፔሻሊቲዎ? ከሌለ ይዝለሉ።'), t: 'text', opt: true, sugg: function (d) { return SPEC[d.profession] || []; }, show: function (d) { return d.profession !== 'gp'; } },
      { k: 'name', ask: q2('Your full name, as it is on your licence.', 'ሙሉ ስምዎ (በፈቃድዎ ላይ እንዳለው)።'), t: 'text', ph: 'Dr Selam Tesfaye', min: 3 },
      { k: 'where', ask: q2('Where do you work? Type the hospital or clinic name.', 'የት ይሠራሉ? የሆስፒታሉን ወይም የክሊኒኩን ስም ይጻፉ።'), t: 'facility', indep: true },
      { k: 'area', ask: q2('Which sub-city do you work in?', 'በየትኛው ክፍለ ከተማ ይሠራሉ?'), t: 'choice', opts: SUBS.map(function (s) { return [s, s]; }), show: function (d) { return !d.facilityRef; } },
      { k: 'licence', ask: q2('Your professional licence number. Only our team sees it, to check it. It is never shown on your profile.', 'የሙያ ፈቃድ ቁጥርዎ። ለማረጋገጥ ቡድናችን ብቻ ያየዋል፤ በገጹ ላይ አይታይም።'), t: 'text', min: 3, ph: 'Licence number' },
      { k: 'licenceIssuer', ask: q2('Who issued the licence?', 'ፈቃዱን የሰጠው ማነው?'), t: 'text', min: 2, sugg: function () { return ['Ministry of Health', 'Addis Ababa Health Bureau', 'Regional health bureau']; }, ph: 'e.g. Ministry of Health' },
      { k: 'services', ask: q2('Which services do you offer? Pick all that fit, or type your own.', 'የትኞቹን አገልግሎቶች ይሰጣሉ? የሚስማሙትን ይምረጡ ወይም የራስዎን ይጻፉ።'), t: 'multi', sugg: function (d) { return SERV[d.profession] || []; }, own: true },
      { k: 'languages', ask: q2('Which languages do you speak with patients?', 'ከታካሚዎች ጋር በየትኛው ቋንቋ ይነጋገራሉ?'), t: 'multi', sugg: function () { return LANGS; }, own: true },
      { k: 'hours', ask: q2('Your working hours (optional).', 'የሥራ ሰዓትዎ (አማራጭ)።'), t: 'text', opt: true, ph: 'Mon–Fri 8:30–17:30', sugg: function () { return ['Mon–Fri 8:30–17:30', 'Mon–Sat 8:00–18:00', '24/7']; } },
      { k: 'fee', ask: q2('Consultation fee (optional).', 'የምክክር ክፍያ (አማራጭ)።'), t: 'text', opt: true, ph: 'e.g. 500 birr' },
      { k: 'phone', ask: q2('Your mobile number. Our team calls you on it to check your licence.', 'የሞባይል ቁጥርዎ። ቡድናችን ፈቃድዎን ለማረጋገጥ ይደውልልዎታል።'), t: 'phone' },
      { k: 'show', ask: q2('Should patients see this number on your profile?', 'ታካሚዎች ይህን ቁጥር በፕሮፋይልዎ ላይ ይዩት?'), t: 'choice', opts: [['yes', '📞 Yes, show it'], ['wa', '📞 Yes + WhatsApp'], ['no', '🔒 No, keep it private']] },
      { k: 'photo', ask: q2('Add a clear photo of yourself (optional). We remove the hidden location data from it.', 'ግልጽ ፎቶዎን ያክሉ (አማራጭ)።'), t: 'photo' },
      { k: 'review', t: 'review' }
    ];
    return [
      { k: 'where', ask: q2('Which hospital, clinic or lab? Type its name.', 'የትኛው ሆስፒታል፣ ክሊኒክ ወይም ላብራቶሪ? ስሙን ይጻፉ።'), t: 'facility' },
      { k: 'kind', ask: q2('What kind of place is it?', 'ምን ዓይነት ተቋም ነው?'), t: 'choice', opts: Object.keys(KI).map(function (k) { return [k, KI[k][0] + ' ' + KI[k][1] + ' · ' + KI[k][2]]; }), show: function (d) { return !d.facilityRef; } },
      { k: 'area', ask: q2('Which sub-city is it in?', 'በየትኛው ክፍለ ከተማ ነው?'), t: 'choice', opts: SUBS.map(function (s) { return [s, s]; }), show: function (d) { return !d.facilityRef; } },
      { k: 'role', ask: q2('What is your role there?', 'እዚያ ያለዎት ሚና ምንድነው?'), t: 'choice', opts: [['owner', 'Owner · ባለቤት'], ['manager', 'Manager · ሥራ አስኪያጅ'], ['staff', 'Staff · ሠራተኛ']] },
      { k: 'name', ask: q2('Your name.', 'ስምዎ።'), t: 'text', min: 3 },
      { k: 'phone', ask: q2('Your mobile, for our call. It is not shown.', 'ለጥሪያችን የሞባይል ቁጥርዎ። አይታይም።'), t: 'phone' },
      { k: 'publicPhone', ask: q2('The number patients should call. It is shown on the page. Skip to keep the one we have.', 'ታካሚዎች የሚደውሉበት ቁጥር። በገጹ ላይ ይታያል።'), t: 'text', opt: true, ph: '011 ...', tel: true },
      { k: 'services', ask: q2('Which services do you offer? Pick all that fit, or type your own.', 'የትኞቹን አገልግሎቶች ይሰጣሉ? የሚስማሙትን ይምረጡ ወይም የራስዎን ይጻፉ።'), t: 'multi', own: true, sugg: function (d) { return SERV[d.kind === 'lab' ? 'lab_f' : d.kind] || SERV.clinic; } },
      { k: 'hours', ask: q2('Opening hours (optional).', 'የሥራ ሰዓት (አማራጭ)።'), t: 'text', opt: true, sugg: function () { return ['24/7', 'Mon–Sat 8:00–18:00', 'Mon–Fri 8:30–17:30']; } },
      { k: 'review', t: 'review' }
    ];
  }

  function openJoin(type, ref) {
    if ($('.jw')) return;
    type = type === 'facility' ? 'facility' : 'doctor';
    var d = { type: type }, S = steps(type), i = -1, sending = false;
    var w = document.createElement('div'); w.className = 'jw'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = '<div class="sh"><div class="hd"><span class="av">👩🏾‍⚕️</span><div><b>Dr Afiya · ዶ/ር አፍያ</b><small>' + (type === 'doctor' ? 'Your free doctor profile' : 'Your free facility page') + '</small></div><button type="button" aria-label="Close">×</button></div>'
      + '<div class="pr"><i></i></div><div class="log" aria-live="polite"></div><div class="ft"></div><input class="hp" name="website_url" tabindex="-1" autocomplete="off" aria-hidden="true"></div>';
    document.body.appendChild(w); document.documentElement.style.overflow = 'hidden';
    // a frame for the fade-in, and a timer too: a tab opened in the background runs no animation frames
    requestAnimationFrame(function () { w.classList.add('on'); }); setTimeout(function () { w.classList.add('on'); }, 80);
    var log = $('.log', w), ft = $('.ft', w), bar = $('.pr i', w);
    function close() { w.classList.remove('on'); document.documentElement.style.overflow = ''; setTimeout(function () { w.remove(); }, 260);
      try { var u = new URL(location.href); u.searchParams.delete('join'); u.searchParams.delete('ref'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {} }
    $('.hd button', w).onclick = close; w.addEventListener('click', function (e) { if (e.target === w) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    function say(html, who) { var m = document.createElement('div'); m.className = 'msg ' + (who || 'af'); m.innerHTML = html; log.appendChild(m); log.scrollTop = log.scrollHeight; return m; }
    function me(text) { say(esc(text), 'me'); }
    function err(code) { var e = $('.err', ft); if (e) e.textContent = ERR[code] || code || ''; }
    function next() {
      i++; while (S[i] && S[i].show && !S[i].show(d)) i++;
      bar.style.width = Math.min(100, Math.round(i / (S.length - 1) * 100)) + '%';
      var s = S[i]; if (!s) return;
      ft.innerHTML = '';
      if (s.t === 'review') return review();
      var ask = s.t === 'facility' && ref && !d._refAsked ? (type === 'doctor' ? q2('Do you work here?', 'እዚህ ይሠራሉ?') : q2('Is this the place?', 'ቦታው ይህ ነው?')) : s.ask;
      setTimeout(function () { say(ask); render(s); }, 260);
    }
    function input(s, ph) {
      var r = document.createElement('div'); r.className = 'row';
      r.innerHTML = '<input ' + (s.t === 'phone' || s.tel ? 'type="tel" inputmode="tel" autocomplete="tel"' : 'type="text"') + ' placeholder="' + esc(ph || s.ph || '') + '" maxlength="90"><button type="button">Next</button>';
      ft.appendChild(r); var inp = $('input', r); setTimeout(function () { inp.focus(); }, 50); return r;
    }
    function skipBtn(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'skip'; b.textContent = label || 'Skip · ዝለል'; b.onclick = fn; ft.appendChild(b); }
    function errBox() { var e = document.createElement('div'); e.className = 'err'; ft.appendChild(e); }
    function render(s) {
      if (s.t === 'choice') {
        var o = document.createElement('div'); o.className = 'opts';
        s.opts.forEach(function (p) { var b = document.createElement('button'); b.type = 'button'; b.textContent = p[1]; b.onclick = function () {
          if (s.k === 'show') { d.showPhone = p[0] !== 'no'; d.whatsapp = p[0] === 'wa'; } else d[s.k] = p[0];
          me(p[1]); next(); }; o.appendChild(b); });
        ft.appendChild(o); return;
      }
      if (s.t === 'text' || s.t === 'phone') {
        var sugg = s.sugg ? s.sugg(d) : [];
        if (sugg.length) { var o2 = document.createElement('div'); o2.className = 'opts'; sugg.forEach(function (v) { var b = document.createElement('button'); b.type = 'button'; b.textContent = v; b.onclick = function () { d[s.k] = v; me(v); next(); }; o2.appendChild(b); }); ft.appendChild(o2); }
        var r = input(s), inp = $('input', r); errBox();
        var go = function () {
          var v = inp.value.trim();
          if (!v && s.opt) { d[s.k] = ''; me('—'); return next(); }
          if (s.t === 'phone' && !/^(\+?251|0)?[79]\d{8}$/.test(v.replace(/[\s-]/g, ''))) return err('phone');
          if (s.tel && v && v.replace(/\D/g, '').length < 9) return err('phone');
          if (v.length < (s.min || 1)) return err(s.k === 'name' ? 'name' : s.k === 'licence' || s.k === 'licenceIssuer' ? 'licence' : 'Please type a little more.');
          d[s.k] = v; me(v); next();
        };
        $('button', r).onclick = go; inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        if (s.opt) skipBtn(null, function () { d[s.k] = ''; me('—'); next(); });
        return;
      }
      if (s.t === 'multi') {
        var picked = [], o3 = document.createElement('div'); o3.className = 'opts';
        var add = function (v) { var b = document.createElement('button'); b.type = 'button'; b.textContent = v; b.onclick = function () { var j = picked.indexOf(v); if (j >= 0) { picked.splice(j, 1); b.classList.remove('sel'); } else { picked.push(v); b.classList.add('sel'); } }; o3.appendChild(b); return b; };
        (s.sugg ? s.sugg(d) : []).forEach(add);
        ft.appendChild(o3);
        var r2 = input(s, 'Type one more and press +'), inp2 = $('input', r2), plus = $('button', r2); plus.textContent = '+';
        var own = function () { var v = inp2.value.trim().slice(0, 60); if (v.length < 2) return; if (picked.indexOf(v) < 0) { picked.push(v); add(v).classList.add('sel'); } inp2.value = ''; inp2.focus(); };
        plus.onclick = own; inp2.addEventListener('keydown', function (e) { if (e.key === 'Enter') own(); });
        var done = document.createElement('div'); done.className = 'opts'; done.style.marginTop = '8px';
        var dn = document.createElement('button'); dn.type = 'button'; dn.className = 'go'; dn.textContent = 'Done ✓'; done.appendChild(dn); ft.appendChild(done); errBox();
        dn.onclick = function () { own(); if (!picked.length) return err('Pick at least one, or type your own.'); d[s.k] = picked.slice(0, 24); me(picked.join(', ')); next(); };
        return;
      }
      if (s.t === 'facility') {
        if (ref && !d._refAsked) {
          d._refAsked = true;
          dir().then(function (D) {
            var f = D.facilities.filter(function (x) { return refOf(x) === ref; })[0];
            if (!f) { say(s.ask); return render(s); }
            var o = document.createElement('div'); o.className = 'opts';
            [['yes', '✓ Yes, ' + f.name], ['no', 'No, another place']].forEach(function (p) { var b = document.createElement('button'); b.type = 'button'; b.textContent = p[1]; b.onclick = function () {
              if (p[0] === 'yes') { d.facilityRef = ref; d.facilityName = f.name; d.kind = f.kind; me(f.name); next(); } else { me(p[1]); ft.innerHTML = ''; say(s.ask); render(s); } }; o.appendChild(b); });
            ft.innerHTML = ''; ft.appendChild(o);
          });
          return;
        }
        var r3 = input(s, 'Hospital or clinic name…'), inp3 = $('input', r3), res = document.createElement('div'); res.className = 'opts'; res.style.marginTop = '8px'; ft.appendChild(res); errBox();
        $('button', r3).textContent = 'Use'; var pick = function (f) { d.facilityRef = f ? refOf(f) : null; d.facilityName = f ? f.name : inp3.value.trim(); if (f) d.kind = f.kind; me(d.facilityName); next(); };
        var use = function () { if (inp3.value.trim().length < 3) return err('facility'); pick(null); };
        $('button', r3).onclick = use; inp3.addEventListener('keydown', function (e) { if (e.key === 'Enter') use(); });
        var find = function () {
          var q = inp3.value.trim().toLowerCase(); res.innerHTML = ''; if (q.length < 2) return;
          dir().then(function (D) {
            var hits = D.facilities.filter(function (f) { return (f.name + ' ' + (f.nameAm || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 6);
            res.innerHTML = '';
            hits.forEach(function (f) { var b = document.createElement('button'); b.type = 'button'; b.textContent = (KI[f.kind] || KI.clinic)[0] + ' ' + f.name + (f.sub ? ' · ' + f.sub : ''); b.onclick = function () { pick(f); }; res.appendChild(b); });
            var nb = document.createElement('button'); nb.type = 'button'; nb.textContent = '➕ Not in the list: "' + inp3.value.trim() + '"'; nb.onclick = use; res.appendChild(nb);
          });
        };
        var ti; inp3.addEventListener('input', function () { clearTimeout(ti); ti = setTimeout(find, 180); });
        if (s.indep) skipBtn('I work independently / my own practice · የግል ሥራ', function () { d.facilityRef = null; d.facilityName = ''; me('Independent · የግል'); next(); });
        return;
      }
      if (s.t === 'photo') {
        var f = document.createElement('div'); f.className = 'row';
        f.innerHTML = '<input type="file" accept="image/*"><button type="button">Skip</button>'; ft.appendChild(f); errBox();
        $('button', f).onclick = function () { me('—'); next(); };
        $('input', f).onchange = function (e) { var file = e.target.files && e.target.files[0]; if (!file) return; err('Uploading… · እየጫነ ነው…'); shrink(file).then(function (data) {
          return fetch('/api/property/photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: uid(), image: data }) }).then(function (r) { return r.json(); }); })
          .then(function (j) { if (!j || !j.ok) return err(j && j.error === 'too_small' ? 'The photo is too small. Please use a photo at least 600 pixels wide.' : 'That photo did not upload. Try another, or skip.'); d.photo = true; me('📷 Photo added'); next(); })
          .catch(function () { err('That photo did not upload. Try another, or skip.'); }); };
      }
    }
    function shrink(file) { return new Promise(function (ok, no) { var img = new Image(), url = URL.createObjectURL(file); img.onload = function () {
      var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.88)); }; img.onerror = no; img.src = url; }); }
    function review() {
      var P = PROS.filter(function (p) { return p[0] === d.profession; })[0];
      var rows = type === 'doctor'
        ? [['Name', d.name], ['Profession', P ? P[1] : ''], ['Specialty', d.specialty], ['Works at', d.facilityName || 'Independent'], ['Sub-city', d.area], ['Licence', (d.licence || '') + ' · ' + (d.licenceIssuer || '') + ' 🔒'],
          ['Services', (d.services || []).join(', ')], ['Languages', (d.languages || []).join(', ')], ['Hours', d.hours], ['Fee', d.fee], ['Phone', d.phone + (d.showPhone ? (d.whatsapp ? ' (shown + WhatsApp)' : ' (shown)') : ' (private)')], ['Photo', d.photo ? 'Yes' : '']]
        : [['Place', d.facilityName], ['Type', d.kind ? KI[d.kind][1] : ''], ['Sub-city', d.area], ['Your role', d.role], ['Your name', d.name], ['Your phone', d.phone + ' 🔒'], ['Public number', d.publicPhone], ['Services', (d.services || []).join(', ')], ['Hours', d.hours]];
      setTimeout(function () {
        say(q2('Please check, then send. Our team calls you before anything shows.', 'ያረጋግጡና ይላኩ። ከመታየቱ በፊት ቡድናችን ይደውላል።')
          + '<div class="sum">' + rows.filter(function (r) { return r[1]; }).map(function (r) { return '<div><b>' + esc(r[0]) + '</b><span>' + esc(r[1]) + '</span></div>'; }).join('') + '</div>');
        var o = document.createElement('div'); o.className = 'opts';
        o.innerHTML = '<button type="button" class="go">Send · ላክ ✓</button><button type="button">Start again</button>';
        ft.appendChild(o); errBox();
        var bs = $$('button', o);
        bs[1].onclick = function () { close(); setTimeout(function () { openJoin(type, ref); }, 300); };
        bs[0].onclick = function () {
          if (sending) return; sending = true; bs[0].textContent = 'Sending…';
          var body = { type: type, name: d.name, phone: d.phone, services: d.services || [], hours: d.hours || '', facilityRef: d.facilityRef || null, facilityName: d.facilityName || '', area: d.area || '', uid: uid(), website_url: $('.hp', w).value };
          if (type === 'doctor') { body.profession = d.profession; body.specialty = d.specialty || ''; body.licence = d.licence; body.licenceIssuer = d.licenceIssuer; body.languages = d.languages || []; body.fee = d.fee || ''; body.showPhone = !!d.showPhone; body.whatsapp = !!d.whatsapp; }
          else { body.role = d.role; body.kind = d.kind || 'clinic'; body.publicPhone = d.publicPhone || ''; }
          fetch('/api/health/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.ok) { sending = false; bs[0].textContent = 'Send · ላክ ✓'; return err(j && j.error); }
            bar.style.width = '100%'; ft.innerHTML = '';
            say('<div class="ok-ic">✓</div>' + q2(type === 'doctor' ? 'Sent! Our team will call you on ' + d.phone + ' to check your licence. Your profile goes live after that call, and they give you a code for your dashboard (bina.et/health/dashboard) where you can edit it.' : 'Sent! Our team will call you on ' + d.phone + ' to confirm. The page updates after that call, and they give you a code for your dashboard (bina.et/health/dashboard).',
              type === 'doctor' ? 'ተልኳል! ቡድናችን ፈቃድዎን ለማረጋገጥ ይደውልልዎታል። ከጥሪው በኋላ ፕሮፋይልዎ ይታያል።' : 'ተልኳል! ቡድናችን ለማረጋገጥ ይደውልልዎታል። ከጥሪው በኋላ ገጹ ይዘመናል።'));
            var o2 = document.createElement('div'); o2.className = 'opts'; o2.innerHTML = '<button type="button" class="go">Close</button>'; ft.appendChild(o2); $('button', o2).onclick = close;
          }).catch(function () { sending = false; bs[0].textContent = 'Send · ላክ ✓'; err('No connection. Please try again.'); });
        };
      }, 260);
    }
    say(type === 'doctor'
      ? q2('Selam! I am Dr Afiya. I will help you make your free doctor profile; it takes about 2 minutes. Nothing shows until our team has called you and checked your licence.', 'ሰላም! እኔ ዶ/ር አፍያ ነኝ። ነፃ የሐኪም ፕሮፋይልዎን እንዲሠሩ እረዳዎታለሁ። ቡድናችን ደውሎ ፈቃድዎን እስኪያረጋግጥ ድረስ ምንም አይታይም።')
      : q2('Selam! I am Dr Afiya. Let us add your services, hours and number, free. Our team calls to confirm before anything shows.', 'ሰላም! እኔ ዶ/ር አፍያ ነኝ። አገልግሎቶችዎን፣ ሰዓትዎንና ቁጥርዎን በነፃ እንጨምር። ከመታየቱ በፊት ቡድናችን ደውሎ ያረጋግጣል።'));
    next();
  }
  // the API gives slugs, not map refs; a slug ends in -<n|w|r><id>, which is the ref
  function refOf(f) { var m = /-([nwr])(\d+)$/.exec(f.slug || ''); return m ? ({ n: 'node', w: 'way', r: 'relation' })[m[1]] + '/' + m[2] : null; }
  window.HealthJoin = openJoin;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="join="]'); if (!a) return;
    var u; try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.pathname !== '/health' || !u.searchParams.get('join')) return;
    e.preventDefault(); openJoin(u.searchParams.get('join'), u.searchParams.get('ref'));
  });
  var P0 = new URLSearchParams(location.search); if (P0.get('join')) openJoin(P0.get('join'), P0.get('ref'));
})();
