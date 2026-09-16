'use strict';
// The table a prepared action waits in, and the SQL that creates and reverses it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');

test('the pending-action table stores ids, units and amounts — never a phone number', () => {
  const at = schema.indexOf('model OwnerAction {');
  assert.ok(at > 0, 'model OwnerAction is missing');
  const model = schema.slice(at, schema.indexOf('\n}', at));
  for (const field of ['id           String    @id', 'buildingId', 'kind', 'status', 'channel', 'preparedBy', 'preparedRole', 'preparedTg',
    'args         Json', 'payload      Json', 'text', 'cardText', 'fingerprint', 'bulk', 'urgent', 'cards', 'confirmedBy', 'confirmedAt',
    'result', 'expiresAt', 'createdAt', 'updatedAt'])
    assert.ok(model.includes(field), 'OwnerAction is missing ' + field);
  assert.equal(/phone/i.test(model), false, 'no phone number belongs in this table');
  assert.match(model, /@@index\(\[status, expiresAt\]\)/);
  assert.match(model, /@@index\(\[buildingId, bulk, confirmedAt\]\)/);
});

test('the SQL creates exactly that table, and the reverse drops it', () => {
  const up = fs.readFileSync(path.join(ROOT, 'prisma', 'sql', '20260916_owner_actions.up.sql'), 'utf8');
  const down = fs.readFileSync(path.join(ROOT, 'prisma', 'sql', '20260916_owner_actions.down.sql'), 'utf8');
  assert.match(up, /CREATE TABLE IF NOT EXISTS "OwnerAction"/);
  assert.match(up, /"fingerprint" TEXT NOT NULL/);
  assert.match(up, /"payload" JSONB NOT NULL/);
  assert.match(up, /CREATE INDEX IF NOT EXISTS "OwnerAction_status_expiresAt_idx"/);
  assert.equal(/ALTER TABLE "Building"|DROP/.test(up), false, 'the change is one new table and nothing else');
  assert.match(down, /DROP TABLE IF EXISTS "OwnerAction"/);
  assert.match(down, /ops\/owner\/actions\.js off/, 'the reverse says to switch the actions off first');
});

// Plan C review: the comment above the table said no tenant name is stored in it, and cardText is a preview that can
// hold one. Somebody reading the table has to be told, and told where that name may go.
test('the comment says cardText may hold an occupant name, and where that name may not travel', () => {
  const at = schema.indexOf('// An owner action waiting for');
  assert.ok(at > 0, 'the comment above model OwnerAction is missing');
  const note = schema.slice(at, schema.indexOf('model OwnerAction {', at));
  assert.match(note, /cardText/);
  assert.match(note, /occupant name/i);   // the comment shouts it: cardText MAY HOLD AN OCCUPANT NAME
  assert.match(note, /never reaches the model/);
  assert.match(note, /never leaves in a response/);
  // The claim that has to go, because it was not true of cardText.
  assert.equal(/no tenant name is stored here/.test(note), false);
});
