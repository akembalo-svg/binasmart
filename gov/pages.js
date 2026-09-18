'use strict';
// The three documents the government widget serves: the loader (on the office's page), the frame (on
// bina.et, inside the office's page), and the private demo (on bina.et). Every string from the tenant goes
// into a JSON block with < escaped, or through esc(); nothing is concatenated into HTML raw.
const fs = require('fs');
const path = require('path');

const LOADER = fs.readFileSync(path.join(__dirname, 'loader.js'), 'utf8');
const json = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pickLangs = (o, langs) => Object.fromEntries(langs.filter(l => o && o[l] != null).map(l => [l, o[l]]));

const UI = {
  am: { chats: 'የቀድሞ ውይይቶች', newChat: 'አዲስ ውይይት', close: 'ዝጋ', noChats: 'እስካሁን ውይይት የለም።', delete: 'ሰርዝ',
    deleteAll: 'ሁሉንም ውይይቶች ሰርዝ', deleteAllConfirm: 'ሁሉንም ውይይቶች ከዚህ መሣሪያ ልሰርዝ?', local: 'ውይይቶችዎ በዚህ መሣሪያ ላይ ብቻ ይቀመጣሉ።',
    oldChat: 'የቀድሞ ውይይት ነው። ረዳቱ አያስታውሰውም፤ ጥያቄዎን ሙሉ በሙሉ ይጻፉ።', send: 'ላክ', mic: 'በድምፅ ይጠይቁ', stop: 'አቁም',
    typing: 'በመጻፍ ላይ…', from: 'ምንጭ፦', fetched: 'የተወሰደበት ቀን እ.ኤ.አ.', emergencyTitle: 'አሁኑኑ ይደውሉ', urgentTitle: 'አስቸኳይ ነው',
    error: 'መልስ ማግኘት አልተቻለም። እንደገና ይሞክሩ። አስቸኳይ ከሆነ 991 ይደውሉ።', retry: 'እንደገና ሞክር', listening: '', unclear: '',
    tooLong: '', micDenied: '', voiceError: '', voiceBusy: '', up: 'ጠቃሚ ነበር', down: 'ጠቃሚ አልነበረም', report: 'የተሳሳተ መልስ ሪፖርት አድርግ',
    reportConsent: 'ይህ ጥያቄዎንና መልሳችንን ለግምገማ ወደ ቢናስማርት ይልካል። ስምዎን ወይም ስልክ ቁጥርዎን አያካትቱ። ልላክ?',
    reportYes: 'አዎ፣ ላክ', reportNo: 'አይ', thanks: 'እናመሰግናለን።', expired: 'ገጹ እየታደሰ ነው…' },
  en: { chats: 'Past chats', newChat: 'New chat', close: 'Close', noChats: 'No chats yet.', delete: 'Delete',
    deleteAll: 'Delete all chats', deleteAllConfirm: 'Delete all chats from this device?', local: 'Your chats stay on this device.',
    oldChat: 'An earlier chat. The assistant does not remember it, so ask your question in full.', send: 'Send', mic: 'Ask by voice',
    stop: 'Stop', typing: 'Writing…', from: 'Source:', fetched: 'fetched', emergencyTitle: 'Call now', urgentTitle: 'This is urgent',
    error: 'Couldn\'t get an answer. Try again. If this is an emergency, call 991.', retry: 'Try again', listening: '', unclear: '',
    tooLong: '', micDenied: '', voiceError: '', voiceBusy: '', up: 'Helpful', down: 'Not helpful', report: 'Report a wrong answer',
    reportConsent: 'This sends your question and our answer to BinaSmart for review. Do not include your name or phone number. Send it?',
    reportYes: 'Yes, send', reportNo: 'No', thanks: 'Thank you.', expired: 'Refreshing…' },
};

function loaderScript(office) {
  const t = office.tenant;
  const cfg = { frame: 'https://bina.et/w/' + t.id + '/frame?k=' + office.ops.publicKey, color: t.brand.color,
    label: t.brand.label, title: t.assistantName, close: { am: 'ዝጋ', en: 'Close', om: 'Cufi' } };
  return '/* BinaSmart assistant for ' + t.id + ' - https://bina.et/terms#api */\n' + LOADER.replace('__CFG__', json(cfg));
}

