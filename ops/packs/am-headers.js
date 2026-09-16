#!/usr/bin/env node
'use strict';
// An Amharic title and an Amharic key-fact summary for every ENGLISH document of a knowledge pack, written to
// knowledge/<pack>/am-headers.json and read by ops/packs/fetch-pack.js when the registry's `pack` block says
// "amHeaders": true.
//
// Why. The sector-pack design asked for "an English and Amharic header per document naming the key facts".
// The banking pack shipped with only half of that: the Amharic sentence in every header is a template, word
// for word the same on all 203 English documents, so an Amharic question cannot tell one of them from
// another by keyword and the reranker sees 420 characters that read alike. The first measured run
// (knowledge/banking/gold-spec.json -> measured) found exactly that: 30 Amharic questions whose gold page is
// English scored 30.0% on retrieval, while the 10 whose gold page is itself Amharic scored 90.0%. Dashen,
// CBE and Coop Bank publish no Amharic at all, so the missing Amharic cannot be fetched. It can be written -
// from the page, never from memory.
//
// What is generated, and what is not. Gemini is given the page's own title, the institution's name in
// Amharic from the registry, the section's Amharic title and the first 3,000 characters of the page text,
// and asked for a title and a summary. It is given nothing else, and nothing it returns is taken on trust:
// every run of digits in both strings must appear, digit for digit, in the page text
// (fetch-pack.js -> ungroundedFigures). A first failure is retried once with a stricter instruction; a
// second failure keeps the title and drops the summary. No figure this pack prints in Amharic is a figure
// the institution did not print in English.
//
//   node --env-file=.env ops/packs/am-headers.js --pack banking
//   node --env-file=.env ops/packs/am-headers.js --pack banking --only-missing
//   node --env-file=.env ops/packs/am-headers.js --pack banking --limit 3 --dry-run
//
// One request at a time, 4 s apart, the same pacing every generation and evaluation loop in this repo uses.
// 203 documents is about 15 minutes, so run it detached and poll the log.
const fs = require('fs');
const path = require('path');
const P = require('./fetch-pack.js');

const MODEL = 'gemini-2.5-flash';
const PACE_MS = 4000;
const BODY_CHARS = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

const arg = (argv, name, dflt) => { const i = argv.indexOf(name); return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt; };

// The prompt states the three rules the code then enforces anyway: Amharic only, no figure the page does not
// print, and the institution's name as the registry spells it in Amharic. `strict` is the second attempt.
function prompt(doc, strict) {
  const rules = [
    'Write in Amharic (Ethiopic script) only. No English words except a product name the page itself leaves in English.',
    'Use the institution name exactly as given above in Amharic.',
    'The title names the institution and the product or topic, and is at most 12 words.',
    'The summary is 2 or 3 sentences saying what the page is about and its key facts.',
    'Every number you write must appear in the page text above. Do not convert, round or invent any number.',
  ];
  if (strict) rules.push('Your previous answer contained a number that is not in the page text. Write the summary with NO numbers at all unless you can copy the digits exactly from the page text above.');
  return 'You are writing the Amharic header of a knowledge document about an Ethiopian financial institution.\n\n'
    + 'Institution (English): ' + doc.siteName + '\n'
    + 'Institution (Amharic): ' + doc.siteNameAm + '\n'
    + (doc.sectionTitleAm ? 'Section (Amharic): ' + doc.sectionTitleAm + '\n' : '')
    + 'Page title (English): ' + doc.title + '\n\n'
    + 'Page text (the first ' + BODY_CHARS + ' characters, exactly as the institution published it):\n'
    + '"""\n' + doc.body + '\n"""\n\n'
    + 'Rules:\n' + rules.map(r => '- ' + r).join('\n') + '\n\n'
    + 'Answer with JSON and nothing else: {"titleAm": "...", "summaryAm": "..."}';
}

async function ask(apiKey, text) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey, {
      method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!r.ok) return { err: 'http_' + r.status };
    const j = await r.json();
    const out = (((j.candidates || [])[0] || {}).content || {}).parts;
    const raw = (out && out[0] && out[0].text) || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { err: 'no json' };
    let o; try { o = JSON.parse(m[0]); } catch (e) { return { err: 'bad json' }; }
    const one = s => String(s || '').replace(/\s+/g, ' ').trim();
    return { titleAm: one(o.titleAm), summaryAm: one(o.summaryAm) };
  } catch (e) {
    return { err: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 60) };
  } finally { clearTimeout(t); }
}

