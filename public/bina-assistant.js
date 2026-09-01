/* BinaSmart 24/7 AI assistant "Bini" — self-contained floating chat widget. */
(function () {
  if (window.__binaBini) return; window.__binaBini = true;
  var WA = 'https://wa.me/251911244344';
  var css = `
  #biniBtn{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:60px;height:60px;border-radius:50%;
    background:linear-gradient(135deg,#064e3b,#059669 55%,#10b981);color:#fff;border:none;cursor:pointer;
    box-shadow:0 12px 30px -8px rgba(6,78,59,.6);font-size:27px;display:flex;align-items:center;justify-content:center;transition:transform .15s}
  #biniBtn:hover{transform:scale(1.06)}
  #biniBtn .dot{position:absolute;top:6px;right:8px;width:11px;height:11px;background:#f59e0b;border:2px solid #fff;border-radius:50%}
  #biniWrap{position:fixed;right:16px;bottom:16px;z-index:2147483001;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 24px));
    background:#fff;border-radius:20px;box-shadow:0 30px 70px -18px rgba(0,0,0,.4);display:none;flex-direction:column;overflow:hidden;
    font-family:'Noto Sans Ethiopic','Plus Jakarta Sans',system-ui,sans-serif}
  #biniWrap.open{display:flex}
  #biniHd{background:linear-gradient(135deg,#064e3b,#059669 55%,#10b981);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
  #biniHd .av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:20px}
  #biniHd b{font-size:15px;font-weight:800;display:block;line-height:1.2}
  #biniHd small{font-size:11px;opacity:.9}
  #biniHd .x{margin-left:auto;background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px}
  #biniMsgs{flex:1;overflow-y:auto;padding:14px;background:#f4faf7;display:flex;flex-direction:column;gap:10px}
  .biniM{max-width:82%;padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.55;word-wrap:break-word;white-space:pre-wrap}
  .biniM a{color:#047857;font-weight:700}
  .biniA{align-self:flex-start;background:#fff;border:1.5px solid #d7ebe0;color:#1e293b;border-bottom-left-radius:5px}
  .biniU{align-self:flex-end;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border-bottom-right-radius:5px}
  .biniA a{color:#047857}
  #biniTyping{align-self:flex-start;color:#5c7268;font-size:13px;padding:4px 6px}
  #biniIn{display:flex;gap:8px;padding:10px;border-top:1.5px solid #e9f2ed;background:#fff}
  #biniTxt{flex:1;border:1.5px solid #d7ebe0;border-radius:999px;padding:10px 15px;font-size:14px;outline:none;font-family:inherit}
  #biniTxt:focus{border-color:#059669}
  #biniSend{background:linear-gradient(135deg,#064e3b,#059669);color:#fff;border:none;border-radius:50%;width:42px;height:42px;cursor:pointer;font-size:18px;flex:none}
  #biniFoot{text-align:center;font-size:10.5px;color:#8aa;padding:0 0 8px}
  #biniMsgs .biniChips{display:flex;flex-wrap:wrap;gap:7px;align-self:flex-start;max-width:100%;margin-top:2px}
  .biniChip{background:#fff;border:1.5px solid #cfe9dd;color:#047857;border-radius:999px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;transition:transform .14s,background .14s,box-shadow .14s;line-height:1.2}
  .biniChip:hover{background:#ecfdf5;transform:translateY(-2px);box-shadow:0 8px 16px -10px rgba(6,140,120,.5)}
  .biniChip:active{transform:translateY(0)}
  `;
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement('button');
  btn.id = 'biniBtn'; btn.setAttribute('aria-label', 'ያግኙን · Chat'); btn.innerHTML = '💬<span class="dot"></span>';
  document.body.appendChild(btn);

  var wrap = document.createElement('div'); wrap.id = 'biniWrap';
  wrap.innerHTML =
    '<div id="biniHd"><div class="av">🏢</div><div><b>ቢኒ · Bini</b><small>የ BinaSmart ረዳት · 24/7</small></div><button class="x" aria-label="close">×</button></div>' +
    '<div id="biniMsgs"></div>' +
    '<form id="biniIn"><input id="biniTxt" autocomplete="off" placeholder="መልእክት ይጻፉ… (Amharic/English)"><button id="biniSend" type="submit" aria-label="send">➤</button></form>' +
    '<div id="biniFoot">🤖 AI · ትክክለኛ መረጃ ለማረጋገጥ WhatsApp ይጠቀሙ</div>';
  document.body.appendChild(wrap);

  var msgs = wrap.querySelector('#biniMsgs');
  var txt = wrap.querySelector('#biniTxt');
  var history = [];
  var greeted = false;

  function esc(s){ return s.replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function linkify(s){
    s = esc(s);
    var _a=[];
    // markdown [text](url|/path) -> anchor, stashed so URL/path passes don't remangle it
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[a-z0-9][a-z0-9\-\/]*)\)/gi, function(m,txt,url){ var ext=/^https?:/i.test(url); _a.push('<a href="'+url+'"'+(ext?' target="_blank" rel="noopener"':'')+'>'+txt+'</a>'); return '\u0000'+(_a.length-1)+'\u0000'; });
    s = s.replace(/(https?:\/\/[^\s]+)/g, function(u){ return '<a href="'+u+'" target="_blank" rel="noopener">'+u+'</a>'; });
    // bare /path links to bina.et pages
    s = s.replace(/(^|[\s(])(\/[a-z][a-z0-9\-\/]*)/g, function(m,p,path){ return p+'<a href="'+path+'">'+path+'</a>'; });
    s = s.replace(/\u0000(\d+)\u0000/g, function(m,i){ return _a[+i]; });
    return s;
  }
  function add(role, text){
    var d = document.createElement('div');
    d.className = 'biniM ' + (role === 'user' ? 'biniU' : 'biniA');
    d.innerHTML = role === 'user' ? esc(text) : linkify(text);
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d;
  }
  var STARTERS = [
    ['🏠 ኪራይ መሰብሰብ', 'በ BinaSmart ኪራይ እንዴት እሰበስባለሁ?'],
    ['📋 የዛሬ ጨረታ', 'የዛሬ አዳዲስ ጨረታዎችን አሳየኝ'],
    ['🧾 VAT accounting', 'BinaSmart የ VAT አካውንቲንግ እንዴት ይሰራል?'],
    ['🆔 TIN', 'TIN ቁጥር እንዴት አገኛለሁ?'],
    ['🏨 ሆቴል', 'ሆቴል መያዝ እፈልጋለሁ'],
    ['🛂 ፓስፖርት', 'e-Passport እንዴት አወጣለሁ?'],
    ['🏢 ህንፃዬን ማስተዳደር', 'ንብረቴን በ BinaSmart እንዴት አስተዳድራለሁ?']
  ];
  function showChips(){
    var c = document.createElement('div'); c.id = 'biniChips2'; c.className = 'biniChips';
    STARTERS.forEach(function(it){
      var b = document.createElement('button'); b.type = 'button'; b.className = 'biniChip'; b.textContent = it[0];
      b.addEventListener('click', function(){ send(it[1]); });
      c.appendChild(b);
    });
    msgs.appendChild(c); msgs.scrollTop = msgs.scrollHeight;
  }
  function greet(){
    if (greeted) return; greeted = true;
    add('assistant', 'ሰላም! 👋 እኔ ቢኒ ነኝ — የ BinaSmart ረዳት። ስለ ህንፃ አስተዳደር፣ ጨረታ፣ ክፍያ ወይም መመሪያዎች ማንኛውንም ይጠይቁኝ።\n\nHi! I\'m Bini — ask me anything about BinaSmart. 😊');
    showChips();
  }
  function open(){ wrap.classList.add('open'); btn.style.display='none'; greet(); setTimeout(function(){txt.focus();},80); }
  function close(){ wrap.classList.remove('open'); btn.style.display='flex'; }

  btn.addEventListener('click', open);
  wrap.querySelector('.x').addEventListener('click', close);

  function send(m){
    m = (m || '').trim(); if (!m) return;
    var ch = msgs.querySelector('#biniChips2'); if (ch) ch.remove();   // clear starters once chatting
    txt.value = ''; add('user', m); history.push({role:'user', content:m});
    var typing = document.createElement('div'); typing.id='biniTyping'; typing.textContent='ቢኒ እየጻፈ ነው…'; msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight;
    fetch('/api/assistant', {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({message:m, history:history.slice(-6)})})
      .then(function(r){return r.json();})
      .then(function(d){
        typing.remove();
        var rep = (d && d.reply) || 'ይቅርታ፣ በ WhatsApp ያግኙን፦ '+WA;
        add('assistant', rep); history.push({role:'assistant', content:rep});
      })
      .catch(function(){
        typing.remove();
        add('assistant', 'ይቅርታ፣ የግንኙነት ችግር። እባክዎ በ WhatsApp ያግኙን፦ '+WA);
      });
  }
  wrap.querySelector('#biniIn').addEventListener('submit', function(e){
    e.preventDefault();
    send(txt.value);
  });
})();
