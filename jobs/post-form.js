'use strict';
// bina.et/jobs/post — an employer publishes a vacancy, free.
//
// Where this sits: the "Post a vacancy FREE" band on /jobs used to send an employer to Telegram, which
// means the owner types the advert out by hand for every company. This is the same offer with the
// typing done by the person who has the details, and it lands in the same review queue
// (jobs/submit.js): nothing here reaches the board until a person taps publish.
//
// Deliberately short. An employer posting a cleaner's job on a phone will not fill fourteen fields, and
// every field we demand is a vacancy that never gets posted. Five are required, the rest help.
const { gradient, badge } = require('../brand/sections');

const L = {
  am: {
    h1: 'ክፍት የሥራ ቦታዎን በነጻ ያውጡ',
    lede: 'ማስታወቂያዎ ከድርጅትዎ መገለጫ ጋር በbina.et ላይ ይወጣል — ክፍያ የለም።',
    company: 'የድርጅቱ ስም', title: 'የሥራ መደቡ ስም', city: 'ከተማ',
    type: 'የቅጥር ዓይነት', salary: 'ደመወዝ (ካለ)', deadline: 'ማብቂያ ቀን',
    summary: 'ስለ ሥራው በአጭሩ', body: 'ዝርዝር — የሥራ ድርሻ፣ የሚጠበቅ ብቃት፣ የሥራ ልምድ',
    apply: 'እንዴት ማመልከት ይቻላል — ኢሜይል፣ አድራሻ ወይም የማመልከቻ ሊንክ',
    you: 'የእርስዎ ስም', youRef: 'ስልክ ወይም ኢሜይል (ለእኛ ብቻ)',
    send: 'ማስታወቂያውን ላክ', sending: 'እየተላከ…',
    ok: '✅ ደርሶናል። ከመታተሙ በፊት አንድ ሰው ያረጋግጠዋል — በተለምዶ በጥቂት ሰዓታት ውስጥ ይወጣል።',
    free: 'ነጻ ነው። ከሥራ ፈላጊም ሆነ ከቀጣሪ ምንም ክፍያ አንጠይቅም።',
    note: 'ማስታወቂያው ከመውጣቱ በፊት በሰው ይታያል — ይህ የውሸት ማስታወቂያ እንዳይወጣ ነው።',
    claim: 'ድርጅትዎ አስቀድሞ በቢና ላይ አለ? ገጽዎን በ<a href="/employers">የድርጅቶች ማውጫ</a> ያግኙና «ይህ የእርስዎ ድርጅት ነው?» በመጫን ትክክለኛ አድራሻዎንና የካርታ ቦታዎን በነጻ ያክሉ።',
    err: { employer_required: 'የድርጅቱን ስም ይጻፉ።', title_required: 'የሥራ መደቡን ስም ይጻፉ።',
      slow_down: 'ትንሽ ቆይተው ይሞክሩ።', other: 'አልተሳካም — እንደገና ይሞክሩ።' },
  },
  en: {
    h1: 'Post a vacancy, free',
    lede: 'Your advert appears on bina.et with your company profile. No charge.',
    company: 'Company name', title: 'Job title', city: 'City',
    type: 'Employment type', salary: 'Salary (if you state one)', deadline: 'Closing date',
    summary: 'The job in one or two lines', body: 'Details — duties, requirements, experience',
    apply: 'How to apply — email, office address, or an application link',
    you: 'Your name', youRef: 'Phone or email (for us only)',
    send: 'Send the advert', sending: 'Sending…',
    ok: '✅ Received. A person checks it before it goes live — usually within a few hours.',
    free: 'It is free. We charge neither the employer nor the job seeker.',
    note: 'Every advert is read by a person before publishing — that is how fake vacancies stay off the board.',
    claim: 'Is your company already on Bina? Find its page in the <a href="/employers?lang=en">company directory</a> and tap «Is this your company?» to add your exact address and map pin, free.',
    err: { employer_required: 'Please write the company name.', title_required: 'Please write the job title.',
      slow_down: 'Please try again in a little while.', other: 'That did not go through — please try again.' },
  },
};

const TYPES = [['full-time', 'ሙሉ ጊዜ'], ['part-time', 'ትርፍ ጊዜ'], ['contract', 'በውል'], ['internship', 'ልምምድ'], ['temporary', 'ጊዜያዊ']];

