#!/usr/bin/env node
'use strict';
// Share cards for the SECTIONS, not just for articles.
//
//   node ops/og/section-cards.js            build them all
//   node ops/og/section-cards.js jobs       just one section
//   node ops/og/section-cards.js --list     what it would build
//
// The bug this fixes (owner, 22 Sep 2026): "telegram share about job but og talk about different".
// newsShell() defaults og:image to bina-news.png, and every section that did not pass its own picture
// got it — so a vacancy shared to Telegram showed the ዜና card. One wrong picture on every job, tender
// and company page we have ever shared.
//
// The cards are drawn from brand/sections.js, so a section's colour and mark here are the same ones on
// its hero. No numbers on a card: a vacancy count is true for a day and the card is cached for weeks.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { MARKS, COLOURS, mark } = require('../../brand/sections');
const { CATEGORIES } = require('../../jobs/categories');

const ROOT = path.join(__dirname, '..', '..');
const RENDER = path.join(ROOT, 'ops', 'og', 'render-card.sh');
const TMP = '/tmp/og-section-card.html';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One template, two lines of text and a mark. Everything else is the section's colour.
function html({ section, titleAm, titleEn, lede }) {
  const c = COLOURS[section] || COLOURS.news;
  return `<!doctype html><html lang="am"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Ethiopic:wght@600;800;900&family=Noto+Sans+Ethiopic:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{font-family:'Noto Sans Ethiopic','Noto Serif Ethiopic',system-ui,sans-serif;color:#141a24;position:relative;
    background:
      radial-gradient(760px 520px at 86% 2%, ${hexA(c[1], .16)} 0%, transparent 62%),
      radial-gradient(640px 440px at 0% 100%, ${hexA(c[0], .12)} 0%, transparent 58%),
      #fbfaf8;}
  .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(20,26,36,.08) 1.1px, transparent 1.1px);
    background-size:26px 26px;opacity:.45}
  .wrap{position:absolute;inset:0;padding:46px 58px;display:flex;flex-direction:column}
  .mast{display:flex;align-items:center;justify-content:space-between}
  .brand{font-size:29px;font-weight:800;letter-spacing:-.4px}
  .brand .et{color:#078930}.brand .zena{color:#DA121A;margin-left:5px}
  .site{font-size:19px;color:#7b8494;font-weight:600}
  .body{flex:1;display:flex;align-items:center;gap:44px}
  .left{flex:1}
  h1{font-family:'Noto Serif Ethiopic',serif;font-size:56px;line-height:1.14;font-weight:900;letter-spacing:-.6px}
  h2{font-size:30px;font-weight:700;color:${c[1]};margin-top:10px;letter-spacing:-.2px}
  p{margin-top:20px;font-size:22px;line-height:1.55;color:#4b5565;max-width:19em}
  /* The section mark, lifted off the page — the same drawing as the site's own hero badge. */
  .tile{width:230px;height:230px;border-radius:64px;flex:none;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(145deg,${c[1]},${c[0]});
    box-shadow:0 42px 60px -34px ${hexA(c[0], .75)}, inset 0 3px 0 rgba(255,255,255,.35);
    transform:rotate(-6deg)}
  .tile svg{transform:rotate(6deg)}
  .foot{display:flex;align-items:center;justify-content:space-between;font-size:19px;color:#7b8494;font-weight:600}
  .foot b{color:#141a24}
</style></head><body>
<div class="dots"></div>
<div class="wrap">
  <div class="mast"><div class="brand">Bina<span class="et">Smart</span><span class="zena">ዜና</span></div>
    <div class="site">bina.et</div></div>
  <div class="body">
    <div class="left">
      <h1>${esc(titleAm)}</h1>
      <h2>${esc(titleEn)}</h2>
      <p>${esc(lede)}</p>
    </div>
    <div class="tile">${mark(section, { size: 128, colour: '#fff', stroke: 1.6 })}</div>
  </div>
  <div class="foot"><span>bina.et</span><span><b>በአማርኛና በእንግሊዝኛ</b></span></div>
</div></body></html>`;
}

