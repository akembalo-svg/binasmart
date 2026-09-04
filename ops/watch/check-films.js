'use strict';
// Daily: is every public YouTube film still online and embeddable? A film the channel removed or
// made private would otherwise sit on /watch as a dead player. Dead ones go back to draft with a
// dated note; the owner gets one Telegram line. Never sends anything when nothing changed.
//   node ops/watch/check-films.js [--dry]
const fs = require('fs'); const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { youtubeId } = require('../../watch/rules');
const prisma = new PrismaClient();
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const dry = process.argv.includes('--dry');

async function embeddable(id) {
  try { const r = await fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=' + id + '&format=json', { signal: AbortSignal.timeout(15000) }); return r.status === 200 ? 'ok' : r.status === 401 || r.status === 403 || r.status === 404 ? 'gone' : 'unknown'; }
  catch (e) { return 'unknown'; }
}
async function alert(text) {
  const tok = env.BINA_RIDER_BOT_TOKEN, chat = env.BINA_OWNER_TG_CHAT;
  if (!tok || !chat || dry) return;
  try { await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) }); } catch (e) { console.error('alert failed: ' + e.message); }
}

(async () => {
  const films = await prisma.film.findMany({ where: { status: 'public', sourceKind: 'youtube' } });
  const dead = [], unsure = []; let ok = 0;
  for (const f of films) {
    const id = youtubeId(f.sourceUrl); const st = id ? await embeddable(id) : 'gone';
    if (st === 'ok') { ok++; continue; }
    if (st === 'unknown') { unsure.push(f.slug); continue; }   // network blip: leave it, look again tomorrow
    dead.push(f.slug);
    if (!dry) await prisma.film.update({ where: { id: f.id }, data: { status: 'draft', rights: (f.rights || '') + '\n[' + new Date().toISOString().slice(0, 10) + '] unpublished automatically: YouTube video no longer available/embeddable.' } });
  }
  console.log(new Date().toISOString().slice(0, 16) + ' films ok ' + ok + ', unpublished ' + dead.length + (dead.length ? ' (' + dead.join(', ') + ')' : '') + ', unreachable ' + unsure.length + (unsure.length ? ' (' + unsure.join(', ') + ')' : ''));
  if (dead.length) await alert('▶️ Watch: ' + dead.length + ' film(s) taken off /watch because the YouTube video is gone: ' + dead.join(', ') + '\nhttps://bina.et/ops/watch');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