module.exports = function postFormRoutes(fastify, { shell, escH }) {
  fastify.get('/jobs/post', async (req, reply) => {
    const lang = String(req.query.lang || '').toLowerCase() === 'en' ? 'en' : 'am';
    const t = L[lang];
    const body = `<main>
      <a class="sans" href="${lang === 'en' ? '?lang=am' : '?lang=en'}" style="float:right;font-size:13px;font-weight:700;border:1.5px solid var(--line);border-radius:999px;padding:5px 14px">${lang === 'en' ? 'አማርኛ' : 'English'}</a>
      <div class="phero lite"><div style="display:flex;align-items:center;gap:12px">${badge('jobs', { size: 26 })}
        <h1 style="margin:0">${t.h1}</h1></div>
        <div class="am sans">${t.lede}</div></div>

      <form id="pf" class="sans pf">
        <label>${t.company}<input name="employerName" required maxlength="120"></label>
        <label>${t.title}<input name="title" required maxlength="140"></label>
        <div class="row">
          <label>${t.city}<input name="city" maxlength="60" value="Addis Ababa"></label>
          <label>${t.type}<select name="jobType"><option value=""></option>
            ${TYPES.map(([v, am]) => `<option value="${v}">${lang === 'en' ? v.replace(/-/g, ' ') : am}</option>`).join('')}
          </select></label>
        </div>
        <div class="row">
          <label>${t.salary}<input name="salary" maxlength="60"></label>
          <label>${t.deadline}<input name="deadline" type="date"></label>
        </div>
        <label>${t.summary}<input name="summary" maxlength="280"></label>
        <label>${t.body}<textarea name="bodyHtml" rows="6" maxlength="8000"></textarea></label>
        <label>${t.apply}<textarea name="howToApply" rows="3" maxlength="600"></textarea></label>
        <div class="row">
          <label>${t.you}<input name="submitter" maxlength="90"></label>
          <label>${t.youRef}<input name="submitterRef" maxlength="90"></label>
        </div>
        <button type="submit">${t.send}</button>
        <div id="pmsg"></div>
        <p class="note">${t.note}<br>${t.free}</p>
        <p class="note">🏢 ${t.claim}</p>
      </form>
    </main>
    <style>
      /* The light hero, repeated here rather than exported from jobs/routes.js: two short rules are a
         smaller dependency than a shared stylesheet for one page. */
      .phero.lite{background:#fff;color:var(--ink);padding:16px 18px;margin:16px 0 2px;clear:both;overflow:visible;
        border:1.5px solid var(--line);box-shadow:0 10px 26px -22px rgba(15,23,42,.5)}
      .phero.lite h1{font-size:clamp(20px,4.6vw,27px)}
      .phero.lite .am{color:var(--mut);font-weight:700;font-size:13px;margin-top:3px}
      .phero.lite::after{display:none}
      .pf{display:grid;gap:12px;max-width:640px;margin:18px 0 40px}
      .pf label{display:block;font-size:13px;font-weight:700;color:var(--mut)}
      .pf input,.pf select,.pf textarea{display:block;width:100%;margin-top:5px;border:1.5px solid var(--line);
        border-radius:11px;padding:12px 13px;font-size:15px;font-family:inherit;background:#fff;color:var(--ink);font-weight:400}
      .pf textarea{line-height:1.55;resize:vertical}
      .pf .row{display:flex;gap:12px;flex-wrap:wrap}
      .pf .row>label{flex:1;min-width:150px}
      .pf button{background:${gradient('jobs')};color:#fff;border:0;border-radius:999px;padding:13px 30px;
        font-weight:800;font-size:15px;font-family:inherit;cursor:pointer;justify-self:start}
      .pf button[disabled]{opacity:.6}
      .pf .note{color:var(--mut);font-size:12.5px;line-height:1.6;margin:0}
      #pmsg{font-size:14px;line-height:1.55}
    </style>
    <script>
    (function(){
      var f=document.getElementById('pf'), msg=document.getElementById('pmsg');
      var T=${JSON.stringify({ send: t.send, sending: t.sending, ok: t.ok, err: t.err })};
      f.addEventListener('submit', function(ev){
        ev.preventDefault();
        var E=f.elements, btn=f.querySelector('button');
        btn.disabled=true; btn.textContent=T.sending; msg.textContent='';
        var payload={source:'form'};
        ['employerName','title','city','jobType','salary','deadline','summary','bodyHtml','howToApply','submitter','submitterRef']
          .forEach(function(k){ if(E[k] && E[k].value) payload[k]=E[k].value; });
        fetch('/api/jobs/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
          .then(function(r){ return r.json().catch(function(){return {ok:false};}); })
          .then(function(d){
            if(d&&d.ok){
              f.querySelectorAll('input,select,textarea,button').forEach(function(el){el.disabled=true;});
              msg.style.color='#047857'; msg.textContent=T.ok;
            } else {
              msg.style.color='#b91c1c'; msg.textContent=T.err[(d&&d.error)||'other']||T.err.other;
              btn.disabled=false; btn.textContent=T.send;
            }
          })
          .catch(function(){ msg.style.color='#b91c1c'; msg.textContent=T.err.other; btn.disabled=false; btn.textContent=T.send; });
      });
    })();
    </script>`;
    reply.type('text/html').send(shell({
      title: lang === 'en' ? 'Post a job vacancy in Ethiopia — free · BinaSmart' : 'ክፍት የሥራ ቦታ በነጻ ያውጡ · BinaSmart',
      desc: lang === 'en'
        ? 'Employers: publish your vacancy on bina.et free of charge, with your company profile. Checked by a person before it goes live.'
        : 'ቀጣሪዎች፦ ክፍት የሥራ ቦታዎን በbina.et ላይ በነጻ ያውጡ — ከድርጅትዎ መገለጫ ጋር። ከመውጣቱ በፊት በሰው ይረጋገጣል።',
      canonical: 'https://bina.et/jobs/post', body, active: 'jobs',
      ogImage: 'https://bina.et/static/og-section-jobs.png',
    }));
  });
};
