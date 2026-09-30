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
  #biniPic{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;background:#eef7f2;border:1.5px solid #d7ebe0;cursor:pointer;font-size:18px;flex:none}
  #biniPic:hover{background:#dff0e8}
  #biniFile{display:none}
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
    '<form id="biniIn">' + '<label id="biniPic" title="ፎቶ ይላኩ · send a photo" aria-label="send a photo">📷<input id="biniFile" type="file" accept="image/*" capture="environment"></label>' + '<input id="biniTxt" autocomplete="off" placeholder="መልእክት ይጻፉ… (Amharic/English)"><button id="biniSend" type="submit" aria-label="send">➤</button></form>' +
    '<div id="biniFoot">🤖 AI · ትክክለኛ መረጃ ለማረጋገጥ WhatsApp ይጠቀሙ</div>';
  document.body.appendChild(wrap);

  var msgs = wrap.querySelector('#biniMsgs');
  var txt = wrap.querySelector('#biniTxt');
  var history = [];
  function biniUid(){ try { var k='bina_uid', v=localStorage.getItem(k); if(!v){ v='w'+Date.now().toString(36)+Math.random().toString(36).slice(2,10); localStorage.setItem(k,v);} return v; } catch(e){ return ''; } }
  var greeted = false;

  function esc(s){ return s.replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  // A link to a spot on the page the visitor is on (bina.et/property#p-...) opens it right here, not in a new tab.
  function here(u){ try { var x = new URL(u, location.href); return x.origin === location.origin && x.pathname === location.pathname && !!x.hash; } catch (e) { return false; } }
  function linkify(s){
    s = esc(s);
    var _a=[];
    // markdown [text](url|/path) -> anchor, stashed so URL/path passes don't remangle it
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[a-z0-9][a-z0-9\-\/]*)\)/gi, function(m,txt,url){ var ext=/^https?:/i.test(url)&&!here(url); _a.push('<a href="'+url+'"'+(ext?' target="_blank" rel="noopener"':'')+'>'+txt+'</a>'); return '\u0000'+(_a.length-1)+'\u0000'; });
    s = s.replace(/(https?:\/\/[^\s]+?)([.,;:!?)]*)(?=\s|$)/g, function(m,u,tail){ return '<a href="'+u+'"'+(here(u)?'':' target="_blank" rel="noopener"')+'>'+u+'</a>'+tail; });
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
  var PROPERTY = /^\/property(\/|$)/.test(location.pathname);
  var CARS = /^\/cars(\/|$)/.test(location.pathname);
  var HOTELS = /^\/hotels(\/|$)/.test(location.pathname);
  if (HOTELS) STARTERS = [
    ['🏨 Hotels in Bole', 'Hotels in Bole'],
    ['⭐ 4-star hotels', 'Show me 4 star hotels in Addis Ababa'],
    ['🛏️ ፔንሲዮን ፒያሳ', 'ፒያሳ አካባቢ ፔንሲዮን'],
    ['🏠 Furnished apartments', 'Furnished apartment hotels in Addis']
  ];
  if (CARS) STARTERS = [
    ['🚙 SUV under 10 million', 'Show me SUVs for sale under 10 million birr'],
    ['⚡ Electric cars', 'Electric cars for sale in Addis'],
    ['🏷️ የሚሸጥ መኪና', 'የሚሸጥ ቶዮታ መኪና አሳየኝ'],
    ['💰 Cheapest cars', 'Show me the cheapest cars for sale'],
    ['🆕 New Suzuki', 'New Suzuki cars for sale']
  ];
  var COM = (location.pathname.match(/^\/companies\/([a-z0-9-]+)\/?$/) || [])[1] || null;
  var COMODE = !!COM && /[?&]bini=company\b/.test(location.search);
  var HOT = (location.pathname.match(/^\/hotels\/([a-z0-9-]+)\/?$/) || [])[1] || null;
  var HOMODE = !!HOT && /[?&]bini=hotel\b/.test(location.search);
  // a restaurant's own page, opened from its "Claim this page" button (restaurants/directory.js, 1 Oct 2026)
  var RES = (location.pathname.match(/^\/restaurants\/([a-z0-9-]+)\/?$/) || [])[1] || null;
  var REMODE = !!RES && /[?&]bini=restaurant\b/.test(location.search);
  var LIMODE = PROPERTY && /[?&]bini=list\b/.test(location.search);
  if (LIMODE) STARTERS = [
    ['\u{1F3E0} ለሽያጭ \u00b7 For sale', 'ቤቴን ለሽያጭ ማስተዋወቅ እፈልጋለሁ። · I want to list my home for sale.'],
    ['\u{1F511} ለኪራይ \u00b7 For rent', 'ቤቴን ለኪራይ ማስተዋወቅ እፈልጋለሁ። · I want to list my home for rent.'],
    ['\u{1F4F7} ፎቶ ላክ \u00b7 Send photos', '__photo__'],
    ['\u{1F3E2} ድርጅት/ደላላ ነኝ \u00b7 Company or agent', 'እኔ የሪል እስቴት ድርጅት ወይም ደላላ ነኝ፤ ቤቶቻችንን መዘርዘር እንፈልጋለን። · I am a company or agent and want to list our homes.']
  ];
  var SHMODE = /^\/shop\/?$/.test(location.pathname) && /[?&]bini=shop\b/.test(location.search);
  if (SHMODE) STARTERS = [
    ['\u{1F6CD} ዕቃ ልለጥፍ · Post a product', 'ዕቃ በbina.et/shop ላይ መለጠፍ እፈልጋለሁ። · I want to post a product on bina.et/shop.'],
    ['\u{1F3F7} ቅናሽ · Post an offer', 'ለሱቄ ቅናሽ መለጠፍ እፈልጋለሁ። · I want to post an offer or discount for my shop.'],
    ['\u{1F4F7} ፎቶ ላክ · Send photos', '__photo__'],
    ['\u{1F5D1} ልጥፌን አንሳ · Remove my post', 'የለጠፍኩት ዕቃ ተሽጧል፤ እባክዎ ያንሱት። · My item is sold, please take my post down.']
  ];
  var CONAME = (COMODE || HOMODE || REMODE) ? ((document.querySelector('h1') || {}).textContent || '').trim().slice(0, 80) : '';
  if (REMODE) STARTERS = [
    ['📞 Our phone & hours · ስልክና ሰዓት', 'I work at this restaurant. I want to add our phone number and opening hours.'],
    ['🍲 Add dishes & prices · ምግቦችና ዋጋ', 'I work at this restaurant. I want to add our dishes with prices.'],
    ['✏️ Fix our details · ለማስተካከል', 'I work at this restaurant. Some of our details are wrong.'],
    ['✅ Confirm our page · ለመረከብ', 'I own this restaurant and want to confirm (claim) our page.']
  ];
  if (HOMODE) STARTERS = [
    ['\u{1F4F7} Add our photos \u00b7 \u134e\u1276', '__photo__'],
    ['🛏️ Add rooms & prices · ክፍሎችና ዋጋ', 'I work at this hotel. I want to add our rooms and prices.'],
    ['📞 Add our phone · ስልክ', 'I work at this hotel. I want to add our phone number.'],
    ['✏️ Fix our details · ለማስተካከል', 'I work at this hotel. Some of our details are wrong.'],
    ['✅ Confirm our page · ለመረከብ', 'I work at this hotel and want to confirm (claim) our page.'],
    ['🌐 Direct bookings · ቀጥታ ቦታ ማስያዝ', 'I work at this hotel. How can guests book rooms with us directly on BinaSmart?']
  ];
  if (COMODE) STARTERS = [
    ['📞 Add our WhatsApp · ዋትሳፕ', 'I work at this company. I want to add our WhatsApp and phone number.'],
    ['🏠 Add listings · ለመጨመር', 'I work at this company. We want to add new listings.'],
    ['✏️ Fix our details · ለማስተካከል', 'I work at this company. Some of our details are wrong.'],
    ['✅ Confirm our page · ለመረከብ', 'I work at this company and want to confirm (claim) our page.'],
    ['🗑️ Remove a listing · ለማስወገድ', 'I work at this company. Please remove a listing.']
  ];
  if (PROPERTY) STARTERS = [
    ['🛏️ 2 bedrooms for rent, Bole', 'I want a 2 bedroom apartment for rent in Bole, up to 200,000 birr a month'],
    ['🏢 የሚሸጥ አፓርትመንት', 'በአዲስ አበባ የሚሸጥ አፓርትመንት አሳየኝ'],
    ['💰 Cheapest homes for sale', 'Show me the cheapest homes for sale'],
    ['🛋️ Furnished studio', 'Furnished studio apartment for rent'],
    ['🏡 Villa / G+1', 'Villa or G+1 house for sale']
  ];
  function showChips(){
    var c = document.createElement('div'); c.id = 'biniChips2'; c.className = 'biniChips';
    STARTERS.forEach(function(it){
      var b = document.createElement('button'); b.type = 'button'; b.className = 'biniChip'; b.textContent = it[0];
      b.addEventListener('click', function(){ if (it[1] === '__photo__') { var fi = document.getElementById('biniFile'); if (fi) fi.click(); return; } send(it[1]); });
      c.appendChild(b);
    });
    msgs.appendChild(c); msgs.scrollTop = msgs.scrollHeight;
  }
  function greet(){
    if (greeted) return; greeted = true;
    if (SHMODE) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ \u{1F6CD} ዕቃዎን ወይም ቅናሽዎን በbina.et/shop ላይ በነጻ እለጥፍልዎታለሁ። ኮሚሽን የለም፤ ገዢዎች በቀጥታ እርስዎን ይደውላሉ። ምን ይሸጣሉ? ፎቶ በካሜራ ቁልፉ መላክ ይችላሉ።\n\nHi, I\'m Bini! I\'ll post your product or offer on bina.et/shop, free and with no commission; buyers call you directly. What are you selling? You can send photos with the camera button.'); showChips(); return; }
    if (LIMODE) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ \u{1F3E0} ቤትዎን፣ አፓርታማዎን፣ ቦታዎን ወይም ሱቅዎን ለሽያጭ ወይም ለኪራይ በነጻ እናስተዋውቃለን። ኮሚሽን የለም፤ ገዢዎችና ተከራዮች በቀጥታ እርስዎን ይደውላሉ። ጥቂት ጥያቄዎችን እጠይቅዎታለሁ፤ ፎቶዎችንም በካሜራ ቁልፉ መላክ ይችላሉ። ቡድናችን ደውሎ ካረጋገጠ በኋላ ይለቀቃል።\n\nHi, I\'m Bini! List your home, apartment, land or shop for sale or rent, free and with no commission; buyers and tenants call you directly. I\'ll ask a few questions, and you can send photos with the camera button. It goes live after our team calls to confirm.'); showChips(); return; }
    if (REMODE) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ 🍽 ' + (CONAME ? 'የ' + CONAME + ' ' : '') + 'ገጽ በቢናስማርት ላይ ነው። ስልክ ቁጥርዎን፣ የሥራ ሰዓትዎንና ምግቦችዎን ከነዋጋቸው ይንገሩኝ፤ ቡድናችን ደውሎ አረጋግጦ ያጸድቃል። ነፃ ነው፣ ኮሚሽን የለም።\n\nHi, I\'m Bini! ' + (CONAME ? CONAME + '\'s' : 'Your') + ' page is on BinaSmart. Tell me your phone, your opening hours and your dishes with prices; our team calls to confirm before anything shows. Free, no commission.'); showChips(); return; }
    if (HOMODE) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ 🏨 ' + (CONAME ? 'የ' + CONAME + ' ' : '') + 'ገጽ በቢናስማርት ላይ ነው። ክፍሎችና ዋጋ፣ ስልክ ቁጥር ወይም የሚስተካከል መረጃ ካለ ይንገሩኝ፤ ቡድናችን አረጋግጦ ያጸድቃል። እንግዶች በቀጥታ ከእርስዎ ጋር ቦታ ያስይዛሉ፤ ኮሚሽን የለም። በማንኛውም ሰዓት እመልሳለሁ።\n\nHi, I\'m Bini! ' + (CONAME ? CONAME + '\'s' : 'Your') + ' page is on BinaSmart. Tell me your rooms and prices, your phone, or what to fix, and our team will confirm and approve it. Guests book with you directly, 0% commission. I answer any time.'); showChips(); return; }
    if (COMODE) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ 🤝 ' + (CONAME ? 'የ' + CONAME + ' ' : '') + 'ገጽ በቢናስማርት ላይ ነው። ቁጥር መጨመር፣ መረጃ ማስተካከል፣ ቤት ወይም መኪና መጨመር ወይም ማስወገድ ከፈለጉ ይንገሩኝ፤ ቡድናችን አረጋግጦ ያጸድቃል። በማንኛውም ሰዓት እመልሳለሁ።\n\nHi, I\'m Bini! ' + (CONAME ? CONAME + '\'s' : 'Your') + ' page is on BinaSmart. Tell me what to add, change or remove (your WhatsApp number, details, new listings) and our team will confirm and approve it. I answer any time.'); showChips(); return; }
    if (HOTELS) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ 🏨 የት አካባቢ ማረፍ ይፈልጋሉ? ሰፈሩንና የሆቴል ዓይነቱን ይንገሩኝ።\n\nHi, I\'m Bini! Tell me the area and the kind of place, and I\'ll give you hotels with their own phone.'); showChips(); return; }
    if (CARS) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ 🚗 ምን ዓይነት መኪና ይፈልጋሉ? ሞዴል፣ ዓመትና በጀትዎን ይንገሩኝ።\n\nHi, I\'m Bini! Tell me the make, year and budget, and I\'ll show you real cars with the dealer\'s own phone.'); showChips(); return; }
    if (PROPERTY) { add('assistant', 'ሰላም! እኔ ቢኒ ነኝ 🏠 ምን ዓይነት ቤት ይፈልጋሉ? ሰፈር፣ መኝታ ቤት ብዛትና በጀትዎን ይንገሩኝ።\n\nHi, I\'m Bini! Tell me the area, bedrooms and budget, and I\'ll show you real listings with the company\'s own phone.'); showChips(); return; }
    add('assistant', 'ሰላም! 👋 እኔ ቢኒ ነኝ — የ BinaSmart ረዳት። ስለ ህንፃ አስተዳደር፣ ጨረታ፣ ክፍያ ወይም መመሪያዎች ማንኛውንም ይጠይቁኝ።\n\nHi! I\'m Bini — ask me anything about BinaSmart. 😊');
    showChips();
  }
  function open(){ wrap.classList.add('open'); btn.style.display='none'; greet(); setTimeout(function(){txt.focus();},80); }
  function close(){ wrap.classList.remove('open'); btn.style.display='flex'; }

  btn.addEventListener('click', open);
  if (COMODE || HOMODE || LIMODE || SHMODE || REMODE) setTimeout(open, 700);
  window.biniAsk = function(m){ open(); if (m && String(m).trim()) send(String(m).trim().slice(0, 500)); };
  // A link to a spot on this page (a listing card) jumps there without reloading, even when the address has
  // ?utm=... in it; on a phone the chat closes so the card can be seen.
  msgs.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a || !here(a.getAttribute('href') || '')) return;
    e.preventDefault();
    var h = new URL(a.getAttribute('href'), location.href).hash;
    if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h;
    if (window.innerWidth < 640) close();
  });
  wrap.querySelector('.x').addEventListener('click', close);

  function send(m){
    m = (m || '').trim(); if (!m) return;
    var ch = msgs.querySelector('#biniChips2'); if (ch) ch.remove();   // clear starters once chatting
    txt.value = ''; add('user', m); history.push({role:'user', content:m});
    var typing = document.createElement('div'); typing.id='biniTyping'; typing.textContent='ቢኒ እየጻፈ ነው…'; msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight;
    fetch('/api/assistant', {method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({message:m, history:history.slice(-6), user:{uid:biniUid()}, company: COMODE ? COM : undefined, hotel: HOMODE ? HOT : undefined, restaurant: REMODE ? RES : undefined, listing: LIMODE ? true : undefined, shop: SHMODE ? true : undefined})})
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
  // A photograph of a document, read out (server: /api/assistant/read-image). People here photograph
  // every letter an office gives them; the typed question next to it is optional, so an older person can
  // send the picture alone and still be answered.
  wrap.querySelector('#biniFile').addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    e.target.value = '';                       // so the same photo can be sent twice
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { add('assistant', 'ፎቶው በጣም ትልቅ ነው (ከ6MB በታች ይሁን)። · The photo is too large.'); return; }
    var q = txt.value.trim(); txt.value = '';
    add('user', '📷 ' + (q || (SHMODE ? 'የዕቃው ፎቶ · photo of the product' : LIMODE ? 'የቤቱ ፎቶ · photo of the home' : 'ይህን ፎቶ አንብብልኝ')));
    var typing = document.createElement('div'); typing.id='biniTyping'; typing.textContent='ቢኒ ፎቶውን እያነበበ ነው…';
    msgs.appendChild(typing); msgs.scrollTop = msgs.scrollHeight;
    var fr = new FileReader();
    fr.onload = function(){
      var b64 = String(fr.result).split(',')[1] || '';
      if (LIMODE || SHMODE) {   // listing / shop mode: a photo of the home; kept private until the team approves the listing
        fetch('/api/property/photo', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({image: b64, mime: file.type || 'image/jpeg', uid: biniUid()})})
          .then(function(r){ return r.json(); }).then(function(d){ typing.remove();
            if (d && d.ok) { var n = d.count || 1; add('assistant', 'ፎቶው ደርሶኛል \u2705 (' + n + ') \u00b7 Photo received. ተጨማሪ ፎቶ መላክ ይችላሉ። · You can send more.');
              history.push({role:'user', content:'[I sent ' + n + ' photo(s) of the ' + (SHMODE ? 'product' : 'home') + ' in this chat]'}); return; }
            add('assistant', d && d.error === 'too_small' ? 'ፎቶው ትንሽ ነው፤ ትልቅ ፎቶ ይላኩ። · The photo is too small (at least 600 pixels wide).'
              : d && d.error === 'slow_down' ? 'ብዙ ፎቶዎች ተልከዋል፤ ትንሽ ቆይተው ይሞክሩ። · Too many photos for now.' : 'ፎቶውን መላክ አልተቻለም። · Could not send the photo.'); })
          .catch(function(){ typing.remove(); add('assistant', 'Connection problem.'); });
        return;
      }
      if (HOMODE) {   // on a hotel's own page the photo is for that hotel's gallery: the team checks it, no AI reads it
        fetch('/api/hotels/photo', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({slug: HOT, image: b64, mime: file.type || 'image/jpeg', note: q, uid: biniUid()})})
          .then(function(r){ return r.json(); }).then(function(d){ typing.remove();
            add('assistant', d && d.ok ? '\u12a5\u1293\u1218\u1230\u130d\u1293\u1208\u1295! \u{1F4F7} \u134e\u1276\u12cd \u12f0\u122d\u1236\u1293\u120d\u1362 \u1261\u12f5\u1291 \u12a0\u12ed\u1276 \u1308\u133d\u12ce \u120b\u12ed \u12eb\u1235\u1240\u121d\u1320\u12cb\u120d\u1362 \u1270\u1328\u121b\u122a \u134e\u1276 \u1218\u120b\u12ad \u12ed\u127d\u120b\u1209\u1362\n\nThank you! Our team will check the photo and add it to your page. You can send more photos.'
              : d && d.error === 'too_small' ? 'The photo is too small. Please send a bigger one (at least 800 pixels wide).'
              : d && d.error === 'slow_down' ? 'Too many photos this hour. Please try again later.' : 'Could not send the photo. Please try again.'); })
          .catch(function(){ typing.remove(); add('assistant', 'Connection problem.'); });
        return;
      }
      fetch('/api/assistant/read-image', {method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({image:b64, mime:file.type || 'image/jpeg', question:q, uid:biniUid()})})
        .then(function(r){ return r.json().then(function(d){ return {s:r.status, d:d}; }); })
        .then(function(x){
          typing.remove();
          if (x.d && x.d.ok && x.d.text) { add('assistant', x.d.text); history.push({role:'assistant', content:x.d.text}); return; }
          var e2 = (x.d && x.d.error) || '';
          add('assistant', e2 === 'slow_down' ? 'ትንሽ ያርፉ — በዚህ ሰዓት ብዙ ፎቶ ተልኳል። · Too many photos this hour.'
            : e2 === 'unsupported_type' ? 'ይህ ዓይነት ፋይል አይነበብም። ፎቶ (JPG/PNG) ይላኩ። · Send a photo instead.'
            : 'ይቅርታ፣ ፎቶውን ማንበብ አልተቻለም። እባክዎ በግልጽ ብርሃን ደግመው ይሞክሩ። · Could not read the photo.');
        })
        .catch(function(){ typing.remove(); add('assistant', 'ይቅርታ፣ የግንኙነት ችግር። · Connection problem.'); });
    };
    fr.readAsDataURL(file);
  });

  wrap.querySelector('#biniIn').addEventListener('submit', function(e){
    e.preventDefault();
    send(txt.value);
  });
})();
