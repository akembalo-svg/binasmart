/* One footer for the whole of bina.et. Any page that adds
     <script src="/static/bina-footer.js?v=9" defer></script>
   gets it, injected at the end of <body>.
   v9 (7 Sep 2026): new bi mark + Telegram Mini App init. v8: the BinaSmart home design footer — dark navy, teal play logo, tagline, nav row,
   social icons, three link columns (Amharic first, English on wide screens), bottom bar. */
(function () {
  'use strict';
  if (window.__binaFooter) return; window.__binaFooter = 1;
  var here = location.pathname.replace(/\/+$/, '') || '/';
  var PLAY = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><g transform="scale(0.024)"><path transform="translate(255,700) scale(0.62,-0.62)" d="M699 -82Q668 -82 645.5 -55.0Q623 -28 615 0H437V465Q437 551 408.0 597.5Q379 644 311 644Q236 644 208.5 595.0Q181 546 181 464V0H90V472Q90 586 144.0 655.0Q198 724 311 724Q426 724 477.0 658.5Q528 593 528 470V73H615Q623 101 645.5 127.5Q668 154 699 154H723L697 36L723 -82Z" fill="#fff" stroke="#fff" stroke-width="56" stroke-linejoin="round"/><path d="M800 150l24 62 62 24-62 24-24 62-24-62-62-24 62-24z" fill="#fff"/></g></svg>';
  // [Amharic, English, href]
  var COLS = [
    ['አገልግሎቶች', 'Services', [
      ['ራይድ', 'Ride', '/ride'], ['አየር ማረፊያ', 'Airport transfer', '/airport'], ['ሆቴሎች', 'Hotels', '/hotels'],
      ['ቲቪ · ፊልም', 'Watch', '/watch'], ['ሲኒማ', 'Cinema', '/cinema'], ['ሬስቶራንት', 'Restaurants', '/restaurant/bina-restaurant'],
      ['ንብረት', 'Property', '/property'], ['መኪና', 'Cars', '/cars'], ['መድን', 'Insurance', '/insurance'],
      ['በረራ', 'Flights', '/flights'], ['አውቶቡስ', 'Bus tickets', '/travel'], ['ሆስፒታሎች', 'Hospitals', '/hospital/bina-general-hospital'],
      ['ዜና', 'News', '/news'], ['ጨረታ', 'Tenders', '/tenders'], ['መመሪያዎች', 'Guides', '/guides'], ['ሱቆች', 'Shops', '/business'],
    ]],
    ['ይቀላቀሉን', 'Join us', [
      ['ሱቅ አለዎት?', 'For business', '/for-business'], ['ሆቴል አለዎት?', 'For hotels', '/for-business'], ['ሲኒማ ቤት?', 'For cinemas', '/for-cinemas'],
      ['ፊልም ሰሪ?', 'For filmmakers', '/for-filmmakers'], ['መድን ድርጅት?', 'For insurers', '/for-insurers'], ['ሹፌር ይሁኑ', 'Drive with us', '/drive-with-us'],
      ['ዲያስፖራ', 'Diaspora owners', '/diaspora'], ['የህንፃ ባለቤት', 'Owner login', '/owner'],
    ]],
    ['ስለ እኛ', 'About', [
      ['ስለ ቢና', 'About us', '/why-binasmart'], ['ቢና AI', 'Bina AI · MCP', '/ai'], ['እገዛ', 'Support', '/support'],
      ['ግላዊነት', 'Privacy', '/privacy'], ['ውል', 'Terms', '/terms'], ['ኮዳችን', 'GitHub', 'https://github.com/akembalo-svg/binasmart'],
    ]],
  ];
  var SOC = [
    ['Telegram', 'https://t.me/binasmart', '<path d="M21 4L3 11l6 2 2 6 3-4 5 3z"/>'],
    ['Telegram bot', 'https://t.me/bina_smart_bot', '<rect x="5" y="7" width="14" height="11" rx="4"/><path d="M12 4v3M9 3.5h6"/><circle cx="9.5" cy="12.5" r="1" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1" fill="currentColor"/><path d="M9.5 15.5c1.5 1 3.5 1 5 0"/>'],
    ['Facebook', 'https://www.facebook.com/binasmartet', '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>'],
    ['LinkedIn', 'https://www.linkedin.com/company/144771046', '<rect x="3" y="9" width="4" height="12"/><circle cx="5" cy="5" r="2"/><path d="M11 21v-7a3 3 0 0 1 6 0v7M11 9v12M21 21v-7a5 5 0 0 0-5-5"/>'],
    ['WhatsApp', 'https://wa.me/251911244344', '<path d="M4 20l1.3-3.8A8 8 0 1 1 8.2 19z"/><path d="M9 9.5c.3 2.5 2.5 4.7 5 5l1.2-1.2-1.8-.9-.9.6c-.8-.4-1.5-1.1-1.9-1.9l.6-.9-.9-1.8z"/>'],
  ];
  var css = '.bina-ft{position:relative;overflow:hidden;background:#081120;color:rgba(255,255,255,.62);font-family:"Plus Jakarta Sans","Noto Sans Ethiopic",system-ui,sans-serif;padding:34px 16px 22px;margin-top:48px;line-height:1.5;font-size:13px;-webkit-font-smoothing:antialiased}'
    + '.bina-ft::before{content:"";position:absolute;right:-160px;top:-220px;width:560px;height:560px;border-radius:50%;background:radial-gradient(circle,rgba(0,153,255,.22) 0%,rgba(0,153,255,0) 65%);pointer-events:none}'
    + '.bina-ft .in{max-width:1320px;margin:0 auto;position:relative}'
    + '.bina-ft .row{display:flex;flex-wrap:wrap;align-items:center;gap:14px 22px}'
    + '.bina-ft .brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none}'
    + '.bina-ft .brand i{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#00C896,#009688);display:inline-flex;align-items:center;justify-content:center;flex:none;box-shadow:0 12px 26px -10px rgba(0,200,150,.9)}'
    + '.bina-ft .brand i svg{width:18px;height:18px;display:block}'
    + '.bina-ft .brand b{display:block;font-size:18px;font-weight:800;letter-spacing:-.4px;line-height:1}'
    + '.bina-ft .brand small{display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,.6);margin-top:4px}'
    + '.bina-ft nav.main{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13.5px}'
    + '.bina-ft nav.main a{color:rgba(255,255,255,.7);font-weight:600;padding:4px 0}'
    + '.bina-ft .soc{display:flex;gap:8px;margin-left:auto}'
    + '.bina-ft .soc a{width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);display:inline-flex;align-items:center;justify-content:center;color:#fff;padding:0}'
    + '.bina-ft .soc a svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
    + '.bina-ft .soc a:hover{background:rgba(0,200,150,.18);color:#00C896}'
    + '.bina-ft .cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:26px;padding-top:22px;border-top:1px solid rgba(255,255,255,.1)}'
    + '.bina-ft .h{color:rgba(255,255,255,.45);font-size:11px;font-weight:800;letter-spacing:.1em;margin:0 0 8px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.bina-ft .h i{font-style:normal;display:none}'
    + '.bina-ft a{color:rgba(255,255,255,.62);text-decoration:none}'
    + '.bina-ft .cols a{display:block;padding:3px 0;font-size:12.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.bina-ft .cols a .en{display:none;color:rgba(255,255,255,.4);font-weight:500}'
    + '.bina-ft .cols a:hover{color:#fff}.bina-ft .cols a[aria-current]{color:#00C896;font-weight:800}'
    + '.bina-ft .bot{border-top:1px solid rgba(255,255,255,.1);margin-top:22px;padding-top:14px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:11.5px;color:rgba(255,255,255,.45)}'
    + '.bina-ft .bot .sp{flex:1}'
    + '.bina-ft .lang{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#fff;font-weight:800;font-size:12px}'
    + '@media(min-width:700px){.bina-ft{padding:48px 40px 30px;font-size:14px}.bina-ft .cols{gap:24px;margin-top:34px;padding-top:28px}.bina-ft .h{font-size:12px}.bina-ft .h i{display:inline}'
    + '.bina-ft .cols a{font-size:13.5px;padding:3px 0}.bina-ft .cols a .en{display:inline}.bina-ft .bot{font-size:12.5px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var NAV = [['መነሻ', 'Home', '/'], ['አገልግሎቶች', 'Services', '/#services'], ['ስለ እኛ', 'About', '/why-binasmart'], ['እገዛ', 'Help', '/support'], ['ለንግድ', 'For business', '/for-business'], ['ሹፌር ይሁኑ', 'Drive with us', '/drive-with-us']];
  var html = '<div class="in"><div class="row">'
    + '<a class="brand" href="/"><i>' + PLAY + '</i><span><b>BinaSmart</b><small>Smart. Together. · አንድ አፕ። ሁሉንም በኢትዮጵያ።</small></span></a>'
    + '<nav class="main">' + NAV.map(function (l) { return '<a href="' + l[2] + '">' + l[0] + ' · ' + l[1] + '</a>'; }).join('') + '</nav>'
    + '<div class="soc">' + SOC.map(function (s) { return '<a href="' + s[1] + '" target="_blank" rel="noopener" aria-label="' + s[0] + '" title="' + s[0] + '"><svg viewBox="0 0 24 24">' + s[2] + '</svg></a>'; }).join('') + '</div>'
    + '</div><div class="cols">'
    + COLS.map(function (c) {
      return '<div><div class="h">' + c[0] + ' <i>· ' + c[1] + '</i></div>' + c[2].map(function (l) {
        var ext = /^https?:/.test(l[2]);
        return '<a href="' + l[2] + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + (l[2] === here ? ' aria-current="page"' : '') + '>'
          + l[0] + '<span class="en"> · ' + l[1] + '</span></a>';
      }).join('') + '</div>';
    }).join('')
    + '</div><div class="bot"><span>© ' + new Date().getFullYear() + ' BinaSmart · አዲስ አበባ · bina.et</span><span class="sp"></span>'
    + '<span>Built for Ethiopia 🇪🇹 · fast on 3G</span><span class="lang">አማርኛ · English</span></div></div>';
  // Inside the Telegram Mini App every page must call ready()+expand(), or Telegram shows it as a half-height sheet.
  // Telegram marks the first URL with #tgWebApp...; later in-app navigation loses the hash, so remember it per tab.
  (function () {
    var tg = /tgWebApp/.test(location.hash);
    try { if (tg) sessionStorage.setItem('bina_tg', '1'); else tg = sessionStorage.getItem('bina_tg') === '1'; } catch (e) {}
    if (!tg) return;
    document.documentElement.classList.add('in-telegram');
    function init() { var W = window.Telegram && window.Telegram.WebApp; if (!W) return;
      try { W.ready(); W.expand(); if (W.setHeaderColor) W.setHeaderColor('#F8FAFC'); if (W.setBackgroundColor) W.setBackgroundColor('#F8FAFC'); } catch (e) {} }
    if (window.Telegram && window.Telegram.WebApp) return init();
    var sc = document.createElement('script'); sc.src = 'https://telegram.org/js/telegram-web-app.js?58'; sc.onload = init; document.head.appendChild(sc);
  })();
  var ft = document.createElement('footer');
  ft.className = 'bina-ft'; ft.innerHTML = html;
  document.body.appendChild(ft);
  // pages with a fixed bottom bar (Watch tabs, Ride sheet): keep the bottom line above it
  var bar = document.querySelector('nav.tabs, .tabbar, .cartbar');
  if (bar && getComputedStyle(bar).position === 'fixed') ft.style.paddingBottom = (bar.offsetHeight + 24) + 'px';
})();
