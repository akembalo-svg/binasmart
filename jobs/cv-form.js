'use strict';
// The apply panel on a job page. Two ways in, because there are two kinds of applicant:
//
//   1. "I have a CV"      — upload it.                        → POST /api/jobs/apply
//   2. "I don't have one" — answer a few questions and we
//                           write one, as a real PDF.         → POST /api/jobs/cv-build
//
// The second is the one that matters here. A shop assistant with six years behind a counter loses the
// vacancy to someone with a worse record and a typed page; the experience is not what they are missing.
// The AI formats what they type and is forbidden to add to it (jobs/cv-build.js enforces that after the
// model answers, not only in the prompt) - a CV claiming a diploma they do not hold costs them the job
// at the moment the certificate is asked for.
//
// Three things are deliberate:
//   · the consent line says what will happen to their CV, in their own language, next to the box.
//   · nothing is uploaded until they press send - a half-filled form leaves nothing on the server.
//   · the built CV comes back as a download link that is theirs to keep, whether or not they ever hear
//     from this employer. They came for a job; they leave with a document they did not have.

const L = {
  am: {
    open: '📄 ሲቪዎን ይላኩ',
    openMain: '📨 ማመልከቻዎን በዚህ ገጽ ይላኩ',
    hint: 'ማመልከቻ መላክ ካልቻሉ ወይም ሲቪዎን በቀጥታ መላክ ከፈለጉ — ሞልተው ይላኩ።',
    hintMain: 'ሲቪዎን እዚህ ይላኩ — እኛ ወደዚህ ቀጣሪ እናደርሰዋለን።',
    tabUp: '📎 ሲቪ አለኝ', tabAi: '✍️ ሲቪ የለኝም — ይሠራልኝ',
    aiHint: 'የሚያውቁትን ይጻፉ። ሲቪዎን ሠርተን PDF አድርገን ለቀጣሪው እንልካለን — እርስዎም ማውረድ ይችላሉ።',
    name: 'ሙሉ ስም', phone: 'ስልክ (09… ወይም +251…)', city: 'ከተማ', cat: 'የሙያ ዘርፍ',
    years: 'የሥራ ልምድ (ዓመት)', email: 'ኢሜይል (ካለ)',
    edu: 'ትምህርት — ምን ጨረሱ፣ የት፣ መቼ',
    eduPh: 'ምሳሌ፦ 12ኛ ክፍል፣ አዲስ አበባ፣ 2016 · ወይም ዲፕሎማ በአካውንቲንግ፣ ዩኒቲ ኮሌጅ፣ 2014',
    hist: 'የሠሩበት ሥራ — የት፣ ምን ይሠሩ ነበር፣ ስንት ጊዜ',
    histPh: 'ምሳሌ፦ ሱቅ ውስጥ ሻጭ፣ መርካቶ፣ ከ2016 እስከ 2018 — ሽያጭ፣ የሂሳብ መዝገብ፣ ዕቃ መቀበል',
    skills: 'ክህሎት (በኮማ ይለያዩ)', langs: 'ቋንቋ (አማርኛ፣ እንግሊዝኛ…)',
    file: 'ሲቪ (PDF፣ Word ወይም ፎቶ · እስከ 6MB)',
    share: 'ሲቪዬ በተመሳሳይ የሥራ ዘርፍ ላሉ ሌሎች ቀጣሪዎችም ይላክ',
    send: 'ላክ', build: 'ሲቪዬን ይሠራ', sending: 'እየተላከ…', building: 'ሲቪዎ እየተሠራ ነው…',
    ok: '✅ ደርሷል። ሲቪዎ ወደዚህ ቀጣሪ ይተላለፋል።',
    okWide: '✅ ደርሷል። ሲቪዎ ወደዚህ ቀጣሪ፣ እንዲሁም በዚሁ ዘርፍ ወደሚቀጥሩ ሌሎች ድርጅቶች ይተላለፋል።',
    okBuilt: '✅ ሲቪዎ ተሠርቷል፤ ደርሶናል።',
    dl: '⬇️ ሲቪዎን ያውርዱ (PDF)',
    keep: 'ሲቪዎ ለአንድ ዓመት ይቀመጣል። ማስወገድ ከፈለጉ በቴሌግራም ይጻፉልን።',
    err: {
      name_required: 'ሙሉ ስምዎን ይጻፉ።', phone_invalid: 'ስልክ ቁጥሩ ትክክል አይደለም (09… ወይም +2519…)።',
      cv_required: 'ሲቪዎን ያያይዙ።', cv_type: 'ይህ ዓይነት ፋይል አይደገፍም — PDF፣ Word ወይም ፎቶ ይላኩ።',
      cv_too_large: 'ፋይሉ ከ6MB በላይ ነው።', slow_down: 'ትንሽ ቆይተው ይሞክሩ።',
      tell_us_more: 'ትምህርትዎን ወይም የሠሩበትን ሥራ ይጻፉ — ያለዚያ ሲቪ መሥራት አንችልም።',
      other: 'አልተሳካም — እንደገና ይሞክሩ።',
    },
  },
  en: {
    open: '📄 Send your CV instead',
    openMain: '📨 Apply here',
    hint: 'If you cannot reach the advert, or you would rather send your CV directly — fill this in.',
    hintMain: 'Send your CV here — we pass it to this employer.',
    tabUp: '📎 I have a CV', tabAi: '✍️ I don\'t have one — write it for me',
    aiHint: 'Write what you know. We build your CV as a PDF, send it to the employer, and give you a copy to keep.',
    name: 'Full name', phone: 'Phone (09… or +251…)', city: 'City', cat: 'Field of work',
    years: 'Years of experience', email: 'Email (if you have one)',
    edu: 'Education — what you finished, where, when',
    eduPh: 'e.g. Grade 12, Addis Ababa, 2016 · or Diploma in Accounting, Unity College, 2014',
    hist: 'Work you have done — where, what you did, how long',
    histPh: 'e.g. Shop assistant, Merkato, 2016 to 2018 — serving customers, cash book, receiving stock',
    skills: 'Skills (separate with commas)', langs: 'Languages (Amharic, English…)',
    file: 'CV (PDF, Word or a photo · up to 6MB)',
    share: 'Also send my CV to other employers hiring in the same field',
    send: 'Send', build: 'Build my CV', sending: 'Sending…', building: 'Writing your CV…',
    ok: '✅ Received. Your CV will be passed to this employer.',
    okWide: '✅ Received. Your CV will be passed to this employer and to others hiring in the same field.',
    okBuilt: '✅ Your CV is ready, and we have it.',
    dl: '⬇️ Download your CV (PDF)',
    keep: 'Your CV is kept for one year. Message us on Telegram to have it removed sooner.',
    err: {
      name_required: 'Please write your full name.', phone_invalid: 'That phone number does not look right (09… or +2519…).',
      cv_required: 'Please attach your CV.', cv_type: 'That file type is not supported — send a PDF, Word file or a photo.',
      cv_too_large: 'The file is larger than 6MB.', slow_down: 'Please try again in a little while.',
      tell_us_more: 'Please write your education or the work you have done — we cannot build a CV without it.',
      other: 'That did not go through — please try again.',
    },
  },
};

