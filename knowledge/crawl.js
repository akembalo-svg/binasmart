#!/usr/bin/env node
'use strict';
// Weekly crawl of the official Ethiopian sources in knowledge/sources-am.json into knowledge/web/<id>/<hash>.md
// (front matter: url, title, fetched). knowledge/index.js reads that folder as source "web", so after
// `ingest.js --source web` the pages are searchable by Bini, the MCP and the writer skill, with their URL.
//   node knowledge/crawl.js [--only nbe,fayda] [--max 20]
// Polite: one host at a time, 1.5 s between requests, 12 s timeout, same-host links only, Amharic paths first,
// skips binaries, keeps pages with at least 400 chars of text. A site that times out is logged and skipped.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { htmlToText } = require('./index');

const REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources-am.json'), 'utf8')).sources;
const OUT = path.join(__dirname, 'web');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const maxOverride = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : 0;
// A browser UA: ethiopianreporter.com answers 403 to anything that says bot. We stay polite by pacing, not by the name.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Several .gov.et hosts serve incomplete TLS chains that browsers tolerate and Node rejects; this crawler only READS public pages.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, tries = 2) {
  for (let i = 0; i < tries; i++) { const r = await getOnce(url); if (r) return r; await sleep(2000); }
  return null;
}
async function getOnce(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': 'am,en;q=0.8' } });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/text\/html/.test(ct)) return null;
    return { url: r.url, html: await r.text() };
  } catch (e) { return null; } finally { clearTimeout(t); }
}
function links(html, base) {
  const out = new Set(); const host = new URL(base).host;
  const re = /href\s*=\s*["']([^"'#]+)["']/gi; let m;
  while ((m = re.exec(html))) {
    try { const u = new URL(m[1], base); if (u.host !== host || !/^https?:$/.test(u.protocol)) continue; if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|doc|docx|xls|xlsx|mp4|mp3|css|js)(\?|$)/i.test(u.pathname)) continue; u.hash = ''; out.add(u.toString()); } catch (e) { /* bad href */ }
  }
  return [...out].sort((a, b) => (/\/am\b|amh|amharic/.test(b) ? 1 : 0) - (/\/am\b|amh|amharic/.test(a) ? 1 : 0));
}
const titleOf = h => { const m = /<title>([\s\S]*?)<\/title>/i.exec(h); return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 140) : ''; };
const esc = s => String(s).replace(/"/g, '\\"');

(async () => {
  const report = [];
  for (const src of REG) {
    if (!src.crawl || (only && !only.includes(src.id))) continue;
    const dir = path.join(OUT, src.id); fs.mkdirSync(dir, { recursive: true });
    const max = maxOverride || src.maxPages || 30;
    const seen = new Set(); const queue = [src.am || src.url]; if (src.am) queue.push(src.url);
    let saved = 0, tried = 0;
    while (queue.length && saved < max && tried < max * 3) {
      const u = queue.shift(); if (seen.has(u)) continue; seen.add(u); tried++;
      const page = await get(u, u === src.url ? 3 : 2); await sleep(1500);
      if (!page) { if (u === src.url) break; continue; } // home unreachable: skip the whole site (a missing /am/ path is not fatal)
      const text = htmlToText(page.html);
      if (text.length >= 400) {
        const hash = crypto.createHash('sha1').update(page.url).digest('hex').slice(0, 12);
        const lang = /[ሀ-፿]/.test(text.slice(0, 600)) ? 'am' : 'en';
        const body = '---\nurl: "' + esc(page.url) + '"\ntitle: "' + esc(titleOf(page.html) || src.name) + '"\nsource_name: "' + esc(src.name) + '"\nlang: ' + lang + '\nfetched: ' + new Date().toISOString().slice(0, 10) + '\n---\n' + text.slice(0, 20000) + '\n';
        fs.writeFileSync(path.join(dir, hash + '.md'), body); saved++;
      }
      for (const l of links(page.html, page.url)) if (!seen.has(l) && queue.length < max * 4) queue.push(l);
    }
    report.push(src.id + ': ' + saved + ' pages' + (saved === 0 ? ' (unreachable or empty)' : ''));
    console.log('[crawl] ' + report[report.length - 1]);
  }
  fs.writeFileSync(path.join(OUT, 'last-run.txt'), new Date().toISOString() + '\n' + report.join('\n') + '\n');
})().catch(e => { console.error('[crawl] failed:', e.message); process.exit(1); });
