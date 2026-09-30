// bina.et/health/dashboard (30 Sep 2026): who may edit a checked profile, what they may change, and Dr Afiya's
// professional mode. The account always comes from the session (req.authUser), never from the body.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const STORE = path.join(os.tmpdir(), 'health-dash-' + process.pid + '.json');
const OSMF = path.join(os.tmpdir(), 'health-dash-osm-' + process.pid + '.json');
process.env.HEALTH_FILE = STORE; process.env.HEALTH_OSM_FILE = OSMF;
fs.writeFileSync(OSMF, JSON.stringify({ bySub: { way2: 'Arada' }, elements: [
  { type: 'way', id: 2, center: { lat: 9.03, lon: 38.75 }, tags: { amenity: 'dentist', name: 'Selam Dental Clinic', phone: '011 000 0070' } }] }));
const health = require('../health/directory');
const dashboard = require('../health/dashboard');
const pro = require('../agents/afiya-pro/rules');

function app({ proven = {} } = {}) {
  const routes = {}, sent = [], agentCalls = [];
  const fastify = { get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  const tell = async t => { sent.push(t); return true; };
  const prisma = { authUser: { findUnique: async ({ where }) => proven[where.id] || null } };
  health(fastify, { prisma, limiter: () => () => true, tell }, () => {});
  dashboard(fastify, { prisma, limiter: () => () => true, tell, agent: pro,
    runAgent: async (agent, req, reply, opts) => { agentCalls.push({ agent: agent.name, body: req.body, opts }); return { reply: 'draft' }; } }, () => {});
  const call = async (k, req = {}) => {
    const r = { c: 200, h: {}, code(n) { this.c = n; return this; }, header(a, b) { this.h[a] = b; return this; }, type() { return this; }, send(x) { this.body = x; return x; }, sendFile(f) { this.file = f; return f; } };
    const out = await routes[k](Object.assign({ headers: {}, query: {}, params: {}, body: {}, authUser: null }, req), r);
    return { code: r.c, body: out };
  };
  return { call, sent, agentCalls };
}
const ALICE = { id: 'user-alice', name: 'Selam T' }, BOB = { id: 'user-bob', name: 'Bob' };
const doctor = { type: 'doctor', name: 'Dr Selam Tesfaye', phone: '0900 000 051', profession: 'dentist', specialty: 'Orthodontics',
  licence: 'MOH-99887-ABC', licenceIssuer: 'Ministry of Health', services: ['Braces'], languages: ['Amharic'], facilityRef: 'way/2' };
async function approved(A, body = doctor, as = null) {
  const r = await A.call('POST /api/health/submit', { body, authUser: as });
  const t = /approve\?t=([a-f0-9]+)/.exec(A.sent[A.sent.length - 1])[1];
  await A.call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t } });
  const E = JSON.parse(fs.readFileSync(STORE, 'utf8')).entries.find(e => e.id === r.body.id);
  return E;
}

test.beforeEach(() => { try { fs.unlinkSync(STORE); } catch (e) {} });
test.after(() => { for (const f of [STORE, OSMF]) try { fs.unlinkSync(f); } catch (e) {} });

test('signed out: every dashboard door is shut', async () => {
  const A = app();
  for (const [k, params] of [['GET /api/health/mine'], ['POST /api/health/claim'], ['POST /api/health/mine/:id', { id: 'x' }], ['POST /api/health/assist'], ['POST /api/health/mine/:id/pause', { id: 'x' }]])
    assert.strictEqual((await A.call(k, { params: params || {} })).code, 401, k);
});

test('approval makes a one-time code; the code links the profile once; the licence stays masked', async () => {
  const A = app(), E = await approved(A);
  assert.match(E.dashCode, /^[A-HJ-KM-NP-Z2-9]{8}$/); assert.ok(E.manageToken);
  assert.ok(A.sent.some(s => s.includes(health.fmtCode(E.dashCode)) && /Dashboard code/.test(s)));
  assert.strictEqual((await A.call('POST /api/health/claim', { authUser: ALICE, body: { code: 'ABCD-EFGH' } })).body.error, 'bad_code');
  const typed = E.dashCode.toLowerCase().slice(0, 4) + ' - ' + E.dashCode.toLowerCase().slice(4);    // how people type it
  assert.strictEqual((await A.call('POST /api/health/claim', { authUser: ALICE, body: { code: typed } })).body.ok, true);
  assert.strictEqual((await A.call('POST /api/health/claim', { authUser: BOB, body: { code: E.dashCode } })).body.error, 'bad_code');   // used
  const mine = (await A.call('GET /api/health/mine', { authUser: ALICE })).body;
  assert.strictEqual(mine.entries.length, 1); assert.strictEqual(mine.entries[0].licence, '••••ABC');
  assert.doesNotMatch(JSON.stringify(mine), /MOH-99887|manageToken|dashCode|"token"/);
  assert.strictEqual((await A.call('GET /api/health/mine', { authUser: BOB })).body.entries.length, 0);
});

