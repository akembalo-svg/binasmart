'use strict';
// The first thing a newly linked owner reads: what BinaSmart knows about their building and what is missing,
// in Amharic and English, with no tenant names and no model involved.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { healthMessage } = require('../../agents/owner/health-report');

const health = over => ({ buildings: [Object.assign({ building: 'Test Plaza', buildingAm: 'ቴስት ፕላዛ', units: 71, activeTenancies: 71,
  invoices: 71, invoicesPaid: 0, rentMonthsWithoutInvoices: ['2026-09', '2026-08'], expensesRecorded: 1, openRepairs: 2,
  contractsExpiredStillActive: 0, newestInvoice: '2026-07-05', newestPayment: null }, over)] });

test('it says what is recorded and what is missing, in both languages', () => {
  const m = healthMessage(health());
  assert.match(m, /ቴስት ፕላዛ/);
  assert.match(m, /71/);
  assert.match(m, /⚠️.*(2026-09, 2026-08)/);
  assert.match(m, /invoices/); assert.match(m, /ኢንቮይስ/);
  assert.match(m, /2026-07-05/);
  assert.match(m, /የለም · none|none/);
  assert.match(m, /\/bini/); assert.match(m, /\/logout/);
});

test('nothing missing means no warning lines', () => {
  const m = healthMessage(health({ invoicesPaid: 60, rentMonthsWithoutInvoices: [], expensesRecorded: 12, contractsExpiredStillActive: 0, newestPayment: '2026-09-07' }));
  assert.doesNotMatch(m, /⚠️/);
});

test('expired contracts are called out', () => {
  assert.match(healthMessage(health({ contractsExpiredStillActive: 14 })), /⚠️.*14/);
});

test('two buildings get two blocks', () => {
  const two = { buildings: [...health().buildings, ...health({ building: 'Second', buildingAm: null }).buildings] };
  const m = healthMessage(two);
  assert.equal((m.match(/🏢/g) || []).length, 2);
  assert.match(m, /Second/);
});

test('no result, or an error from the tools, gets a short apology instead of a broken message', () => {
  assert.match(healthMessage(null), /Sorry/);
  assert.match(healthMessage({ error: 'records unavailable' }), /Sorry/);
});
