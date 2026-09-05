'use strict';
// Broken-link audit for bina.et: crawl the pages in the sitemap, collect every href/src, and check
// each unique URL once.
//
// Two lessons are baked in, both learned the hard way on the first run:
//   * One host at a time. Eight parallel requests to the same site earns a 403 from its rate
//     limiter, and a rate limit is not a broken link — the first run reported 159 dead links on a
//     site that answers 202 to a normal visitor.
//   * A quoted fragment inside an inline <script> is not a link. Skip anything that still carries a
//     quote or a JS concatenation, and skip the font hosts that only ever appear as <link
//     rel=preconnect> with no path.
//
//   node ops/link-audit.js            all sitemap pages (news posts sampled)
//   node ops/link-audit.js --all      every sitemap page, no sampling
//   node ops/link-audit.js --internal only bina.et links
const BASE = 'https://bina.et';
const ALL = process.argv.includes('--all');
const ONLY_INTERNAL = process.argv.includes('--internal');
// Identify ourselves honestly, but as a browser engine: several hosts serve a blank 403 to anything
// that does not look like one, which tells us nothing about whether the link works for a person.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 BinaSmartLinkAudit/1.1 (+https://bina.et)';
const HOST_GAP_MS = 900;   // minimum spacing between two requests to the same host

const get = async (url, method = 'GET') => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { method, redirect: 'manual', signal: c.signal, headers: { 'user-agent': UA, accept: '*/*' } });
    return { status: r.status, location: r.headers.get('location') || null };
  } catch (e) { return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
  finally { clearTimeout(t); }
};
const text = async url => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'user-agent': UA } }); return r.ok ? await r.text() : ''; }
  catch (e) { return ''; } finally { clearTimeout(t); }
};

// A href is only a link if it survives all of these.
const FONT_ROOTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$/;
function isRealLink(raw) {
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(raw)) return false;
  if (/['"`]/.test(raw)) return false;              // a fragment of an inline script, not a URL
  if (/\+|%20\+|\{\{|\$\{/.test(raw)) return false; // concatenation or a template placeholder
  return true;
}

(async () => {
  const sm = await text(BASE + '/sitemap.xml');
  let pages = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  if (!ALL) {
    const news = pages.filter(u => /\/news\//.test(u)), rest = pages.filter(u => !/\/news\//.test(u));
    pages = rest.concat(news.slice(0, 10));   // the news posts share one template
  }
  console.log('pages to crawl: ' + pages.length);

  const links = new Map();   // url -> Set(pages it appears on)
  let done = 0;
  for (const p of pages) {
    const html = await text(p);
    done++;
    if (done % 25 === 0) process.stdout.write('  crawled ' + done + '/' + pages.length + '\n');
    if (!html) { console.log('  !! could not fetch page: ' + p); continue; }
    for (const m of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
      const raw = m[1];
      if (!isRealLink(raw)) continue;
      let u;
      try { u = new URL(raw, p).toString(); } catch (e) { continue; }
      if (!/^https?:/.test(u)) continue;
      if (FONT_ROOTS.test(u)) continue;                     // <link rel=preconnect>, nothing to open
      if (ONLY_INTERNAL && !u.startsWith(BASE)) continue;
      u = u.replace(/#.*$/, '');
      if (!links.has(u)) links.set(u, new Set());
      links.get(u).add(p.replace(BASE, '') || '/');
    }
  }
  console.log('unique links found: ' + links.size);

  // Group by host so each host is checked by exactly one worker, spaced out. Different hosts still
  // run in parallel, so the whole audit stays about as fast as before.
  const byHost = new Map();
  for (const u of links.keys()) {
    const h = new URL(u).host;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(u);
  }
  const hosts = [...byHost.keys()];
  const bad = [], redirects = [], blocked = [];
  let checked = 0, hi = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await Promise.all(Array.from({ length: Math.min(10, hosts.length) }, async () => {
    while (hi < hosts.length) {
      const host = hosts[hi++];
      const list = byHost.get(host);
      // bina.et is ours: no need to be polite to our own server.
      const gap = host === 'bina.et' ? 0 : HOST_GAP_MS;
      for (const u of list) {
        const r = await get(u);
        checked++;
        const seen = links.get(u);
        const on = [...seen].slice(0, 3).join(', ') + (seen.size > 3 ? ' +' + (seen.size - 3) : '');
        if (r.status === 403 || r.status === 429) blocked.push({ u, status: r.status, on });
        else if (r.status >= 400 || r.status === 0) bad.push({ u, status: r.status || r.error, on });
        else if (r.status >= 300) redirects.push({ u, status: r.status, to: r.location, on });
        if ((checked % 50) === 0) process.stdout.write('  checked ' + checked + '/' + links.size + '\n');
        if (gap) await sleep(gap);
      }
    }
  }));

  const fmt = x => '  ' + String(x.status).padEnd(9) + x.u.replace(BASE, '') + (x.to ? '  ->  ' + x.to : '') + '\n      on: ' + x.on;
  console.log('\n=== BROKEN (' + bad.length + ') ===');
  bad.sort((a, b) => String(a.u).localeCompare(String(b.u))).forEach(x => console.log(fmt(x)));

  console.log('\n=== REFUSED THE CRAWLER — check by hand before believing (' + blocked.length + ') ===');
  const hostCount = {};
  blocked.forEach(x => { const h = new URL(x.u).host; hostCount[h] = (hostCount[h] || 0) + 1; });
  Object.entries(hostCount).forEach(([h, n]) => console.log('  ' + h + ' — ' + n + ' link(s)'));

  console.log('\n=== REDIRECTS (' + redirects.length + ') ===');
  redirects.forEach(x => console.log(fmt(x)));
  console.log('\nchecked ' + links.size + ' links on ' + pages.length + ' pages across ' + hosts.length
    + ' hosts: ' + bad.length + ' broken, ' + blocked.length + ' refused the crawler, ' + redirects.length + ' redirecting');
})();
