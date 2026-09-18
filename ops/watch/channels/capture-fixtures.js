'use strict';
// One-off fixture capture for the channel watch. Read-only: it fetches public pages and writes them
// verbatim under test/fixtures/watch/. 5 s between every request, one host at a time.
const fs = require('fs');
const path = require('path');
const UA = 'BinaSmart/1.0 (+https://bina.et; knowledge watch)';
const OUT = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'watch');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const JOBS = {
  previews: [
    ['tme-nbethiopia.html', 'https://t.me/s/nbethiopia'],
    ['tme-ethiopiancustomscommission.html', 'https://t.me/s/EthiopianCustomsCommission'],
    ['tme-ethio_telecom.html', 'https://t.me/s/ethio_telecom'],
    ['tme-fanatelevision.html', 'https://t.me/s/fanatelevision'],
    ['tme-m0h_ethiopia.html', 'https://t.me/s/M0H_EThiopia'],
    ['tme-wwwaddisababaeducationbureau.html', 'https://t.me/s/wwwAddisAbabaeducationbureau'],
    ['tme-missing-handle.html', 'https://t.me/s/binasmart_no_such_office_channel_2026'],
  ],
  feeds: [
    ['feed-fana-am.xml', 'https://www.fanamc.com/feed/'],
    ['feed-fana-en.xml', 'https://www.fanamc.com/english/feed/'],
    ['feed-reporter-am.xml', 'https://www.ethiopianreporter.com/feed/'],
    ['feed-reporter-en.xml', 'https://www.thereporterethiopia.com/feed/'],
    ['feed-addisfortune.xml', 'https://addisfortune.news/feed/'],
    ['feed-capital-blocked.html', 'https://capitalethiopia.com/feed/'],
    ['feed-presset-spa.html', 'https://www.press.et/feed/'],
  ],
};

(async () => {
  const which = process.argv[2] || 'previews';
  fs.mkdirSync(OUT, { recursive: true });
  let first = true;
  for (const [name, url] of JOBS[which]) {
    if (!first) await sleep(5000);
    first = false;
    const f = path.join(OUT, name);
    if (fs.existsSync(f)) { console.log('skip (exists) ' + name); continue; }
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'am,en;q=0.8', connection: 'keep-alive' },
        signal: AbortSignal.timeout(25000),
      });
      const body = await r.text();
      fs.writeFileSync(f, body);
      console.log(r.status + ' ' + body.length + ' bytes -> ' + name);
    } catch (e) {
      console.log('FAIL ' + name + ' ' + String(e.message || e).slice(0, 120));
    }
  }
})();
