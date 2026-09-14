'use strict';
// /afiya and /asmat as thin chat pages: the search-engine head they had, the shared chat assets, and a config
// whose safety texts are the agents' own — read from assistant/afiya.js and assistant/asmat.js, never copied
// by hand and left to drift. Every suggestion and chip is run through the real agent: a tap must never be
// sent to Bini, and must never page a person.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const afiya = require('../assistant/afiya');
const asmat = require('../assistant/asmat');
const lang = require('../assistant/lang');
const PUB = path.join(__dirname, '..', 'public');

const PAGES = [
  { file: 'afiya.html', slug: 'afiya', mod: afiya, agent: require('../agents/afiya/rules'), theme: 'ac-teal', banner: '907', head: [
    '<title>ዶ/ር አፍያ — Health Guide for Ethiopia | BinaSmart</title>',
    '<meta name="description" content="ዶ/ር አፍያ የቢናስማርት የጤና መረጃ አገልግሎት — የትኛው ክፍል፣ ምን ይዘው መሄድ እንዳለብዎና መቼ። ሐኪም አይደለችም። Dr Afiya guides you through Ethiopia\'s health system.">',
    '<meta property="og:title" content="Dr Afiya | BinaSmart">',
    '<meta property="og:description" content="ዶ/ር አፍያ የቢናስማርት የጤና መረጃ አገልግሎት — የትኛው ክፍል፣ ምን ይዘው መሄድ እንዳለብዎና መቼ። ሐኪም አይደለችም። Dr Afiya guides you through Ethiopia\'s health system.">',
    '<meta property="og:url" content="https://bina.et/afiya">', '<link rel="canonical" href="https://bina.et/afiya">'],
    about: ['Dr Afiya does not diagnose, name a medicine or a dose, read a test result, or tell you whether something is serious.', 'በሽታ መለየት ወይም ማስወገድ', 'የላቦራቶሪ ውጤት መተርጎም', 'ሐኪም አይደለችም፤ በሽታ አትለይም፣ መድሃኒት አታዝዝም።'] },
  { file: 'asmat.html', slug: 'asmat', mod: asmat, agent: require('../agents/asmat/rules'), theme: 'ac-blue', banner: '991', head: [
    '<title>አስማት — Ethiopian Legal Procedure Guide | BinaSmart</title>',
    '<meta name="description" content="አስማት የቢናስማርት የሕግ አሰራርና ሰነድ መመሪያ — የትኛው ጽ/ቤት፣ ምን ሰነድ፣ በምን ቅደም ተከተል። ጠበቃ አይደለም። Asmat explains Ethiopian legal procedure and paperwork.">',
    '<meta property="og:title" content="Asmat | BinaSmart">',
    '<meta property="og:description" content="አስማት የቢናስማርት የሕግ አሰራርና ሰነድ መመሪያ — የትኛው ጽ/ቤት፣ ምን ሰነድ፣ በምን ቅደም ተከተል። ጠበቃ አይደለም። Asmat explains Ethiopian legal procedure and paperwork.">',
    '<meta property="og:url" content="https://bina.et/asmat">', '<link rel="canonical" href="https://bina.et/asmat">'],
    about: ['Asmat does not advise on your own case, predict how it will end, say who is right, or draft anything to be signed or filed.', 'ውጤቱ ምን እንደሚሆን መተንበይ', 'አቤቱታ ወይም መከላከያ መጻፍ', 'ጠበቃ አይደለም፤ በጉዳይዎ አይወክልዎትም።'] },
];
const UI_KEYS = ['chats', 'newChat', 'close', 'noChats', 'delete', 'deleteAll', 'deleteAllConfirm', 'local', 'oldChat', 'send', 'mic', 'stop',
  'typing', 'from', 'emergencyTitle', 'urgentTitle', 'error', 'retry', 'listening', 'unclear', 'tooLong', 'micDenied', 'voiceError', 'voiceBusy'];

const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');
function config(html) {
  const m = html.match(/<script id="agent-chat-config" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'config block missing');
  return JSON.parse(m[1]);
}

