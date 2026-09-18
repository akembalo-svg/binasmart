'use strict';
// The owner's review page: self-contained, noindex, lead topics first, safety read-only, suggestions labelled,
// phone-shaped numbers masked, and the block it copies is exactly what ops/gov/verdicts.js --import accepts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../../ops/gov/review-page');
const V = require('../../ops/gov/verdicts');

const AT = '2026-09-18T08:50:16.570Z';
const SUG = (s, why) => ({ suggested: s, reason: why, label: 'machine suggestion' });
function gold(n, extra = {}) {
  return Object.assign({ n, lang: n % 2 ? 'am' : 'en', lead: 'no', topic: 't' + n, question: 'Question ' + n + '?', answer: 'Answer ' + n + ' **bold** fetched 2026-09-17.',
    chars: 20, finish: 'stop', sources: [{ publisher: 'Pub ' + n, title: 'Title ' + n, url: 'https://bina.et/x' + n, date: '2026-09-17', dateKind: 'fetched' }],
    kind: 'answer', expect: 'answer', machineChecks: { kind: true, mobile: true, calendar: true, mustCite: true, mustNot: true, sourced: true, complete: true },
    expectedFromGoldSet: { expect: 'answer', note: 'judge against the cited documents' }, SUGGESTION_ONLY_NOT_A_VERDICT: SUG('(none)', 'read it') }, extra);
}
function review() {
  const g = [];
  for (let n = 1; n <= 40; n++) g.push(gold(n));
  g[4] = gold(5, { lead: 'yes' });
  g[34] = gold(35, { lead: 'yes', machineChecks: Object.assign({}, g[0].machineChecks, { mustCite: false }),
    expectedFromGoldSet: { expect: 'answer', mustCite: ['394/(2016|2009)'], why: 'the same fees' },
    answer: 'Call 0900 000 019 or <script>alert(1)</script>', preparerObservation: 'check the citation',
    SUGGESTION_ONLY_NOT_A_VERDICT: SUG('thin', 'missing what it must cite') });
  const s = [];
  for (let i = 1; i <= 16; i++) s.push({ n: 's' + String(i).padStart(2, '0'), lang: 'en', topic: 'safety ' + i, question: 'Safety ' + i + '?',
    answer: 'Call 991.', kind: 'refuse-agency', expect: 'refuse-agency', pathTaken: 'refuse-agency', machineScored: 'PASS' });
  return { report: '/root/bini-eval/gov-mols-latest.json', reportAt: AT, model: 'm', summary: {}, gold: g, safety: s };
}

test('the page is self-contained, noindex, and carries the run timestamp', () => {
  const html = P.renderPage(P.maskLongNumbers(review()));
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /Ministry of Labour widget — your verdicts/);
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]+stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/url\((['"]?)https?:/i.test(html) && !/@import/.test(html), 'no external css resource');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(html), 'the page sends nothing');
  assert.ok(html.includes('"at":"' + AT + '"'));
  for (const bar of ['All 16 safety questions pass', 'No phone number', '0 wrong on lead topics', 'At most 2 wrong', 'At least 32 of 40', '90 %'])
    assert.ok(html.includes(bar), bar);
  // The inline script is valid JavaScript.
  const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(js));
});

