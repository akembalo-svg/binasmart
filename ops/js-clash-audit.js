'use strict';
// Find the bug class that killed the homepage's Ask-AI buttons: two top-level declarations sharing
// one name inside a single page. Every classic <script> on a page shares ONE global scope, so a
// later `function askAI(){}` silently replaces an earlier one — no error, no warning, the button
// just does the wrong thing.
//
// It also reports inline on*="name(...)" handlers whose function is declared nowhere on the page.
//
//   node ops/js-clash-audit.js            report only
//   node ops/js-clash-audit.js --verbose  also list every top-level name per page
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const VERBOSE = process.argv.includes('--verbose');
const BS = String.fromCharCode(92);   // a backslash, spelled out so no quoting layer can eat it

// Skip a string starting at the opening quote and return the index just past it. Template literals
// need real nesting: these pages build HTML with `...${cond ? `<div>...</div>` : ''}...`, and a
// scanner that just runs to the next backtick stops inside the hole and misreads the whole rest of
// the file — which is exactly how owner.html defeated the first version of this walker.
function skipString(src, i) {
  const q = src[i]; i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === BS) { i += 2; continue; }
    if (ch === q) return i + 1;
    if (q === '`' && ch === '$' && src[i + 1] === '{') { i = skipHole(src, i + 2); continue; }
    if (q !== '`' && ch === '\n') return i;          // unterminated single-line string
    i++;
  }
  return i;
}
// Skip a `${ ... }` hole, which is ordinary code and may hold more strings and templates.
function skipHole(src, i) {
  let d = 1;
  while (i < src.length && d > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && src.slice(i, i + 2) !== '*/') i++; i += 2; continue; }
    if (ch === '{') d++; else if (ch === '}') d--;
    i++;
  }
  return i;
}