// Every live English document of the pack, with the text this renderer wrote it from.
function documents(pack) {
  const dir = P.packDir(pack);
  const reg = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
  const sites = new Map((reg.sites || []).map(s => [s.name, s]));
  const out = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md')).sort()) {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = P.readMeta(md);
    const site = sites.get(meta.source_name);
    if (!site || meta.status === 'gone') continue;
    const slug = f.replace(/\.md$/, '');
    const lang = meta.lang || P.langFor(site, P.pathOf(meta.url) || '');
    if (lang !== 'en') continue;
    const text = P.bodyText(md);
    if (!text) continue;
    const sec = P.sectionOf(site, P.pathOf(meta.url) || '');
    const pre = site.name + ' — ';
    out.push({ slug, contentHash: meta.contentHash, siteName: site.name, siteNameAm: site.nameAm,
      sectionTitleAm: sec ? sec.titleAm : '', text,
      title: meta.title && meta.title.slice(0, pre.length) === pre ? meta.title.slice(pre.length) : meta.title,
      body: text.slice(0, BODY_CHARS) });
  }
  return out;
}

(async () => {
  const argv = process.argv.slice(2);
  const pack = arg(argv, '--pack', 'banking');
  const limit = Number(arg(argv, '--limit', 0)) || 0;
  const dryRun = argv.includes('--dry-run');
  const onlyMissing = argv.includes('--only-missing');
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) { console.error('[am-headers] no GEMINI_API_KEY - run with node --env-file=.env'); process.exit(1); }

  const file = path.join(P.packDir(pack), P.AM_HEADERS);
  const side = P.readAmHeaders(pack) || {};
  let docs = documents(pack);
  // A page whose text has not changed since its entry was written needs no second call to Gemini: the
  // summary was generated from exactly those characters. --only-missing goes further and skips anything
  // that already has an entry at all.
  const before = docs.length;
  docs = docs.filter(d => {
    const e = side[d.slug];
    if (!e) return true;
    if (onlyMissing) return false;
    return e.contentHash !== d.contentHash;
  });
  if (limit) docs = docs.slice(0, limit);
  console.log('[am-headers] ' + pack + ': ' + before + ' English documents, ' + docs.length + ' to generate'
    + (dryRun ? '  [DRY RUN — nothing written]' : ''));

  const r = { both: 0, titleOnly: 0, rejected: 0, failed: 0, retried: 0 };
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    if (i) await sleep(PACE_MS);
    let a = await ask(apiKey, prompt(d, false));
    if (a.err || !a.titleAm) { r.failed++; console.log('        ! ' + (a.err || 'no title') + '  ' + d.slug); continue; }
    let bad = P.ungroundedFigures(d.text, a.titleAm, a.summaryAm);
    if (bad.length) {
      r.retried++;
      await sleep(PACE_MS);
      const b = await ask(apiKey, prompt(d, true));
      if (!b.err && b.titleAm) a = b;
      bad = P.ungroundedFigures(d.text, a.titleAm, a.summaryAm);
    }
    // A title whose figures are not on the page is a title we cannot use at all; a summary is dropped alone.
    const badTitle = P.ungroundedFigures(d.text, a.titleAm);
    if (badTitle.length) { r.failed++; console.log('        ! ungrounded title, figures not on the page: ' + badTitle.join(' ') + '  ' + d.slug); continue; }
    const summaryAm = bad.length ? '' : a.summaryAm;
    if (bad.length) { r.rejected++; console.log('        ~ summary dropped, figures not on the page: ' + bad.join(' ') + '  ' + d.slug); }
    if (summaryAm) r.both++; else r.titleOnly++;
    side[d.slug] = { titleAm: a.titleAm, summaryAm, contentHash: d.contentHash, generatedAt: today(), model: MODEL };
    if (!dryRun) fs.writeFileSync(file, JSON.stringify(side, null, 1) + '\n');
    if ((i + 1) % 10 === 0) console.log('[am-headers] ' + (i + 1) + '/' + docs.length);
  }
  console.log('[am-headers] ' + pack + ': ' + r.both + ' with a title and a summary, ' + r.titleOnly + ' with a title only, '
    + r.rejected + ' summaries rejected by the grounding check, ' + r.retried + ' retried, ' + r.failed + ' failed');
  console.log(JSON.stringify({ pack, entries: Object.keys(side).length, ...r }));
})().catch(e => { console.error('[am-headers] failed: ' + e.message); process.exit(1); });
