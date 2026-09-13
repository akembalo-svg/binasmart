'use strict';
// /api/tg-webhook links a chat to a tenant from a unit number. Without Telegram's secret header, anyone
// could forge the update and take a tenant's rent reminders.
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
  assert.ok(gate < body.indexOf('req.body'), 'the secret must be checked before the update is read');
  assert.ok(gate < body.indexOf('telegramChatId'), 'and before any chat is linked');
  assert.match(body, /if \(!tgSecret \|\|/, 'an unset secret must refuse, not allow');
});
