'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 2026-09-13. POST /api/b/:slug/maintenance is the public form behind a building's QR poster and needs
// no login. A description written as <img src=x onerror=...> was stored as-is, and the owner dashboard
// wrote it straight into innerHTML: opening the Maintenance tab ran the script, which read the owner key
// out of localStorage. Proven in a browser on a demo building before the fix, and gone after it.
//
// owner.html had no escape function at all. It has two now, and these tests hold every free-text value
// to them — a stranger's maintenance request or lead, a shop owner's offer title, the owner's own entries.
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'owner.html'), 'utf8');

function leaves(text) {
  const out = [], re = /\$\{/g;
  let m;
  while ((m = re.exec(text))) {
    const j = m.index;
    let depth = 0, k = j + 1;
    for (; k < text.length; k++) {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') { depth--; if (depth === 0) break; }
    }
    const e = text.slice(j + 2, k);
    if (!e.includes('`') && !e.includes('${')) out.push({ at: j, e, line: text.slice(0, j).split('\n').length });
  }
  return out;
}
function context(text, at) {
  const before = text.slice(text.lastIndexOf('\n', at) + 1, at);
  const open = (re) => { const ms = [...before.matchAll(re)]; return ms.length && !before.slice(ms[ms.length - 1].index + ms[ms.length - 1][0].length).includes('"'); };
  if (open(/\bon[a-z]+="/g)) return 'js-attr';
  if (open(/\b(href|src)="/g)) return 'url-attr';
  if (open(/\b[a-z-]+="/g)) return 'attr';
  return 'text';
}

// Fields a person typed. Reading one of these in a template without esc()/jsq() is the bug.
const FREE = /\b(m\.(description|name|phone|type)|l\.(name|phone|unit)|i\.shop|u\.tenant|o\.(title|icon)|x\.(detail|action|at)|s\.(name|role|phone)|e\.(vendor|description|category|date|receiptNo)|u\.number|i\.unit|i\.(paymentCode|method)|a\.(month|bank|account)|d\.tinNumber|v\.filingDue)\b/;
// Expressions that mention a free-text field but only to TEST it, look it up, or turn it into a date —
// their output is fixed markup, a colour or a formatted date, never the text itself.
const SAFE_USE = [
  /^x\.action\.includes\(/,                 // picks a fixed badge class
  /^new Date\(a\.month/,                    // becomes a localised month name
  /^MAINT_ICON\[m\.type\] \|\| /,           // a lookup into a fixed emoji table
  /^u\.tenant \? payColor\[/,               // tenant used only as a truthiness test
  /^encodeURIComponent\(/,
  /\.length$/,                              // a count: UNITS.filter(u => !u.tenant).length is a number
];

test('every free-text value the owner dashboard renders goes through esc() or jsq()', () => {
  const bad = [];
  for (const l of leaves(HTML)) {
    if (!FREE.test(l.e) && l.e !== 'k') continue;
    if (/^(esc|jsq)\(/.test(l.e)) continue;
    if (SAFE_USE.some(re => re.test(l.e))) continue;
    bad.push('owner.html:' + l.line + '  [' + context(HTML, l.at) + ']  ${' + l.e.slice(0, 80) + '}');
  }
  assert.deepEqual(bad, [], 'free text reaching the page unescaped:\n  ' + bad.join('\n  '));
});

// The browser decodes &#39; back into ' BEFORE the JavaScript in an onclick runs, so HTML-escaping alone
// does not stop a quote closing the string. Free text in a handler has to be jsq(), not esc().
test('free text inside an onclick handler uses jsq(), not esc() alone', () => {
  const bad = leaves(HTML).filter(l => context(HTML, l.at) === 'js-attr' && FREE.test(l.e) && !/^jsq\(/.test(l.e))
    .map(l => 'owner.html:' + l.line + '  ${' + l.e + '}');
  assert.deepEqual(bad, [], bad.join('\n'));
});

// Run the functions that actually ship, lifted out of the page, against hostile input.
const helper = name => {
  const m = HTML.match(new RegExp('^function ' + name + '\\(v\\) \\{.*\\}$', 'm'));
  assert.ok(m, name + '() not found in owner.html');
  return m[0];
};
// Extracted inside each test, not at load: on a page with no esc() the test should fail by name, not take
// the whole file down with it.
const shipped = () => new Function(helper('esc') + '\n' + helper('jsq') + '\nreturn { esc, jsq };')();

test('esc() leaves nothing a browser would parse as markup', () => {
  const { esc } = shipped();
  for (const p of ['<img src=x onerror=alert(1)>', '"><script>x</script>', "' onmouseover='x", '&lt;already&gt;']) {
    const out = esc(p);
    assert.equal(/[<>"']/.test(out), false, JSON.stringify(p) + ' -> ' + out);
  }
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

// What jsq() produces goes inside onclick="fn('...')". Decode it the way the HTML parser will, then read
// it as a JavaScript string literal: it must come back as exactly the original text, and nothing else.
test('jsq() survives the attribute and the JavaScript string intact', () => {
  const { jsq } = shipped();
  const decode = s => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const v of ["O'Brien", 'back\\slash\\', 'ends with \\', "');alert(1);('", 'line\nbreak', 'Unit "G-3" <b>', '']) {
    const jsLiteral = "'" + decode(jsq(v)) + "'";
    assert.equal(new Function('return ' + jsLiteral)(), v, 'round trip failed for ' + JSON.stringify(v));
  }
});

// The server half: the two public forms feeding the dashboard had no limit at all.
test('both public forms that feed the dashboard are rate limited and refuse a non-phone', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const route of ["fastify.post('/api/b/:slug/maintenance'", "fastify.post('/api/units/:unitId/leads'"]) {
    const at = src.indexOf(route);
    assert.ok(at > 0, route + ' not found');
    const handler = src.slice(at, at + 1400);
    const createAt = handler.indexOf('.create(');
    for (const guard of ['formIpRL(', 'phoneOk(', 'formPhoneRL(']) {
      const g = handler.indexOf(guard);
      assert.ok(g > 0, route + ' has no ' + guard);
      assert.ok(g < createAt, route + ': ' + guard + ' must run before anything is stored');
    }
  }
});
