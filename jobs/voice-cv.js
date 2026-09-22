'use strict';
// A CV spoken into Telegram.
//
// The written form asks for education, work history, skills and languages. On a phone, in Amharic,
// that is twenty minutes of typing in a script most people type slowly - and it is asked of exactly
// the people least likely to own a laptop. Speaking the same thing takes a minute, and @bina_smart_bot
// already receives voice notes (ride/binaBot.js → assistant/transcribe.js).
//
// The flow is two steps and no more, because every extra step loses people:
//   /cv            → "send me one voice note saying …"
//   the voice note → transcribed, the facts pulled out of it, then one tap to share a phone number
//   → the PDF arrives, with the vacancies that match it.
//
// Three rules carried over from the written builder, which matter more here rather than less:
//   · The model FORMATS, it never INVENTS. jobs/cv-build.js checks every field back against the words
//     the person actually said; a spoken CV goes through the same check, on the transcript.
//   · Consent is a question, not an assumption. The row is created with shareWider false and the person
//     is asked afterwards, with two buttons. Nothing is forwarded on a guess.
//   · The state lives in the database (BotState), not in memory, so a restart between the voice note and
//     the phone number does not silently swallow the minute somebody just spent talking.
const { buildCvFor } = require('./cv-build');

const STATE_MAX_MS = 2 * 3600 * 1000;      // an abandoned half-CV is forgotten after two hours
const MODEL = 'gemini-2.5-flash';

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Ethiopian mobile, in the shapes people type it or Telegram sends it.
const normPhone = raw => {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^09\d{8}$/.test(d)) return '+251' + d.slice(1);
  if (/^(\+?251)9\d{8}$/.test(d)) return '+251' + d.replace(/^\+?251/, '');
  if (/^9\d{8}$/.test(d)) return '+251' + d;
  return null;
};

// Who is speaking, and about what. Only the four facts the CV header and the matcher need - everything
// else in the transcript is left to the builder, which already knows how to format it.
const WHO_PROMPT = [
  'An Ethiopian job seeker described their working life out loud. Below is the transcript.',
  '',
  'Return ONLY a JSON object with these keys, using ONLY what the transcript actually says:',
  '  "name"     — their full name as they said it, in the script they used. "" if they did not say it.',
  '  "city"     — the city or town they live in or want to work in. "" if not said.',
  '  "category" — their trade in 1-3 words in ENGLISH (Accountant, Driver, Nurse, Sales, Electrician,',
  '               Cleaner, Security guard, Teacher…). "" if the transcript does not make it clear.',
  '  "years"    — whole years of work experience as a number, or null if they did not say.',
  '',
  'Never guess a name from a greeting, never invent a city, never round a number up.',
].join('\n');