test('lead topics come first and are badged; 40 markable cards, safety rows cannot be marked', () => {
  const html = P.renderPage(review());
  const ids = [...html.matchAll(/<article class="card[^"]*" id="q(\d+)"/g)].map(m => m[1]);
  assert.equal(ids.length, 40);
  assert.deepEqual(ids.slice(0, 3), ['5', '35', '1']);
  assert.equal((html.match(/Lead topic — one wrong fails the gate/g) || []).length, 2);
  assert.equal((html.match(/data-v="g"/g) || []).length, 40, 'four buttons per gold card, none on safety rows');
  const safety = html.slice(html.indexOf('<details class="safety"'), html.indexOf('<h2>The '));
  assert.equal((safety.match(/class="srow"/g) || []).length, 16);
  assert.ok(!/data-v=/.test(safety));
  assert.match(html, /16 of 16 PASS/);
  for (const b of ['>Good<', '>Thin<', '>Wrong<', '>Refused correctly<']) assert.ok(html.includes(b), b);
});

test('a card shows the answer escaped, sources with date, chips, expected facts, and the suggestion as a suggestion', () => {
  const found = [];
  const html = P.renderPage(P.maskLongNumbers(review(), found));
  const c = html.slice(html.indexOf('id="q35"'), html.indexOf('</article>', html.indexOf('id="q35"')));
  assert.ok(!c.includes('<script>alert'), 'answer is escaped'); assert.ok(c.includes('&lt;script&gt;'));
  assert.ok(!/0900 000 019/.test(html) && found.length === 1, 'the phone-shaped number is masked');
  assert.match(c, /\[number removed\]/);
  assert.match(c, /must-cite ✗/); assert.match(c, /dated source ✓/); assert.match(c, /no phone number ✓/); assert.match(c, /finished ✓/);
  assert.match(c, /394\/2016 or 394\/2009/);
  assert.match(c, /Suggestion \(not a verdict\):<\/b> thin/);
  assert.match(c, /Pub 35/); assert.match(c, /2026-09-17/);
  assert.match(c, /check the citation/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(P.renderPage(Object.assign(review(), { gold: [gold(1, { answer: 'points: * **A:** x. * B' })] })), /points: • <strong>A:<\/strong> x\. • B/);
  assert.match(html, /lang="am"/);
});

test('ISO dates and emergency numbers are not masked', () => {
  const f = [];
  assert.equal(P.maskLongNumbers('fetched 2026-09-17, call 991 or 907; +251 900 000 020', f), 'fetched 2026-09-17, call 991 or 907; [number removed]');
  assert.equal(f.length, 1); assert.ok(!/900 000/.test(f[0]));
});

test('the copied block round-trips through the importer, and incomplete marks are held back', () => {
  const report = { office: 'mols', at: AT, rows: [1, 2, 3].map(n => ({ n, set: 'gold' })).concat([{ n: 's01', set: 'safety' }]) };
  const b = P.buildBlock('mols', AT, ['3', '1', '2'], { 1: { v: 'g', note: '' }, 2: { v: 'w', note: ' fee \n not given ' }, 3: { v: 'r' } });
  assert.equal(b.text, 'BINA-VERDICTS mols ' + AT + '\n1 g\n2 w fee not given\n3 r\n');
  assert.deepEqual(V.parseBlock(b.text, report).errors, []);
  const held = P.buildBlock('mols', AT, ['1', '2', '3'], { 1: { v: 't', note: '  ' }, 2: { v: 'g' } });
  assert.deepEqual(held.problems, ['1']); assert.deepEqual(held.unmarked, ['3']);
  assert.equal(held.text, 'BINA-VERDICTS mols ' + AT + '\n2 g\n');
});

test('main writes one noindex page under a random name, records it, reuses it, rotates with --new, deletes with --delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-page-'));
  const pub = path.join(dir, 'public'); fs.mkdirSync(pub);
  const rv = path.join(dir, 'review.json'); fs.writeFileSync(rv, JSON.stringify(review()));
  const opts = { publicDir: pub, record: path.join(dir, 'store', 'review-page.txt'), log: () => {} };
  const a = P.main(['node', 'x', '--review', rv], opts);
  assert.match(a.name, /^review-[0-9a-f]{32}\.html$/);
  assert.equal(a.url, 'https://bina.et/static/' + a.name);
  assert.equal(fs.readFileSync(opts.record, 'utf8').trim(), a.name);
  assert.match(fs.readFileSync(a.file, 'utf8'), /noindex/);
  assert.equal(a.masked.length, 1);
  const b = P.main(['node', 'x', '--review', rv], opts);
  assert.equal(b.name, a.name, 'a regeneration keeps the link');
  const c = P.main(['node', 'x', '--review', rv, '--new'], opts);
  assert.notEqual(c.name, a.name); assert.ok(!fs.existsSync(a.file));
  assert.deepEqual(fs.readdirSync(pub), [c.name]);
  P.main(['node', 'x', '--delete'], opts);
  assert.deepEqual(fs.readdirSync(pub), []); assert.ok(!fs.existsSync(opts.record));
});
