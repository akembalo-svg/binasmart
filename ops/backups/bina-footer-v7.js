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
      ['🏪 ሱቆች', 'Businesses', '/business'], ['✈️ በረራ', 'Flights', '/flights'], ['🏢 ንብረት', 'Property', '/property'], ['🏨 ሆቴል', 'Hotels', '/hotels'], ['✈️ አየር ማረፊያ', 'Airport', '/airport'],
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
  var css = '.bina-ft{background:#081120;color:rgba(255,255,255,.62);font-family:"Plus Jakarta Sans","Noto Sans Ethiopic",system-ui,sans-serif;padding:26px 14px 20px;margin-top:40px;line-height:1.5;font-size:13px}'
    + '.bina-ft .in{max-width:1000px;margin:0 auto}'
    + '.bina-ft .cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}'
    + '.bina-ft .h{color:#fff;font-size:11px;font-weight:900;letter-spacing:.03em;margin:0 0 6px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.bina-ft .h i{font-style:normal;color:rgba(255,255,255,.45);display:none}'
    + '.bina-ft a{color:rgba(255,255,255,.62);text-decoration:none;display:block;padding:4px 0;font-size:12.5px;line-height:1.35}'
    + '.bina-ft a .en{display:none;color:rgba(255,255,255,.45);font-weight:600}'
    + '.bina-ft a:hover{color:#fff}.bina-ft a[aria-current]{color:#00C896;font-weight:800}'
    + '.bina-ft .brand{display:flex;align-items:center;gap:10px;margin-bottom:14px;font-size:18px;font-weight:800;letter-spacing:-.3px;color:#fff}.bina-ft .brand i{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#00C896,#009688);display:inline-flex;align-items:center;justify-content:center;font-style:normal;flex:none}.bina-ft .brand i svg{width:16px;height:16px;display:block}'
    + '.bina-ft .brand span{color:#00C896}'
    + '.bina-ft .bot{border-top:1px solid rgba(255,255,255,.1);margin-top:18px;padding-top:12px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:11px;color:rgba(255,255,255,.45)}'
    + '.bina-ft .bot .sp{flex:1}'
    + '@media(min-width:560px){.bina-ft{padding:34px 18px 26px;font-size:14px}.bina-ft .cols{gap:22px}.bina-ft .h{font-size:13px}.bina-ft .h i{display:inline}'
    + '.bina-ft a{font-size:14px;padding:3px 0}.bina-ft a .en{display:inline}.bina-ft .bot{font-size:12px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var html = '<div class="in"><div class="brand"><i><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"></path></svg></i>Bina<span>Smart</span></div><div class="cols">'
    + COLS.map(function (c) {
      return '<div><div class="h">' + c[0] + ' <i>· ' + c[1] + '</i></div>' + c[2].map(function (l) {
        var ext = /^https?:/.test(l[2]);
        return '<a href="' + l[2] + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (l[2] === here ? ' aria-current="page"' : '') + '>'
          + l[0] + '<span class="en"> · ' + l[1] + '</span></a>';
      }).join('') + '</div>';
    }).join('')
    + '</div><div class="bot"><span>© ' + new Date().getFullYear() + ' BinaSmart · አዲስ አበባ</span><span class="sp"></span>'
    + '<span>በኢትዮጵያዊ ገንቢ የተሰራ · Built for Ethiopia 🇪🇹</span></div></div>';
  var ft = document.createElement('footer');
  ft.className = 'bina-ft'; ft.innerHTML = html;
  document.body.appendChild(ft);
})();