test('an expired code does not work', async () => {
  const A = app(), E = await approved(A);
  const S = JSON.parse(fs.readFileSync(STORE, 'utf8')); S.entries[0].dashCodeExpires = new Date(Date.now() - 1000).toISOString(); fs.writeFileSync(STORE, JSON.stringify(S));
  assert.strictEqual((await A.call('POST /api/health/claim', { authUser: ALICE, body: { code: E.dashCode } })).body.error, 'bad_code');
});

test('sent while signed in: that account manages it after approval; a proven phone links it too', async () => {
  const A = app(), E = await approved(A, doctor, ALICE);
  assert.strictEqual(E.ownerUserId, ALICE.id);
  const B = app({ proven: { 'user-carol': { phone: '+251900000052', phoneVerifiedAt: new Date() }, 'user-dan': { phone: '+251900000053', phoneVerifiedAt: null } } });
  await approved(B, Object.assign({}, doctor, { name: 'Dr Carol', phone: '0900 000 052' }));
  await approved(B, Object.assign({}, doctor, { name: 'Dr Dan', phone: '0900 000 053' }));
  assert.strictEqual((await B.call('GET /api/health/mine', { authUser: { id: 'user-carol' } })).body.entries[0].name, 'Dr Carol');
  assert.strictEqual((await B.call('GET /api/health/mine', { authUser: { id: 'user-dan' } })).body.entries.length, 0);   // a typed, unproven phone links nothing
});

test('the owner edits services, hours and About live; name and licence are not theirs to change', async () => {
  const A = app(), E = await approved(A, doctor, ALICE);
  assert.strictEqual((await A.call('POST /api/health/mine/:id', { authUser: BOB, params: { id: E.id }, body: { hours: 'x' } })).code, 404);
  const r = await A.call('POST /api/health/mine/:id', { authUser: ALICE, params: { id: E.id }, body: {
    services: ['Braces', 'Teeth whitening'], hours: 'Mon–Sat 9:00–18:00', about: 'I straighten teeth for adults and children.\nWe are the best clinic in Addis.',
    name: 'Dr Somebody Else', licence: 'FAKE', profession: 'gp', showPhone: true, whatsapp: true } });
  assert.strictEqual(r.body.ok, true);
  assert.deepStrictEqual(r.body.changed.sort(), ['about', 'hours', 'services', 'showPhone', 'whatsapp']);
  const S = JSON.parse(fs.readFileSync(STORE, 'utf8')).entries[0];
  assert.strictEqual(S.name, 'Dr Selam Tesfaye'); assert.strictEqual(S.licence, 'MOH-99887-ABC'); assert.strictEqual(S.profession, 'dentist');
  const fyi = A.sent[A.sent.length - 1];
  assert.match(fyi, /edited the page/); assert.match(fyi, /Teeth whitening/); assert.match(fyi, /hide page/); assert.match(fyi, /makes a promise/);
  const page = (await A.call('GET /doctors/:slug', { params: { slug: S.slug } })).body;
  assert.match(page, /I straighten teeth/); assert.match(page, /Teeth whitening/); assert.match(page, /wa\.me\/251900000051/);
  // a dose on a public page is refused
  assert.strictEqual((await A.call('POST /api/health/mine/:id', { authUser: ALICE, params: { id: E.id }, body: { about: 'Take 500 mg twice.' } })).body.error, 'about_dose');
});

test('a facility page follows its latest update and its manager can add hours and a number', async () => {
  const A = app(), F = await approved(A, { type: 'facility', facilityRef: 'way/2', role: 'owner', name: 'Abebe', phone: '0900 000 054', services: ['Fillings'] }, ALICE);
  await A.call('POST /api/health/mine/:id', { authUser: ALICE, params: { id: F.id }, body: { services: ['Braces', 'Check-up & cleaning'], publicPhone: '011 000 0082', about: 'Family dental clinic.' } });
  const page = (await A.call('GET /health/:slug', { params: { slug: 'selam-dental-clinic-w2' } })).body;
  assert.match(page, /Check-up &amp; cleaning/); assert.doesNotMatch(page, />Fillings</); assert.match(page, /tel:\+251110000082/); assert.match(page, /Family dental clinic/);
  assert.strictEqual((await A.call('POST /api/health/mine/:id', { authUser: ALICE, params: { id: F.id }, body: { publicPhone: '12' } })).body.error, 'phone');
});

