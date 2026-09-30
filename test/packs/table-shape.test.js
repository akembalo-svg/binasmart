'use strict';
// tableShape: a table the registry names is laid out from the page's HTML, rowspans and colspans in place, as the
// registry says it reads - two lists side by side, a header row over labelled rows, or labels with their values to
// the right. The case behind it is Dashen Bank (2026-09-23): its Import/Export requirement lists and its three
// account tiers are parallel lists, and tableRows paired "Tin Certificate" with the Export column and Amex Gold with
// the wrong tier. Every table, label and figure in this file is invented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

// A <td>, or { t, rs, cs } for a spanning one. Rows sit on lines of their own, cells one per line, as WordPress
// writes them, so htmlToText gives the flat one-cell-per-line form the pack holds today.
const td = c => (typeof c === 'string' ? '<td>' + c + '</td>'
  : '<td' + (c.rs ? ' rowspan="' + c.rs + '"' : '') + (c.cs ? ' colspan="' + c.cs + '"' : '') + '>' + c.t + '</td>');
const TABLE = rows => '<table><tbody>\n' + rows.map(r => '<tr>\n' + r.map(td).join('\n') + '\n</tr>').join('\n\n') + '\n</tbody></table>';
const PAGE = (...tables) => '<!DOCTYPE html><html><head><title>Loans | Example Bank</title></head><body><h2>Loans</h2>'
  + '<p>Our loans are described below.</p>\n' + tables.join('\n<p>Between the tables.</p>\n') + '\n<p>Ask at any branch.</p></body></html>';
