#!/usr/bin/env node
'use strict';
/*
 * Points @binasmartdriverbot at the driver app and registers its commands.
 *
 *   node ops/ride/setup-driver-bot.js          # show what is set now
 *   node ops/ride/setup-driver-bot.js --apply  # set the menu button, commands and webhook
 *
 * Idempotent, and it never sends a message to anybody. The token is read from .env and never printed.
 */
require('dotenv').config();
const { makeTgApi } = require('../../ride/tgApi');

const TOKEN = process.env.BINA_DRIVER_BOT_TOKEN || '';
const SECRET = process.env.TG_WEBHOOK_SECRET || '';
const BASE = process.env.BASE_URL || 'https://bina.et';
const APPLY = process.argv.includes('--apply');

if (!TOKEN) { console.error('BINA_DRIVER_BOT_TOKEN is not set — nothing to do.'); process.exit(1); }
const api = makeTgApi({ token: TOKEN });

const COMMANDS = [
  { command: 'start', description: 'Open the driver app · መተግበሪያውን ክፈት' },
  { command: 'app', description: 'Go online and receive rides' },
];

(async () => {
  const me = await api.call('getMe', {});
  console.log('bot: @' + me.username + ' (' + me.first_name + ')');
  const hook = await api.call('getWebhookInfo', {});
  console.log('webhook: ' + (hook.url || 'NONE') + (hook.last_error_message ? '  last error: ' + hook.last_error_message : ''));
  const menu = await api.call('getChatMenuButton', {});
  console.log('menu button: ' + JSON.stringify(menu));

  if (!APPLY) { console.log('\n(dry run — pass --apply to change anything)'); return; }

  await api.setChatMenuButton(BASE + '/drive', '🚗 Drive');
  console.log('✓ menu button -> ' + BASE + '/drive');
  await api.setMyCommands(COMMANDS);
  console.log('✓ commands -> ' + COMMANDS.map(c => '/' + c.command).join(' '));
  if (SECRET) {
    await api.setWebhook(BASE + '/api/tg/driver', SECRET);
    console.log('✓ webhook -> ' + BASE + '/api/tg/driver');
  } else {
    console.log('! TG_WEBHOOK_SECRET is empty — webhook left untouched');
  }
  const after = await api.call('getChatMenuButton', {});
  console.log('\nnow: ' + JSON.stringify(after));
})().catch(e => { console.error('failed: ' + e.message); process.exit(1); });
