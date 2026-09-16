'use strict';
// Every document in knowledge/banking, judged against the rules the pack promises. These are the rules that
// stop a knowledge pack becoming a pile of scraped HTML: every document names its source and its date, every
// document says what it is before it says anything else, no document contains a figure we wrote, and no
// document is a login page, an application form or an empty shell.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'knowledge', 'banking');
const reg = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md'));
const docs = files.map(f => {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const meta = {};
  if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
  return { file: f, slug: f.replace(/\.md$/, ''), meta, body: fm ? raw.slice(fm[0].length) : raw, raw };
});
const live = docs.filter(d => d.meta.status !== 'gone');
const hosts = new Set(reg.sites.filter(s => s.fetch !== 'manual').map(s => s.host));

test('the pack exists and is not thin', () => {
  assert.ok(docs.length >= 80, 'expected at least 80 documents, got ' + docs.length);
});

test('every document has front matter with a url, a title, a source, a language and two dates', () => {
  for (const d of docs) {
    assert.ok(/^https:\/\//.test(d.meta.url || ''), d.file + ' has no url');
    assert.ok((d.meta.title || '').length > 3, d.file + ' has no title');
    assert.ok((d.meta.source_name || '').length > 2, d.file + ' has no source_name');
    assert.ok(['en', 'am'].includes(d.meta.lang), d.file + ' lang: ' + d.meta.lang);
    assert.match(d.meta.fetchedAt || '', /^\d{4}-\d{2}-\d{2}$/, d.file + ' fetchedAt');
    assert.match(d.meta.lastChecked || '', /^\d{4}-\d{2}-\d{2}$/, d.file + ' lastChecked');
    assert.match(d.meta.contentHash || '', /^[0-9a-f]{40}$/, d.file + ' contentHash');
    assert.equal(d.meta.generated_by, 'ops/packs/fetch-pack.js --pack banking', d.file + ' generated_by');
  }
});

test('every url belongs to a host the registry names', () => {
  for (const d of docs) assert.ok(hosts.has(new URL(d.meta.url).hostname), d.file + ' is off-registry: ' + d.meta.url);
});

test('no document is an account, login or application page', () => {
  for (const d of docs) assert.equal(/\/(login|signin|register|apply|application-form|onlinebanking|my-account)\b/i.test(d.meta.url), false,
    d.file + ' looks like an account page: ' + d.meta.url);
});

test('every live document carries the dated honesty line, in both languages', () => {
  for (const d of live) {
    assert.ok(d.body.includes(reg.pack.disclaimerEn), d.file + ' is missing the English honesty line');
    assert.ok(d.body.includes(reg.pack.disclaimerAm), d.file + ' is missing the Amharic honesty line');
    assert.ok(d.body.includes('BinaSmart is not a bank'), d.file + ' is missing the not-a-bank line');
  }
});

test('every live document opens by saying what it is, in English and in Amharic', () => {
  for (const d of live) {
    const head = d.body.slice(0, 1400);
    assert.ok(head.includes(d.meta.source_name), d.file + ' does not name its institution up front');
    assert.ok(/[ሀ-፿]/.test(head), d.file + ' has no Amharic in its header');
    assert.ok(head.includes(d.meta.url), d.file + ' does not show its source url up front');
  }
});

test('the header states no figure of its own', () => {
  for (const d of live) {
    const paras = d.body.split('\n\n');
    const written = paras.slice(0, 4).join(' ').split(d.meta.url).join(' ').split(d.meta.fetchedAt).join(' ');
    const stripped = written.split(reg.pack.disclaimerEn).join(' ').split(reg.pack.disclaimerAm).join(' ');
    assert.equal(/\b\d+(\.\d+)?\s*(%|birr|etb|usd|kg)\b/i.test(stripped), false,
      d.file + ' states a figure in text we wrote: ' + stripped.slice(0, 200));
  }
});

test('no live document is a shell: at least 400 characters of the page itself', () => {
  for (const d of live) {
    const paras = d.body.split('\n\n');
    const text = paras.slice(4).join('\n\n').trim();
    assert.ok(text.length >= 400, d.file + ' has only ' + text.length + ' characters of page text');
  }
});

test('Zemen Amharic pages are recorded as Amharic and actually are', () => {
  const am = live.filter(d => d.meta.lang === 'am');
  assert.ok(am.length >= 8, 'expected at least eight Amharic documents, got ' + am.length);
  for (const d of am) {
    const eth = (d.body.match(/[ሀ-፿]/g) || []).length;
    assert.ok(eth > 300, d.file + ' is marked Amharic but holds only ' + eth + ' Ethiopic characters');
    assert.ok(d.body.includes('in Amharic'), d.file + ' header should say the page is in Amharic');
  }
});

test('every institution in the registry that can be fetched produced documents', () => {
  for (const s of reg.sites.filter(x => x.fetch !== 'manual')) {
    const n = docs.filter(d => d.meta.source_name === s.name).length;
    assert.ok(n >= 1, s.id + ' produced no documents at all');
  }
});

test('every filename says which institution the page came from', () => {
  const prefixes = reg.sites.filter(s => s.fetch !== 'manual').map(s => s.id + '-');
  for (const d of docs) assert.ok(prefixes.some(p => d.slug.startsWith(p)),
    d.file + ' does not start with a site id — two banks would collide on one filename');
});

test('no two documents are the same page', () => {
  const byUrl = new Map();
  for (const d of docs) {
    const u = d.meta.url.replace(/\/+$/, '');
    assert.equal(byUrl.has(u), false, 'two documents for ' + u + ': ' + byUrl.get(u) + ' and ' + d.file);
    byUrl.set(u, d.file);
  }
});

test('no document duplicates a page the crawler already holds', () => {
  const web = path.join(__dirname, '..', '..', 'knowledge', 'web');
  const crawled = new Set();
  for (const site of fs.existsSync(web) ? fs.readdirSync(web) : []) {
    const p = path.join(web, site);
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p).filter(x => x.endsWith('.md'))) {
      const m = /^url: "(.*?)"$/m.exec(fs.readFileSync(path.join(p, f), 'utf8'));
      if (m) crawled.add(m[1].replace(/\/+$/, ''));
    }
  }
  for (const d of docs) assert.equal(crawled.has(d.meta.url.replace(/\/+$/, '')), false,
    d.file + ' is already in knowledge/web as a crawled page: ' + d.meta.url);
});
