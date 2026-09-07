#!/usr/bin/env node
'use strict';
// BinaWatch live checker. Every 10 minutes (cron) for every tv/kids channel in watch/channels.json:
//   - is the broadcaster's own YouTube channel live right now, and which video is the stream?
//   - what are its latest uploads? (the public RSS feed: no API key, no quota)
// Writes watch/live-status.json, which /api/watch/live serves. Nothing here is scraped from third
// parties: it is the broadcaster's channel page and its feed, the same things a viewer's browser loads.
//
//   node watch/livecheck.js            check all
//   node watch/livecheck.js --quiet    for cron
const fs = require('fs');
const path = require('path');
const CH = path.join(__dirname, 'channels.json');
const OUT = path.join(__dirname, 'live-status.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const quiet = process.argv.includes('--quiet');
const log = (...a) => { if (!quiet) console.log(...a); };

async function get(url, ms) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try { const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: ctrl.signal, redirect: 'follow' }); return r.ok ? await r.text() : ''; }
  catch (e) { return ''; } finally { clearTimeout(t); }
}
function liveOf(html) {
  const live = /"isLive":true/.test(html);
  const vid = html.match(/"videoId":"([\w-]{11})"/);
  const title = html.match(/<meta name="title" content="([^"]*)"/);
  return { live, videoId: live && vid ? vid[1] : null, title: live && title ? title[1] : null };
}
function feedOf(xml) {
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = e.match(/<yt:videoId>([^<]+)/), t = e.match(/<title>([^<]*)/), p = e.match(/<published>([^<]+)/), v = e.match(/views="(\d+)"/);
    if (id && t) out.push({ id: id[1], title: t[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").slice(0, 120), published: p ? p[1].slice(0, 10) : null, views: v ? Number(v[1]) : null, thumb: 'https://i.ytimg.com/vi/' + id[1] + '/hqdefault.jpg' });
    if (out.length >= 8) break;
  }
  return out;
}
(async () => {
  const cfg = JSON.parse(fs.readFileSync(CH, 'utf8'));
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).channels || {}; } catch (e) {}
  const channels = {};
  const all = [].concat(cfg.tv.map(c => ({ ...c, kind: 'tv' })), cfg.kids.map(c => ({ ...c, kind: 'kids' })), cfg.radio.filter(c => c.yt).map(c => ({ ...c, kind: 'radio' })));
  for (const c of all) {
    const [liveHtml, xml] = await Promise.all([
      c.kind === 'radio' ? Promise.resolve('') : get('https://www.youtube.com/channel/' + c.yt + '/live'),
      get('https://www.youtube.com/feeds/videos.xml?channel_id=' + c.yt, 15000),
    ]);
    const lv = liveOf(liveHtml); const latest = feedOf(xml);
    const p = prev[c.id] || {};
    channels[c.id] = { kind: c.kind, live: lv.live, videoId: lv.videoId, liveTitle: lv.title, latest: latest.length ? latest : (p.latest || []), checkedAt: new Date().toISOString(), lastLiveAt: lv.live ? new Date().toISOString() : (p.lastLiveAt || null) };
    log((lv.live ? 'LIVE ' : 'off  ') + c.name.padEnd(20) + (lv.videoId || '-').padEnd(12) + ' latest:' + latest.length);
    await new Promise(r => setTimeout(r, 800));
  }
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), channels }));
  fs.renameSync(tmp, OUT);
  log('wrote ' + OUT + ' — ' + Object.values(channels).filter(c => c.live).length + ' live of ' + all.length);
})().catch(e => { console.error('livecheck failed: ' + e.message); process.exit(1); });
