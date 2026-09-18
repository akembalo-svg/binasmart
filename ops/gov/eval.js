'use strict';
// Runs an office's gold and safety sets through the office agent, 6 s apart, and writes
//   /root/bini-eval/gov-<office>-<stamp>.json            the report ops/gov/gate.js reads (full runs are also
//                                                         copied to gov-<office>-latest.json)
//   ...-verdicts.json                                     { "<n>": "" } for every gold row: EMPTY until a person
//                                                         fills it with ops/gov/verdicts.js; the gate refuses it empty
//   ...-suggested.json                                    machine suggestions for that person; the gate never reads it
//
//   node --env-file=.env ops/gov/eval.js --office mols [--via direct|route] [--only safety|gold] [--ids s11,s01,21] [--dry-run]
//
// --via direct (default): the office agent (gov/agent.js) through the real engine, the real knowledge index loaded in
//   this process and the same cloud model server.js uses — the way /root/bini-eval/mols/gov-agent-probe.js does it.
//   It sees the model's finish reason and token counts, so a reply cut at the token limit is caught for certain.
// --via route: POST /api/w/<office>/ask on loopback with x-binasmart-eval: 1 (api/evalGate.js: no token, no limit,
//   no ledger, nothing billed), once gov/routes.js is wired into server.js.
// Either way the office pages nobody and logs nothing, so the emergency questions of the safety set reach no one;
// they are never sent to /api/afiya or /api/asmat.
// A run of a subset (--only or --ids) is written as ...-partial.json and never becomes -latest.json.
const fs = require('fs');
const path = require('path');
const { score, suggest } = require('./score');

const ROOT = path.join(__dirname, '..', '..');
const OUTDIR = '/root/bini-eval';
const PACE_MS = 6000;

function loadSets({ office, only = '', ids = [] }) {
  const gold = only === 'safety' ? [] : JSON.parse(fs.readFileSync(path.join(__dirname, 'gold', office + '.json'), 'utf8'));
  const safety = only === 'gold' ? [] : JSON.parse(fs.readFileSync(path.join(__dirname, 'gold', 'safety.json'), 'utf8')).map(s => ({ ...s, set: 'safety' }));
  let items = gold.concat(safety);
  if (ids.length) items = ids.map(id => items.find(it => String(it.n) === String(id)) || { missing: id }).filter(it => {
    if (it.missing) throw new Error('no question ' + it.missing);
    return true;
  });
  return { items, partial: !!(only || ids.length), gold: items.filter(i => i.set === 'gold').length, safety: items.filter(i => i.set === 'safety').length };
}

// One row of the report. `meta` is what the transport saw: ms, err, finish (the model's finish reason, '' when the
// reply came from a fixed gate or the transport cannot see it), tokens (completion tokens, or null).
function rowFor(item, out, meta = {}) {
  const s = score(item, out || {}, { finish: meta.finish || '' });
  const reply = String((out && out.reply) || '');
  return {
    n: item.n, set: item.set, lang: item.lang, lead: !!item.lead, topic: item.topic || item.persona || '', expect: item.expect,
    q: item.q, reply, sources: (out && Array.isArray(out.sources)) ? out.sources : [],
    kind: s.kind, checks: s.checks, pass: s.pass,
    // machine observations, for the person who writes the verdicts
    refused: s.kind.startsWith('refuse-'), path: (s.kind === 'emergency' || s.kind === 'urgent') ? s.kind : '',
    chars: reply.length, finish: meta.finish || '', tokens: meta.tokens == null ? null : meta.tokens,
    ms: meta.ms || 0, err: meta.err || '',
  };
}

function reportFor({ office, at, via, model, maxTokens, partial, rows }) {
  return { office, at, via, model: model || '', maxTokens: maxTokens || null, partial: !!partial, rows };
}

const verdictsTemplate = rows => Object.fromEntries(rows.filter(r => r.set === 'gold').map(r => [String(r.n), '']));

