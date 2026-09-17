'use strict';
// The rule: no full personal phone number enters the public repository. mols.gov.et publishes the manager's
// mobile for each of 1,222 licensed overseas employment agencies, and a register like that, committed to a
// public git repository, is a harvestable list rather than a page somebody has to visit. The number is not
// deleted - the last four digits stay, so a person holding it can still confirm an entry is theirs.
//
// These tests pin both halves: the function that masks, and the documents on disk. The second half is the
// one that matters, because a correct function and a stale file is exactly the failure this is guarding.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { maskPhones, header, bodyText } = require('../../ops/packs/fetch-pack.js');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'knowledge', 'business');
const reg = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
const B = '•';
const MASKED = new RegExp('251' + B + '{5}[0-9]{4}');
// A full Ethiopian mobile in international form: 251 then 9 or 7 then eight more digits.
const FULL_MOBILE = /(?<![0-9])\+?251[ -]?[79](?:[ -]?[0-9]){8}(?![0-9])/;

test('a mobile number is masked to its last four digits', () => {
  assert.equal(maskPhones('251900000001'), '251' + B.repeat(5) + '0001');
  assert.equal(maskPhones('251900000002'), '251' + B.repeat(5) + '0002');
  // Safaricom Ethiopia is 07x, so 2517 is a mobile too.
  assert.equal(maskPhones('251700000003'), '251' + B.repeat(5) + '0003');
});

test('a mobile written with separators is masked the same way', () => {
  assert.equal(maskPhones('Phone: +251-900-000-004'), 'Phone: 251' + B.repeat(5) + '0004');
  assert.equal(maskPhones('+251 900 000 005'), '251' + B.repeat(5) + '0005');
  assert.equal(maskPhones('+251900000006'), '251' + B.repeat(5) + '0006');
});

test('an office line and a short code are left exactly as the institution published them', () => {
  // Ethiopian landlines are 011, 022, 025, 033, 034, 046, 047, 057, 058: 251 then 1 to 5, never 9 or 7.
  for (const s of ['+251 11 551 8055', '+251-115571307', '251115515777', '+251-582206728',
                   '8482', '6333', '+251 116 179 900', '+251-11-551-4588']) {
    assert.equal(maskPhones(s), s, s + ' is an office line or a short code and must not be masked');
  }
});

test('the mask does not bite into a longer digit run', () => {
  // A 13-digit run is not a phone number, and half-masking one would corrupt a figure.
  assert.equal(maskPhones('2519000000012'), '2519000000012');
  assert.equal(maskPhones('1251900000001'), '1251900000001');
});

test('masking is idempotent, so a re-render cannot eat the number twice', () => {
  const once = maskPhones('251900000007');
  assert.equal(maskPhones(once), once);
});

test('a masked number keeps the last four digits of the original', () => {
  const src = 'Manager | 251900000008 | Saudi Arabia';
  const out = maskPhones(src);
  assert.ok(/251•{5}0008/.test(out), 'expected the real last four digits, got ' + out);
  assert.ok(out.startsWith('Manager | ') && out.endsWith(' | Saudi Arabia'),
    'the rest of the row must survive untouched, got ' + out);
  assert.ok(!FULL_MOBILE.test(out), 'no full mobile may survive');
});

test('the registry sets maskPhones on the sites that publish personal mobiles', () => {
  const on = (reg.sites || []).filter(s => s.maskPhones).map(s => s.id).sort();
  assert.deepEqual(on, ['eic', 'mols']);
  assert.ok(reg.pack.maskNoteEn && reg.pack.maskNoteAm, 'the pack must carry both note templates');
  assert.ok(/\{url\}/.test(reg.pack.maskNoteEn) && /\{url\}/.test(reg.pack.maskNoteAm),
    'both notes must point at the institution page, by url');
});

test('the note is rendered only for a page that actually holds a masked number', () => {
  const site = { name: 'Ministry of Labour and Skills', nameAm: 'የሥራና ክህሎት ሚኒስቴር', maskPhones: true };
  const page = { url: 'https://mols.gov.et/agencies/', path: '/agencies/', slug: 'agencies', lang: 'en',
    title: 'List of Oversees Employment Agencies', text: 'A | 251' + B.repeat(5) + '0742 | B' };
  const withNum = header(page, site, '2026-09-18', reg.pack, null);
  assert.ok(withNum.includes('Phone numbers on this page are masked'), 'the English note must be rendered');
  assert.ok(withNum.includes('ተሸፍነዋል'), 'the Amharic note must be rendered');
  assert.ok(withNum.indexOf('ተሸፍነዋል') < withNum.indexOf('Source: http'),
    'the note belongs before the Source paragraph, or bodyText() would read it back as page text');

  const clean = header({ ...page, text: 'A page with no phone number at all.' }, site, '2026-09-18', reg.pack, null);
  assert.ok(!clean.includes('Phone numbers on this page are masked'),
    'a page with nothing masked must not carry the note');

  const off = header(page, { ...site, maskPhones: false }, '2026-09-18', reg.pack, null);
  assert.ok(!off.includes('Phone numbers on this page are masked'), 'a site without the flag renders no note');
});

test('no committed business document holds a full personal mobile number', () => {
  const bad = [];
  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const line of raw.split('\n')) {
      const m = FULL_MOBILE.exec(line);
      if (m) bad.push(f + ': ' + m[0]);
    }
  }
  assert.deepEqual(bad, [], 'these documents still carry a full personal mobile number');
});

test('the agency register is masked and still names its agencies', () => {
  for (const f of ['mols-agencies.md', 'mols-agencies-part-2.md']) {
    const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
    const masked = (raw.match(new RegExp('251' + B + '{5}[0-9]{4}', 'g')) || []).length;
    assert.ok(masked > 300, f + ' should hold hundreds of masked numbers, holds ' + masked);
    assert.ok(MASKED.test(raw));
    assert.ok(raw.includes('https://mols.gov.et/agencies/'), f + ' must point at the ministry register');
    assert.ok(raw.includes('Phone numbers on this page are masked'), f + ' must carry the English note');
    assert.ok(raw.includes('ተሸፍነዋል'), f + ' must carry the Amharic note');
    // Masking the phone column must not have touched the rest of the row.
    assert.ok(/AKLID|MEDINA HUSSEN/.test(raw), f + ' must still name its agencies');
    // The note sits in the header area, so the page text read back by a re-render starts at the table.
    assert.ok(bodyText(raw) && !bodyText(raw).includes('Phone numbers on this page are masked'),
      f + ': the note must be header, not page text, or a re-render would duplicate it');
  }
});
