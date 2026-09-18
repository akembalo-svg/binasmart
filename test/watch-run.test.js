'use strict';
// The whole morning, end to end, against stubbed sources. The one behaviour that has to hold before the cron
// is installed: --dry-run reads everything and writes NOTHING — no document, no trigger, no status change, no
// message — and says exactly what it would have done.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, harvest } = require('../ops/watch/channels/run');

// The shape t.me/s/<handle> really answers with, reduced to what ops/watch/channels/preview.js reads.
const bubble = (handle, id, when, text, links = []) =>
  '<div class="tgme_widget_message_wrap js-widget_message_wrap">'
  + '<div class="tgme_widget_message js-widget_message" data-post="' + handle + '/' + id + '">'
  + '<div class="tgme_widget_message_text js-message_text">' + text
  + links.map(u => '<a href="' + u + '">' + u + '</a>').join('') + '</div>'
  + '<div class="tgme_widget_message_footer compact js-message_footer">'
  + '<span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/' + handle + '/' + id + '">'
  + '<time datetime="' + when + '" class="time"></time></a></span></div></div></div>';
const page = (handle, title, bubbles) =>
  '<html><head><title>' + title + '</title></head><body><section class="tgme_channel_history js-message_history">'
  + '<div class="tgme_channel_info_header_username"><a href="https://t.me/' + handle + '">@' + handle + '</a></div>'
  + '<div class="tgme_channel_info_header_title"><span dir="auto">' + title + '</span></div>'
  + bubbles.join('') + '</section></body></html>';
const EMPTY = '<html><head><title>Telegram</title></head><body>' + 'x'.repeat(9000) + '</body></html>';

const REG = { sources: [
  { id: 'nbe', office: 'nbe', kind: 'office', handle: '@nbethiopia', name: 'National Bank of Ethiopia', lang: 'en', pack: 'banking', active: true, verified: true },
  { id: 'ecc', office: 'ecc', kind: 'office', handle: '@EthiopianCustomsCommission', name: 'Ethiopian Customs Commission', lang: 'am', pack: null, active: true, verified: true },
  { id: 'ghost', office: 'moj', kind: 'office', handle: '@doesnotexist', name: 'A handle that answers 200 and is not a channel', lang: 'am', pack: null, active: true, verified: true },
  { id: 'dormant', office: 'motri', kind: 'office', handle: '@etrade_gov_et', name: 'dormant', lang: 'am', pack: null, active: false, verified: true },
  { id: 'unverified', office: 'ethiopianairlines', kind: 'office', handle: '@ethiopian_airlines', name: 'not linked from the airline site', lang: 'am', pack: null, active: true, verified: false },
] };

