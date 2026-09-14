'use strict';
// The two avatars are drawn for BinaSmart as plain SVG: self-contained, no script, no outside reference, small,
// and with a title so a screen reader has a name.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

for (const [file, name] of [['afiya.svg', 'Dr Afiya'], ['asmat.svg', 'Asmat']]) {
  test(file + ' is a small, safe, self-contained SVG', () => {
    const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'agents', file), 'utf8');
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"'));
    assert.ok(svg.trim().endsWith('</svg>'));
    assert.ok(svg.includes('<title id="' + file.replace('.svg', '') + '-t">' + name + '</title>'));
    assert.equal(/<script|\bon[a-z]+=|href=|<image|<foreignObject|@import|url\((?!#)/i.test(svg), false, 'no script, handlers or outside references');
    assert.equal((svg.match(/<[a-zA-Z]/g) || []).length, (svg.match(/<\/[a-zA-Z]+>|\/>/g) || []).length, 'every element is closed');
    assert.ok(Buffer.byteLength(svg) < 3000, Buffer.byteLength(svg) + ' bytes');
  });
}
