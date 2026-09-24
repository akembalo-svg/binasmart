'use strict';
// The @binasmart channel's two daily posts. Every job, tender and story below is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../ops/channel/digest');

const NOW = Date.UTC(2026, 8, 25, 4, 30);   // 07:30 Addis, Friday 25 September 2026 = Meskerem 15, 2019

test('the date is written the way an Addis reader says it', () => {
  assert.equal(D.ethLong(NOW), 'ዓርብ መስከረም 15 ቀን 2019 ዓ.ም');
  assert.equal(D.ethShort('2026-09-30T00:00:00Z'), 'መስከረም 20');
});

test('the morning post: new jobs from three employers, tenders closing soon, one story, buttons back to bina.et', () => {
  const t = D.morningText({ now: NOW, jobsNew: 94, jobsOpen: 4389, tendersOpen: 113,
    jobs: [{ title: 'Accountant', employer: 'Sample Trading PLC', deadline: new Date('2026-09-30T00:00:00Z') },
           { title: 'Drafts Man', employer: 'Sample Real Estate for fresh graduates', deadline: null }],
    closing: [{ title: 'Supply of <office> chairs', org: 'Sample Enterprise', deadline: new Date('2026-09-26T00:00:00Z') }],
    story: { title: 'አዲስ መመሪያ', url: 'https://bina.et/news/sample' }, tip: D.QA[0] });
  assert.match(t, /^☀️ <b>ቢና ጠዋት<\/b> · ዓርብ መስከረም 15 ቀን 2019 ዓ\.ም/);
  assert.match(t, /ዛሬ 94 አዲስ ሥራ<\/b> — ከ4,389 ክፍት ቦታዎች/);
  assert.match(t, /• Accountant — Sample Trading PLC \(እስከ መስከረም 20\)/);
  assert.match(t, /• Drafts Man — Sample Real Estate · ለአዲስ ምሩቃን/, 'the advert\'s "for fresh graduates" is said once, in Amharic');
  assert.match(t, /Supply of &lt;office&gt; chairs/, 'listing text is escaped for Telegram HTML');
  assert.match(t, /📰 አዲስ መመሪያ\nhttps:\/\/bina\.et\/news\/sample/);
  assert.doesNotMatch(t, /የዛሬ ጥቆማ/, 'a story takes the place of the tip');
  const noStory = D.morningText({ now: NOW, jobsNew: 0, jobsOpen: 10, tendersOpen: 0, jobs: [], closing: [], story: null, tip: D.QA[0] });
  assert.match(noStory, /💡 <b>የዛሬ ጥቆማ፦<\/b>/);
  const urls = D.morningButtons().flat().map(b => b.url);
  assert.deepEqual(urls, ['https://bina.et/jobs', 'https://bina.et/tenders', 'https://bina.et/jobs/alert/all', 'https://bina.et/go']);
  assert.ok(t.length < 1500, 'short enough to read on a phone');
});

test('the evening post answers one question with its source and sends the reader to Bini and the guide', () => {
  const qa = D.QA[0];
  const t = D.eveningText(qa);
  assert.match(t, /^💬 <b>ቢኒ መለሰ<\/b>/);
  assert.ok(t.includes('❓ «' + qa.q + '»') && t.includes('📌 ምንጭ፦ '));
  const [row1, row2] = D.eveningButtons(qa);
  assert.ok(row1[0].url.startsWith('https://bina.et/go?q=') && row1[1].url === qa.page);
  assert.ok(row2[0].url.startsWith('https://t.me/share/url?url='));
});

test('every answer names a source and a bina.et guide, and the morning tip is never the evening answer', () => {
  for (const x of D.QA) {
    assert.ok(x.q && x.a && x.tip && x.source, JSON.stringify(x).slice(0, 60));
    assert.match(x.page, /^https:\/\/bina\.et\/[a-z0-9-]+$/);
  }
  for (let d = 0; d < 20; d++) {
    const now = NOW + d * 86400000;
    assert.notEqual(D.qaFor(now, 'morning'), D.qaFor(now, 'evening'));
  }
});

test('on Mondays only, the morning post tells companies they can add their own address', () => {
  const base = { jobsNew: 0, jobsOpen: 10, tendersOpen: 0, jobs: [], closing: [], story: null, tip: D.QA[0] };
  const monday = Date.UTC(2026, 8, 28, 4, 30);        // 07:30 Addis, Monday 28 September 2026
  assert.match(D.morningText({ ...base, now: monday }), /ድርጅትዎ በቢና ላይ አለ\?[\s\S]*bina\.et\/employers/);
  assert.doesNotMatch(D.morningText({ ...base, now: NOW }), /bina\.et\/employers/, 'Friday: no company line');
});
