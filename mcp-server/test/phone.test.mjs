import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPhone, maskPhone } from '../lib/phone.mjs';

test('normPhone accepts the three Ethiopian forms', () => {
  assert.equal(normPhone('0911244344'), '+251911244344');
  assert.equal(normPhone('+251 911 244 344'), '+251911244344');
  assert.equal(normPhone('251911244344'), '+251911244344');
  assert.equal(normPhone('0711244344'), '+251711244344');
});

test('normPhone rejects short, foreign and empty', () => {
  assert.equal(normPhone('091124434'), null);
  assert.equal(normPhone('+254711244344'), null);
  assert.equal(normPhone(''), null);
  assert.equal(normPhone(undefined), null);
});

test('maskPhone keeps only the last 3 digits', () => {
  assert.equal(maskPhone('+251911244344'), '+251••••••344');
  assert.equal(maskPhone(null), '-');
});
