#!/usr/bin/env node
'use strict';
// Social preview images, generated rather than drawn by hand (the idea behind @vercel/og, with the tools this
// server already has: no new dependency, Chromium comes from the Musaned scrapers).
//   node ops/og-image.js --title "…" --am "…" --out public/og-ai.png [--url bina.et/ai] [--stats "22,000+|official passages"]
// Every page that wants its own card gets one line in ops/og-pages.json and `node ops/og-image.js --all`.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CHROMIUM = process.env.PLAYWRIGHT_MODULE || '/root/storage/musaned/node_modules/playwright';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function html({ title, am, url, stats }) {
  const cells = (stats || []).map(s => {
    const [big, small] = String(s).split('|');
    return `<div><b>${esc(big)}</b><span>${esc(small || '')}</span></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://bina.et/static/fonts/fonts.css?v=3">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#000;color:#fff;font-family:Geist,Inter,'Noto Sans Ethiopic',sans-serif;position:relative;overflow:hidden}
.flag{height:6px;background:linear-gradient(90deg,#078930 0 33.3%,#fcdd09 33.3% 66.6%,#da121a 66.6%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(#1f1f1f 1px,transparent 1px),linear-gradient(90deg,#1f1f1f 1px,transparent 1px);background-size:60px 60px;opacity:.5;
 mask-image:radial-gradient(ellipse 70% 70% at 30% 40%,#000 20%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse 70% 70% at 30% 40%,#000 20%,transparent 75%)}
.glow{position:absolute;left:-10%;top:-40%;width:900px;height:700px;background:radial-gradient(closest-side,rgba(16,185,129,.35),transparent),radial-gradient(closest-side at 70% 60%,rgba(59,130,246,.25),transparent);filter:blur(10px)}
.wrap{position:relative;padding:64px 72px;height:100%;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-size:26px;font-weight:700}
.mark{width:34px;height:34px;border-radius:9px;background:conic-gradient(from 200deg,#10b981,#3b82f6,#f472b6,#f5a524,#10b981);position:relative}
.mark:after{content:"";position:absolute;inset:6px;border-radius:5px;background:#000}
h1{margin-top:40px;font-size:${String(title).length > 46 ? 60 : 76}px;line-height:1.05;letter-spacing:-.045em;font-weight:800;max-width:17ch}
h1 span{background:linear-gradient(90deg,#fff,#9ca3af);-webkit-background-clip:text;background-clip:text;color:transparent}
.am{margin-top:20px;font-family:'Noto Sans Ethiopic',sans-serif;font-size:32px;font-weight:800;color:#34d399;max-width:26ch;line-height:1.3}
.row{margin-top:auto;display:flex;gap:44px;align-items:flex-end}
.row div b{display:block;font-size:38px;font-weight:800}
.row div span{color:#a1a1a1;font-size:17px}
.url{margin-left:auto;font-size:24px;color:#a1a1a1;font-family:'Geist Mono',monospace}
</style></head><body>
<div class="flag"></div><div class="grid"></div><div class="glow"></div>
<div class="wrap">
  <div class="brand"><span class="mark"></span>BinaSmart <span style="color:#6b6b6b;font-weight:500">AI</span></div>
  <h1><span>${esc(title)}</span></h1>
  ${am ? `<div class="am">${esc(am)}</div>` : ''}
  <div class="row">${cells}<div class="url">${esc(url || 'bina.et/ai')}</div></div>
</div></body></html>`;
}

async function shoot(spec, outAbs) {
  const { chromium } = require(CHROMIUM);
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
    await p.setContent(html(spec), { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    await p.screenshot({ path: outAbs });
  } finally { await b.close(); }
}

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i === -1 ? def : process.argv[i + 1]; }

(async () => {
  const listFile = path.join(__dirname, 'og-pages.json');
  const all = process.argv.includes('--all');
  const jobs = all
    ? JSON.parse(fs.readFileSync(listFile, 'utf8'))
    : [{ title: arg('title', 'BinaSmart AI'), am: arg('am', ''), url: arg('url', 'bina.et/ai'),
         stats: (arg('stats', '') || '').split(';').filter(Boolean), out: arg('out', 'public/og-ai.png') }];
  for (const j of jobs) {
    const outAbs = path.isAbsolute(j.out) ? j.out : path.join(ROOT, j.out);
    await shoot(j, outAbs);
    console.log('wrote ' + outAbs + ' (' + Math.round(fs.statSync(outAbs).size / 1024) + ' KB)');
  }
})().catch(e => { console.error(e.message); process.exit(1); });