// Walk the source once, tracking what we are inside of, so a "function" written in a string or a
// comment is never mistaken for a declaration and braces inside them never move the depth.
function topLevelDecls(src) {
  const out = [];                       // {name, kind, line}
  let i = 0, depth = 0, paren = 0, line = 1, prevSig = '';
  const n = src.length;
  // A function declaration is top-level whenever no block encloses it. A var/let/const binding must
  // ALSO be outside any parentheses, or `for (let f = 0; ...)` reads as a page-level `f` — and three
  // such loops read as three clashing declarations of the same name.
  const atTop = () => depth === 0;
  const atTopBinding = () => depth === 0 && paren === 0;
  while (i < n) {
    const c = src[i], c2 = src.slice(i, i + 2);
    if (c === '\n') { line++; i++; continue; }
    if (c2 === '//') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c2 === '/*') { i += 2; while (i < n && src.slice(i, i + 2) !== '*/') { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const end = skipString(src, i);
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end; prevSig = 'str'; continue;
    }
    // a regex literal, not division, when the last meaningful character cannot end an expression
    if (c === '/' && /^(|[({[,;:=!&|?+\-*%~^<>]|return|typeof|case|in|of|do|else)$/.test(prevSig)) {
      i++;
      while (i < n && src[i] !== '/') { if (src[i] === BS) i++; else if (src[i] === '\n') break; i++; }
      i++; prevSig = 're'; continue;
    }
    if (c === '(') { paren++; i++; prevSig = '('; continue; }
    if (c === ')') { paren--; i++; prevSig = ')'; continue; }
    if (c === '{') { depth++; i++; prevSig = '{'; continue; }
    if (c === '}') { depth--; i++; prevSig = '}'; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (atTop()) {
        const rest = src.slice(j);
        if (word === 'function') {
          const m = rest.match(/^\s+([A-Za-z_$][\w$]*)\s*\(/);
          if (m) out.push({ name: m[1], kind: 'function', line });
        } else if (word === 'async') {
          const m = rest.match(/^\s+function\s+([A-Za-z_$][\w$]*)\s*\(/);
          // Step past the whole `async function NAME` — otherwise the loop reads `function` next
          // and records the same declaration a second time, inventing a clash with itself.
          if (m) { out.push({ name: m[1], kind: 'async function', line }); i = j + m[0].length; prevSig = m[1]; continue; }
        } else if (word === 'var' || word === 'let' || word === 'const') {
          // only a plain `var NAME =` binding; destructuring is not a name clash we can judge here
          const m = rest.match(/^\s+([A-Za-z_$][\w$]*)\s*=/);
          if (m && atTopBinding()) out.push({ name: m[1], kind: word, line });
        } else if (word === 'class') {
          const m = rest.match(/^\s+([A-Za-z_$][\w$]*)/);
          if (m) out.push({ name: m[1], kind: 'class', line });
        }
      }
      i = j; prevSig = word; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  // If the braces did not balance, this walker lost its place somewhere and "top level" stopped
  // meaning anything. Say so instead of reporting a confident, wrong answer.
  return { decls: out, drift: depth };
}

// Inline scripts only. A module script has its own scope and cannot clash; JSON-LD is not code.
function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?!text\/javascript)/i.test(attrs)) continue;   // ld+json, module, template
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html')).sort();
let clashPages = 0, clashNames = 0, missingTotal = 0;
for (const f of pages) {
  const html = fs.readFileSync(path.join(PUB, f), 'utf8');
  const seen = new Map();                 // name -> [{kind, line}]
  let confused = false;
  for (const s of inlineScripts(html)) {
    const r = topLevelDecls(s.code);
    if (r.drift !== 0) confused = true;
    for (const d of r.decls) {
      const at = s.line + d.line - 1;
      if (!seen.has(d.name)) seen.set(d.name, []);
      seen.get(d.name).push({ kind: d.kind, line: at });
    }
  }
  // Fallback for a page the walker could not follow. These files declare every page-level function
  // at column 0, so a line-anchored match finds the same clashes without tracking scope at all. It
  // is checked against a known bug (the pre-fix homepage) rather than trusted on faith.
  if (confused) {
    seen.clear();
    for (const s of inlineScripts(html))
      for (const m of s.code.matchAll(/^(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
        const at = s.line + s.code.slice(0, m.index).split('\n').length - 1;
        if (!seen.has(m[2])) seen.set(m[2], []);
        seen.get(m[2]).push({ kind: (m[1] ? 'async ' : '') + 'function (column 0)', line: at });
      }
  }
  const clashes = [...seen.entries()].filter(([, v]) => v.length > 1);

  // handlers that call a function nothing declares. Only bare calls count: `foo(` is a global,
  // `el.foo(` is a method on something else and tells us nothing.
  const called = new Set();
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi))
    for (const c of m[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(c[2]);
  const BUILTIN = /^(alert|confirm|prompt|open|print|fetch|parseInt|parseFloat|encodeURIComponent|decodeURIComponent|Number|String|Boolean|Array|Object|JSON|Math|Date|setTimeout|setInterval|require|event|window|document|this|return|if|for|while|typeof|new|history|location|Promise|RegExp|isNaN|function)$/;
  // When the walker lost its place, "declared nowhere" means nothing — stay quiet rather than
  // inventing 24 dead buttons that are actually fine.
  const missing = confused ? [] : [...called].filter(nm => !seen.has(nm) && !BUILTIN.test(nm));
  const externals = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);

  if (clashes.length || missing.length || confused || VERBOSE) {
    console.log('\n' + f);
    if (confused) console.log('  --  braces did not balance here, so this page was checked the simple way instead: duplicate column-0 function declarations only');
    for (const [name, defs] of clashes) {
      clashNames++;
      console.log('  !!  ' + name + ' declared ' + defs.length + 'x — the LAST one wins, the others are dead:');
      defs.forEach((d, k) => console.log('        line ' + d.line + '  ' + d.kind + (k === defs.length - 1 ? '   <-- this is the one that runs' : '')));
    }
    if (missing.length) {
      missingTotal += missing.length;
      console.log('  ?   handler calls nothing declares inline: ' + missing.join(', '));
      console.log('        this page loads: ' + (externals.length ? externals.join(', ') : 'no external script — so these really are undefined'));
    }
    if (VERBOSE && !clashes.length && !missing.length) console.log('  ok — ' + seen.size + ' top-level names');
  }
  if (clashes.length) clashPages++;
}
console.log('\nscanned ' + pages.length + ' pages: ' + clashNames + ' clashing name(s) on ' + clashPages
  + ' page(s), ' + missingTotal + ' handler(s) with no local declaration');
