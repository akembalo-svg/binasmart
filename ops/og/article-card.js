#!/usr/bin/env node
'use strict';
// Share cards for articles — a different one each time.
//
//   node ops/og/article-card.js <slug> --title "…" --lede "…" [--style rings] [--palette amber]
//   node ops/og/article-card.js --styles            list the styles and palettes
//
// Why this exists (owner, 22 September 2026: "why repeat same picture"): three articles in a row went
// out with the same stacked-slab drawing in the same blue. A share card is the first thing a reader
// sees, and three identical ones read as one article posted three times.
//
// So: six drawings and six palettes, and unless a style is named the slug picks one — the same slug
// always lands on the same card (a redeploy must not change a picture people already saw), but
// consecutive articles land on different ones.
//
// Every drawing is pure CSS. No image to license, nothing to 404, and it renders the same every run.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RENDER = path.join(__dirname, 'render-card.sh');
const TMP = '/tmp/og-article-card.html';

const PALETTES = {
  blue:   { ink: '#1a3fa8', a: '#3b74e4', b: '#0c2f83', wash: 'rgba(37,99,235,.13)' },
  green:  { ink: '#0b6b45', a: '#17a06a', b: '#064e3b', wash: 'rgba(7,137,48,.13)' },
  amber:  { ink: '#9a5b08', a: '#e0952a', b: '#7a3f05', wash: 'rgba(234,149,42,.16)' },
  purple: { ink: '#5b21a8', a: '#8b5cf6', b: '#3b1078', wash: 'rgba(139,92,246,.14)' },
  teal:   { ink: '#0d6b6b', a: '#14a8a8', b: '#064b4b', wash: 'rgba(20,168,168,.14)' },
  crimson:{ ink: '#a11d33', a: '#e04358', b: '#74101f', wash: 'rgba(224,67,88,.13)' },
};
const PALETTE_ORDER = Object.keys(PALETTES);

// Each style returns the markup for the right-hand drawing. They must all sit inside a 430x380 box.
const STYLES = {
  // Stacked slabs seen at an angle — layers that build on each other.
  slabs: (p, m) => `<div class="fig slabs">${(m.labels || ['', '', '', '']).slice(0, 4).map((t, i) =>
    `<div class="slab s${i + 1}">${esc(t)}</div>`).join('')}</div>`,

  // Concentric rings — one idea at the centre, context around it.
  rings: (p, m) => `<div class="fig rings">
      <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>
      <div class="core">${esc((m.labels || [''])[0] || '')}</div></div>`,

  // A single large number — for an article whose point IS a figure.
  stat: (p, m) => `<div class="fig stat">
      <div class="big">${esc(m.stat || '')}</div>
      <div class="cap">${esc(m.statCap || '')}</div></div>`,

  // A mosaic of tiles, one highlighted — many things, one that matters.
  mosaic: (p, m) => `<div class="fig mosaic">${Array.from({ length: 9 }, (_, i) =>
    `<div class="tile${i === (m.pick == null ? 4 : m.pick) ? ' on' : ''}"></div>`).join('')}</div>`,

  // A bar climbing left to right — growth, comparison, before and after.
  bars: (p, m) => `<div class="fig bars">${(m.bars || [28, 46, 70, 100]).map((h, i) =>
    `<div class="bar b${i + 1}" style="height:${Math.max(12, Math.min(100, h))}%"></div>`).join('')}</div>`,

  // The companies' own marks — what a reader recognises in a feed before reading a word.
  logo: (p, m) => `<div class="fig logorow"><div class="marks${(m.logos || []).length === 1 ? ' one' : ''}">${(m.logos || []).map((f, i) =>
    (i ? '<span class="plus">+</span>' : '') + `<img src="${dataUri(f)}" alt="">`).join('')}</div>${
    m.logoText ? `<div class="lname">${esc(m.logoText)}</div>` : ''}</div>`,

  // A door / gateway — access, permission, a way in.
  gate: (p, m) => `<div class="fig gate"><div class="arch"><div class="glow"></div>
      <div class="key">${esc((m.labels || [''])[0] || '')}</div></div></div>`,
};
const STYLE_ORDER = Object.keys(STYLES);

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A logo is read from disk and inlined. The renderer must not depend on the network, and a card is
// re-rendered months later when a path may have moved — a data: URI fails loudly at build time instead.
const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function dataUri(file) {
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', '..', file);
  const type = MIME[path.extname(abs).toLowerCase()];
  if (!type) throw new Error('logo must be svg/png/jpg/webp: ' + file);
  return 'data:' + type + ';base64,' + fs.readFileSync(abs).toString('base64');
}