const site = (rules, over = {}) => ({ id: 'x', name: 'Example Bank', host: 'bank.example.et', tableShape: rules, ...over });
// What the pack would write as the body: the page text as htmlToText reads it, with the named tables laid out.
function body(html, rules, pagePath = '/loans', over = {}) {
  const s = site(rules, over);
  const text = P.extract(html, { minChars: 1 }).text;
  return P.layoutBody({ text, tables: P.htmlTables(html, s, pagePath) }, s);
}
const tableOf = out => out.split('\n\n').filter(p => !/^(## Loans|Our loans|Between the tables|Ask at any branch)/.test(p)).join('\n\n');

const LISTS = TABLE([['Buy', 'Sell'], ['Form A', 'Form X'], ['<p>Licence</p>', ''], ['', '<p>Contract</p>'], ['Tax card', '']]);

test('parallel lists: one line per column, every item under its own header, empty cells left out', () => {
  const out = body(PAGE(LISTS), [{ shape: 'columns' }]);
  assert.equal(tableOf(out), 'Buy: Form A; Licence; Tax card\n\nSell: Form X; Contract');
  assert.ok(!/\|/.test(out), 'the flat cell-per-line form is gone');
  assert.ok(out.startsWith('## Loans\n\nOur loans are described below.\n\nBuy:'), 'the text around the table is as it was');
  assert.ok(out.endsWith('Contract\n\nAsk at any branch.'));
});

test('a comparison of tiers with no label column: each benefit stays with its tier, never with the tier beside it', () => {
  const tiers = TABLE([['Silver', 'Gold', 'Platinum'], ['Rate A', 'Rate B', 'Rate C'], ['Card S', 'Card G', 'Card P'], ['Gift', '', 'Lounge']]);
  const out = tableOf(body(PAGE(tiers), [{ first: 'Silver', shape: 'columns' }]));
  assert.equal(out, 'Silver: Rate A; Card S; Gift\n\nGold: Rate B; Card G\n\nPlatinum: Rate C; Card P; Lounge');
});

test('a row-label table: the header line and one line per row naming each value\'s column; an empty cell is never filled', () => {
  const plans = TABLE([['Plan', 'Fee', 'Term'], ['Basic', '10 birr', '1 year'], ['Plus', '', '2 years']]);
  const out = tableOf(body(PAGE(plans), [{ first: 'Plan', shape: 'rows' }]));
  assert.equal(out, 'Plan | Fee | Term\nBasic: Fee 10 birr; Term 1 year\nPlus: Term 2 years');
  // the same table through tableRows' own row format, so the two read alike
  assert.equal(out.split('\n')[1], 'Basic: Fee 10 birr; Term 1 year');
});

test('stacked header rows over spanning columns: every rate names its group and its column; a spanning value is written once', () => {
  const rates = TABLE([
    ['', { t: 'Rate', cs: 4 }],
    ['Kind', { t: 'Local', cs: 2 }, { t: 'Foreign', cs: 2 }],
    ['Share', '10%', '20%', '10%', '20%'],
    ['Home', '5', '4', '7', 'NA'],
    ['Car', '6', '', '8', '7.5'],
    ['', { t: 'Term', cs: 4 }],
    ['Home', { t: '9 years', cs: 4 }],
  ]);
  const out = tableOf(body(PAGE(rates), [{ first: '', shape: 'rows', headRows: [1, 2, 3, 6] }]));
  assert.equal(out, [
    'Rate', 'Kind | Local | Foreign', 'Share | 10% | 20% | 10% | 20%',
    'Home, Rate, Local: 10% 5; 20% 4', 'Home, Rate, Foreign: 10% 7; 20% NA',
    'Car, Rate, Local: 10% 6', 'Car, Rate, Foreign: 10% 8; 20% 7.5',
    'Term', 'Home: Term 9 years',
  ].join('\n'));
});

test('labels: a label spanning rows owns each of them, and a cell spanning rows inside it owns its own', () => {
  const loan = TABLE([
    [{ t: 'Amount', rs: 2 }, 'Minimum', { t: 'None', cs: 2 }],
    ['Maximum', { t: '80% of cost', cs: 2 }],
    [{ t: 'Features', rs: 2 }, { t: 'No collateral', cs: 3 }],
    [{ t: 'Long term', cs: 3 }],
    [{ t: 'Repay', rs: 2 }, { t: 'Tier A', cs: 2 }, 'ETB'],
    [{ t: 'Tier B', cs: 2 }, 'USD/ETB'],
    [{ t: 'Security', rs: 2 }, { t: 'Cash may count', rs: 2, cs: 2 }, 'Account kept here'],
    ['Employer blocks it'],
  ]);
  const out = tableOf(body(PAGE(loan), [{ first: 'Amount', shape: 'labels' }]));
  assert.equal(out, [
    'Amount: Minimum — None; Maximum — 80% of cost',
    'Features: No collateral; Long term',
    'Repay: Tier A — ETB; Tier B — USD/ETB',
    'Security: Cash may count — Account kept here / Employer blocks it',
  ].join('\n\n'));
});

test('labels with columnsUnder: two lists under one label are written as two lists, not paired by row', () => {
  const elig = TABLE([
    [{ t: 'Eligibility', rs: 4 }, 'Group A', 'Group B'],
    ['Item A1', 'Item B1'],
    ['Item A2', ''],
    ['', 'Item B2'],
    ['Collateral', { t: 'The house', cs: 2 }],
  ]);
  const out = tableOf(body(PAGE(elig), [{ first: 'Eligibility', shape: 'labels', columnsUnder: ['Eligibility'] }]));
  assert.equal(out, 'Eligibility — Group A: Item A1; Item A2\nEligibility — Group B: Item B1; Item B2\n\nCollateral: The house');
  assert.ok(!/Item A1 — Item B1/.test(out));
});

test('question and answer: an answer that is a list stays a list, and a question mark or colon is not doubled', () => {
  const faq = TABLE([['What is it?', 'A thing.'], ['Which kinds?', 'There are two:<ul><li>Red</li><li>Blue</li></ul>'], ['Fee:', 'None.']]);
  const out = tableOf(body(PAGE(faq), [{ shape: 'labels' }]));
  assert.equal(out, 'What is it? A thing.\n\nWhich kinds? There are two:\n- Red\n- Blue\n\nFee: None.');
});

test('a table no rule names, and a page no rule covers, are left exactly as htmlToText wrote them', () => {
  const html = PAGE(LISTS, TABLE([['Plan', 'Fee'], ['Basic', '10 birr']]));
  const flat = P.extract(html, { minChars: 1 }).text;
  assert.equal(body(html, [{ first: 'Nothing like it', shape: 'columns' }]), flat);
  assert.equal(body(html, [{ pages: '^/other$', shape: 'columns' }]), flat);
  const one = body(html, [{ first: 'Buy', shape: 'columns' }]);
  assert.ok(one.includes('Buy: Form A; Licence; Tax card'));
  assert.ok(one.includes('Plan |\nFee |\n\nBasic |\n10 birr |'), 'the unnamed table keeps its flat form');
});

test('the first rule that matches decides, and head matches the whole first row', () => {
  const html = PAGE(TABLE([['Eligibility', 'Group A', 'Group B'], ['', 'Item A1', 'Item B1']]), TABLE([['Eligibility', 'One list'], ['Also', 'Two']]));
  const rules = [{ head: 'Eligibility | Group A | Group B', shape: 'columns' }, { first: 'Eligibility', shape: 'labels' }];
  const out = body(html, rules);
  assert.ok(out.includes('Group A: Item A1\n\nGroup B: Item B1'));
  assert.ok(out.includes('Eligibility: One list\n\nAlso: Two'));
});

test('a table the grid cannot account for (a caption, a table inside a table) keeps its flat form', () => {
  const cap = '<table><caption>Fees</caption><tbody>\n<tr>\n<td>Buy</td>\n<td>Sell</td>\n</tr>\n\n<tr>\n<td>A</td>\n<td>B</td>\n</tr>\n</tbody></table>';
  const nest = '<table><tbody><tr><td>Outer</td><td><table><tr><td>In</td></tr></table></td></tr></tbody></table>';
  for (const t of [cap, nest]) {
    const html = PAGE(t);
    assert.equal(P.htmlTables(html, site([{ shape: 'columns' }]), '/loans').length, 0);
    assert.equal(body(html, [{ shape: 'columns' }]), P.extract(html, { minChars: 1 }).text);
  }
});

test('the layout is idempotent and needs no HTML the second time', () => {
  const html = PAGE(LISTS);
  const once = body(html, [{ shape: 'columns' }]);
  const s = site([{ shape: 'columns' }]);
  assert.equal(P.layoutBody({ text: once }, s), once, 'a --rerender (no HTML) writes it as it stands');
  assert.equal(P.shapeTables(once, P.htmlTables(html, s, '/loans'), s), once, 'the flat form is no longer there to replace');
});

test('a site without tableShape reads exactly as before', () => {
  const text = 'Plan |\nFee |\n\nBasic |\n10 birr |\n\nPlus |\n20 birr |';
  assert.equal(P.layoutBody({ text }, { id: 'y' }), text);
  assert.equal(P.layoutBody({ text }, { id: 'y', tableRows: true }), P.tableRows(text));
  assert.equal(P.layoutBody({ text, tables: [{ plain: 'Plan |', text: 'x' }] }, { id: 'y' }), text, 'tables are ignored unless the site names tableShape');
  assert.deepEqual(P.htmlTables(PAGE(LISTS), { id: 'y' }, '/loans'), []);
});

test('the mask applies to the laid-out table as it does to the rest of the page', () => {
  const num = '0' + '9' + '1'.repeat(8);   // an invented mobile, built here so no literal number sits in the file
  const html = PAGE(TABLE([['Office', 'Line'], ['Head office', num]]));
  const s = site([{ shape: 'rows' }], { maskPhones: true });
  const text = P.maskPhones(P.extract(html, { minChars: 1 }).text);
  const out = P.layoutBody({ text, tables: P.htmlTables(html, s, '/loans') }, s);
  assert.ok(out.includes('Head office: Line '), out);
  assert.ok(!out.includes(num));
  assert.ok(!/\|\n/.test(tableOf(out)));
});

test('a bad rule is refused rather than guessed at', () => {
  for (const bad of [{ shape: 'diagonal' }, { shape: 'rows', headRows: [0] }, { shape: 'labels', columnsUnder: 'x' }, null])
    assert.throws(() => P.htmlTables(PAGE(LISTS), site([bad]), '/loans'), /tableShape x refused/);
  assert.throws(() => P.htmlTables(PAGE(LISTS), site({ shape: 'rows' }), '/loans'), /a list of rules/);
});

// The weekly fetch and a --rerender: an unchanged page keeps its contentHash (the hash of the page as htmlToText
// wrote it) and its fetchedAt, and gets the layout as a re-render.
const pack = { id: 'banking', logPrefix: 'banking', headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}), fetched {today}.' };
const pageOf = (html, s) => ({ url: 'https://bank.example.et/loans/', path: '/loans', slug: 'x-loans', siteId: 'x', title: 'Loans', section: '',
  lang: 'en', text: P.extract(html, { minChars: 1 }).text, ...(s && s.tableShape ? { tables: P.htmlTables(html, s, '/loans') } : {}) });

test('writePack: the flat document of an unchanged page is re-rendered with the layout, hash and date kept; a re-render changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-shape-'));
  const html = PAGE(LISTS);
  const plainSite = { id: 'x', name: 'Example Bank', host: 'bank.example.et' };
  P.writePack(dir, [pageOf(html, plainSite)], plainSite, { today: '2026-09-16', pack });
  const before = fs.readFileSync(path.join(dir, 'x-loans.md'), 'utf8');
  const s = site([{ shape: 'columns' }]);
  const r = P.writePack(dir, [pageOf(html, s)], s, { today: '2026-09-23', pack });
  assert.deepEqual(r.unchanged, ['x-loans']);
  assert.deepEqual(r.reformatted, ['x-loans']);
  assert.deepEqual(r.changed, []);
  const after = fs.readFileSync(path.join(dir, 'x-loans.md'), 'utf8');
  assert.equal(P.readMeta(after).contentHash, P.readMeta(before).contentHash);
  assert.equal(P.readMeta(after).fetchedAt, '2026-09-16');
  assert.ok(P.bodyText(after).includes('Buy: Form A; Licence; Tax card\n\nSell: Form X; Contract'));
  const rr = P.rerenderPack(dir, { pack, sites: [s] });
  assert.equal(rr.rerendered.length, 0, 'a --rerender writes the same document');
  assert.equal(fs.readFileSync(path.join(dir, 'x-loans.md'), 'utf8'), after);
  const again = P.writePack(dir, [pageOf(html, s)], s, { today: '2026-09-30', pack });
  assert.deepEqual(again.reformatted, [], 'next week the page is unchanged and so is the document');
});

