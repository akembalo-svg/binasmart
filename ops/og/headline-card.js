#!/usr/bin/env node
'use strict';
// The daily headline round-up card, in the Ethiopian colours.
//
//   node ops/og/headline-card.js items.json [--out /root/charts/headlines-am.png] [--date "መስከረም 19 ቀን 2019 ዓ.ም"]
//
// items.json:
//   [ { "cat": "ግንባታና ቱሪዝም", "icon": "🏗️", "items": [ { "t": "…", "src": "ፋና" }, … ] }, … ]
//
// Ibrahim settled this design on 29 Sep 2026 ("better than all of them") after a first attempt that used
// the flag only as a hairline at the top. What he meant by "our colour" was the Ethiopian green, yellow
// and red carrying the page — a green masthead, the yellow/red ribbon beneath it, number badges cycling
// through the three, and the three again along the foot. Keep that; it is the brand, not decoration.
//
// Every headline is credited to the outlet it came from, in a tag, because this is a pointer to their
// reporting rather than ours.
const fs = require('fs');
const { execFileSync } = require('child_process');

const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const SRC = process.argv[2];
const OUT = arg('--out') || '/root/charts/headlines-am.png';
const TPL = '/root/charts/templates/headline-card.tpl.html';
const BADGE = ['#078930', '#c9a800', '#DA121A'];   // green, yellow, red — cycled per item
const BAR = ['#078930', '#DA121A', '#c9a800'];     // per category

if (!SRC) { console.error('usage: headline-card.js <items.json> [--out file.png] [--date "…"]'); process.exit(2); }
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const groups = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let n = 0;
const html = groups.map((g, gi) => {
  const items = g.items.map(it => {
    const colour = BADGE[n % BADGE.length]; n++;
    return `<div class="item"><div class="n" style="background:${colour}">${n}</div>` +
           `<div class="t">${esc(it.t)}<br><span class="src">${esc(it.src)}</span></div></div>`;
  }).join('\n  ');
  return `<div class="grp">\n  <div class="cat"><span class="bar" style="background:${BAR[gi % BAR.length]}"></span>` +
         `<i>${esc(g.icon || '📰')}</i><b>${esc(g.cat)}</b><span class="line"></span></div>\n  ${items}\n </div>`;
}).join('\n ');

// Height grows with the content: a fixed box either clips the last item or leaves a lake of cream.
const height = 300 + groups.length * 78 + n * 96;

let tpl = fs.readFileSync(TPL, 'utf8');
tpl = tpl.replace(/<div class="body">[\s\S]*?<\/div>\n\n<div class="foot">/, '<div class="body">\n ' + html + '\n</div>\n\n<div class="foot">');
tpl = tpl.replace(/height:780px/g, 'height:' + height + 'px');
if (arg('--date')) tpl = tpl.replace(/<div class="date">[^<]*<\/div>/, '<div class="date">' + esc(arg('--date')) + '</div>');

const work = process.env.HOME + '/og-render';
fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(work + '/hc.html', tpl);
execFileSync('chromium-browser', ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1080,' + height,
  '--screenshot=' + work + '/hc.png', '--virtual-time-budget=9000', 'file://' + work + '/hc.html'],
  { stdio: 'ignore' });
if (!fs.existsSync(work + '/hc.png')) { console.error('render produced nothing'); process.exit(1); }
fs.copyFileSync(work + '/hc.png', OUT);
console.log('wrote ' + OUT + '  1080x' + height + '  ' + n + ' headlines in ' + groups.length + ' groups');
console.log('LOOK AT IT before sending — a long headline can still push a group tight.');
