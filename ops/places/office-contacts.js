#!/usr/bin/env node
'use strict';
// Official contacts of Ethiopian federal and Addis Ababa offices, read from each office's OWN website.
//
//   node ops/places/office-contacts.js                  fetch every site, write /root/storage/offices/raw-<date>.json
//   node ops/places/office-contacts.js --only mols,ics  a few
//
// It records only what the office's page says, with the page address and the day it was read: phone numbers
// (landlines and short codes; a mobile number is never kept), e-mail addresses on the office's own domain,
// P.O. boxes, and the lines that carry an address. It does not guess a number, complete one, or take one from
// anywhere but the office's own site. A site that does not answer is recorded as not reached, not skipped.
// The output is raw material for a person to read; knowledge/places/ethiopia-government-contacts.md is written
// from it by ops/places/office-contacts-md.js only for entries that were read.
const fs = require('fs');
const path = require('path');

const OFFICES = require('./offices.json');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1].split(',') : null; })();
const UA = 'Mozilla/5.0 (compatible; BinaSmart-directory/1.0; +https://bina.et)';
const PATHS = ['', 'contact', 'contact-us', 'contactus', 'en/contact-us', 'en/contact', 'am/contact', 'contact.html', 'contact-us/', 'about-us'];

const MOBILE = /(?:\+?251[ -]?|\b0)[79](?:[ -]?\d){8}/g;
const PHONE = /(?:\+?251[\s\-.]?(?:\(0\)[\s\-.]?)?|\b0)[1-5](?:[\s\-.]?\d){8}\b/g;   // any grouping: id.gov.et writes +251 (0) 113 720 006
const SHORT = /(?:hotline|free ?call|call center|call centre|ነጻ የስልክ|ጥሪ ማዕከል|short ?code)[^0-9]{0,25}\b(\d{3,4})\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const POBOX = /(?:P\.?\s?O\.?\s?Box|ፖ\.?\s?ሣ\.?\s?ቁ|ፖ\.ሳ\.ቁ)[\s:.#-]{0,4}(\d{2,6})/gi;
const ADDR = /[^\n.]{0,80}(Addis Ababa|አዲስ አበባ|Sub[- ]?City|ክ\/ከተማ|ክፍለ ከተማ|Woreda|ወረዳ|Building|ሕንፃ|ህንፃ)[^\n.]{0,80}/gi;

const text = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|td|span)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');

async function get(url, ms = 20000, ua = UA) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': ua, accept: 'text/html' }, redirect: 'follow', signal: ctl.signal });
    const ct = r.headers.get('content-type') || '';
    // The Wayback Machine's raw copies (…id_/) keep the original gzip body without saying so: decompress by the
    // magic bytes, not by the header.
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = require('zlib').gunzipSync(buf); } catch (e) { /* leave as is */ } }
    const body = buf.toString('utf8');
    return { status: r.status, url: r.url, html: (/html|text|json/.test(ct) || /<html|<body/i.test(body.slice(0, 3000))) ? body : '' };
  } catch (e) { return { status: 0, url, html: '', err: e.name === 'AbortError' ? 'timeout' : e.message.slice(0, 80) }; }
  finally { clearTimeout(t); }
}

// The Internet Archive answers a burst with 503 "Temporarily Offline" (24 September 2026): archive requests
// wait and retry, and are spaced out.
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getArchive(url, ms) {
  for (let i = 0; i < 8; i++) {
    const r = await get(url, ms, 'BinaSmart-directory/1.0 (info@bina.et)');
    if (r.status === 200) { await sleep(3000); return r; }
    if (r.status && r.status !== 503 && r.status !== 429) return r;
    await sleep(10000 * (i + 1));
  }
  return { status: 0, url, html: '' };
}

const uniq = a => [...new Set(a.map(s => s.replace(/\s+/g, ' ').trim()))].filter(Boolean);
function extract(t, host) {
  const base = host.replace(/^www\./, '').split('.').slice(-3).join('.');
  const phones = uniq((t.match(PHONE) || []).filter(p => !/^(\+?251[ -]?|0)[79]/.test(p.replace(/[\s\-.()]/g, '').replace(/^\+?251/, '0'))));
  const shorts = uniq([...t.matchAll(SHORT)].map(m => m[1]));
  const emails = uniq((t.match(EMAIL) || []).filter(e => !/\.(png|jpe?g|gif|svg|webp)$/i.test(e)))
    .filter(e => { const d = e.split('@')[1].toLowerCase(); return d.endsWith('.gov.et') || d.endsWith('.et') || d.includes(base.split('.')[0]); });
  const boxes = uniq([...t.matchAll(POBOX)].map(m => m[1]));
  const addr = uniq((t.match(ADDR) || []).map(s => s.slice(0, 200))).slice(0, 6);
  const mobilesSeen = (t.match(MOBILE) || []).length;
  return { phones, shorts, emails, boxes, addr, mobilesSeen };
}

