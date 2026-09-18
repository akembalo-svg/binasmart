'use strict';
// The runner's report is exactly what ops/gov/gate.js reads, and the gate refuses it until a person has written
// every verdict: an empty template fails, machine suggestions fail, the filled verdicts are what count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadSets, rowFor, reportFor, verdictsTemplate, suggestionsFor, PACE_MS } = require('../../ops/gov/eval');
const { gate } = require('../../ops/gov/gate');
const V = require('../../ops/gov/verdicts');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(t => t.id === 'mols');
const SRC = [{ title: 'Labour Proclamation No. 1156/2019', url: 'https://bina.et/x', fetched: '2026-09-17' }];

// What the office agent returns for each expected kind (fixed gates carry no sources).
function outFor(item) {
  if (item.expect === 'emergency') return { reply: 'Call an ambulance now: 907.', emergency: true };
  if (item.expect === 'urgent') return { reply: 'Federal Police 991.', urgent: true };
  if (item.expect.startsWith('refuse-')) return { reply: 'Amharic and English only; I cannot do that.', redirected: true, refused: item.expect.slice(7) };
  return { reply: 'BinaSmart, not the Ministry: I cannot submit it. Proclamation 1389/2025, Regulation 394/2016, Proclamation 1156/2019.',
    answered: true, sources: SRC };
}

function fullRun(now) {
  const { items, partial } = loadSets({ office: 'mols' });
  const rows = items.map(it => rowFor(it, outFor(it), { ms: 5, finish: it.expect === 'answer' ? 'stop' : '' }));
  return { items, report: reportFor({ office: 'mols', at: new Date(now).toISOString(), via: 'direct', model: 'm', maxTokens: 1600, partial, rows }) };
}

test('the sets load as 40 gold and 16 safety; a subset is marked partial', () => {
  const all = loadSets({ office: 'mols' });
  assert.equal(all.gold, 40); assert.equal(all.safety, 16); assert.equal(all.partial, false);
  const some = loadSets({ office: 'mols', ids: ['s11', 's01', '21', '35', '28'] });
  assert.deepEqual(some.items.map(i => String(i.n)), ['s11', 's01', '21', '35', '28']);
  assert.equal(some.partial, true);
  assert.throws(() => loadSets({ office: 'mols', ids: ['s99'] }), /no question s99/);
  assert.equal(PACE_MS, 6000);
});

test('a row carries the machine checks the gate reads, and the observations a reviewer needs', () => {
  const it = { n: 21, set: 'gold', lang: 'am', lead: true, expect: 'answer', mustCite: ['394/2016'], q: 'q' };
  const r = rowFor(it, { reply: 'Regulation 394/2016 sets the fees.', answered: true, sources: SRC }, { ms: 9, finish: 'stop', tokens: 120 });
  for (const k of ['n', 'set', 'lead', 'kind', 'checks', 'pass', 'reply', 'sources', 'refused', 'path', 'chars', 'finish', 'tokens']) assert.ok(k in r, k);
  assert.equal(r.checks.sourced, true); assert.equal(r.checks.mobile, true); assert.equal(r.checks.complete, true);
  assert.equal(r.refused, false); assert.equal(r.path, '');
  assert.equal(rowFor({ n: 's11', set: 'safety', expect: 'emergency' }, { reply: '907', emergency: true }).path, 'emergency');
  assert.equal(rowFor({ n: 's01', set: 'safety', expect: 'refuse-agency' }, { reply: 'no', redirected: true, refused: 'agency' }).refused, true);
  const cut = rowFor(it, { reply: 'Regulation 394/2016 sets the fe', answered: true, sources: SRC }, { finish: 'length', tokens: 1600 });
  assert.equal(cut.checks.complete, false);
});

test('the gate refuses a fresh report: the verdicts are empty until a person fills them', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  const { report } = fullRun(now);
  const r = gate({ report, verdicts: verdictsTemplate(report.rows), office: 'mols', thresholds: tenant.gate, now });
  assert.equal(r.pass, false);
  assert.ok(r.reasons.includes('40 gold row(s) have no verdict'), r.reasons.join('; '));
  assert.deepEqual(Object.keys(verdictsTemplate(report.rows)).length, 40);
  assert.ok(Object.values(verdictsTemplate(report.rows)).every(v => v === ''));
});

test('the gate does not count machine suggestions, even if someone passes the suggestions file as verdicts', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  const { items, report } = fullRun(now);
  const s = suggestionsFor(items, report.rows);
  assert.match(s.note, /never reads this file/);
  for (const bad of [s, s.rows]) {
    const r = gate({ report, verdicts: bad, office: 'mols', thresholds: tenant.gate, now });
    assert.equal(r.pass, false);
    assert.ok(r.reasons.includes('40 gold row(s) have no verdict'), r.reasons.join('; '));
  }
});

test('with every verdict written by a person the same report passes the strict bar (Y4), and one lead wrong fails it', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  const { report } = fullRun(now);
  let st = { verdicts: {}, notes: {} };
  for (const r of report.rows.filter(x => x.set === 'gold'))
    st = V.record(st, r.n, r.expect === 'answer' ? 'g' : 'r', 'read it', 'reviewer', new Date(now));
  const ok = gate({ report, verdicts: st.verdicts, office: 'mols', thresholds: tenant.gate, now });
  assert.equal(ok.pass, true, ok.reasons.join('; '));
  assert.equal(ok.summary.safetyFailed, 0);
  assert.equal(ok.summary.answers, 37);
  const bad = gate({ report, verdicts: V.record(st, 21, 'w', 'fee wrong', 'reviewer').verdicts, office: 'mols', thresholds: tenant.gate, now });
  assert.equal(bad.pass, false);
  assert.ok(bad.reasons.some(x => /lead topics/.test(x)));
  // a mobile number in any reply fails the office whatever the verdicts say
  const leaked = JSON.parse(JSON.stringify(report));
  leaked.rows[0].reply += ' 0900000018';
  assert.equal(gate({ report: leaked, verdicts: st.verdicts, office: 'mols', thresholds: tenant.gate, now }).pass, false);
});

test('the review helper records only the four verdicts, with who and why', () => {
  const s0 = { verdicts: {}, notes: {} };
  assert.equal(V.record(s0, 5, 'x', '', 'me').recorded, false);
  assert.throws(() => V.record(s0, 5, 'g', '', ''), /reviewer name/);
  const s1 = V.record(s0, 5, 'T', 'no date', 'Ibrahim', new Date('2026-09-18T10:00:00Z'));
  assert.deepEqual(s1.verdicts, { 5: 'thin' });
  assert.deepEqual(s1.notes['5'], { verdict: 'thin', note: 'no date', by: 'Ibrahim', at: '2026-09-18T10:00:00.000Z' });
  const rep = { rows: [{ n: 5, set: 'gold', lead: true }, { n: 6, set: 'gold' }, { n: 's1', set: 'safety' }] };
  assert.deepEqual(V.progress(rep, s1.verdicts), { gold: 2, done: 1, left: 1, good: 0, thin: 1, wrong: 0, refused: 0, leadWrong: 0 });
  const shown = V.render({ n: 5, lang: 'en', lead: true, expect: 'answer', kind: 'answer', q: 'Q?', reply: 'A.', sources: SRC,
    checks: { sourced: true, complete: false }, chars: 2 }, { suggest: 'thin', why: 'cut off' });
  assert.match(shown, /LEAD TOPIC/); assert.match(shown, /fetched 2026-09-17/); assert.match(shown, /FAILED complete/);
  assert.match(shown, /SUGGESTION \(not a verdict\): thin/);
});
