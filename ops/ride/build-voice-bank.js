#!/usr/bin/env node
'use strict';
// Every sentence the driver app can say, spoken once and kept.
//
//   node --env-file=.env ops/ride/build-voice-bank.js --dry-run
//   node --env-file=.env ops/ride/build-voice-bank.js
//   node --env-file=.env ops/ride/build-voice-bank.js --voice Iapetus --force
//
// Why a bank and not a call per instruction. A driver at a junction has one second and often no
// signal; an API round trip is the wrong thing to depend on there. And navigation does not say
// arbitrary sentences - it says one of seventeen manoeuvres, after one of about a hundred distances.
// So each fragment is generated once and the app plays two short clips back to back:
// "በ200 ሜትር" + "ወደ ቀኝ ይታጠፉ".
//
// The whole bank costs about six US cents to build and nothing at all to use. It also survives the
// thing that broke voice before: the phone needs no Amharic voice of its own, because the Amharic was
// spoken on this server by a voice the owner chose by ear (Charon, 24 September 2026).
//
// Files are named by a hash of the text, so a phrase that has not changed is never paid for twice and
// the app can build the same name without a lookup table.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const KEY = process.env.GEMINI_API_KEY || '';
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const MODEL = arg('--model') || 'gemini-3.8-flash-tts';
const VOICE = arg('--voice') || 'Charon';
const OUT = path.join(__dirname, '..', '..', 'public', 'ride', 'voice');

// ---- the phrases, taken from drivenav.js and drive.js so the two cannot drift apart ----
const TURNS = [
  'ወደ ኋላ ተመልሰው ይሂዱ', 'በግራ በኩል ይቀጥሉ', 'ከክብ መንገዱ ይውጡ', 'አጥብቀው ወደ ግራ ይታጠፉ', 'ወደ ግራ ይታጠፉ',
  'በትንሹ ወደ ግራ ይያዙ', 'ቀጥ ብለው ይቀጥሉ', 'በትንሹ ወደ ቀኝ ይያዙ', 'ወደ ቀኝ ይታጠፉ', 'አጥብቀው ወደ ቀኝ ይታጠፉ',
  'ደረሱ', 'ይቀጥሉ', 'ወደ ክብ መንገዱ ይግቡ', 'በቀኝ በኩል ይቀጥሉ',
];
// Roundabout exits: drivenav.js appends "እና <ordinal> መውጫ ይውጡ".
const ORDINALS = ['አንደኛ', 'ሁለተኛ', 'ሦስተኛ', 'አራተኛ', 'አምስተኛ', 'ስድስተኛ'];
const EXITS = ORDINALS.map(o => 'እና ' + o + ' መውጫ ይውጡ');

// distAm(): "አሁን" under 30m, then every 10m to 940, then tenths of a kilometre.
const DIST = ['አሁን'];
for (let m = 30; m <= 950; m += 10) DIST.push('በ' + m + ' ሜትር');
// distAm gives tenths of a kilometre below 5km and whole kilometres above it (drivenav.js changed
// to match): a tenth is useful at 1.2km and noise at 7.3km, and it makes the set finite, which is
// what lets the bank be complete rather than nearly complete.
for (let n = 10; n <= 49; n++) DIST.push('በ' + (n / 10) + ' ኪሎ ሜትር');
for (let k = 5; k <= 30; k++) DIST.push('በ' + k + ' ኪሎ ሜትር');

// Whole lines drive.js speaks. The passenger's name is deliberately NOT in the bank - a name cannot be
// pre-recorded, and the app says the nameless version rather than mispronouncing somebody.
const LINES = [
  'ወደ መድረሻው ይሂዱ',
  'ወደ ተሳፋሪው ይሂዱ',
  'ጉዞው ተጠናቋል። አመሰግናለሁ።',
  'ጉዞው ተጠናቋል። ኢንተርኔት ሲመለስ ይላካል።',
  'መንገድ ስተዋል። ወደ መንገዱ ይመለሱ።',
];

const ALL = [...new Set([...TURNS, ...EXITS, ...DIST, ...LINES])];
const idOf = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 16);

function wavHeader(dataLen, rate) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  return b;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function speak(text, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + KEY, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      }),
    });
    const j = await r.json().catch(() => null);
    if (r.ok) {
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const inline = parts.find(p => p.inlineData);
      if (inline) return inline.inlineData;
    }
    const retryable = r.status === 429 || r.status >= 500;
    if (!retryable || i === tries - 1) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(j && j.error ? j.error : j).slice(0, 160));
    await sleep(2000 * Math.pow(1.8, i) + Math.random() * 800);
  }
}

(async () => {
  if (!KEY) { console.error('GEMINI_API_KEY is not set'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  const index = {};
  let made = 0, had = 0, failed = 0, seconds = 0;
  console.log('[voice] ' + ALL.length + ' phrases, voice ' + VOICE + (DRY ? '  (dry run)' : ''));

  for (const text of ALL) {
    const id = idOf(text);
    index[text] = id;
    const ogg = path.join(OUT, id + '.ogg');
    if (!FORCE && fs.existsSync(ogg)) { had++; continue; }
    if (DRY) { made++; continue; }

    let data;
    try { data = await speak(text); }
    catch (e) { failed++; console.log('  !! ' + text + '  ' + e.message.slice(0, 80)); continue; }

    const pcm = Buffer.from(data.data, 'base64');
    const rate = Number((String(data.mimeType || '').match(/rate=(\d+)/) || [])[1]) || 24000;
    const wav = path.join(OUT, id + '.wav');
    fs.writeFileSync(wav, Buffer.concat([wavHeader(pcm.length, rate), pcm]));
    // opus at 24kbps: a two-second clip is a few kilobytes, which matters on an Ethiopian phone plan.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libopus', '-b:a', '24k', ogg]);
    fs.unlinkSync(wav);
    seconds += pcm.length / (rate * 2);
    made++;
    if (made % 20 === 0) process.stdout.write('  ' + made + ' made\r');
    await sleep(120);
  }

  if (!DRY) {
    fs.writeFileSync(path.join(OUT, 'index.json'),
      JSON.stringify({ voice: VOICE, model: MODEL, built: new Date().toISOString(), phrases: index }, null, 1));
  }
  console.log('\n[voice] made ' + made + ', already had ' + had + (failed ? ', failed ' + failed : ''));
  if (!DRY) console.log('[voice] ' + seconds.toFixed(0) + 's of speech  ≈ $' + (seconds / 60 * 0.0135).toFixed(3) +
    '\n[voice] index: public/ride/voice/index.json');
})().catch(e => { console.error(e.message); process.exit(1); });
