#!/usr/bin/env node
'use strict';
// Build a share card from the post record itself, then render it.
//
//   node ops/og/card-from-post.js <slug>        one post
//   node ops/og/card-from-post.js --missing     every published post that has no card yet
//   node ops/og/card-from-post.js --missing --dry-run
//
// Everything on the card comes from the database: the Amharic title, the excerpt, the category, the
// hero emoji and the read time. Nothing is invented, because a share image travels on its own and a
// number made up to fill a space has no article around it to correct it.
//
// The date is deliberately absent. The hand-made cards carry an Ethiopian-calendar month, and
// converting Gregorian dates to it correctly is fiddly enough that a wrong month on a dozen public
// cards is a worse outcome than no month at all. Add one by hand if a particular card wants it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const ROOT = path.join(__dirname, '..', '..');
const WORK = path.join(os.homedir(), 'og-render');
const RENDER = path.join(ROOT, 'ops', 'og', 'render-card.sh');
const prisma = new PrismaClient();

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Ethiopian titles are written "question — answer" or "statement? detail". Break on whichever comes
// first so the second half can carry the accent colour; if neither is present the whole title is one
// line rather than being chopped mid-phrase.
function splitTitle(t) {
  const dash = t.indexOf('—');
  if (dash > 4) return [t.slice(0, dash).trim(), t.slice(dash + 1).trim()];
  const q = t.indexOf('?');
  if (q > 4 && q < t.length - 4) return [t.slice(0, q + 1).trim(), t.slice(q + 1).trim()];
  return [t.trim(), ''];
}

// Ethiopic glyphs are wide. Step the size down so a long title still fits two or three lines.
function headSize(t) {
  const n = t.length;
  if (n <= 34) return 57;
  if (n <= 46) return 50;
  if (n <= 60) return 44;
  return 39;
}

function buildHtml(post) {
  const titleAm = post.titleAm || post.title || post.slug;
  const [a, b] = splitTitle(titleAm);
  const fs_ = headSize(titleAm);
  let lede = (post.excerpt || '').trim();
  if (lede.length > 165) lede = lede.slice(0, 162).replace(/[\s,;]+\S*$/, '') + '…';

  return `<!doctype html>
<html lang="am"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Ethiopic:wght@600;800;900&family=Noto+Sans+Ethiopic:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{font-family:'Noto Sans Ethiopic','Noto Serif Ethiopic',system-ui,sans-serif;color:#141a24;position:relative;
    background:
      radial-gradient(900px 520px at 88% 6%, rgba(218,18,26,.10) 0%, transparent 62%),
      radial-gradient(700px 480px at 4% 98%, rgba(7,137,48,.08) 0%, transparent 62%),
      #fbfaf8;}
  .dots{position:absolute;inset:0;background-image:radial-gradient(rgba(20,26,36,.10) 1.1px, transparent 1.1px);
    background-size:26px 26px;opacity:.5}
  .wrap{position:absolute;inset:0;padding:44px 56px;display:flex;flex-direction:column}
  .mast{display:flex;align-items:center;justify-content:space-between}
  .brandrow{display:flex;align-items:center;gap:16px}
  .brand{font-family:'Noto Serif Ethiopic',serif;font-size:31px;font-weight:900;letter-spacing:-.5px}
  .brand .et{color:#078930}
  .brand .zena{color:#DA121A;margin-left:5px}
  .pill{background:#141a24;color:#fff;font-size:17px;font-weight:700;padding:7px 20px;border-radius:999px}
  .read{font-size:19px;color:#7b8494;font-weight:600}
  .rule{width:210px;height:3px;background:#141a24;margin:24px 0 30px}
  h1{font-family:'Noto Serif Ethiopic',serif;font-size:${fs_}px;font-weight:900;line-height:1.26;
     letter-spacing:-.5px;max-width:12.4em}
  h1 .hl{color:#DA121A}
  p.lede{margin-top:22px;font-size:22px;line-height:1.62;color:#4b5565;max-width:17.5em}
  .foot{margin-top:auto;display:flex;align-items:flex-end}
  .site{margin-left:auto;font-family:'Noto Serif Ethiopic',serif;font-size:21px;font-weight:800}
  .art{position:absolute;right:70px;top:47%;transform:translateY(-50%);font-size:224px;line-height:1;
    filter:drop-shadow(0 26px 46px rgba(20,26,36,.22))}
</style></head>
<body>
<div class="dots"></div>
<div class="wrap">
  <div class="mast">
    <div class="brandrow">
      <span class="brand">Bina<span class="et">.et</span><span class="zena">ዜና</span></span>
      <span class="pill">${esc(post.category)}</span>
    </div>
    <span class="read">${Number(post.readMinutes) || 4} ደቂቃ ንባብ</span>
  </div>
  <div class="rule"></div>
  <h1>${esc(a)}${b ? `<br><span class="hl">${esc(b)}</span>` : ''}</h1>
  ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
  <div class="foot"><span class="site">bina.et/news</span></div>
</div>
<div class="art">${esc(post.heroEmoji || '📰')}</div>
</body></html>`;
}

(async () => {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const wantMissing = args.includes('--missing');
  const slugs = args.filter(a => !a.startsWith('--'));

  let posts;
  if (wantMissing) {
    const all = await prisma.newsPost.findMany({ where: { published: true }, orderBy: { publishedAt: 'desc' } });
    posts = all.filter(x => !fs.existsSync(path.join(ROOT, 'public', 'og-' + x.slug + '.png')));
  } else if (slugs.length) {
    posts = await prisma.newsPost.findMany({ where: { slug: { in: slugs } } });
    const found = new Set(posts.map(p => p.slug));
    slugs.filter(s => !found.has(s)).forEach(s => console.error('  no such post: ' + s));
  } else {
    console.error('usage: card-from-post.js <slug>... | --missing [--dry-run]');
    process.exit(2);
  }

  if (!posts.length) { console.log('nothing to do — every published post already has a card'); return; }
  fs.mkdirSync(WORK, { recursive: true });
  console.log(posts.length + ' card(s)' + (dry ? '  (dry run — nothing written to public/)' : '') + '\n');

  let ok = 0, failed = [];
  for (const post of posts) {
    const file = path.join(WORK, post.slug + '.html');
    fs.writeFileSync(file, buildHtml(post), 'utf8');
    if (dry) { console.log('  ' + post.slug + '  -> ' + file); ok++; continue; }
    try {
      const out = execFileSync('bash', [RENDER, file, post.slug], { encoding: 'utf8' });
      const size = (out.match(/-> ([\d.]+ KB)/) || [])[1] || '?';
      console.log('  ✓ ' + post.slug.padEnd(44) + size);
      ok++;
    } catch (e) {
      console.log('  ✗ ' + post.slug + '  ' + (e.message || '').split('\n')[0]);
      failed.push(post.slug);
    }
  }
  console.log('\ndone: ' + ok + ' rendered' + (failed.length ? ', ' + failed.length + ' failed: ' + failed.join(', ') : ''));
})()
  .catch(e => { console.error(e.stack); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