test('pause, and the team\'s hide / new code links', async () => {
  const A = app(), E = await approved(A, doctor, ALICE);
  await A.call('POST /api/health/mine/:id/pause', { authUser: ALICE, params: { id: E.id }, body: { paused: true } });
  assert.strictEqual((await A.call('GET /doctors/:slug', { params: { slug: E.slug } })).code, 404);
  await A.call('POST /api/health/mine/:id/pause', { authUser: ALICE, params: { id: E.id }, body: { paused: false } });
  assert.strictEqual((await A.call('GET /doctors/:slug', { params: { slug: E.slug } })).code, 200);
  const m = (action, t) => A.call('GET /ops/health/:id/manage/:action', { params: { id: E.id, action }, query: { t } });
  assert.strictEqual((await m('hide', 'wrong')).code, 404);
  await m('hide', E.manageToken);
  assert.strictEqual((await A.call('GET /doctors/:slug', { params: { slug: E.slug } })).code, 404);
  assert.strictEqual((await A.call('POST /api/health/mine/:id/pause', { authUser: ALICE, params: { id: E.id }, body: { paused: false } })).body.error, 'hidden_by_team');
  await m('unhide', E.manageToken);
  assert.strictEqual((await A.call('GET /doctors/:slug', { params: { slug: E.slug } })).code, 200);
  assert.match(String((await m('newcode', E.manageToken)).body), /New dashboard code/);
  const S = JSON.parse(fs.readFileSync(STORE, 'utf8')).entries[0];
  assert.ok(S.dashCode && S.dashCode !== E.dashCode);
});

test('Dr Afiya for professionals: owners only, with their profile as scope and no phone numbers or licence', async () => {
  const A = app(), E = await approved(A, doctor, ALICE);
  assert.strictEqual((await A.call('POST /api/health/assist', { authUser: BOB, body: { entryId: E.id, message: 'hi' } })).code, 403);
  const r = await A.call('POST /api/health/assist', { authUser: ALICE, body: { entryId: E.id, task: 'reply', message: 'Patient Abebe 0900 000 072 asks: are you open Saturday?' } });
  assert.strictEqual(r.body.reply, 'draft');
  const c = A.agentCalls[0];
  assert.strictEqual(c.agent, 'afiya-pro'); assert.strictEqual(c.opts.scope.task, 'reply');
  assert.match(c.body.message, /\[phone\]/); assert.doesNotMatch(c.body.message, /0900 000 072/);
  assert.strictEqual(c.opts.scope.profile.name, 'Dr Selam Tesfaye'); assert.strictEqual(c.opts.scope.profile.facility, 'Selam Dental Clinic');
  assert.doesNotMatch(JSON.stringify(c.opts.scope), /MOH-99887|0900/);
  assert.strictEqual((await A.call('POST /api/health/assist', { authUser: ALICE, body: { entryId: E.id, task: 'hack', message: 'x' } })).body.reply, 'draft');
  assert.strictEqual(A.agentCalls[1].opts.scope.task, 'chat');                        // unknown task falls back to chat
});

test('afiya-pro rules: emergencies answered without the model and without paging; no doses, no promises', async () => {
  const c = { msg: 'my patient is not breathing, what do I tell him', l: 'en', scope: { task: 'reply', profile: { name: 'Dr X' } } };
  const gate = pro.gates.find(g => g.test(c));
  assert.ok(gate, 'the emergency gate fires');
  const g = gate.answer(c);
  assert.strictEqual(g.handover, undefined); assert.strictEqual(g.log, undefined); assert.match(g.body.reply, /907/);
  assert.strictEqual(pro.log, false);
  assert.match(pro.instruct({ msg: 'write my about text', scope: { task: 'about' } }), /English:[\s\S]*አማርኛ:/);
  assert.match(pro.instruct({ msg: 'what dose of amoxicillin should I give', scope: { task: 'chat' } }), /CLINICAL DECISION/);
  const ctx = await pro.context({ scope: { task: 'about', profile: { name: 'Dr X', services: ['Braces'], fee: '500 birr' } } });
  assert.match(ctx.prompt, /Braces/); assert.match(ctx.grounding, /500 birr/);
  const run = t => pro.filters.reduce((s, f) => f(s).text, t);
  assert.strictEqual(run('We offer braces. Take 500 mg twice a day. Guaranteed results.'), 'We offer braces.');
  const shaped = 'English:\nYes, Dr. Abebe sees patients on Saturday. We offer braces.\n\nአማርኛ:\nብሬስ እንሰጣለን።\n- Tooth extraction\n- Fillings';
  assert.strictEqual(run(shaped), shaped);                                              // the shape the dashboard reads survives
  assert.strictEqual(run('English:\nWe offer braces. Guaranteed results.\nTake 2 tablets a day.\nOpen daily.'), 'English:\nWe offer braces.\n\nOpen daily.');
  assert.match(pro.finish({ msg: 'what dose of amoxicillin should I give', l: 'en' }, 'I can help with your profile.'), /Clinical decisions stay with you/);
});
