'use strict';
// /api/tg-webhook used to link a chat to a tenant from a unit number. Without Telegram's secret header, anyone
// could forge the update and take a tenant's rent reminders. The linking was retired on 15 Sep 2026
// (test/messaging/server-tenant.test.js pins that); the secret gate stays, and nothing may come before it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('/api/tg-webhook refuses a request without the Telegram secret, before reading the body', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("fastify.post('/api/tg-webhook'");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('\n});', at));
  const gate = body.search(/x-telegram-bot-api-secret-token'\] !== tgSecret\) return reply\.code\(401\)/);
  assert.ok(gate > 0, 'the secret check is missing');
  const before = s => { const i = body.indexOf(s); return i === -1 || gate < i; };   // absent is fine
  assert.ok(before('req.body'), 'the secret must be checked before the update is read');
  assert.ok(before('telegramChatId'), 'and before any chat is linked');
  assert.match(body, /if \(!tgSecret \|\|/, 'an unset secret must refuse, not allow');
});
