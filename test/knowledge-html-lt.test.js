'use strict';
// htmlToText and a "<" that is text, not a tag. Until 2026-09-23 every "<...>" was dropped as a tag, so a page that
// writes a band as a raw "<td>< 100</td>" (telebirr's English tariff page does) lost the band and the cell after
// it: the row read "1 | 1 |" where the same page escaped as "&lt; 100" (the Amharic version) read "1 | < 100 | 1 |".
// A tag starts with a letter, "/", "!" or "?", as an HTML parser reads it. The figures below are invented.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { htmlToText } = require('../knowledge/index');

const row = cells => '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';

test('a raw "<" before a figure survives, with the cell after it', () => {
  const html = '<table><tbody>' + row(['1', '< 250', '3']) + row(['2', '251 to 900', '7']) + '</tbody></table>';
  assert.equal(htmlToText(html), '1 | < 250 | 3 |\n2 | 251 to 900 | 7 |');
});

test('the raw and the escaped form of one table read the same', () => {
  const raw = '<table>' + row(['1', '< 40', '2']) + '</table>';
  const esc = '<table>' + row(['1', '&lt; 40', '2']) + '</table>';
  assert.equal(htmlToText(raw), htmlToText(esc));
  assert.equal(htmlToText(esc), '1 | < 40 | 2 |');
});

test('"<" followed by a space, a digit or "=" is text; "<=" and "a < b > c" keep every character', () => {
  assert.equal(htmlToText('<p>limit <=5 units, x < y > z, love <3</p>'), 'limit <=5 units, x < y > z, love <3');
  assert.equal(htmlToText('<p>sales < 7M a year</p>'), 'sales < 7M a year');
});

test('real tags are still dropped: elements, end tags, doctype, comments, processing instructions', () => {
  assert.equal(htmlToText('<!DOCTYPE html><?xml version="1.0"?><div><span class="a">Fee</span> <b>9</b><!-- note --></div>'), 'Fee 9');
});

test('a broken end tag "</ span>" is dropped, as a browser drops it', () => {
  assert.equal(htmlToText('<p><span>Read More</ span></p>'), 'Read More');
});

test('escaped markup stays visible as text', () => {
  assert.equal(htmlToText('<p>type &lt;b&gt; for bold</p>'), 'type <b> for bold');
});
