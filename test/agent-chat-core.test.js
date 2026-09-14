'use strict';
// The chat pages' logic, run under node. Replies are the real fixed texts from assistant/afiya.js,
// assistant/asmat.js and assistant/scope.js, so a change to one of them that would break a card fails here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/agent-chat-core');
const afiya = require('../assistant/afiya');
const asmat = require('../assistant/asmat');
const scope = require('../assistant/scope');

const cfgFor = mod => ({
  disclosure: { am: mod.disclosure('am'), en: mod.disclosure('en'), om: mod.disclosure('om') },
  emergency: { numbers: [afiya.AMBULANCE, afiya.POLICE, afiya.FIRE] },
});
const AFIYA = cfgFor(afiya), ASMAT = cfgFor(asmat);

function memoryStorage() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };

test('an answer: bold stripped, line breaks kept, the disclosure split off, sources kept', () => {
  for (const l of ['am', 'en', 'om']) {
    const reply = '**ወደ ተመላላሽ ክፍል** ይሂዱ።\nካርድ ይያዙ።\n\n' + afiya.disclosure(l);
    const card = C.toCard({ reply, emergency: false, sources: [{ title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide' }] }, AFIYA);
    assert.deepEqual(card, { kind: 'answer', text: 'ወደ ተመላላሽ ክፍል ይሂዱ።\nካርድ ይያዙ።', disclosure: afiya.disclosure(l), call: [],
      sources: [{ title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide' }] });
  }
  const legal = C.toCard({ reply: 'በሰነዶች ማረጋገጫ ጽ/ቤት።' + asmat.caseNudge('en') + '\n\n' + asmat.disclosure('en'), urgent: false }, ASMAT);
  assert.equal(legal.disclosure, asmat.disclosure('en'));
  assert.ok(legal.text.endsWith(asmat.caseNudge('en').trim()));
});

test('a reply that is only the disclosure, or starts with it, is shown as it came', () => {
  assert.deepEqual(C.toCard({ reply: asmat.disclosure('am') }, ASMAT), { kind: 'answer', text: asmat.disclosure('am'), disclosure: '', call: [], sources: [] });
  const fallback = afiya.disclosure('en') + '\nSorry, I could not answer just now. If this is urgent, call 907.';
  assert.equal(C.toCard({ reply: fallback }, AFIYA).text, fallback);
  assert.equal(C.toCard({ reply: fallback }, AFIYA).disclosure, '');
});

test('an emergency: the ambulance first, then the other numbers, once each; no sources', () => {
  for (const l of ['am', 'en', 'om']) {
    const card = C.toCard({ reply: afiya.emergencyReply(l), emergency: true, ambulance: afiya.AMBULANCE, sources: [{ title: 'x', url: 'https://bina.et' }] }, ASMAT);
    assert.equal(card.kind, 'emergency');
    assert.deepEqual(card.call, ['907', '991', '939']);
    assert.deepEqual(card.sources, []);
    assert.equal(card.text.includes('**'), false);
    assert.ok(card.text.includes('907'));
  }
});

test('an urgent legal reply: only the numbers it actually contains become call buttons', () => {
  const card = C.toCard({ reply: asmat.urgentReply('en'), urgent: true }, AFIYA);
  assert.equal(card.kind, 'urgent');
  assert.deepEqual(card.call, ['991']);
  assert.ok(C.linkify(card.text).some(s => s.type === 'link' && s.href === 'https://wa.me/251911244344'));
});

test('a redirect: kind redirect, and the link in it is a real link', () => {
  const reply = scope.redirect('ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?', 'health', 'am');
  const card = C.toCard({ reply, redirected: true }, AFIYA);
  assert.equal(card.kind, 'redirect');
  assert.deepEqual(C.linkify(card.text).filter(s => s.type === 'link').map(s => s.href), ['https://bina.et']);
  assert.equal(C.toCard({ reply: 'x', emergency: false, urgent: false, redirected: false }, AFIYA).kind, 'answer');
});

test('nothing from a reply can become markup, a script link or a bad tel: link', () => {
  const card = C.toCard({ reply: '<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,x https://bina.et/afiya.',
    emergency: true, ambulance: 'javascript:alert(1)',
    sources: [{ title: '<b>x</b>', url: 'javascript:alert(1)' }, { title: 'ok', url: 'https://bina.et/fayda' }] }, AFIYA);
  assert.deepEqual(card.call, ['907', '991', '939']);
  const segs = C.linkify(card.text);
  assert.deepEqual(segs.filter(s => s.type === 'link').map(s => s.href), ['https://bina.et/afiya']);
  assert.equal(segs.map(s => s.value).join(''), card.text, 'linkify loses nothing');
  const stored = C.normaliseCard({ kind: 'emergency<script>', text: 5, call: ['907', 'tel:1', '12345678'], sources: [{ title: 'a', url: 'https://bina.et x' }] });
  assert.deepEqual(stored, { kind: 'answer', text: '5', disclosure: '', call: [], sources: [] });
  assert.deepEqual(C.normaliseCard({ kind: 'urgent', call: ['991', '991', 'x'] }).call, ['991']);
  assert.deepEqual(C.toCard(null, AFIYA), { kind: 'answer', text: '', disclosure: '', call: [], sources: [] });
});

test('sources: at most two, http(s) only, titles cleaned', () => {
  const card = C.toCard({ reply: 'a', sources: [
    { title: ' **One** ', url: 'https://bina.et/1' }, { title: 'ftp', url: 'ftp://x' }, { title: 'Two', url: 'http://www.moh.gov.et/' }, { title: 'Three', url: 'https://bina.et/3' }] }, AFIYA);
  assert.deepEqual(card.sources, [{ title: 'One', url: 'https://bina.et/1' }, { title: 'Two', url: 'http://www.moh.gov.et/' }]);
});

test('linkify trims trailing punctuation and keeps the text around links', () => {
  assert.deepEqual(C.linkify('See https://bina.et/afiya. Then (https://bina.et/asmat)።'), [
    { type: 'text', value: 'See ' }, { type: 'link', href: 'https://bina.et/afiya', value: 'https://bina.et/afiya' },
    { type: 'text', value: '. Then (' }, { type: 'link', href: 'https://bina.et/asmat', value: 'https://bina.et/asmat' }, { type: 'text', value: ')።' }]);
  assert.deepEqual(C.linkify(''), []);
});

test('history: newest first, a title from the first question, 40 messages and 20 chats at most', () => {
  let t = 1000;
  const s = memoryStorage();
  const h = C.makeHistory(s, 'bina_chat_test', () => t++);
  const first = h.create('ልጄ ትኩሳት አለበት፣ የትኛው ክፍል ልሂድ? ' + 'ረጅም '.repeat(30));
  for (let i = 0; i < 45; i++) h.add(first, i % 2 ? { role: 'agent', card: { kind: 'answer', text: 'a' + i } } : { role: 'user', text: 'q' + i });
  const got = h.get(first);
  assert.equal(got.messages.length, 40);
  assert.equal(got.messages[0].card.text, 'a5', 'the oldest messages go first');
  assert.equal(got.messages[39].text, 'q44');
  assert.equal(got.title.length, 60);
  assert.ok(got.title.endsWith('…'));
  for (let i = 0; i < 25; i++) h.create('question ' + i);
  const list = h.list();
  assert.equal(list.length, 20);
  assert.equal(list[0].title, 'question 24');
  assert.equal(h.get(first), null, 'the oldest chat fell off');
  const older = list[5].id;
  h.add(older, { role: 'user', text: 'again' });
  assert.equal(h.list()[0].id, older, 'a chat moves to the top when used');
  assert.equal(h.remove(older), true);
  assert.equal(h.get(older), null);
  assert.equal(h.remove('nope'), false);
  assert.equal(h.add('nope', { role: 'user', text: 'x' }), false);
  h.clear();
  assert.deepEqual(h.list(), []);
});

test('history survives corrupt JSON, wrong shapes and blocked storage without throwing', () => {
  const s = memoryStorage();
  s.setItem('k', '{not json');
  const h = C.makeHistory(s, 'k');
  assert.deepEqual(h.list(), []);
  s.setItem('k', JSON.stringify([{ id: 1 }, null, { id: 'ok', title: 't', messages: [{ role: 'agent', card: { kind: 'emergency', call: ['javascript:x'] } }, { role: 'evil', text: 'x' }] }]));
  assert.deepEqual(h.list().map(c => c.id), ['ok']);
  assert.deepEqual(h.get('ok').messages, [{ role: 'agent', card: { kind: 'emergency', text: '', disclosure: '', call: [], sources: [] } }]);
  const b = C.makeHistory(blocked, 'k');
  const id = b.create('q');
  assert.equal(typeof id, 'string');
  assert.equal(b.add(id, { role: 'user', text: 'q' }), false);
  assert.deepEqual(b.list(), []);
  assert.equal(b.clear(), false);
  const none = C.makeHistory(null, 'k');
  assert.deepEqual(none.list(), []);
  assert.equal(typeof none.create('q'), 'string');
});

test('language: remembered per device, only am/en/om, and blocked storage falls back', () => {
  const s = memoryStorage();
  assert.equal(C.loadLang(s, 'bina_chat_lang', 'am'), 'am');
  assert.equal(C.saveLang(s, 'bina_chat_lang', 'om'), true);
  assert.equal(C.loadLang(s, 'bina_chat_lang', 'am'), 'om');
  assert.equal(C.saveLang(s, 'bina_chat_lang', 'fr'), false);
  s.setItem('bina_chat_lang', '<x>');
  assert.equal(C.loadLang(s, 'bina_chat_lang', 'en'), 'en');
  assert.equal(C.loadLang(blocked, 'bina_chat_lang', 'am'), 'am');
  assert.equal(C.saveLang(blocked, 'bina_chat_lang', 'en'), false);
  assert.equal(C.pickLang('xx', 'yy'), 'am');
});

test('pick: Oromo UI text falls back to English, then Amharic', () => {
  assert.equal(C.pick({ am: 'ሰላም', en: 'Hello' }, 'om'), 'Hello');
  assert.equal(C.pick({ am: 'ሰላም', en: 'Hello', om: 'Akkam' }, 'om'), 'Akkam');
  assert.equal(C.pick({ am: 'ሰላም' }, 'en'), 'ሰላም');
  assert.deepEqual(C.pick({ am: ['a'], en: ['b'] }, 'en'), ['b']);
  assert.equal(C.pick('plain', 'en'), 'plain');
});

test('?q= on load, the recording format and the timer', () => {
  assert.equal(C.queryFrom('?q=%E1%88%8D%E1%8C%84+%E1%89%B5%E1%8A%A9%E1%88%B3%E1%89%B5'), 'ልጄ ትኩሳት');
  assert.equal(C.queryFrom('?x=1&q=hello%20there&y=2'), 'hello there');
  assert.equal(C.queryFrom('?q=%E0%A4%A'), '');
  assert.equal(C.queryFrom(''), '');
  assert.equal(C.queryFrom('?q=' + 'a'.repeat(900)).length, 500);
  assert.equal(C.pickMime(m => m === 'audio/mp4'), 'audio/mp4');
  assert.equal(C.pickMime(m => m.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(C.pickMime(() => false), '');
  assert.equal(C.pickMime(undefined), '');
  assert.equal(C.pickMime(() => { throw new Error('x'); }), '');
  assert.equal(C.baseMime('audio/ogg; codecs=opus'), 'audio/ogg');
  assert.equal(C.formatTimer(7), '0:07');
  assert.equal(C.formatTimer(60), '1:00');
  assert.equal(C.formatTimer(-3), '0:00');
});