function frameHtml(office, token, l) {
  const t = office.tenant, langs = t.languages;
  const lang = langs.includes(l) ? l : 'am';
  const tel = ['907', '991'].concat((t.contacts || []).filter(c => c.approved === true).map(c => c.tel));
  const cfg = {
    agent: 'gov-' + t.id, api: '/api/w/' + t.id + '/ask', headers: { 'x-bina-frame': token },
    feedback: { api: '/api/w/' + t.id + '/feedback' }, storageKey: 'bina_gov_' + t.id,
    avatar: '/static/w/assistant.svg?v=1', voice: false, sources: true,
    name: pickLangs(t.assistantName, langs), role: pickLangs(t.role, langs), greeting: pickLangs(t.greeting, langs),
    intro: pickLangs(t.intro, langs), placeholder: pickLangs(t.placeholder, langs),
    suggestions: pickLangs(t.suggestions, langs), chips: pickLangs(t.suggestions, langs),
    footer: pickLangs(t.footer, langs), disclosure: pickLangs(t.footer, langs),
    emergency: { numbers: tel, labels: { am: ['አምቡላንስ', 'ፖሊስ'], en: ['Ambulance', 'Police'] } },
    ui: pickLangs(UI, langs),
  };
  return '<!doctype html>\n<html lang="' + lang + '"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">'
    + '<title>' + esc(t.assistantName[lang] || t.assistantName.en) + '</title>'
    + '<link rel="stylesheet" href="/static/fonts/fonts.css?v=2"><link rel="stylesheet" href="/static/agent-chat.css?v=1">'
    + '<style>:root{--ac-brand:' + esc(t.brand.color) + '}html,body{height:100%;margin:0}.ac{height:100%}'
    + '.ac-foot{font-size:12px;line-height:1.4;margin:0;padding:6px 12px;background:#f4f6f8;color:#333}</style></head><body>'
    + '<script id="agent-chat-config" type="application/json">' + json(cfg) + '</script>'
    + '<div id="agent-chat" class="ac"></div>'
    + '<script src="/static/w/frame.js?v=1"></script>'
    + '<script src="/static/agent-chat-core.js?v=3" defer></script><script src="/static/agent-chat.js?v=3" defer></script>'
    + '</body></html>';
}

function demoHtml(office) {
  const t = office.tenant;
  return '<!doctype html>\n<html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow"><title>MOCK - ' + esc(t.institution.en) + ' - BinaSmart demo</title>'
    + '<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#222;background:#fafafa}'
    + '.mock{background:#b00020;color:#fff;padding:12px 16px;font-weight:700}'
    + 'header{background:#fff;border-bottom:1px solid #ddd;padding:16px}main{max-width:860px;margin:0 auto;padding:16px}'
    + 'section{background:#fff;border:1px solid #e3e3e3;border-radius:8px;padding:16px;margin:0 0 16px}</style></head><body>'
    + '<div class="mock">MOCK: this is not the ' + esc(t.institution.en) + '\'s website. BinaSmart built it to show how the assistant would look installed. '
    + 'ይህ የ' + esc(t.institution.am) + ' ድረ ገጽ አይደለም፤ ረዳቱ ሲጫን ምን እንደሚመስል ለማሳየት ቢናስማርት የሠራው ናሙና ነው።</div>'
    + '<header><strong>' + esc(t.institution.am) + ' · ' + esc(t.institution.en) + '</strong> (mock page)</header><main>'
    + '<section><h2>የውጭ አገር ሥራ ስምሪት · Overseas employment</h2><p>A placeholder section where a ministry page would describe '
    + 'working abroad. The ministry\'s own page on this subject held 57 characters when it was measured on 17 September 2026.</p></section>'
    + '<section><h2>የሥራ ፈቃድ · Work permits</h2><p>A placeholder section where a ministry page would describe work permits for foreign nationals. '
    + 'Press the button in the corner to ask the assistant.</p></section></main>'
    + '<script src="/w/' + esc(t.id) + '.js" async></script></body></html>';
}

module.exports = { loaderScript, frameHtml, demoHtml, UI };