function sources(today) {
  return {
    'https://t.me/s/nbethiopia': page('nbethiopia', 'National Bank of Ethiopia', [
      bubble('nbethiopia', 412, today + 'T08:00:00+00:00', 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 28',
        ['https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf']),
      bubble('nbethiopia', 411, '2026-01-02T08:00:00+00:00', 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 1'),
      bubble('nbethiopia', 410, today + 'T07:00:00+00:00', 'The Governor met the ambassador of India to discuss bilateral cooperation and BRICS.'),
    ]),
    'https://t.me/s/EthiopianCustomsCommission': page('EthiopianCustomsCommission', 'Ethiopian Customs Commission', [
      bubble('EthiopianCustomsCommission', 205, today + 'T15:00:00+00:00',
        'ሁሉም የጉምሩክ ቅርንጫፍ ጽ/ቤቶች ከመስከረም 7 ቀን 2019 ዓ.ም እስከ መስከረም 30 ቀን 2019 ዓ.ም ድረስ እስከ ምሽቱ 1፡00 ሰዓት አገልግሎት ይሰጣሉ። ማስታወቂያ',
        ['https://ecc.gov.et/notice/working-hours']),
    ]),
    'https://t.me/s/doesnotexist': EMPTY,
    'https://t.me/s/ethiopian_airlines': page('ethiopian_airlines', 'Ethiopian Airlines', [bubble('ethiopian_airlines', 9, today + 'T09:00:00+00:00', 'ማስታወቂያ አዲስ በረራ')]),
  };
}

function stub(today, { onFetch } = {}) {
  const pages = sources(today);
  return async (url) => {
    if (onFetch) onFetch(url);
    if (/generativelanguage/.test(url)) throw new Error('the model must not be called in this test');
    const body = pages[String(url)];
    if (body === undefined) return { status: 404, text: async () => '' };
    return { status: 200, text: async () => body, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(8) };
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wrun-'));
const tmpRoot = () => { const r = tmp(); fs.mkdirSync(path.join(r, 'knowledge', 'watch'), { recursive: true }); return r; };
const TODAY = '2026-09-18';

test('a handle that answers 200 with no bubbles is dead, not quiet; an inactive or unverified one is not read', async () => {
  const asked = [];
  const h = await harvest({ registry: REG, today: TODAY, fetchImpl: stub(TODAY, { onFetch: u => asked.push(u) }), sleep: async () => {} });
  assert.deepEqual(asked, ['https://t.me/s/nbethiopia', 'https://t.me/s/EthiopianCustomsCommission', 'https://t.me/s/doesnotexist'],
    'the dormant handle and the unverified one are never asked for');
  assert.deepEqual(h.dead.map(d => d.id), ['ghost']);
  assert.match(h.dead[0].why, /no channel title and no dated post/);
  assert.equal(h.raw, 4);
  assert.equal(h.items.length, 3, 'the January post is outside the window');
});

test('a dry run reads everything and writes nothing at all', async () => {
  const root = tmpRoot();
  const triggerDir = tmp();
  const harvestRoot = tmp();
  try {
    const said = [];
    let sends = 0;
    const r = await run({ root, registry: REG, today: TODAY, dryRun: true, harvestRoot, triggerDir,
      fetchImpl: stub(TODAY), sleep: async () => {}, env: { WATCH_NO_MODEL: '1' },
      sendTg: async () => { sends++; return true; }, log: m => said.push(String(m)) });
    assert.equal(r.admitted, 2, 'the auction notice and the customs hours');
    assert.equal(r.excluded, 1, 'the governor and the ambassador');
    assert.equal(r.written.length, 2);
    assert.equal(sends, 0, 'nothing is sent');
    assert.deepEqual(fs.readdirSync(path.join(root, 'knowledge', 'watch')), [], 'no document is written');
    assert.deepEqual(fs.readdirSync(triggerDir), [], 'no pack is queued');
    assert.deepEqual(fs.readdirSync(harvestRoot), [], 'no document is fetched');
    const out = said.join('\n');
    assert.match(out, /\[DRY RUN — nothing is written, nothing is sent\]/);
    assert.match(out, /would write knowledge\/watch\/2026-09-18-nbe-[0-9a-f]{8}\.md/);
    assert.match(out, /would write knowledge\/watch\/2026-09-18-ecc-[0-9a-f]{8}\.md/);
    assert.match(out, /would fetch the document behind .*: https:\/\/nbe\.gov\.et/);
    assert.match(out, /would have sent:/);
    assert.match(r.note.text, /2 item\(s\) written to the watch/);
    // and the customs item takes its own end date, not ninety days
    assert.equal(r.written.find(w => w.meta.office === 'ecc').meta.expires_at, '2026-10-10');
    assert.equal(r.written.find(w => w.meta.office === 'nbe').meta.expires_at, '2026-12-17');
  } finally { for (const d of [root, triggerDir, harvestRoot]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('the real run writes one dated document per admitted item, queues the pack, and sends one note', async () => {
  const root = tmpRoot();
  const triggerDir = tmp();
  const harvestRoot = tmp();
  try {
    const sent = [];
    const r = await run({ root, registry: REG, today: TODAY, harvestRoot, triggerDir,
      fetchImpl: stub(TODAY), sleep: async () => {}, env: { WATCH_NO_MODEL: '1' },
      sendTg: async t => { sent.push(t); return true; }, log: () => {} });
    const files = fs.readdirSync(path.join(root, 'knowledge', 'watch')).sort();
    assert.equal(files.length, 2, files.join(', '));
    assert.ok(files.every(f => /^2026-09-18-(nbe|ecc)-[0-9a-f]{8}\.md$/.test(f)), files.join(', '));
    const nbe = fs.readFileSync(path.join(root, 'knowledge', 'watch', files.find(f => f.includes('-nbe-'))), 'utf8');
    assert.match(nbe, /reported_at: "2026-09-18"/);
    assert.match(nbe, /On 18 September 2026, the National Bank of Ethiopia announced:/);
    assert.deepEqual(fs.readdirSync(triggerDir), ['banking-refetch.json'], 'only the pack whose office announced a directive');
    assert.equal(sent.length, 1, 'one message, whatever is in it');
    assert.match(sent[0], /📣 Channel watch — 18 September 2026/);
    // a second run the same morning writes nothing again and says so
    const again = await run({ root, registry: REG, today: TODAY, harvestRoot, triggerDir,
      fetchImpl: stub(TODAY), sleep: async () => {}, env: { WATCH_NO_MODEL: '1' }, sendTg: async () => true, log: () => {} });
    assert.equal(again.written.length, 0);
    assert.equal(fs.readdirSync(path.join(root, 'knowledge', 'watch')).length, 2);
  } finally { for (const d of [root, triggerDir, harvestRoot]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('a quiet morning writes nothing and sends nothing', async () => {
  const root = tmpRoot();
  try {
    let sends = 0;
    const r = await run({ root, registry: { sources: [REG.sources[2]] }, today: TODAY,
      fetchImpl: stub(TODAY), sleep: async () => {}, env: { WATCH_NO_MODEL: '1' },
      sendTg: async () => { sends++; return true; }, log: () => {}, triggerDir: root, harvestRoot: root });
    assert.equal(r.written.length, 0);
    assert.equal(r.note.text, '');
    assert.equal(sends, 0, 'a morning with nothing to say says nothing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The first live dry run found ethio telecom and telebirr carrying the same six announcements within minutes
// of each other. One announcement is one document, whichever channel it also appeared on.
test('an announcement two channels both carry is read once', async () => {
  const same = 'ማስታወቂያ ⚠️ የጥንቃቄ መልእክት! በቴሌብር ግብይት ሲፈፅሙ ጥንቃቄ ማድረግዎን አይርሱ። የማጭበርበር ድርጊት ሲያጋጥም ጥቆማዎን ወደ 9090 ይላኩ።';
  const reg = { sources: [
    { id: 'ethiotelecom', office: 'ethiotelecom', kind: 'office', handle: '@ethio_telecom', name: 'ethio telecom', lang: 'am', pack: null, active: true, verified: true },
    { id: 'telebirr', office: 'telebirr', kind: 'office', handle: '@telebirr', name: 'telebirr', lang: 'am', pack: null, active: true, verified: true },
  ] };
  const pages = {
    'https://t.me/s/ethio_telecom': page('ethio_telecom', 'ethio telecom', [bubble('ethio_telecom', 11466, TODAY + 'T06:00:00+00:00', same)]),
    'https://t.me/s/telebirr': page('telebirr', 'telebirr', [bubble('telebirr', 8506, TODAY + 'T06:04:00+00:00', same)]),
  };
  const h = await harvest({ registry: reg, today: TODAY, sleep: async () => {},
    fetchImpl: async url => ({ status: 200, text: async () => pages[String(url)] || '' }) });
  assert.equal(h.raw, 2);
  assert.equal(h.duplicates, 1);
  assert.deepEqual(h.items.map(i => i.source.id), ['ethiotelecom'], 'the channel that said it first keeps it');
});

test('the sources are paced 5 s apart and nothing is asked for twice', async () => {
  const slept = [];
  const asked = [];
  await harvest({ registry: REG, today: TODAY, fetchImpl: stub(TODAY, { onFetch: u => asked.push(u) }), sleep: async ms => slept.push(ms) });
  assert.deepEqual(slept, [5000, 5000], 'no wait before the first, one between each pair');
  assert.equal(new Set(asked).size, asked.length);
});
