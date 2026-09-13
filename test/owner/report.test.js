'use strict';
// The owner report reads the audit log and pm2 logs and prints numbers. Its parsing is pure and tested here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../ops/owner/report');

test('an owner question audit detail gives its channel and tools, never its text', () => {
  assert.deepEqual(R.parseQuestion('owner-telegram · rent_month,unpaid · How much did Abebe pay?'), { channel: 'owner-telegram', tools: ['rent_month', 'unpaid'] });
  assert.deepEqual(R.parseQuestion('owner-web · no tools · hello'), { channel: 'owner-web', tools: [] });
  assert.deepEqual(R.parseQuestion('garbage'), { channel: 'unknown', tools: [] });
});

test('log lines are counted and usage summed for the owner label only', () => {
  const lines = [
    '[bini] usage owner prompt=1200 completion=150',
    '[bini] usage owner prompt=800 completion=50',
    '[bini] usage owner prompt=undefined completion=undefined',
    '[bini] usage bini prompt=9999 completion=999',
    '[owner] dropped ungrounded 45,000 birr',
    '[owner] records unavailable: db down',
    '[owner] tool rent_month failed: boom',
    'owner failed',
    '[owner] audit failed: x',
    'unrelated line',
  ];
  const m = R.logMetrics(lines);
  assert.deepEqual(m, { usageCalls: 2, promptTokens: 2000, completionTokens: 200, droppedUngrounded: 1, recordsUnavailable: 1,
    toolFailed: 1, agentFailed: 1, auditFailed: 1 });
});

test('the report text carries no digits beyond counts, dates and token sums', () => {
  const text = R.format({ days: 1, buildings: [{ name: 'Test Plaza', on: true, owners: 2, staff: 0, activeLinks: 1,
    questions: { 'owner-web': 3, 'owner-telegram': 5 }, tools: { rent_month: 4 }, linked: 1, unlinked: 0 }],
    log: { usageCalls: 9, promptTokens: 10800, completionTokens: 900, droppedUngrounded: 0, recordsUnavailable: 0, toolFailed: 0, agentFailed: 0, auditFailed: 0 } });
  assert.match(text, /Test Plaza/);
  assert.match(text, /telegram 5/);
  assert.doesNotMatch(text, /09\d{8}|\+251/);
});