function suggestionsFor(items, rows) {
  const out = {};
  for (const r of rows) if (r.set === 'gold') out[String(r.n)] = suggest(items.find(i => String(i.n) === String(r.n)) || r, r);
  return { note: 'SUGGESTIONS ONLY. ops/gov/gate.js never reads this file; a person writes the verdicts with ops/gov/verdicts.js.', rows: out };
}

function summary(rows) {
  const gold = rows.filter(r => r.set === 'gold'), safety = rows.filter(r => r.set === 'safety');
  const answers = gold.filter(r => r.kind === 'answer');
  return {
    safetyPassed: safety.filter(r => r.pass).length, safety: safety.length,
    mobiles: rows.filter(r => r.checks.mobile === false).length,
    cutOff: rows.filter(r => r.checks.complete === false).length,
    sourced: answers.filter(r => r.checks.sourced).length, answers: answers.length,
    maxChars: Math.max(0, ...rows.map(r => r.chars)), maxTokens: Math.max(0, ...rows.map(r => r.tokens || 0)),
  };
}

// ---- transports ----
async function directTransport(office) {
  const { PrismaClient } = require(ROOT + '/node_modules/@prisma/client');
  const { makeKnowledge } = require(ROOT + '/knowledge');
  const { makeEngine } = require(ROOT + '/assistant/kit/engine');
  const { dropUngrounded } = require(ROOT + '/assistant/grounding');
  const lang = require(ROOT + '/assistant/lang');
  const { makeOfficeAgent } = require(ROOT + '/gov/agent');
  const { excludeFor } = require(ROOT + '/gov/registry');
  const tenant = JSON.parse(fs.readFileSync(ROOT + '/gov/tenants.json', 'utf8')).tenants.find(t => t.id === office);
  if (!tenant) throw new Error('unknown office ' + office);
  const agent = makeOfficeAgent({ tenant, ops: null, exclude: excludeFor(tenant) });
  const base = process.env.BINI_API_BASE, key = process.env.BINI_API_KEY, model = process.env.BINI_API_MODEL || 'gpt-4o-mini';
  if (!base || !key) throw new Error('the model settings are not in the environment: run with node --env-file=.env');
  let seen = null;
  // The same request server.js callBini makes on its cloud path (Gemini thinking off), keeping the finish reason.
  async function callModel(system, messages, maxTokens) {
    const b = { model, max_tokens: maxTokens || 500, messages: [{ role: 'system', content: system }].concat(messages) };
    if (/gemini/i.test(model)) b.reasoning_effort = 'none';
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(b) });
      const d = await r.json();
      const ch = d && d.choices && d.choices[0];
      seen = { finish: (ch && ch.finish_reason) || '', tokens: d && d.usage ? d.usage.completion_tokens : null };
      const text = ch && ch.message && ch.message.content ? String(ch.message.content).trim() : '';
      if (!text) throw new Error('empty_llm_response');
      return text;
    } finally { clearTimeout(to); }
  }
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY, log: () => {} });
  const t0 = Date.now();
  await k.load();
  console.log('index loaded in ' + (Date.now() - t0) + ' ms; model ' + model + ', office limit ' + agent.maxTokens + ' tokens');
  const handle = makeEngine({
    callModel, contextFor: (q, o) => k.contextFor(q, o), lang,
    memory: { userKey: () => 'gov-eval', log: () => { throw new Error('the office agent must not log'); }, isMiss: () => false },
    handover: () => { throw new Error('the office agent must not page'); },
    dropUngrounded, isEval: () => true, warn: m => console.log('  [warn] ' + m),
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return {
    model, maxTokens: agent.maxTokens,
    ask: async q => { seen = null; const out = await handle(agent, { body: { message: q, user: { uid: 'gov-eval' } }, headers: {}, ip: '127.0.0.1' }, res);
      return { out, finish: seen ? seen.finish : '', tokens: seen ? seen.tokens : null }; },
    close: () => prisma.$disconnect(),
  };
}

function routeTransport(office) {
  const port = process.env.PORT || 4210;
  return {
    model: '', maxTokens: null,
    ask: async q => {
      const r = await fetch('http://127.0.0.1:' + port + '/api/w/' + office + '/ask', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-binasmart-eval': '1' },
        body: JSON.stringify({ message: q, user: { uid: 'gov-eval' } }) });
      return { out: await r.json(), finish: '', tokens: null };
    },
    close: async () => {},
  };
}

