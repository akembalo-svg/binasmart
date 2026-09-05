'use strict';
// Find buttons that cannot do anything. For every <button>, <input type=submit|button> and
// role="button" on every page, work out what would happen if a person pressed it:
//
//   onclick="foo()"      -> foo must exist somewhere this page loads
//   id="x"               -> the id must be mentioned in script, or nothing is listening
//   class / data-*       -> the selector must be mentioned in script (delegated handler)
//   inside a <form>      -> the form submits it
//   type="submit"        -> same
//
// A button matching none of those has no way to be wired up, and is reported.
//
// Deliberately permissive about what counts as "defined": the goal is a short list of buttons that
// are certainly dead, not a long list of maybes. Anything reported here should then be pressed in a
// real browser before being believed.
//
//   node ops/button-audit.js            report dead buttons
//   node ops/button-audit.js --all      also print the per-page tally
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const ALL = process.argv.includes('--all');

const readIf = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };

// Every script a page can see: its own inline scripts plus the local files it loads. The external
// files matter twice over — most buttons on the app pages (menu, shop, cinema, watch) do not exist
// in the HTML at all, they are built inside those files and injected, so a scan of the .html alone
// sees a page with no buttons on it.
function scriptsFor(html) {
  const parts = [{ file: '(inline)', code: '' }];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type\s*=\s*["'](?!text\/javascript)/i.test(m[1] || '')) continue;   // ld+json is not code
    if (!/\bsrc\s*=/i.test(m[1] || '')) { parts[0].code += '\n' + m[2]; continue; }
    const src = (m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (/^https?:/i.test(src)) continue;                                      // a CDN library
    const rel = src.replace(/^\/static\//, '').replace(/^\//, '').split('?')[0];
    const code = readIf(path.join(PUB, rel));
    if (code) parts.push({ file: rel, code });
  }
  return parts;
}

// Names a page-level handler could resolve to. Permissive on purpose — see the note above.
function definedNames(js) {
  const s = new Set();
  for (const m of js.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) s.add(m[1]);
  for (const m of js.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/g)) s.add(m[1]);
  for (const m of js.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) s.add(m[1]);
  return s;
}

const BUILTIN = new Set(['alert', 'confirm', 'prompt', 'open', 'print', 'fetch', 'parseInt', 'parseFloat',
  'encodeURIComponent', 'decodeURIComponent', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON',
  'Math', 'Date', 'setTimeout', 'setInterval', 'Promise', 'RegExp', 'isNaN', 'history',
  'location', 'event', 'window', 'document', 'navigator', 'sendPrompt',
  // keywords: `onclick="if (x) go()"` is a statement, not a call to something named `if`
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'function', 'do', 'else']);

const attr = (tag, name) => {
  const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i'))
    || tag.match(new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'", 'i'));
  return m ? m[1] : null;
};

const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html')).sort();
let totalBtns = 0, totalDead = 0, pagesWithDead = 0;

for (const f of pages) {
  const html = fs.readFileSync(path.join(PUB, f), 'utf8');
  const parts = scriptsFor(html);
  const js = parts.map(p => p.code).join('\n');
  const defined = definedNames(js);

  // Buttons in the markup, and buttons built inside any script this page loads, both reach the
  // user — so collect from all of them.
  const controls = [];
  const collect = (text, where) => {
    for (const m of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi))
      controls.push({ tag: m[1] || '', label: m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), idx: m.index, kind: 'button', where, text });
    for (const m of text.matchAll(/<input\b([^>]*type\s*=\s*["'](?:submit|button)["'][^>]*)>/gi))
      controls.push({ tag: m[1] || '', label: attr(m[1] || '', 'value') || '(input)', idx: m.index, kind: 'input', where, text });
    // Anything else carrying an on* attribute is a control too — a clickable <div>, <span>, <a> or
    // <select onchange>. It already has a handler, so only the handler's existence is in question.
    for (const m of text.matchAll(/<(?!button\b|input\b)([a-z]+)\b([^>]*\bon[a-z]+\s*=\s*"[^"]*"[^>]*)>/gi))
      controls.push({ tag: m[2] || '', label: '<' + m[1] + '>', idx: m.index, kind: 'other', where, text });
  };
  collect(html, f);
  for (const p of parts) if (p.file !== '(inline)') collect(p.code, p.file);

  const dead = [];
  for (const c of controls) {
    totalBtns++;
    const line = c.text.slice(0, c.idx).split('\n').length;
    // A button assembled by string concatenation ('<button class="' + k + '" data-id="' + i + '">')
    // has no readable attributes here — its class and data-* are half expression. Its onclick, if
    // any, is still worth checking, but "no handler" cannot be concluded about it.
    const spliced = /["']\s*\+|\+\s*["']/.test(c.tag);
    const onAttrs = [...c.tag.matchAll(/\bon([a-z]+)\s*=\s*"([^"]*)"/gi)];

    if (onAttrs.length) {
      // Does every function it calls actually exist?
      const unresolved = [];
      for (const [, , raw] of onAttrs) {
        // Blank out quoted arguments first. A shop called "Fikremariam Fantahun (Vodacom)" passed to
        // goToShop() otherwise reads as a call to a function named Fantahun.
        const code = raw.replace(/'[^']*'/g, "''").replace(/&quot;[^&]*&quot;/g, '""');
        for (const call of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g))
          if (!defined.has(call[2]) && !BUILTIN.has(call[2])) unresolved.push(call[2]);
      }
      if (unresolved.length) dead.push({ line, where: c.where, label: c.label, why: 'calls ' + [...new Set(unresolved)].join(', ') + ' — not defined on this page' });
      continue;                                     // has a handler; nothing more to prove
    }
    if (spliced || c.kind === 'other') continue;    // unreadable attributes, or a handler-only control

    const type = (attr(c.tag, 'type') || '').toLowerCase();
    if (type === 'submit' || c.kind === 'input') continue;                    // the form handles it

    const id = attr(c.tag, 'id');
    if (id && js.includes(id)) continue;                                      // something listens for it

    const cls = (attr(c.tag, 'class') || '').split(/\s+/).filter(Boolean);
    if (cls.some(k => js.includes(k))) continue;                              // delegated by class

    if (/\bdata-[a-z-]+\s*=/i.test(c.tag)) {
      const keys = [...c.tag.matchAll(/\b(data-[a-z-]+)\s*=/gi)].map(x => x[1]);
      if (keys.some(k => js.includes(k) || js.includes(k.replace(/^data-/, '').replace(/-(\w)/g, (_, ch) => ch.toUpperCase())))) continue;
    }

    // Inside a <form>? Then pressing it submits.
    const before = c.text.slice(0, c.idx);
    if (before.lastIndexOf('<form') > before.lastIndexOf('</form>')) continue;

    dead.push({ line, where: c.where, label: c.label || '(no label)', why: 'no handler, no id or class any script mentions, not in a form' });
  }

  if (dead.length) {
    pagesWithDead++; totalDead += dead.length;
    console.log('\n' + f);
    dead.forEach(d => console.log('  ' + d.where + ':' + String(d.line).padEnd(5) + ' "' + d.label.slice(0, 40) + '"  -- ' + d.why));
  } else if (ALL) {
    console.log(f.padEnd(30) + controls.length + ' controls, all wired');
  }
}
console.log('\nchecked ' + totalBtns + ' controls on ' + pages.length + ' pages: '
  + totalDead + ' with no way to work, on ' + pagesWithDead + ' page(s)');
