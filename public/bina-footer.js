/* One footer for the whole of bina.et. Any page that adds
     <script src="/static/bina-footer.js" defer></script>
   gets it, injected at the end of <body>. Plain CSS in a <style> it writes once, so it works on the
   old pages (property, guides, news) and the new ones (ride, cinema, watch, business) alike. */
(function () {
  'use strict';
  if (window.__binaFooter) return; window.__binaFooter = 1;
  var here = location.pathname.replace(/\/+$/, '') || '/';
  var COLS = [
    ['አገልግሎቶች · Services', [
      ['🚕 ጉዞ · Ride', '/ride'], ['🎬 ሲኒማ · Cinema', '/cinema'], ['▶️ ፊልም · Watch', '/watch'],
      ['🏪 ሱቆች · Businesses', '/business'], ['🏢 ንብረት · Property', '/property'], ['🏨 ሆቴሎች · Hotels', '/hotel/bina-grand-hotel'],
      ['📋 ጨረታዎች · Tenders', '/tenders'], ['📰 ዜና · News', '/news'], ['📚 መመሪያዎች · Guides', '/guides'],
    ]],
    ['ይቀላቀሉን · Join us', [
      ['🏪 ሱቅ/ቢሮ አለዎት?', '/for-business'], ['🎟️ ሲኒማ ቤት ነዎት?', '/for-cinemas'], ['🎞️ ፊልም ሰሪ ነዎት?', '/for-filmmakers'],
      ['🚗 ሹፌር ይሁኑ · Drive', '/drive-with-us'], ['🤖 AI ላይ ያግኙን · AI', '/ai'],
    ]],
    ['ስለ እኛ · About', [
      ['ስለ ቢና · About BinaSmart', '/why-binasmart'], ['🔒 ግላዊነት · Privacy', '/privacy'], ['📄 ውል · Terms', '/terms'],
      ['💬 እገዛ · Support', '/support'], ['✈️ ቴሌግራም · @bina_smart_bot', 'https://t.me/bina_smart_bot'],
      ['💻 ኮዳችን ክፍት ነው · GitHub', 'https://github.com/akembalo-svg/binasmart'],
    ]],
  ];
  var css = '.bina-ft{background:#0b2a26;color:#cfe7e1;font-family:"Noto Sans Ethiopic","Plus Jakarta Sans",system-ui,sans-serif;padding:34px 18px 26px;margin-top:40px;line-height:1.6;font-size:14px}'
    + '.bina-ft .in{max-width:1000px;margin:0 auto}'
    + '.bina-ft .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:22px}'
    + '.bina-ft h4{color:#fff;font-size:13px;font-weight:900;letter-spacing:.04em;margin:0 0 8px;text-transform:uppercase}'
    + '.bina-ft a{color:#cfe7e1;text-decoration:none;display:block;padding:3px 0}'
    + '.bina-ft a:hover{color:#7ee2cf}.bina-ft a[aria-current]{color:#7ee2cf;font-weight:800}'
    + '.bina-ft .brand{display:flex;align-items:center;gap:10px;margin-bottom:16px;font-size:18px;font-weight:900;color:#fff}'
    + '.bina-ft .brand span{color:#7ee2cf}'
    + '.bina-ft .bot{border-top:1px solid #1c4139;margin-top:22px;padding-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px;color:#8fb8b0}'
    + '.bina-ft .bot .sp{flex:1}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var html = '<div class="in"><div class="brand">🇪🇹 Bina<span>Smart</span></div><div class="cols">'
    + COLS.map(function (c) {
      return '<div><h4>' + c[0] + '</h4>' + c[1].map(function (l) {
        var ext = /^https?:/.test(l[1]);
        return '<a href="' + l[1] + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (l[1] === here ? ' aria-current="page"' : '') + '>' + l[0] + '</a>';
      }).join('') + '</div>';
    }).join('')
    + '</div><div class="bot"><span>© ' + new Date().getFullYear() + ' BinaSmart · አዲስ አበባ · Addis Ababa</span><span class="sp"></span>'
    + '<span>በኢትዮጵያዊ ገንቢ የተሰራ · Built in Ethiopia</span></div></div>';
  var ft = document.createElement('footer');
  ft.className = 'bina-ft'; ft.innerHTML = html;
  document.body.appendChild(ft);
})();
