#!/usr/bin/env node
'use strict';
// Does Gemini's text-to-speech actually speak Amharic? Find out instead of guessing.
//
//   node --env-file=.env ops/tts-amharic-test.js [--model gemini-3.8-flash-tts] [--voice Kore]
//
// Google's announcement says "over 100 languages" and names none of them African except Arabic, so
// whether Amharic is usable is not answerable from the documentation. It is answerable in thirty
// seconds by asking it to say something and listening.
//
// Why this matters here: BinaSmart Ride's driver app was built to speak directions aloud and the cheap
// Android phones drivers carry have no Amharic voice, so they hear a chime. If a hosted model speaks
// Amharic properly, that gap closes - and Bini could talk. If it does not, we have saved ourselves
// from shipping something that mangles the language to people who depend on it.
//
// It writes a .wav a person can listen to. A machine cannot tell you whether an accent is right.
const fs = require('fs');

const KEY = process.env.GEMINI_API_KEY || '';
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const MODEL = arg('--model') || 'gemini-3.8-flash-tts';
const VOICE = arg('--voice') || 'Kore';
const OUT = arg('--out') || '/root/tts-amharic.wav';

// Ordinary sentences a driver and a job seeker would actually hear, not a poem: numbers, a street
// name, a plate, the things a synthesiser usually gets wrong.
const TEXT = [
  'ሰላም፣ ቢናስማርት ነኝ።',
  'ከ300 ሜትር በኋላ ወደ ቀኝ ይታጠፉ፤ ከዚያም ወደ ቦሌ መንገድ ይግቡ።',
  'ተሳፋሪዎ በሜክሲኮ አደባባይ ይጠብቃል። የመኪናው ሰሌዳ ቁጥር B 87982 ነው።',
  'ዛሬ በአዲስ አበባ አራት ሺህ ሦስት መቶ ዘጠና ክፍት የሥራ ቦታዎች አሉ።',
].join(' ');

function wavHeader(dataLen, rate = 24000, channels = 1, bits = 16) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataLen, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * channels * bits / 8, 28);
  b.writeUInt16LE(channels * bits / 8, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36); b.writeUInt32LE(dataLen, 40);
  return b;
}

(async () => {
  if (!KEY) { console.error('GEMINI_API_KEY is not set'); process.exit(2); }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + KEY;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: TEXT }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) { console.error('HTTP ' + r.status + ' ' + JSON.stringify(j && j.error ? j.error : j).slice(0, 400)); process.exit(1); }

  const part = (((j.candidates || [])[0] || {}).content || {}).parts;
  const inline = part && part.find(p => p.inlineData);
  if (!inline) { console.error('no audio came back: ' + JSON.stringify(j).slice(0, 400)); process.exit(1); }

  const pcm = Buffer.from(inline.inlineData.data, 'base64');
  const mime = inline.inlineData.mimeType || '';
  const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
  fs.writeFileSync(OUT, Buffer.concat([wavHeader(pcm.length, rate), pcm]));
  console.log('model ' + MODEL + '  voice ' + VOICE + '  mime ' + mime);
  console.log('wrote ' + OUT + '  (' + (pcm.length / (rate * 2)).toFixed(1) + ' seconds)');
  console.log('\nSaid:\n' + TEXT);
  console.log('\nListen to it. A machine cannot tell you whether the Amharic is right.');
})().catch(e => { console.error(e.message); process.exit(1); });