test('fetchSite reads the tables of a tableShape site from the HTML it fetched, and only there', async () => {
  const H = 'https://bank.example.et';
  const html = PAGE(LISTS) + '<p>' + 'padding sentence to clear the four hundred character floor. '.repeat(8) + '</p>';
  const map = { [H + '/sitemap.xml']: '<urlset><url><loc>' + H + '/loans</loc></url></urlset>', [H + '/loans']: html };
  const impl = async url => ({ status: map[url] ? 200 : 404, ok: !!map[url], headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => map[url] || '', arrayBuffer: async () => Buffer.from(map[url] || '') });
  const base = { id: 'x', name: 'Example Bank', host: 'bank.example.et', fetch: 'sitemap', sitemaps: [H + '/sitemap.xml'], allow: ['^/loans$'], maxPages: 5 };
  const withShape = await P.fetchSite({ ...base, tableShape: [{ shape: 'columns' }] }, { fetchImpl: impl, sleep: async () => {} });
  assert.equal(withShape.pages.length, 1);
  assert.equal(withShape.pages[0].tables.length, 1);
  assert.equal(withShape.pages[0].tables[0].text, 'Buy: Form A; Licence; Tax card\n\nSell: Form X; Contract');
  const without = await P.fetchSite(base, { fetchImpl: impl, sleep: async () => {} });
  assert.ok(!('tables' in without.pages[0]));
  assert.equal(without.pages[0].text, withShape.pages[0].text, 'the page text itself is not touched');
});