// Stable per slug: the same article always renders the same picture.
function pick(list, slug, salt) {
  let h = 0;
  for (const ch of String(slug) + salt) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return list[h % list.length];
}

function html({ title, lede, kicker, read, style, palette, motif }) {
  const p = PALETTES[palette] || PALETTES.blue;
  const fig = (STYLES[style] || STYLES.slabs)(p, motif || {});
  return `<!doctype html><html lang="am"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Ethiopic:wght@600;800;900&family=Noto+Sans+Ethiopic:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{font-family:'Noto Sans Ethiopic','Noto Serif Ethiopic',system-ui,sans-serif;color:#141a24;position:relative;
    background:
      radial-gradient(780px 520px at 86% 2%, ${p.wash} 0%, transparent 62%),
      radial-gradient(620px 430px at 0% 100%, ${p.wash} 0%, transparent 58%),
      #fbfaf8;}
  .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(20,26,36,.08) 1.1px, transparent 1.1px);
    background-size:26px 26px;opacity:.45}
  .wrap{position:absolute;inset:0;padding:44px 56px;display:flex;flex-direction:column}
  .mast{display:flex;align-items:center;justify-content:space-between}
  .brandrow{display:flex;align-items:center;gap:14px}
  .brand{font-size:29px;font-weight:800;letter-spacing:-.4px}
  .brand .et{color:#078930}.brand .zena{color:#DA121A;margin-left:5px}
  .pill{background:#141a24;color:#fff;font-size:16px;font-weight:700;padding:6px 18px;border-radius:999px}
  .read{font-size:18px;color:#7b8494;font-weight:600}
  .body{flex:1;display:flex;align-items:center;gap:36px}
  .left{width:590px}
  .rule{width:180px;height:3px;background:#141a24;margin:14px 0 20px}
  h1{font-family:'Noto Serif Ethiopic',serif;font-size:47px;line-height:1.15;font-weight:900;letter-spacing:-.5px}
  h1 .hl{color:${p.ink}}
  p.lede{margin-top:16px;font-size:21px;line-height:1.55;color:#4b5565}
  .foot{display:flex;align-items:center;justify-content:space-between;font-size:18px;color:#7b8494;font-weight:600}
  .foot b{color:#141a24}
  .fig{flex:1;height:380px;position:relative;display:flex;align-items:center;justify-content:center}

  /* slabs */
  .slabs{perspective:1500px}
  .slabs .slab{position:absolute;width:250px;height:250px;border-radius:24px;display:flex;align-items:flex-end;
    justify-content:flex-end;padding:16px 22px;font-size:23px;font-weight:800;color:#fff;
    transform-style:preserve-3d;border:2px solid rgba(255,255,255,.5);
    box-shadow:0 26px 44px -24px rgba(20,26,36,.55), inset 0 2px 0 rgba(255,255,255,.35)}
  .slabs{transform:rotateX(50deg) rotateZ(-42deg)}
  .slabs .s1{background:linear-gradient(135deg,${p.a}88,${p.a}bb);transform:translate3d(66px,66px,0)}
  .slabs .s2{background:linear-gradient(135deg,${p.a}bb,${p.a});transform:translate3d(44px,44px,54px)}
  .slabs .s3{background:linear-gradient(135deg,${p.a},${p.b}cc);transform:translate3d(22px,22px,108px)}
  .slabs .s4{background:linear-gradient(135deg,${p.b}dd,${p.b});transform:translate3d(0,0,162px)}

  /* rings */
  .rings .ring{position:absolute;border-radius:50%;border:14px solid ${p.a};left:50%;top:50%;transform:translate(-50%,-50%)}
  .rings .r1{width:340px;height:340px;opacity:.18}
  .rings .r2{width:250px;height:250px;opacity:.38}
  .rings .r3{width:160px;height:160px;opacity:.62}
  .rings .core{position:relative;width:118px;height:118px;border-radius:50%;
    background:linear-gradient(145deg,${p.a},${p.b});color:#fff;display:flex;align-items:center;justify-content:center;
    font-size:24px;font-weight:800;text-align:center;line-height:1.15;padding:10px;
    box-shadow:0 26px 40px -22px ${p.b}cc}

  /* stat */
  .stat{flex-direction:column}
  .stat .big{font-size:150px;font-weight:900;letter-spacing:-6px;line-height:1;
    background:linear-gradient(145deg,${p.a},${p.b});-webkit-background-clip:text;background-clip:text;color:transparent}
  .stat .cap{margin-top:14px;font-size:22px;font-weight:700;color:#4b5565;text-align:center;max-width:12em}

  /* logo row */
  .logorow{flex-direction:column;gap:22px}
  .marks{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
  .marks img{height:52px;width:auto;max-width:430px;object-fit:contain}
  .marks .plus{font-size:30px;font-weight:800;color:#b0aa9e;line-height:1}
  /* a single square mark has the whole figure to itself, so it is shown at a size people recognise */
  .marks.one img{height:132px;border-radius:30px}
  .lname{font-size:30px;font-weight:800;letter-spacing:-.4px;color:#141a24}

  /* mosaic */
  .mosaic{display:grid;grid-template-columns:repeat(3,96px);grid-template-rows:repeat(3,96px);gap:16px}
  .mosaic .tile{border-radius:20px;background:#e9edf3;box-shadow:inset 0 2px 0 rgba(255,255,255,.8)}
  .mosaic .tile.on{background:linear-gradient(145deg,${p.a},${p.b});
    box-shadow:0 24px 36px -20px ${p.b}bb;transform:scale(1.08)}

  /* bars */
  .bars{align-items:flex-end;gap:22px;height:300px}
  .bars .bar{width:76px;border-radius:18px 18px 8px 8px;background:linear-gradient(180deg,${p.a},${p.b});
    box-shadow:0 22px 34px -20px ${p.b}aa}
  .bars .b1{opacity:.32}.bars .b2{opacity:.52}.bars .b3{opacity:.76}.bars .b4{opacity:1}

  /* gate */
  .gate .arch{width:240px;height:320px;border-radius:120px 120px 22px 22px;position:relative;
    background:linear-gradient(160deg,${p.a},${p.b});box-shadow:0 34px 52px -28px ${p.b}cc;
    display:flex;align-items:center;justify-content:center}
  .gate .glow{position:absolute;inset:16px;border-radius:112px 112px 14px 14px;border:3px solid rgba(255,255,255,.45)}
  .gate .key{color:#fff;font-size:26px;font-weight:800;text-align:center;padding:0 22px;line-height:1.2}
</style></head><body>
<div class="dots"></div>
<div class="wrap">
  <div class="mast"><div class="brandrow">
    <div class="brand">Bina<span class="et">Smart</span><span class="zena">ዜና</span></div>
    <div class="pill">${esc(kicker || 'ቴክኖሎጂ')}</div></div>
    <div class="read">${esc(read || '')}</div></div>
  <div class="body">
    <div class="left"><div class="rule"></div>
      <h1>${title}</h1>
      <p class="lede">${esc(lede || '')}</p></div>
    ${fig}
  </div>
  <div class="foot"><span>bina.et/news</span><span><b>ቢኒ</b> — በአማርኛ የሚሠራ</span></div>
</div></body></html>`;
}

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
}

if (process.argv.includes('--styles')) {
  console.log('styles  : ' + STYLE_ORDER.join(', '));
  console.log('palettes: ' + PALETTE_ORDER.join(', '));
  process.exit(0);
}

const slug = process.argv[2];
if (!slug || slug.startsWith('--')) {
  console.error('usage: ops/og/article-card.js <slug> --title "…" --lede "…" [--style x] [--palette y]');
  process.exit(2);
}
const style = arg('style') || pick(STYLE_ORDER, slug, 's');
const palette = arg('palette') || pick(PALETTE_ORDER, slug, 'p');
const motif = arg('motif') ? JSON.parse(arg('motif')) : {};

fs.writeFileSync(TMP, html({
  title: arg('title', ''), lede: arg('lede', ''), kicker: arg('kicker', 'ቴክኖሎጂ'),
  read: arg('read', ''), style, palette, motif,
}));
execFileSync(RENDER, [TMP, slug], { stdio: 'inherit' });
console.log('  style: ' + style + '  palette: ' + palette);
fs.unlink(TMP, () => {});
