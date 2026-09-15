'use strict';
// The records the delivery layer writes (design §1.5). No phone number is ever copied into them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const model = name => { const m = schema.match(new RegExp('model ' + name + ' \\{([\\s\\S]*?)\\n\\}')); assert.ok(m, name + ' missing'); return m[1]; };
const has = (body, f) => assert.match(body, new RegExp('\\n\\s+' + f + '\\s'), f);

test('OutboundBatch, OutboundMessage and InvoiceLink carry what the delivery layer writes, and no phone', () => {
  for (const f of ['id', 'buildingId', 'kind', 'source', 'actor', 'text', 'total', 'createdAt']) has(model('OutboundBatch'), f);
  for (const f of ['batchId', 'buildingId', 'tenancyId', 'userId', 'invoiceId', 'kind', 'channel', 'status', 'smsParts', 'providerId', 'errorKind', 'createdAt', 'updatedAt']) has(model('OutboundMessage'), f);
  for (const f of ['token', 'invoiceId', 'kind', 'expiresAt']) has(model('InvoiceLink'), f);
  assert.match(model('InvoiceLink'), /token\s+String\s+@unique/);
  for (const m of ['OutboundBatch', 'OutboundMessage', 'InvoiceLink']) assert.doesNotMatch(model(m), /phone/i, m);
});

test('Building gets a monthly SMS limit of 500 by default and an optional sender, and the SQL files cover every change', () => {
  assert.match(model('Building'), /smsMonthlyLimit\s+Int\s+@default\(500\)/);
  assert.match(model('Building'), /smsSender\s+String\?/);
  const up = fs.readFileSync(path.join(ROOT, 'prisma', 'sql', '20260915_outbound_messages.up.sql'), 'utf8');
  for (const t of ['"OutboundBatch"', '"OutboundMessage"', '"InvoiceLink"', '"smsMonthlyLimit"', '"smsSender"', '"InvoiceLink_token_key"', '"OutboundMessage_batchId_fkey"'])
    assert.ok(up.includes(t), t);
  const down = fs.readFileSync(path.join(ROOT, 'prisma', 'sql', '20260915_outbound_messages.down.sql'), 'utf8');
  for (const t of ['DROP TABLE IF EXISTS "OutboundMessage"', 'DROP TABLE IF EXISTS "OutboundBatch"', 'DROP TABLE IF EXISTS "InvoiceLink"', 'DROP COLUMN IF EXISTS "smsMonthlyLimit"'])
    assert.ok(down.includes(t), t);
});