// #rrggbb + alpha, because the gradients want the section colour at low opacity.
function hexA(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const SECTIONS = {
  jobs: { section: 'jobs', slug: 'section-jobs', titleAm: 'ክፍት የሥራ ቦታዎች', titleEn: 'Jobs in Ethiopia',
    lede: 'በየጠዋቱ የሚታደስ — ከቀጣሪው መገለጫ፣ አድራሻና የማመልከቻ መንገድ ጋር። ለሥራ ፈላጊም ለቀጣሪም ነጻ።' },
  tenders: { section: 'tenders', slug: 'section-tenders', titleAm: 'ጨረታዎች', titleEn: 'Ethiopian tenders',
    lede: 'የተረጋገጡ ጨረታዎች — ድርጅቱ፣ ማብቂያው፣ የቀሩት ቀኖችና ዋናው ማስታወቂያ። ነጻ።' },
  news: { section: 'news', slug: 'section-news', titleAm: 'ዜና', titleEn: 'BinaSmart News',
    lede: 'ቴክኖሎጂ፣ ንግድ፣ ግንባታና ሪል እስቴት — በአማርኛ፣ ከምንጩ ተረጋግጦ።' },
  cinema: { section: 'cinema', slug: 'section-cinema', titleAm: 'ሲኒማ', titleEn: 'Cinema in Addis',
    lede: 'የአዲስ አበባ ሲኒማ ፕሮግራምና ትኬት — መቀመጫ ይምረጡ፣ በQR ይግቡ።' },
  ride: { section: 'ride', slug: 'section-ride', titleAm: 'ጉዞ', titleEn: 'BinaRide',
    lede: 'ቋሚ ዋጋ በአዲስ አበባ — ከመሳፈርዎ በፊት ያውቃሉ። ጭማሪ የለም።' },
  hotels: { section: 'hotels', slug: 'section-hotels', titleAm: 'ሆቴሎች', titleEn: 'Hotels',
    lede: 'በቀጥታ ይያዙ — 0% ኮሚሽን፣ ክፍያ ሆቴሉ ላይ።' },
};

function render(slug, markup) {
  fs.writeFileSync(TMP, markup);
  execFileSync(RENDER, [TMP, slug], { stdio: ['ignore', 'pipe', 'pipe'] });
  return '/static/og-' + slug + '.png';
}

(async () => {
  const args = process.argv.slice(2);
  const only = args.find(a => !a.startsWith('--'));
  const list = args.includes('--list');

  const jobs = [];
  for (const [key, cfg] of Object.entries(SECTIONS)) {
    if (only && only !== key) continue;
    jobs.push(cfg);
  }
  // A card per field of work, so a banking vacancy shared to Telegram shows a banking card.
  if (!only || only === 'jobs') {
    for (const c of CATEGORIES) {
      jobs.push({ section: 'jobs', slug: 'jobs-category-' + c.slug, titleAm: c.am, titleEn: c.en + ' jobs',
        lede: 'ክፍት የሥራ ቦታዎች በbina.et — በየጠዋቱ ይታደሣል። ለሥራ ፈላጊ ነጻ።' });
    }
  }

  if (list) { jobs.forEach(j => console.log('  og-' + j.slug + '.png  ' + j.titleAm)); return; }
  console.log('[og] building ' + jobs.length + ' cards');
  for (const j of jobs) {
    if (!MARKS[j.section]) { console.log('  skip ' + j.slug + ' — no mark for section ' + j.section); continue; }
    render(j.slug, html(j));
    console.log('  ok  og-' + j.slug + '.png');
  }
  fs.unlink(TMP, () => {});
})().catch(e => { console.error('[og] failed: ' + e.message); process.exit(1); });
