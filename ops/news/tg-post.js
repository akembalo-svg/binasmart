#!/usr/bin/env node
'use strict';
// Post a page to the ቢናsmart Telegram channel (@binasmart) as a photo + caption, through @bina_smart_bot,
// which is a channel admin. Replaces the throwaway scripts used for posts 145, 146 and 150 on 6-7 Sep 2026.
//
//   node ops/news/tg-post.js <slug-or-path> --caption caption.txt            preview only
//   node ops/news/tg-post.js <slug-or-path> --caption caption.txt --send     actually post
//
// <slug-or-path> is a news slug (esl-digital-customer-self-service-app-2026), a guide path (/coc-certificate-ethiopia)
// or a full https://bina.et/... URL. The photo is public/og-<slug>.png, which must exist and be 1200x630; the link is
// appended to the caption unless the caption already contains it. Nothing is sent without --send. Every send is
// logged to ops/news/tg-posts.tsv (slug, message id, time) and a slug already in the log is refused unless --again.
//
// Channel posts are deliberate: Ibrahim asks for each one. This script makes the mechanics safe, it does not decide.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..', '..');
const LOG = path.join(__dirname, 'tg-posts.tsv');
const CHANNEL = process.env.BINASMART_TG_CHANNEL || '@binasmart';
const TOKEN = process.env.BINA_RIDER_BOT_TOKEN || '';

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find(a => !a.startsWith('--') && a !== opt('--caption'));
if (!target || !opt('--caption')) { console.error('usage: tg-post.js <slug|/path|url> --caption <file> [--send] [--again]'); process.exit(2); }

// resolve slug + URL
let url, slug;
if (/^https?:\/\//.test(target)) { url = target; slug = target.replace(/\/+$/, '').split('/').pop(); }
else if (target.startsWith('/')) { url = 'https://bina.et' + target; slug = target.replace(/\/+$/, '').split('/').pop(); }
else { url = 'https://bina.et/news/' + target; slug = target; }
if (!/^[a-z0-9-]+$/.test(slug)) { console.error('slug must be lowercase letters, digits, hyphens: ' + slug); process.exit(1); }

const photoFile = path.join(ROOT, 'public', 'og-' + slug + '.png');
if (!fs.existsSync(photoFile)) { console.error('no share card at public/og-' + slug + '.png — render one first (ops/og/render-card.sh)'); process.exit(1); }
const head = fs.readFileSync(photoFile).subarray(0, 24);
const w = head.readUInt32BE(16), h = head.readUInt32BE(20);
if (w !== 1200 || h !== 630) { console.error('share card is ' + w + 'x' + h + ', expected 1200x630 — re-render with ops/og/render-card.sh'); process.exit(1); }

let caption = fs.readFileSync(path.resolve(opt('--caption')), 'utf8').trim();
if (!caption.includes(url)) caption += '\n\n👉 ' + url;
if (Buffer.byteLength(caption, 'utf8') > 1024) { console.error('caption is ' + Buffer.byteLength(caption, 'utf8') + ' bytes; Telegram allows 1024'); process.exit(1); }

const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
const already = log.split('\n').find(l => l.split('\t')[0] === slug);
if (already && !flag('--again')) { console.error('already posted: ' + already.replace(/\t/g, '  ') + '\n(use --again to post it once more on purpose)'); process.exit(1); }

console.log('channel:  ' + CHANNEL + '\nphoto:    https://bina.et/static/og-' + slug + '.png (' + w + 'x' + h + ')\nurl:      ' + url + '\n--- caption (' + Buffer.byteLength(caption, 'utf8') + ' bytes) ---\n' + caption + '\n---');
if (!flag('--send')) { console.log('(preview only — add --send to post)'); process.exit(0); }
if (!TOKEN) { console.error('BINA_RIDER_BOT_TOKEN missing'); process.exit(1); }

(async () => {
  const r = await (await fetch('https://api.telegram.org/bot' + TOKEN + '/sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHANNEL, photo: 'https://bina.et/static/og-' + slug + '.png', caption }) })).json();
  if (!r.ok) { console.error('FAILED: ' + r.description); process.exit(1); }
  const link = 'https://t.me/' + CHANNEL.replace('@', '') + '/' + r.result.message_id;
  fs.appendFileSync(LOG, [slug, r.result.message_id, new Date().toISOString(), url].join('\t') + '\n');
  console.log('posted: ' + link);
})().catch(e => { console.error(e.message); process.exit(1); });