for (const P of PAGES) {
  const html = read(P.file), cfg = config(html);

  test(P.file + ': the search-engine head is unchanged', () => {
    for (const line of P.head) assert.ok(html.includes(line), 'missing: ' + line);
    assert.equal(html.split('<title>').length - 1, 1);
    assert.ok(html.includes('<html lang="am" class="ac-page ' + P.theme + '">'));
  });

  test(P.file + ': loads the shared chat, versioned, core before the page script, footer kept', () => {
    const order = ['/static/fonts/fonts.css?v=2', '/static/site-v3.css?v=5', '/static/agent-chat.css?v=1',
      '/static/agent-chat-core.js?v=1', '/static/agent-chat.js?v=1', '/static/bina-footer.js?v=9'];
    let at = -1;
    for (const a of order) { const i = html.indexOf(a); assert.ok(i > at, a + ' missing or out of order'); at = i; }
    for (const f of ['agent-chat.css', 'agent-chat-core.js', 'agent-chat.js', 'agents/' + P.slug + '.svg']) assert.ok(fs.existsSync(path.join(PUB, f)), f);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map(m => m[1]);
    assert.deepEqual(inline, [' id="agent-chat-config" type="application/json"'], 'no inline script besides the config');
    assert.ok(html.includes('id="agent-chat"'));
  });

  test(P.file + ': the disclosures and emergency numbers are the agent\'s own', () => {
    assert.equal(cfg.api, '/api/' + P.slug);
    assert.equal(cfg.voiceApi, '/api/assistant/voice');
    assert.equal(cfg.storageKey, 'bina_chat_' + P.slug);
    assert.equal(cfg.avatar, '/static/agents/' + P.slug + '.svg?v=1');
    for (const l of ['am', 'en', 'om']) assert.equal(cfg.disclosure[l], P.mod.disclosure(l), 'disclosure ' + l);
    assert.deepEqual(cfg.emergency.numbers, [afiya.AMBULANCE, afiya.POLICE, afiya.FIRE]);
    for (const l of ['am', 'en', 'om']) assert.equal(cfg.emergency.labels[l].length, 3);
    assert.equal(cfg.banner.call, P.banner);
    assert.ok(html.includes('<a href="tel:' + P.banner + '">' + P.banner + '</a>'), 'the number is on the page without JavaScript');
  });

  test(P.file + ': every text the chat shows exists in Amharic and English', () => {
    for (const k of ['name', 'role', 'greeting', 'intro', 'placeholder']) for (const l of ['am', 'en']) assert.ok(cfg[k][l], k + '.' + l);
    for (const l of ['am', 'en']) {
      assert.ok(cfg.banner.text[l]);
      assert.equal(cfg.suggestions[l].length, 4, 'four suggestions ' + l);
      assert.ok(cfg.chips[l].length >= 1 && cfg.chips[l].length <= 3, 'up to three chips ' + l);
      for (const k of UI_KEYS) assert.ok(cfg.ui[l][k], 'ui.' + l + '.' + k);
    }
    if (P.slug === 'afiya') for (const l of ['am', 'en']) assert.match(cfg.ui[l].error, /907/, 'Afiya\'s error text always gives 907');
  });

  test(P.file + ': every suggestion and chip stays with this agent and opens no gate', () => {
    for (const l of ['am', 'en']) for (const q of cfg.suggestions[l].concat(cfg.chips[l])) {
      const d = lang.detect(q);
      const c = { msg: q, lang: d, l: (d === 'am' || d === 'am-latin') ? 'am' : (d === 'om' ? 'om' : 'en'), user: {}, scope: null };
      assert.equal(P.agent.gates.some(g => g.test(c)), false, 'gate fires for: ' + q);
      assert.equal(P.agent.inScope(c), true, 'redirected: ' + q);
      assert.ok(q.length <= 500);
    }
  });

  test(P.file + ': without JavaScript the greeting, the suggestions as ?q= links and the About text are there', () => {
    assert.ok(html.includes('<h1>' + cfg.greeting.am + '</h1>'));
    for (const q of cfg.suggestions.am) assert.ok(html.includes('<a class="ac-sug" href="/' + P.slug + '?q=' + encodeURIComponent(q) + '">' + q + '</a>'), q);
    assert.ok(html.includes('Your chats stay on this phone.'));
    const about = html.slice(html.indexOf('<section class="ac-about">'), html.indexOf('</section>', html.indexOf('<section class="ac-about">')));
    assert.ok(about.includes('<details>') && about.includes('<summary>'));
    for (const t of P.about) assert.ok(about.includes(t), 'About lost: ' + t);
  });
}

test('the two pages keep their chats apart', () => {
  assert.notEqual(config(read('afiya.html')).storageKey, config(read('asmat.html')).storageKey);
});

test('every fixed text agent-chat.js asks for is in both pages, in Amharic and English', () => {
  const keys = new Set();
  for (const m of read('agent-chat.js').matchAll(/\bui\(([^()]*)\)/g)) for (const k of m[1].matchAll(/(?<!=== )'([A-Za-z]+)'/g)) keys.add(k[1]);
  assert.ok(keys.size >= 20, 'found ' + keys.size + ' keys');
  for (const page of ['afiya.html', 'asmat.html']) {
    const cfg = config(read(page));
    for (const k of keys) for (const l of ['am', 'en']) assert.ok(cfg.ui[l][k], page + ' ui.' + l + '.' + k);
  }
});
