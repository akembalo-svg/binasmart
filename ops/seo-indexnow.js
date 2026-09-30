#!/usr/bin/env node
'use strict';
// Tell Bing and Yandex that bina.et's pages exist.
//
// Found on 2026-09-12: the IndexNow key file was hosted and the endpoint accepted submissions, but
// the ONLY IndexNow code in the server was the route that serves the key. Nothing ever submitted a
// URL. 506 pages — 244 of them tenders, which is the freshest and most commercially useful content
// on the site — sat in a sitemap that no search engine had been told about, and a site: search for
// bina.et returned nothing at all.
//
// Runs after the tender autopublish (07:00 and 15:00), because a tender nobody can find is worth
// nothing to the company that posted it or the supplier looking for it.
//
// IndexNow reaches Bing, Yandex, Seznam and Naver — NOT Google. Google needs the sitemap submitted
// in Search Console, which needs the account owner.
const https = require('https');

const KEY = process.env.BINA_INDEXNOW_KEY || 'binasmart2026indexnow1784112792';
const HOST = 'bina.et';
const UA = 'Mozilla/5.0 (compatible; BinaSmart/1.0; +https://bina.et)';

const fetchText = url => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'User-Agent': UA }, timeout: 60000 }, res => {
    let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
  }).on('error', reject);
});

const submit = urlList => new Promise(resolve => {
  const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: 'https://' + HOST + '/' + KEY + '.txt', urlList });
  const req = https.request('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': UA },
    timeout: 60000,
  }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', e => resolve('ERR ' + e.message));
  req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
  req.write(body); req.end();
});

(async () => {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let xml;
  try { xml = await fetchText('https://' + HOST + '/sitemap.xml'); }
  catch (e) { console.error('[indexnow] ' + stamp + ' could not read the sitemap: ' + e.message); process.exit(1); }

  // Only what changed since the last run (IndexNow's own rule: submit added, updated and deleted URLs).
  // Until 28 Sep 2026 every run re-sent the whole sitemap (~5,000 URLs) twice a day; Bing crawled 585 pages in 8 days.
  const entries = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map(m => [m[1], m[2] || 'seen']);
  if (!entries.length) { console.error('[indexnow] ' + stamp + ' the sitemap returned NO urls - not submitting'); process.exit(1); }
  const fs = require('fs'), STATE = '/root/storage/seo/indexnow-state.json';
  let state = null; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) {}
  if (!state || process.argv.includes('--seed')) {   // first run: remember the sitemap as already announced (it was, on 28 Sep)
    fs.writeFileSync(STATE, JSON.stringify(Object.fromEntries(entries)));
    console.log('[indexnow] ' + stamp + ' state seeded with ' + entries.length + ' urls, nothing sent'); process.exit(0);
  }
  const now = new Map(entries);
  const urls = entries.filter(([u, k]) => state[u] !== k).map(([u]) => u).concat(Object.keys(state).filter(u => !now.has(u)));
  let ok = 0, bad = 0;
  for (let i = 0; i < urls.length; i += 200) {
    const batch = urls.slice(i, i + 200);
    const status = await submit(batch);
    // Logged loudly either way. A submission that fails silently is the reason this file exists.
    if (status === 200 || status === 202) { ok += batch.length; for (const u of batch) { if (now.has(u)) state[u] = now.get(u); else delete state[u]; } }
    else { bad += batch.length; console.error('[indexnow] ' + stamp + ' batch of ' + batch.length + ' FAILED: ' + status); }
    await new Promise(r => setTimeout(r, 2000));
  }
  fs.writeFileSync(STATE, JSON.stringify(state));
  console.log('[indexnow] ' + stamp + ' announced ' + ok + '/' + urls.length + ' changed urls (sitemap ' + entries.length + ')' + (bad ? ' · ' + bad + ' FAILED' : ''));
  process.exit(bad ? 1 : 0);
})();
