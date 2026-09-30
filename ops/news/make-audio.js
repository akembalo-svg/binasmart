#!/usr/bin/env node
'use strict';
// Read an article aloud, once, and keep the file.
//
//   node --env-file=.env ops/news/make-audio.js <slug> [--dry-run] [--voice Kore]
//
// Generated ONCE per article, not once per listener: a reader costs nothing, playback is instant, the
// API key never goes near a browser, and nginx caches it like any other file.
//
// TWO ENGINES. Default is `mms` — facebook/mms-tts-amh, free, on this machine, nothing leaves the box.
// `--engine gemini` is the paid fallback at about 26 cents an article.
//
// Read this before touching the bitrate. For most of 26 September the free model was written off because
// it said ፖ where Amharic wants ባ, and hours went into romanisation trying to fix it. It was never the
// model. Every clip was being encoded as Opus 24 kbps with a loudness filter, and voicing — the single
// feature separating ባ from ፖ — is what dies first at that bitrate. At 48 kbps with no filter Ibrahim
// confirmed ባ is correct. So: 48k, no loudnorm, and never lower it to save space without a listening
// test on ባ specifically. A file half the size that mispronounces a letter in every sentence is not a
// saving.
//
// What is NOT read aloud, and why: the source box, the figure captions and the English summary. Nobody
// wants a voice reciting "ፎቶ፦ Volkswagen" after every picture, and the English half doubles the cost and
// the download for an Amharic listener. This cuts roughly a third of the text off the bill.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const VOICE = arg('--voice') || 'Kore';
const ENGINE = (arg('--engine') || 'mms').toLowerCase();
const MMS_PY = '/root/tts-lab/venv/bin/python';
const MMS_SCRIPT = '/root/tts-lab/say_article.py';
const DRY = process.argv.includes('--dry-run');
const slug = process.argv[2];
const PRICE_PER_MIN = 0.0135;          // US dollars, doubling 1 Jan 2027
const MAX_CHARS = 1400;                // per request

if (!slug || slug.startsWith('--')) { console.error('usage: make-audio.js <slug> [--dry-run]'); process.exit(2); }

// --- what the voice actually says -------------------------------------------------------------
function speakable(html) {
  let h = String(html || '');
  h = h.replace(/<figure[\s\S]*?<\/figure>/gi, ' ');                 // pictures and their captions
  h = h.replace(/<p[^>]*background:#f4f1ea[\s\S]*?<\/p>/gi, ' ');     // the source box
  const cut = h.search(/<h3[^>]*>\s*In English/i);                    // the English summary and after
  if (cut > -1) h = h.slice(0, cut);
  h = h.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  h = h.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&#8217;/g, "'");
  return h.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}
// Chunked on paragraph boundaries so a sentence is never cut in half across two requests.
function chunk(text) {
  const out = []; let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > MAX_CHARS && cur) { out.push(cur); cur = line; }
    else cur = cur ? cur + '\n' + line : line;
  }
  if (cur) out.push(cur);
  return out;
}
function wavHeader(dataLen, rate, channels = 1, bits = 16) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * bits / 8, 28);
  b.writeUInt16LE(channels * bits / 8, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  return b;
}
async function say(text, tries = 3) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + KEY;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } } }) });
    const j = await r.json().catch(() => null);
    if (r.ok) {
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts;
      const inline = parts && parts.find(p => p.inlineData);
      if (inline) {
        const pcm = Buffer.from(inline.inlineData.data, 'base64');
        const rate = Number(((inline.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1]) || 24000;
        return { pcm, rate };
      }
    }
    if (i === tries - 1) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(j && j.error ? j.error : j).slice(0, 200));
    await new Promise(res => setTimeout(res, 4000 * (i + 1)));
  }
}

(async () => {
  if (!KEY) { console.error('GEMINI_API_KEY is not set'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const post = await prisma.newsPost.findUnique({ where: { slug } });
    if (!post) { console.error('no such article: ' + slug); process.exit(1); }
    const text = speakable(post.bodyHtml);
    const parts = chunk((post.titleAm || post.title) + '\n' + text);
    const chars = parts.reduce((n, p) => n + p.length, 0);
    const mins = chars / 490 / 1;   // measured: about 490 characters a minute in Amharic
    console.log(slug + '  [engine ' + ENGINE + ']');
    console.log('  ' + chars + ' characters read aloud, roughly ' + mins.toFixed(1) + ' minutes');
    console.log('  cost: ' + (ENGINE === 'mms' ? 'nothing — runs here' : 'about $' + (mins * PRICE_PER_MIN).toFixed(2)));
    if (DRY) { console.log('  [dry run] first chunk:\n' + parts[0].slice(0, 220)); return; }

    const tmp = fs.mkdtempSync('/tmp/newsaudio-');
    const out = path.join(__dirname, '..', '..', 'public', 'news', 'audio', slug + '.ogg');

    if (ENGINE === 'mms') {
      const src = path.join(tmp, 'text.txt');
      fs.writeFileSync(src, parts.join('\n'));
      const wav = path.join(tmp, 'mms.wav');
      execFileSync(MMS_PY, [MMS_SCRIPT, src, wav], { stdio: 'inherit' });
      // Two files from the same source: a small Opus for Chrome/Android/Firefox and an MP3 for iPhone Safari and
      // Telegram's iOS browser, which cannot play Ogg (27 Sep 2026: the first article played nowhere on iPhone).
      // The voice is 16 kHz speech, so 24k Opus / 32k MP3 lose nothing audible and cost readers half the data.
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', out,
        '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', out.replace(/\.ogg$/, '.mp3')]);
      const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
      fs.writeFileSync(out.replace(/\.ogg$/, '.json'), JSON.stringify({ seconds: Math.round(Number(d)), engine: 'mms' }));
      console.log('  wrote ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB  ' + Number(d).toFixed(0) + 's');
      console.log('  https://bina.et/news/' + slug);
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    }

    const list = [];
    for (let i = 0; i < parts.length; i++) {
      const { pcm, rate } = await say(parts[i]);
      const f = path.join(tmp, 'p' + String(i).padStart(3, '0') + '.wav');
      fs.writeFileSync(f, Buffer.concat([wavHeader(pcm.length, rate), pcm]));
      list.push(f);
      console.log('  chunk ' + (i + 1) + '/' + parts.length + '  ' + (pcm.length / (rate * 2)).toFixed(1) + 's');
    }
    const concat = path.join(tmp, 'list.txt');
    fs.writeFileSync(concat, list.map(f => "file '" + f + "'").join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
      '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', out,
      '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '40k', out.replace(/\.ogg$/, '.mp3')]);
    const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
    fs.writeFileSync(out.replace(/\.ogg$/, '.json'), JSON.stringify({ seconds: Math.round(Number(dur)), engine: ENGINE }));
    console.log('  wrote ' + out + '  ' + (fs.statSync(out).size / 1048576).toFixed(2) + ' MB  ' + Number(dur).toFixed(0) + 's');
    console.log('  https://bina.et/news/' + slug);
    fs.rmSync(tmp, { recursive: true, force: true });
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
