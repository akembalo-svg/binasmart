'use strict';
// One admitted item becomes one dated document under knowledge/watch/.
//
// The rule the whole source depends on: a watch document must be unmistakable for the law. Its first sentence
// names who announced it, on what day, and where it was reported, in the document's own language — so that
// even lifted out of context it reads as "the customs commission announced" and never as "the rule is".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { watchDoc, writeWatchDoc } = require('../../ops/watch/channels/write');

// exactly the reader knowledge/index.js and ops/packs/fetch-pack.js use
const FM = /^---\n([\s\S]*?)\n---\n/;
const KEY = /^(\w+):\s*"?(.*?)"?\s*$/;
function frontMatter(raw) {
  const fm = FM.exec(raw);
  assert.ok(fm, 'no front matter');
  const meta = {};
  for (const line of fm[1].split('\n')) { const m = KEY.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
  return { meta, body: raw.slice(fm[0].length) };
}

const CUSTOMS = {
  post: {
    id: 205,
    url: 'https://t.me/EthiopianCustomsCommission/205',
    channel: '@EthiopianCustomsCommission',
    at: '2026-09-17T11:02:00.000Z',
    date: '2026-09-17',
    lang: 'am',
    text: 'ማስታወቂያ ለክቡራን ደንበኞቻችን በሙሉ ! የኢትዮጵያ ጉምሩክ ኮሚሽን የአገልግሎት ተደራሽነቱን ለማስፋት ከዛሬ ከመስከረም 7 ቀን 2019 ዓ.ም እስከ መስከረም 30 ቀን 2019 ዓ.ም ከሰኞ እስከ አርብ እስከ ምሽቱ 1:00 ሰዓት ይሰራል።',
    links: [],
  },
  source: { id: 'ecc', office: 'ecc', kind: 'office', name: 'Ethiopian Customs Commission', handle: '@EthiopianCustomsCommission' },
  label: 'pack-grade',
};
const NBE = {
  post: {
    id: 632, url: 'https://t.me/nbethiopia/632', channel: '@nbethiopia', at: '2026-08-28T09:00:00.000Z',
    date: '2026-08-28', lang: 'en', text: 'PUBLIC AWARENESS NOTICE ON ILLEGAL HAWALA AND UNAUTHORIZED REMITTANCE OPERATORS', links: [],
  },
  source: { id: 'nbe', office: 'nbe', kind: 'office', name: 'National Bank of Ethiopia', handle: '@nbethiopia' },
  label: 'pack-grade',
};

test('the front matter is exactly the design is keys, and every key is a bare word', () => {
  const d = watchDoc(CUSTOMS, { today: '2026-09-18' });
  const { meta } = frontMatter(d.text);
  assert.deepEqual(Object.keys(meta).sort(), ['channel', 'expires_at', 'fetchedAt', 'lastChecked', 'lang', 'office', 'reported_at', 'reported_by', 'source_name', 'status', 'title', 'url'].sort());
  for (const k of Object.keys(meta)) assert.match(k, /^\w+$/, k + ' is not a bare word');
  assert.equal(meta.url, 'https://t.me/EthiopianCustomsCommission/205');
  assert.equal(meta.office, 'ecc');
  assert.equal(meta.reported_by, 'Ethiopian Customs Commission');
  assert.equal(meta.channel, '@EthiopianCustomsCommission');
  assert.equal(meta.reported_at, '2026-09-17');
  assert.equal(meta.status, 'live');
  assert.equal(meta.lang, 'am');
  assert.equal(meta.fetchedAt, '2026-09-18');
  assert.equal(meta.lastChecked, '2026-09-18');
});

test('the file is named for the day it was reported, its office and a hash of its address', () => {
  const d = watchDoc(CUSTOMS, { today: '2026-09-18' });
  assert.match(d.name, /^2026-09-17-ecc-[0-9a-f]{8}\.md$/);
  assert.equal(d.dir, path.join('knowledge', 'watch'));
  // the same item twice is the same file, so a second run overwrites rather than duplicates
  assert.equal(watchDoc(CUSTOMS, { today: '2026-09-19' }).name, d.name);
});

test('expires_at defaults to ninety days after the day it was reported', () => {
  const { meta } = frontMatter(watchDoc(NBE, { today: '2026-09-18' }).text);
  assert.equal(meta.reported_at, '2026-08-28');
  assert.equal(meta.expires_at, '2026-11-26');
  const named = watchDoc(CUSTOMS, { today: '2026-09-18', expiresAt: '2026-10-10' });
  assert.equal(frontMatter(named.text).meta.expires_at, '2026-10-10');
});

test('the first sentence names the office, the day and the channel, in the document is own language', () => {
  const am = frontMatter(watchDoc(CUSTOMS, { today: '2026-09-18' }).text).body.trim();
  const first = am.split('\n')[0];
  assert.ok(first.includes('ጉምሩክ ኮሚሽን'), 'the office is named in Amharic: ' + first);
  assert.ok(first.includes('@EthiopianCustomsCommission'), first);
  assert.ok(first.includes('እ.ኤ.አ.'), 'a Gregorian date is marked as one: ' + first);
  assert.ok(first.includes('2026'), first);

  const en = frontMatter(watchDoc(NBE, { today: '2026-09-18' }).text).body.trim();
  const line = en.split('\n')[0];
  assert.match(line, /^On 28 August 2026, the National Bank of Ethiopia announced: "/);
  assert.ok(line.includes('as reported by its official Telegram channel @nbethiopia'), line);
});

test('it never says the law is, in either language', () => {
  for (const item of [CUSTOMS, NBE]) {
    const body = watchDoc(item, { today: '2026-09-18' }).text;
    assert.ok(!/\b(the law|the rule|the regulation)\s+(is|says|states)\b/i.test(body), body.slice(0, 200));
    assert.ok(!body.includes('ሕጉ ይላል'), 'never speaks as the statute');
    assert.ok(!body.includes('ደንቡ ይላል'));
  }
});

test('the post text is kept verbatim under the provenance sentence, with its address', () => {
  const { body } = frontMatter(watchDoc(CUSTOMS, { today: '2026-09-18' }).text);
  assert.ok(body.includes(CUSTOMS.post.text), 'the office is own words are kept');
  assert.ok(body.includes('https://t.me/EthiopianCustomsCommission/205'));
});

test('no document is written without a reported_at', () => {
  const bad = { ...CUSTOMS, post: { ...CUSTOMS.post, date: '', at: '' } };
  assert.throws(() => watchDoc(bad, { today: '2026-09-18' }), /reported_at/);
});

test('writeWatchDoc puts the file under knowledge/watch and reads back through the same regex', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  const w = writeWatchDoc(CUSTOMS, { root, today: '2026-09-18' });
  const raw = fs.readFileSync(w.file, 'utf8');
  assert.equal(w.file, path.join(root, 'knowledge', 'watch', w.name));
  const { meta } = frontMatter(raw);
  assert.equal(meta.reported_at, '2026-09-17');
  assert.equal(meta.title.length > 0, true);
  fs.rmSync(root, { recursive: true, force: true });
});
