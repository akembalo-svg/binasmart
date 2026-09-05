/* One footer for the whole of bina.et. Any page that adds
     <script src="/static/bina-footer.js" defer></script>
   gets it, injected at the end of <body>.
   Three columns side by side on every screen, including a phone: on a narrow screen only the short
   Amharic label shows, so the footer stays a block instead of one long stack. */
(function () {
  'use strict';
  if (window.__binaFooter) return; window.__binaFooter = 1;
  var here = location.pathname.replace(/\/+$/, '') || '/';
  // [icon + short Amharic, English (hidden on a phone), href]
  var COLS = [
    ['አገልግሎቶች', 'Services', [
      ['🚕 ጉዞ', 'Ride', '/ride'], ['🎬 ሲኒማ', 'Cinema', '/cinema'], ['▶️ ፊልም', 'Watch', '/watch'],
      ['🏪 ሱቆች', 'Businesses', '/business'], ['✈️ በረራ', 'Flights', '/flights'], ['🏢 ንብረት', 'Property', '/property'], ['🏨 ሆቴል', 'Hotels', '/hotel/bina-grand-hotel'],
      ['📋 ጨረታ', 'Tenders', '/tenders'], ['📰 ዜና', 'News', '/news'], ['📚 መመሪያ', 'Guides', '/guides'],
    ]],
    ['ይቀላቀሉን', 'Join us', [
      ['🏪 ሱቅ አለዎት?', 'For business', '/for-business'], ['🎟️ ሲኒማ ቤት?', 'For cinemas', '/for-cinemas'],
      ['🎞️ ፊልም ሰሪ?', 'For filmmakers', '/for-filmmakers'], ['🚗 ሹፌር ይሁኑ', 'Drive', '/drive-with-us'], ['🤖 AI', 'AI', '/ai'],
    ]],
    ['ስለ እኛ', 'About', [
      ['ስለ ቢና', 'About us', '/why-binasmart'], ['🔒 ግላዊነት', 'Privacy', '/privacy'], ['📄 ውል', 'Terms', '/terms'],
      ['💬 እገዛ', 'Support', '/support'], ['✈️ ቴሌግራም', '@bina_smart_bot', 'https://t.me/bina_smart_bot'], ['📢 ቻናል', '@binasmart', 'https://t.me/binasmart'],
      ['💻 ኮዳችን', 'GitHub', 'https://github.com/akembalo-svg/binasmart'],
    ]],
  ];
  var css = '.bina-ft{background:#0b2a26;color:#cfe7e1;font-family:"Noto Sans Ethiopic","Plus Jakarta Sans",system-ui,sans-serif;padding:26px 14px 20px;margin-top:40px;line-height:1.5;font-size:13px}'
    + '.bina-ft .in{max-width:1000px;margin:0 auto}'
    + '.bina-ft .cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}'
    + '.bina-ft h4{color:#fff;font-size:11px;font-weight:900;letter-spacing:.03em;margin:0 0 6px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.bina-ft h4 i{font-style:normal;color:#5c8f85;display:none}'
    + '.bina-ft a{color:#cfe7e1;text-decoration:none;display:block;padding:4px 0;font-size:12.5px;line-height:1.35}'
    + '.bina-ft a .en{display:none;color:#8fb8b0;font-weight:600}'
    + '.bina-ft a:hover{color:#7ee2cf}.bina-ft a[aria-current]{color:#7ee2cf;font-weight:800}'
    + '.bina-ft .brand{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:17px;font-weight:900;color:#fff}'
    + '.bina-ft .brand span{color:#7ee2cf}'
    + '.bina-ft .bot{border-top:1px solid #1c4139;margin-top:18px;padding-top:12px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:11px;color:#8fb8b0}'
    + '.bina-ft .bot .sp{flex:1}'
    + '@media(min-width:560px){.bina-ft{padding:34px 18px 26px;font-size:14px}.bina-ft .cols{gap:22px}.bina-ft h4{font-size:13px}.bina-ft h4 i{display:inline}'
    + '.bina-ft a{font-size:14px;padding:3px 0}.bina-ft a .en{display:inline}.bina-ft .bot{font-size:12px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var html = '<div class="in"><div class="brand">🇪🇹 Bina<span>Smart</span></div><div class="cols">'
    + COLS.map(function (c) {
      return '<div><h4>' + c[0] + ' <i>· ' + c[1] + '</i></h4>' + c[2].map(function (l) {
        var ext = /^https?:/.test(l[2]);
        return '<a href="' + l[2] + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (l[2] === here ? ' aria-current="page"' : '') + '>'
          + l[0] + '<span class="en"> · ' + l[1] + '</span></a>';
      }).join('') + '</div>';
    }).join('')
    + '</div><div class="bot"><span>© ' + new Date().getFullYear() + ' BinaSmart · አዲስ አበባ</span><span class="sp"></span>'
    + '<span>በኢትዮጵያዊ ገንቢ የተሰራ · Built in Ethiopia</span></div></div>';
  var ft = document.createElement('footer');
  ft.className = 'bina-ft'; ft.innerHTML = html;
  document.body.appendChild(ft);
})();
