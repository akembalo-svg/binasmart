(function () {
  'use strict';
  // BinaSmart assistant loader. It adds one button to this page; the assistant itself opens in a frame
  // served from bina.et, so this page and the assistant cannot read each other. Nothing is loaded from
  // bina.et until the button is pressed.
  var C = __CFG__;
  if (window.__binaGovWidget) return;
  window.__binaGovWidget = true;
  var lang = String(document.documentElement.lang || 'am').slice(0, 2).toLowerCase();
  function pick(o) { return (o && (o[lang] || o.am || o.en)) || ''; }
  function css(el, rules) { for (var k in rules) if (Object.prototype.hasOwnProperty.call(rules, k)) el.style[k] = rules[k]; }
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = pick(C.label);
  btn.setAttribute('aria-haspopup', 'dialog');
  css(btn, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483000', background: C.color, color: '#fff',
    border: '0', borderRadius: '24px', padding: '12px 18px', font: '600 15px/1.2 system-ui, sans-serif', cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(0,0,0,.25)' });
  var box = null;
  function close() { box.style.display = 'none'; btn.style.display = ''; btn.focus(); }
  function open() {
    btn.style.display = 'none';
    if (box) { box.style.display = 'flex'; return; }
    box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', pick(C.title));
    css(box, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483000', display: 'flex', flexDirection: 'column',
      width: 'min(400px, calc(100vw - 32px))', height: 'min(640px, calc(100vh - 32px))', background: '#fff',
      borderRadius: '12px', overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,.3)' });
    var bar = document.createElement('div');
    css(bar, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.color, color: '#fff',
      padding: '6px 10px', font: '600 14px/1.2 system-ui, sans-serif' });
    var t = document.createElement('span');
    t.textContent = pick(C.title);
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', pick(C.close));
    css(x, { border: '0', background: 'transparent', color: '#fff', font: '22px/1 system-ui, sans-serif', cursor: 'pointer' });
    x.addEventListener('click', close);
    bar.appendChild(t); bar.appendChild(x);
    var f = document.createElement('iframe');
    f.src = C.frame + '&l=' + encodeURIComponent(lang);
    f.title = pick(C.title);
    f.setAttribute('referrerpolicy', 'strict-origin');
    f.setAttribute('allow', '');
    css(f, { border: '0', width: '100%', flex: '1 1 auto' });
    box.appendChild(bar); box.appendChild(f);
    document.body.appendChild(box);
  }
  btn.addEventListener('click', open);
  function mount() { document.body.appendChild(btn); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
