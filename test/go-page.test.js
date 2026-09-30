'use strict';
// Bina, the customer app: /go (public/go.html + public/go/app.js), its manifest and the app link.
// Every reply, question and link below is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');
const html = fs.readFileSync(path.join(pub, 'go.html'), 'utf8');
const js = fs.readFileSync(path.join(pub, 'go', 'app.js'), 'utf8');
const ring = fs.readFileSync(path.join(pub, 'go', 'ring.js'), 'utf8');
const G = require('../public/go/app.js');
const plain = x => JSON.parse(JSON.stringify(x));

test('go.html: light only, its own manifest, the shared chat core, Ride on its own and every service on the ring', () => {
  assert.ok(!/prefers-color-scheme:\s*dark/.test(html), 'no dark theme');
  assert.ok(html.includes('content="light only"'));
  assert.ok(html.includes('rel="manifest" href="/go.webmanifest"'));
  assert.ok(html.includes('src="/static/agent-chat-core.js?v=1"'), 'reuses the /afiya /asmat core read-only');
  assert.match(html, /src="\/static\/go\/app\.js\?v=\d+"/);
  assert.ok(/<a class="ride" href="\/ride">/.test(html), 'Ride is its own card, not on the ring');
  assert.match(html, /src="\/static\/go\/ring\.js\?v=\d+"/);
  assert.ok(html.includes('id="stage"') && html.includes('id="ringPrev"') && html.includes('id="ringNext"') && html.includes('id="dOpen"'));
  assert.ok(html.includes('placeholder="ምን ልርዳዎ?"'));
  assert.equal((html.match(/class="try"/g) || []).length, 4, 'four example questions');
  assert.ok(html.includes('env(safe-area-inset-top)') && html.includes('env(safe-area-inset-bottom)'));
  assert.ok(/<meta name="robots" content="noindex">/.test(html), 'app page, not a second home page for search');
});

test('ring.js: fifteen services, every one a site path, Ride not among them, and it respects reduced motion', () => {
  const paths = [...ring.matchAll(/'(\/[a-z-]+)', '[a-z]+', '#[0-9A-F]{6}'\]/g)].map(m => m[1]);
  assert.equal(paths.length, 15);
  assert.equal(new Set(paths).size, 15, 'no service twice');
  assert.ok(!paths.includes('/ride') && !paths.includes('/go') && !paths.includes('/login'));
  assert.ok(ring.includes('prefers-reduced-motion'));
  assert.ok(!/\(\?<[=!]/.test(ring), 'no regex lookbehind (old Android Chrome cannot parse it)');
});