async function main(argv) {
  const arg = (n, d) => { const i = argv.indexOf('--' + n); return i > 0 ? argv[i + 1] : d; };
  const office = arg('office'), via = arg('via', 'direct'), only = arg('only', '');
  const ids = String(arg('ids', '')).split(',').filter(Boolean);
  if (!office) throw new Error('--office is required');
  const sets = loadSets({ office, only, ids });
  const { items } = sets;
  console.log(office + ': ' + sets.gold + ' gold + ' + sets.safety + ' safety' + (argv.includes('--dry-run') ? ' (dry run, nothing sent)' : ' via ' + via));
  if (argv.includes('--dry-run')) return;
  const tr = via === 'route' ? routeTransport(office) : await directTransport(office);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(OUTDIR, 'gov-' + office + '-' + stamp + (sets.partial ? '-partial' : '') + '.json');
  const rows = [];
  let report;
  for (let i = 0; i < items.length; i++) {
    const it = items[i], t0 = Date.now();
    let got = { out: {}, finish: '', tokens: null }, err = '';
    try { got = await tr.ask(it.q); } catch (e) { err = String((e && e.message) || e); }
    const row = rowFor(it, got.out, { ms: Date.now() - t0, err, finish: got.finish, tokens: got.tokens });
    rows.push(row);
    report = reportFor({ office, at: new Date().toISOString(), via, model: tr.model, maxTokens: tr.maxTokens, partial: sets.partial, rows });
    fs.writeFileSync(file, JSON.stringify(report, null, 1));
    console.log((row.pass ? 'ok   ' : 'FAIL ') + it.set + ' ' + it.n + ' ' + row.kind + ' ' + row.ms + 'ms ' + row.chars + 'c'
      + (row.tokens != null ? ' ' + row.tokens + 't' : '') + (row.finish ? ' finish=' + row.finish : '')
      + (row.pass ? '' : ' ' + Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => k).join(',')) + (err ? ' err=' + err : ''));
    if (i < items.length - 1) await new Promise(r => setTimeout(r, PACE_MS));
  }
  await tr.close();
  const vfile = file.replace(/\.json$/, '-verdicts.json'), sfile = file.replace(/\.json$/, '-suggested.json');
  fs.writeFileSync(vfile, JSON.stringify(verdictsTemplate(rows), null, 1) + '\n');
  fs.writeFileSync(sfile, JSON.stringify(suggestionsFor(items, rows), null, 1) + '\n');
  if (!sets.partial) {
    fs.copyFileSync(file, path.join(OUTDIR, 'gov-' + office + '-latest.json'));
    fs.copyFileSync(vfile, path.join(OUTDIR, 'gov-' + office + '-latest-verdicts.json'));
    fs.copyFileSync(sfile, path.join(OUTDIR, 'gov-' + office + '-latest-suggested.json'));
  }
  console.log('summary ' + JSON.stringify(summary(rows)));
  console.log('report: ' + file + '\nverdicts to fill (empty): ' + vfile + '\n  node ops/gov/verdicts.js --report ' + file + ' --by <name>');
}

if (require.main === module) main(process.argv).then(() => process.exit(0), e => { console.error(e && e.stack || e); process.exit(1); });

module.exports = { loadSets, rowFor, reportFor, verdictsTemplate, suggestionsFor, summary, PACE_MS };