// `main` is set when this panel IS the way to apply - there is no other route on the page. It then opens
// by default and says so, instead of offering itself as an alternative to something that is not there.
function cvForm({ job, lang = 'am', escH, main = false }) {
  const t = L[lang] || L.am;
  const cat = job.jobType || '';
  const common = `
        <input name="name" required placeholder="${escH(t.name)}" maxlength="90">
        <input name="phone" required inputmode="tel" placeholder="${escH(t.phone)}" maxlength="20">
        <div class="two">
          <input name="city" placeholder="${escH(t.city)}" maxlength="60" value="${escH(job.city || '')}">
          <input name="category" placeholder="${escH(t.cat)}" maxlength="60" value="${escH(cat)}">
        </div>`;
  const consent = `
        <label class="tick">
          <input type="checkbox" name="shareWider">
          <span>${t.share}</span>
        </label>`;
  return `
  <details class="sans cvbox"${main ? ' open' : ''} style="margin:14px 0;border:1.5px solid var(--line);border-radius:16px;background:#fff;overflow:hidden">
    <summary>${main ? t.openMain : t.open}</summary>
    <div style="padding:0 16px 16px">
      <div class="cvtabs">
        <button type="button" class="cvtab on" data-pane="up">${t.tabUp}</button>
        <button type="button" class="cvtab" data-pane="ai">${t.tabAi}</button>
      </div>

      <div id="pane-up">
        <p class="cvhint">${main ? t.hintMain : t.hint}</p>
        <form id="cvf">${common}
          <label class="lab">${t.file}
            <input type="file" name="cv" required accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*">
          </label>${consent}
          <button type="submit" class="cvgo">${t.send}</button>
          <div class="cvmsg" id="cvmsg"></div>
        </form>
      </div>

      <div id="pane-ai" hidden>
        <p class="cvhint">${t.aiHint}</p>
        <form id="cvb">${common}
          <div class="two">
            <input name="years" inputmode="numeric" placeholder="${escH(t.years)}" maxlength="20">
            <input name="email" type="email" placeholder="${escH(t.email)}" maxlength="120">
          </div>
          <label class="lab">${t.edu}
            <textarea name="education" rows="2" maxlength="600" placeholder="${escH(t.eduPh)}"></textarea>
          </label>
          <label class="lab">${t.hist}
            <textarea name="history" rows="4" maxlength="1800" placeholder="${escH(t.histPh)}"></textarea>
          </label>
          <input name="skills" placeholder="${escH(t.skills)}" maxlength="400">
          <input name="languages" placeholder="${escH(t.langs)}" maxlength="200">${consent}
          <button type="submit" class="cvgo">${t.build}</button>
          <div class="cvmsg" id="cvbmsg"></div>
        </form>
      </div>
    </div>
  </details>
  <style>
    .cvbox summary{cursor:pointer;padding:13px 16px;font-weight:800;list-style:none}
    .cvbox summary::-webkit-details-marker{display:none}
    .cvtabs{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 12px}
    .cvtab{border:1.5px solid var(--line);background:#fff;color:var(--mut);border-radius:999px;padding:8px 15px;
      font-weight:700;font-size:13.5px;font-family:inherit;cursor:pointer}
    .cvtab.on{background:#eef4ff;border-color:#8fb0f2;color:#1e3a8a}
    .cvhint{color:var(--mut);font-size:13.5px;margin:0 0 12px}
    .cvbox form{display:grid;gap:9px}
    .cvbox .two{display:flex;gap:9px;flex-wrap:wrap}
    .cvbox .two>*{flex:1;min-width:132px}
    .cvbox .lab{font-size:13px;color:var(--mut);display:block}
    .cvbox input:not([type=checkbox]):not([type=file]),.cvbox textarea{width:100%;border:1.5px solid var(--line);
      border-radius:10px;padding:11px 13px;font-size:14.5px;font-family:inherit;background:#fff;color:inherit}
    .cvbox textarea{margin-top:5px;line-height:1.5;resize:vertical}
    .cvbox input[type=file]{display:block;margin-top:5px;font-family:inherit}
    .cvbox .tick{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;line-height:1.45;padding:2px 0}
    .cvbox .tick input{margin-top:3px;width:17px;height:17px;flex:none}
    .cvgo{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;border:0;border-radius:999px;padding:12px 26px;
      font-weight:800;font-size:14.5px;font-family:inherit;cursor:pointer;justify-self:start}
    .cvgo[disabled]{opacity:.6}
    .cvmsg{font-size:13.5px;line-height:1.5}
    .cvmsg a{font-weight:800}
  </style>
  <script>
  (function(){
    var box=document.querySelector('.cvbox'); if(!box) return;
    var T=${JSON.stringify({ sending: t.sending, building: t.building, send: t.send, build: t.build,
      ok: t.ok, okWide: t.okWide, okBuilt: t.okBuilt, dl: t.dl, keep: t.keep, err: t.err })};
    var JOB=${JSON.stringify(job.id)};

    box.querySelectorAll('.cvtab').forEach(function(b){
      b.addEventListener('click', function(){
        box.querySelectorAll('.cvtab').forEach(function(x){ x.classList.toggle('on', x===b); });
        box.querySelector('#pane-up').hidden = b.dataset.pane!=='up';
        box.querySelector('#pane-ai').hidden = b.dataset.pane!=='ai';
      });
    });

    function done(form, msg, html){
      form.querySelectorAll('input,button,textarea').forEach(function(el){ el.disabled=true; });
      msg.style.color='#047857';
      msg.innerHTML=html+'<br><span style="color:var(--mut)">'+T.keep+'</span>';
    }
    function fail(msg, btn, label, code){
      msg.style.color='#b91c1c';
      msg.textContent=T.err[code||'other']||T.err.other;
      btn.disabled=false; btn.textContent=label;
    }
    function post(url, body, msg, btn, label, onOk){
      fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
        .then(function(x){ return x.json().catch(function(){ return {ok:false}; }); })
        .then(function(d){ if(d&&d.ok) onOk(d); else fail(msg,btn,label,d&&d.error); })
        .catch(function(){ fail(msg,btn,label); });
    }

    // 1. they have a CV
    var f=box.querySelector('#cvf'), msg=box.querySelector('#cvmsg');
    f.addEventListener('submit', function(ev){
      ev.preventDefault();
      var E=f.elements, file=E.cv.files[0], btn=f.querySelector('.cvgo');
      if(!file){ msg.style.color='#b91c1c'; msg.textContent=T.err.cv_required; return; }
      if(file.size>6*1024*1024){ msg.style.color='#b91c1c'; msg.textContent=T.err.cv_too_large; return; }
      btn.disabled=true; btn.textContent=T.sending; msg.textContent='';
      var r=new FileReader();
      r.onload=function(){
        post('/api/jobs/apply',{ jobId:JOB, name:E.name.value, phone:E.phone.value, city:E.city.value,
          category:E.category.value, cv:String(r.result).split(',')[1]||'', cvMime:file.type||'application/pdf',
          shareWider:E.shareWider.checked }, msg, btn, T.send, function(){
            done(f, msg, E.shareWider.checked?T.okWide:T.ok);
          });
      };
      r.onerror=function(){ fail(msg,btn,T.send); };
      r.readAsDataURL(file);
    });

    // 2. we write one
    var b2=box.querySelector('#cvb'), msg2=box.querySelector('#cvbmsg');
    b2.addEventListener('submit', function(ev){
      ev.preventDefault();
      var E=b2.elements, btn=b2.querySelector('.cvgo');
      btn.disabled=true; btn.textContent=T.building;
      msg2.style.color='var(--mut)'; msg2.textContent=T.building;
      post('/api/jobs/cv-build',{ jobId:JOB, name:E.name.value, phone:E.phone.value, city:E.city.value,
        category:E.category.value, years:E.years.value, email:E.email.value, education:E.education.value,
        history:E.history.value, skills:E.skills.value, languages:E.languages.value,
        shareWider:E.shareWider.checked }, msg2, btn, T.build, function(d){
          done(b2, msg2, (E.shareWider.checked?T.okWide:T.okBuilt)+
            '<br><a href="'+d.pdf+'" target="_blank" rel="noopener">'+T.dl+'</a>');
        });
    });
  })();
  </script>`;
}

module.exports = { cvForm, L };