test('app.js writes replies as text, never as HTML, and never forces a sign-in', () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
  assert.ok(!/location\.(href|assign|replace)\s*[=(]\s*['"]\/login/.test(js), 'chat never redirects to /login');
  assert.ok(js.includes("'/api/assistant'") && js.includes("'/api/assistant/voice'"));
});

test('links: site paths become bina.et, only http(s) and tel survive', () => {
  assert.equal(G.safeHref('/ride'), 'https://bina.et/ride');
  assert.equal(G.safeHref('https://example.org/x'), 'https://example.org/x');
  assert.equal(G.safeHref('tel:907'), 'tel:907');
  assert.equal(G.safeHref('javascript:alert(1)'), null);
  assert.equal(G.safeHref('//evil.example/x'), null);
  assert.equal(G.safeHref('data:text/html,hi'), null);
  assert.ok(G.isInternal('https://bina.et/news') && !G.isInternal('https://bina.et.example.org/'));
});

test('inline: bold, markdown links and bare links; an unsafe markdown link is shown as text', () => {
  const s = plain(G.inline('**ክፍያ** ይመልከቱ [መመሪያ](/passport) ወይም https://example.org/a/b. [x](javascript:alert(1))'));
  assert.deepEqual(s[0], { t: 'b', v: 'ክፍያ' });
  assert.deepEqual(s.find(x => x.v === 'መመሪያ'), { t: 'a', v: 'መመሪያ', href: 'https://bina.et/passport' });
  const bare = s.find(x => x.href === 'https://example.org/a/b');
  assert.ok(bare && bare.v === 'example.org/a/b', 'bare link shown without scheme, trailing dot left out');
  assert.ok(!s.some(x => x.href && /^javascript/i.test(x.href)));
});

test('inline: "bina.et/path" without https becomes an in-app link, and birr amounts are bold', () => {
  const s = plain(G.inline('ክፍያው 5,000 ብር ነው፤ ዝርዝሩ እዚህ፦ bina.et/sample-guide። (www.bina.et/ride) ቁጥር 550/2024'));
  assert.deepEqual(s.find(x => x.t === 'b'), { t: 'b', v: '5,000 ብር' });
  assert.deepEqual(s.filter(x => x.t === 'a'), [
    { t: 'a', v: 'bina.et/sample-guide', href: 'https://bina.et/sample-guide' },
    { t: 'a', v: 'bina.et/ride', href: 'https://bina.et/ride' }]);
  assert.ok(s.some(x => x.t === 'text' && x.v.includes('550/2024')), 'a law number is not a price');
  assert.ok(!/\(\?<[=!]/.test(js), 'no regex lookbehind (old Android Chrome cannot parse it)');
});

test('blocks: lists, numbered steps and a quieter source line', () => {
  const b = plain(G.blocks('መልስ፦\n\n* አንድ\n* ሁለት\n\n1. መጀመሪያ\n2. ቀጥሎ\n\nምንጭ፦ ናሙና ቢሮ፣ 2026-01-02'));
  assert.deepEqual(b.map(x => x.type), ['p', 'ul', 'ol', 'src']);
  assert.equal(b[1].items.length, 2);
  const same = plain(G.blocks('ዋጋዎቹ፦ * **አንድ:** 10 ብር\n* **ሁለት:** 20 ብር'));
  assert.deepEqual(same.map(x => x.type), ['p', 'ul'], 'a bullet right after ፦ starts the list');
  assert.equal(same[1].items.length, 2);
  const tail = plain(G.blocks('* **ሀ:** 10 ብር\n* **ለ:** 20 ብር ይህ ዋጋ ከጉዞው በፊት ይቆለፋል። ሌላ ጥያቄ አለዎት?'));
  assert.deepEqual(tail.map(x => x.type), ['ul', 'p'], 'the closing sentence leaves the last bullet');
  assert.equal(tail[1].items[0][0].v, 'ይህ ዋጋ ከጉዞው በፊት ይቆለፋል። ሌላ ጥያቄ አለዎት?');
});

test('open buttons: at most two bina.et pages, never /go, /login or outside sites', () => {
  const o = plain(G.opensFrom('ራይድ፦ https://bina.et/ride ዜና፦ [ዜና](/news) ግባ፦ /login [x](/go) https://example.org/ride [ሲኒማ](/cinema)'));
  assert.deepEqual(o, [{ href: 'https://bina.et/ride', label: 'ራይድ ይዘዙ' }, { href: 'https://bina.et/news', label: 'ዜና' }]);
  const q = plain(G.opensFrom('ዋጋው 205 ብር ነው።', G.pageForTools(['search_places', 'quote_ride'])));
  assert.deepEqual(q, [{ href: 'https://bina.et/ride', label: 'ራይድ ይዘዙ' }], 'a fare quote offers the ride page');
  assert.equal(G.pageForTools(['contact_team']), undefined);
});

test('history: the last six answered turns in the shape /api/assistant reads; failed turns are left out', () => {
  const msgs = [];
  for (let i = 0; i < 5; i++) { msgs.push({ r: 'u', t: 'ጥያቄ ' + i }); msgs.push({ r: 'b', t: 'መልስ ' + i }); }
  msgs.push({ r: 'b', t: 'x', k: 'err' });
  const h = plain(G.historyFor(msgs));
  assert.equal(h.length, 6);
  assert.deepEqual(h[0], { role: 'user', content: 'ጥያቄ 2' });
  assert.deepEqual(h[5], { role: 'assistant', content: 'መልስ 4' });
});

test('stored chat: survives a reload, expires after a week, and junk from storage is dropped', () => {
  const mem = { v: {}, getItem(k) { return this.v[k] == null ? null : this.v[k]; }, setItem(k, v) { this.v[k] = String(v); } };
  const now = Date.UTC(2026, 8, 23);
  assert.ok(G.saveChat(mem, [{ r: 'u', t: 'ሰላም' }, { r: 'b', t: 'እርዳታ', k: 'sos', amb: '907' }], now));
  assert.deepEqual(plain(G.loadChat(mem, now + 1000)), [{ r: 'u', t: 'ሰላም' }, { r: 'b', t: 'እርዳታ', k: 'sos', amb: '907' }]);
  assert.deepEqual(G.loadChat(mem, now + 8 * 864e5).length, 0);
  mem.v[G.STORE_KEY] = JSON.stringify({ at: now, msgs: [{ r: 'x', t: 'a' }, { r: 'b', t: 5 }, { r: 'b', t: 'ok', amb: 'tel:1' }] });
  assert.deepEqual(plain(G.loadChat(mem, now)), [{ r: 'b', t: 'ok' }]);
  mem.v[G.STORE_KEY] = '{broken';
  assert.deepEqual(G.loadChat(mem, now), []);
  assert.deepEqual(G.loadChat(null, now), []);
});

test('the app manifest starts at /go, keeps the whole site in the app and points at real icons', () => {
  const m = JSON.parse(fs.readFileSync(path.join(pub, 'go.webmanifest'), 'utf8'));
  assert.equal(m.start_url, '/go?src=app');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.short_name, 'Bina');
  const partner = JSON.parse(fs.readFileSync(path.join(pub, 'partner.webmanifest'), 'utf8'));
  assert.notEqual(m.id, partner.id, 'a different app from Bina Partner');
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const f = path.join(pub, i.src.replace(/^\/static\//, ''));
    assert.ok(fs.existsSync(f), 'icon exists: ' + i.src);
    const png = fs.readFileSync(f);
    assert.equal(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), i.sizes, 'real size of ' + i.src);
  }
});

test('server.js serves /go and its manifest', () => {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(src.includes("fastify.get('/go', ") && src.includes("sendFile('go.html')"));
  assert.ok(src.includes("fastify.get('/go.webmanifest', ") && src.includes("sendFile('go.webmanifest')"));
});

test('assetlinks.json names both apps, each with a well-formed SHA-256', () => {
  const a = JSON.parse(fs.readFileSync(path.join(pub, '.well-known', 'assetlinks.json'), 'utf8'));
  for (const pkg of ['et.bina.partner', 'et.bina.app']) {
    const st = a.find(s => s.target && s.target.package_name === pkg);
    assert.ok(st, 'statement for ' + pkg);
    assert.deepEqual(st.relation, ['delegate_permission/common.handle_all_urls']);
    assert.equal(st.target.namespace, 'android_app');
    assert.ok(st.target.sha256_cert_fingerprints.length >= 1);
    for (const f of st.target.sha256_cert_fingerprints) assert.match(f, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  }
});

test('share: the question, the start of the answer as plain text, and a link that only types the question in', () => {
  const t = G.shareText('የፓስፖርት ክፍያ ስንት ነው?', '**ክፍያው** 5,000 ብር ነው። ዝርዝሩ [እዚህ](https://bina.et/passport) ነው።');
  assert.ok(t.startsWith('❓ የፓስፖርት ክፍያ ስንት ነው?'));
  assert.match(t, /ክፍያው 5,000 ብር ነው። ዝርዝሩ እዚህ ነው።/, 'bold and link markup become plain text');
  assert.ok(t.endsWith('— ቢኒ · Bini, bina.et'));
  const long = G.shareText('q', 'ሀ '.repeat(400));
  assert.ok(long.length < 330, 'a long answer is cut short: ' + long.length);
  assert.equal(G.shareLink('ከቦሌ ወደ ፒያሳ?'), 'https://bina.et/go?q=' + encodeURIComponent('ከቦሌ ወደ ፒያሳ?') + '&s=share');
  assert.ok(G.shareLink('x'.repeat(2000)).length < 360, 'the question in the link is capped');
  const boot = js.slice(js.indexOf('// A shared link'), js.indexOf('syncSend(); syncResume();'));
  assert.ok(boot.includes('q.value') && !/submit\(|ask_\(/.test(boot), 'a shared link fills the box and never asks by itself');
});