async function askWho({ apiKey, transcript, fetchImpl }) {
  const f = fetchImpl || fetch;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: WHO_PROMPT + '\n\n--- transcript ---\n' + transcript }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
      }),
    });
    if (r.status !== 200) return null;
    const d = await r.json().catch(() => null);
    const out = (((d?.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('').trim();
    return out ? JSON.parse(out) : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// A name the transcript does not contain is a name the model made up.
const saidIt = (value, transcript) => {
  const words = String(value || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!words.length) return false;
  const hay = transcript.toLowerCase();
  return words.filter(w => hay.includes(w)).length / words.length >= 0.5;
};

function makeVoiceCv({ prisma, apiKey }) {

  async function stateOf(chatId) {
    const row = await prisma.botState.findUnique({ where: { chatId: String(chatId) } }).catch(() => null);
    if (!row) return null;
    if (Date.now() - new Date(row.updatedAt).getTime() > STATE_MAX_MS) { await clear(chatId); return null; }
    return row;
  }

  const set = (chatId, state, data) => prisma.botState.upsert({
    where: { chatId: String(chatId) },
    update: { state, data: data || null },
    create: { chatId: String(chatId), state, data: data || null },
  });

  const clear = chatId => prisma.botState.delete({ where: { chatId: String(chatId) } }).catch(() => null);

  // Step one: ask for the voice note.
  async function begin(chatId) {
    await set(chatId, 'cv_wait_voice', null);
    return ['🎤 <b>ሲቪዎን በድምጽ ይናገሩ</b>',
      '',
      'አንድ የድምጽ መልእክት ይላኩ — እስከ 3 ደቂቃ። በውስጡ ይናገሩ፦',
      '• ሙሉ ስምዎ',
      '• የሚኖሩበት ከተማ',
      '• የሠሩበት ሥራ፣ የት፣ ከመቼ እስከ መቼ',
      '• ትምህርትዎ',
      '• የሚችሉት ነገር (ኮምፒውተር፣ መንዳት፣ ቋንቋ…)',
      '',
      'በአማርኛ ቢናገሩ ይሻላል። እኔ ጽፌ ወደ ሲቪ እቀይረዋለሁ።',
      'ለማቋረጥ /cancel',
    ].join('\n');
  }

  // Step two: the transcript. What it holds decides whether there is a CV to build at all.
  async function onTranscript(chatId, transcript) {
    const text = clean(transcript, 4000);
    // A greeting is not a working life. Better to ask again than to render a page with nothing on it.
    if (text.length < 60) return { ok: false, error: 'too_short' };

    const who = await askWho({ apiKey, transcript: text }) || {};
    const name = saidIt(who.name, text) ? clean(who.name, 90) : '';
    const data = {
      transcript: text,
      name,
      city: saidIt(who.city, text) ? clean(who.city, 60) : '',
      category: clean(who.category, 60),
      years: Number.isFinite(Number(who.years)) ? Math.round(Number(who.years)) : null,
    };
    if (!name) { await set(chatId, 'cv_wait_name', data); return { ok: true, need: 'name' }; }
    await set(chatId, 'cv_wait_phone', data);
    return { ok: true, need: 'phone', who: data };
  }

  // They spoke about their work but never said their name - so ask for it plainly.
  async function onName(chatId, raw) {
    const st = await stateOf(chatId);
    if (!st || st.state !== 'cv_wait_name') return { ok: false, error: 'no_state' };
    const name = clean(raw, 90);
    if (name.length < 3) return { ok: false, error: 'name_short' };
    const data = Object.assign({}, st.data, { name });
    await set(chatId, 'cv_wait_phone', data);
    return { ok: true, need: 'phone', who: data };
  }

  // Step three: a phone number, because a CV an employer cannot answer is not a CV. Telegram's
  // "share my number" button sends the real one; a typed number is accepted the same way.
  async function onPhone(chatId, rawPhone) {
    const st = await stateOf(chatId);
    if (!st || st.state !== 'cv_wait_phone') return { ok: false, error: 'no_state' };
    const phone = normPhone(rawPhone);
    if (!phone) return { ok: false, error: 'phone_invalid' };

    const d = st.data || {};
    const who = { name: d.name, phone, city: d.city || '', email: '', category: d.category || '' };
    const source = [
      'Name: ' + who.name,
      who.city ? 'City: ' + who.city : '',
      who.category ? 'Field of work: ' + who.category : '',
      d.years != null ? 'Years of experience: ' + d.years : '',
      'What the person said about their working life:',
      d.transcript,
    ].filter(Boolean).join('\n');

    const built = await buildCvFor({ prisma, apiKey, who, source, years: d.years, shareWider: false });
    await clear(chatId);
    if (!built.ok) return { ok: false, error: built.error || 'other' };
    return { ok: true, id: built.id, pdf: built.pdf, matches: built.matches, path: built.path, who, cv: built.cv };
  }

  // Consent, asked after the CV is in their hands rather than before they have seen it.
  async function setConsent(candidateId, yes) {
    return prisma.candidate.update({ where: { id: String(candidateId) }, data: { shareWider: !!yes } }).catch(() => null);
  }

  return { begin, stateOf, onTranscript, onName, onPhone, setConsent, cancel: clear, normPhone };
}

module.exports = { makeVoiceCv, STATE_MAX_MS };