(async () => {
  const day = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const o of OFFICES.filter(o => !ONLY || ONLY.includes(o.id))) {
    const home = o.url.replace(/\/+$/, '') + '/';
    const pages = [];
    let reached = false, named = false;
    // A site counts as the office's only if its own pages carry the office's name: a guessed address that
    // lands on somebody else's site must not lend that site's numbers to the office.
    const GENERIC = /^(ministry|ethiopian?|addis|ababa|authority|service|services|bureau|administration|commission|city|federal|national|public|agency|and|the|of|for)$/i;
    const keys = [...o.en.split(/[^A-Za-z]+/).filter(w => w.length > 3 && !GENERIC.test(w)),
      ...o.am.split(/[\s()]+/).filter(w => w.length > 2 && !/^(የኢትዮጵያ|የአዲስ|አበባ|ሚኒስቴር|ባለሥልጣን|አገልግሎት|ቢሮ|ኮሚሽን|አስተዳደር|ከተማ)$/.test(w))];
    for (const p of PATHS) {
      const r = await get(home + p);
      if (r.status === 200 && r.html) {
        reached = true;
        const t = text(r.html);
        if (keys.some(k => t.toLowerCase().includes(k.toLowerCase()))) named = true;
        const x = extract(t, new URL(r.url).hostname);
        if (x.phones.length || x.emails.length || x.boxes.length || x.shorts.length) pages.push({ url: r.url, ...x });
      } else if (p === '' && !r.status) { pages.push({ url: home, err: r.err || 'no answer' }); break; }
    }
    // Many .gov.et sites do not answer outside Ethiopia (24 September 2026: 31 of 50 from our server). The
    // Wayback Machine keeps dated copies of the same official pages; the newest copy since 2024 of the home
    // page and of any contact page is read instead, and every entry says it came from that archived copy.
    let archived = null;
    const got = pages.some(p => (p.phones || []).length || (p.emails || []).length);
    if (!got || !named) {
      const host = new URL(home).hostname.replace(/^www\./, '');
      const cdx = await getArchive('http://web.archive.org/cdx/search/cdx?url=' + host + '/*&output=json&from=2024&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&limit=150', 90000);
      let rows = []; try { rows = JSON.parse(cdx.html || '[]').slice(1); } catch (e) { rows = []; }
      const pick = rows.filter(r => /contact|about|%E1%8A%A0%E1%8C%8D%E1%8A%99|\/$|^https?:\/\/(www\.)?[^/]+\/?$/i.test(r[2]))
        .sort((a, b) => (/contact/i.test(b[2]) - /contact/i.test(a[2])) || b[1].localeCompare(a[1])).slice(0, 4);
      for (const r of pick) {
        const snap = 'https://web.archive.org/web/' + r[1] + 'id_/' + r[2];
        const s = await getArchive(snap, 45000);
        if (s.status !== 200 || !s.html) continue;
        const t = text(s.html);
        if (keys.some(k => t.toLowerCase().includes(k.toLowerCase()))) named = true;
        const x = extract(t, host);
        if (x.phones.length || x.emails.length || x.boxes.length || x.shorts.length) {
          pages.push({ url: r[2], archivedAt: r[1].slice(0, 8), snapshot: snap, ...x });
          archived = archived && archived > r[1].slice(0, 8) ? archived : r[1].slice(0, 8);
        }
      }
    }
    const merged = { phones: uniq(pages.flatMap(p => p.phones || [])), shorts: uniq(pages.flatMap(p => p.shorts || [])),
      emails: uniq(pages.flatMap(p => p.emails || [])), boxes: uniq(pages.flatMap(p => p.boxes || [])), addr: uniq(pages.flatMap(p => p.addr || [])).slice(0, 6) };
    out.push({ ...o, read: day, reached, named, archived, pages: pages.map(p => ({ url: p.url, err: p.err, archivedAt: p.archivedAt, snapshot: p.snapshot })), ...merged });
    console.log((reached ? (named ? 'ok  ' : 'NAME?') : (archived ? 'ARCH' : 'DOWN')) + ' ' + o.id.padEnd(10) + ' tel ' + merged.phones.length + ' short ' + merged.shorts.length + ' mail ' + merged.emails.length + ' box ' + merged.boxes.length);
  }
  const dir = '/root/storage/offices'; fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'raw-' + day + (ONLY ? '-partial' : '') + '.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log('reached ' + out.filter(o => o.reached).length + ' of ' + out.length + ' → ' + f);
})();
