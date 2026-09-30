#!/usr/bin/env node
'use strict';
// The daily headline card, built and posted without being asked.
//
//   node --env-file=.env ops/news/headline-card-daily.js --dry-run   build it, send nothing
//   node --env-file=.env ops/news/headline-card-daily.js             build and post
//
// The thing automation removes here is the editorial eye. On 29 September the feed offered a story
// about a Filipino carnival game under a card headed "selected from Ethiopian media"; Ibrahim agreed to
// drop it. Nobody will be reading the feed at 07:00 every morning, so the filter has to do that job:
//
//   1. a rule list drops the obvious foreign/filler items outright — free, instant, auditable
//   2. whatever survives goes to Jev as one boolean per headline: is this about Ethiopia?
//      Anything below the confidence bar is dropped, not published. Jev is used to VETO only.
//   3. if fewer than MIN_ITEMS survive, NOTHING is posted. A thin card is worse than no card.
//
// Only HEADLINES are used, each credited to the outlet, with readers pointed at the source. This is a
// signpost to their reporting, never a substitute for it.
const fs = require('fs');
const { execFileSync } = require('child_process');

const CANDS = '/root/storage/bina_news_candidates.json';
const LEDGER = '/root/storage/headline-card-used.json';
const CARD = '/root/charts/headlines-am.png';
const DRY = process.argv.includes('--dry-run');
const MAX_ITEMS = 6, MIN_ITEMS = 2, JEV_BAR = 0.55;

// Cheap first pass. If a headline is plainly not about Ethiopia, no model needs to be asked.
const FOREIGN = /\b(philippin|perya|manila|vietnam|indonesia|malaysia|thailand|pakistan|bangladesh|casino|betting|slot|crypto ?giveaway|forex bonus)\b/i;
const ETHIOPIAN = /\b(ethiopia|ethiopian|addis|amhara|oromia|tigray|afar|somali region|sidama|birr|nbe|abiy|fana|ena)\b/i;

// The feed labels categories in English; the card is Amharic. Anything not in this map keeps its own
// label rather than being guessed at.
const CAT_AM = { Banking: 'ባንክና ፋይናንስ', Technology: 'ቴክኖሎጂ', Construction: 'ግንባታ', Business: 'ንግድ',
  Health: 'ጤና', Education: 'ትምህርት', Agriculture: 'ግብርና', Politics: 'ፖለቲካ', Energy: 'ኃይል',
  Transport: 'ትራንስፖርት', Tourism: 'ቱሪዝም', Economy: 'ኢኮኖሚ', Mining: 'ማዕድን', Telecom: 'ቴሌኮም' };

const load = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));

async function jevIsEthiopian(items) {
  const API = process.env.JEV_API_URL, KEY = process.env.JEV_API_KEY, MODEL = process.env.JEV_MODEL;
  if (!API || !KEY) return items.map(() => null);          // no key: fall through to the rule list alone
  const state = items.map((it, i) => (i + 1) + '. ' + it.title + '  [' + it.source + ']').join('\n');
  const questions = {};
  items.forEach((it, i) => {
    questions['q' + (i + 1)] = { type: 'boolean',
      instructions: 'Headline ' + (i + 1) + ' of the list. Is this a news story about ETHIOPIA or Ethiopians — its economy, government, companies, people or institutions? Answer false for foreign stories, syndicated filler and advertising.' };
  });
  try {
    const r = await fetch(API, { method: 'POST',
      headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }) });
    const d = await r.json();
    if (!d || !d.answers) return items.map(() => null);
    return items.map((_, i) => {
      const a = d.answers['q' + (i + 1)] || {};
      return typeof a.probability === 'number' ? a.probability : null;
    });
  } catch (e) { console.log('  jev unavailable:', String(e.message).slice(0, 60)); return items.map(() => null); }
}

(async () => {
  const cands = load(CANDS) || [];
  const used = new Set(load(LEDGER) || []);
  let pool = cands.filter(c => c.title && c.url && !used.has(c.url));
  console.log(cands.length + ' candidates, ' + pool.length + ' not used before');

  const dropped = [];
  pool = pool.filter(c => {
    if (FOREIGN.test(c.title)) { dropped.push([c.title, 'rule: foreign/filler']); return false; }
    return true;
  });

  const shortlist = pool.slice(0, MAX_ITEMS + 3);
  const probs = await jevIsEthiopian(shortlist);
  const keep = [];
  shortlist.forEach((c, i) => {
    const p = probs[i];
    if (p !== null && p < JEV_BAR) { dropped.push([c.title, 'jev ' + p.toFixed(2)]); return; }
    if (p === null && !ETHIOPIAN.test(c.title)) { dropped.push([c.title, 'no jev, no Ethiopia keyword']); return; }
    if (keep.length < MAX_ITEMS) keep.push(c);
  });
  dropped.forEach(d => console.log('  dropped: ' + d[0].slice(0, 58) + '   (' + d[1] + ')'));

  if (keep.length < MIN_ITEMS) { console.log('only ' + keep.length + ' survived; posting nothing today.'); return; }

  const byCat = new Map();
  for (const c of keep) {
    const k = CAT_AM[c.cat] || c.cat || 'ዜና';
    if (!byCat.has(k)) byCat.set(k, { cat: k, icon: c.emoji || '📰', items: [] });
    byCat.get(k).items.push({ t: c.title, src: c.source });
  }
  const groups = [...byCat.values()];
  fs.writeFileSync('/tmp/hc-items.json', JSON.stringify(groups));
  execFileSync('node', [__dirname + '/../og/headline-card.js', '/tmp/hc-items.json', '--out', CARD], { stdio: 'inherit' });

  const lines = groups.map(g => g.icon + ' ' + g.cat + '\n' + g.items.map(i => '• ' + i.t).join('\n')).join('\n\n');
  const srcs = [...new Set(keep.map(c => c.source))].join('፣ ');
  const caption = '📌 የዛሬ አርዕስቶች — ከኢትዮጵያ ሚዲያዎች የተመረጡ\n\n' + lines +
    '\n\nምንጭ፦ ' + srcs + '። ሙሉ ዘገባውን በምንጩ ገጽ ያንብቡ።\n\n👉 ተጨማሪ ዜና፦ https://bina.et/news';
  if (Buffer.byteLength(caption, 'utf8') > 1020) { console.log('caption too long for Telegram; trim MAX_ITEMS'); return; }

  console.log('\n--- caption ---\n' + caption + '\n---');
  if (DRY) { console.log('[dry run] card at ' + CARD + ', nothing sent.'); return; }

  const tok = process.env.BINASMART_TG_TOKEN, ch = process.env.BINA_TG_CHANNEL;
  const fd = new FormData();
  fd.append('chat_id', ch); fd.append('caption', caption);
  fd.append('photo', new Blob([fs.readFileSync(CARD)]), 'headlines.png');
  const r = await fetch('https://api.telegram.org/bot' + tok + '/sendPhoto', { method: 'POST', body: fd });
  const d = await r.json();
  if (!d.ok) { console.error('FAILED: ' + d.description); process.exit(1); }
  keep.forEach(c => used.add(c.url)); save(LEDGER, [...used]);
  console.log('posted -> https://t.me/' + String(ch).replace('@', '') + '/' + d.result.message_id);
})().catch(e => { console.error(e.message); process.exit(1); });
