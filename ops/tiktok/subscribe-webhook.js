/* Points TikTok Business Messaging webhooks (DIRECT_MESSAGE) at bina.et. Run once after the app is approved.
 *   node ops/tiktok/subscribe-webhook.js            -> dry run, shows what would be sent
 *   node ops/tiktok/subscribe-webhook.js --apply    -> subscribes
 */
require('dotenv').config();
const APP_ID = process.env.TIKTOK_APP_ID || '', SECRET = process.env.TIKTOK_APP_SECRET || '';
const URL = (process.env.BASE_URL || 'https://bina.et') + '/api/tiktok/webhook';
if (!APP_ID || !SECRET) { console.error('TIKTOK_APP_ID / TIKTOK_APP_SECRET not set in .env'); process.exit(1); }
if (!process.argv.includes('--apply')) { console.log('would subscribe DIRECT_MESSAGE -> ' + URL + '\n(dry run — pass --apply)'); process.exit(0); }
fetch('https://business-api.tiktok.com/open_api/v1.3/business/webhook/update/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: APP_ID, secret: SECRET, event_type: 'DIRECT_MESSAGE', callback_url: URL }),
}).then(r => r.json()).then(j => {
  if (j.code !== 0) { console.error('failed: ' + j.code + ' ' + j.message); process.exit(1); }
  console.log('✓ webhook -> ' + URL);
}).catch(e => { console.error('failed: ' + e.message); process.exit(1); });
