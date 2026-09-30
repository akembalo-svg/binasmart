// bina.et/health: facilities from the city map + doctors and facilities who join through Dr Afiya (30 Sep 2026).
// Nothing a person sends is public until the team approves it; a doctor's licence number is never public.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const STORE = path.join(os.tmpdir(), 'health-test-' + process.pid + '.json');
const OSMF = path.join(os.tmpdir(), 'health-osm-' + process.pid + '.json');
process.env.HEALTH_FILE = STORE; process.env.HEALTH_OSM_FILE = OSMF;
const OSM = { bySub: { node1: 'Bole', way2: 'Arada', node5: 'Kirkos' }, elements: [
  { type: 'node', id: 1, lat: 9.0, lon: 38.78, tags: { amenity: 'hospital', name: 'Test General Hospital', phone: '+251 11 000 0070; 0900 000 070', emergency: 'yes' } },
  { type: 'node', id: 11, lat: 9.0001, lon: 38.7801, tags: { amenity: 'hospital', name: 'Test General Hospital' } },          // the same place again, 15 m away
  { type: 'way', id: 2, center: { lat: 9.03, lon: 38.75 }, tags: { amenity: 'dentist', name: 'ሰላም የጥርስ ክሊኒክ', 'name:en': 'Selam Dental Clinic' } },
  { type: 'node', id: 3, lat: 9.01, lon: 38.76, tags: { amenity: 'pharmacy', name: 'Not Health Directory' } },
  { type: 'node', id: 4, lat: 9.02, lon: 38.77, tags: { amenity: 'clinic' } },                                                  // no name: skipped
  { type: 'node', id: 5, lat: 9.02, lon: 38.74, tags: { healthcare: 'laboratory', name: 'Kirkos Lab' } },
  { type: 'node', id: 6, lat: 9.05, lon: 38.70, tags: { amenity: 'clinic', name: 'Bethezata Clinic ቤተዛታ ክሊኒክ' } }] };
const health = require('../health/directory');

function app() {
  const routes = {}, sent = [];
  const fastify = { get(p, a, b) { routes['GET ' + p] = b || a; }, post(p, a, b) { routes['POST ' + p] = b || a; } };
  health(fastify, { prisma: {}, limiter: () => () => true, tell: async t => { sent.push(t); return true; } }, () => {});
  routes['GET /health'] = health.hub;
  const call = async (k, req = {}) => {
    const r = { c: 200, h: {}, code(n) { this.c = n; return this; }, header(a, b) { this.h[a] = b; return this; }, type() { return this; }, send(x) { this.body = x; return x; } };
    const out = await routes[k](Object.assign({ headers: {}, query: {}, params: {}, body: {} }, req), r);
    return { code: r.c, body: out, headers: r.h };
  };
  return { call, sent };
}
const doctor = { type: 'doctor', name: 'Dr Selam Tesfaye', phone: '0900 000 041', profession: 'dentist', specialty: 'Orthodontics',
  licence: 'MOH-12345-XYZ', licenceIssuer: 'Ministry of Health', services: ['Braces', 'Fillings'], languages: ['Amharic', 'English'], facilityRef: 'way/2' };
const tokenOf = (sent, i) => /approve\?t=([a-f0-9]+)/.exec(sent[i])[1];

test.before(() => fs.writeFileSync(OSMF, JSON.stringify(OSM)));
test.beforeEach(() => { try { fs.unlinkSync(STORE); } catch (e) {} });
test.after(() => { for (const f of [STORE, OSMF]) try { fs.unlinkSync(f); } catch (e) {} });

test('facilities from the map: kinds, English names, landlines only, one listing per place', () => {
  const F = health.buildFacilities(OSM);
  assert.deepStrictEqual(F.map(f => f.name), ['Test General Hospital', 'Bethezata Clinic', 'Selam Dental Clinic', 'Kirkos Lab']);
  assert.strictEqual(F[1].nameAm, 'ቤተዛታ ክሊኒክ');                               // both scripts in one tag: split
  const h = F[0];
  assert.strictEqual(h.kind, 'hospital'); assert.strictEqual(h.sub, 'Bole'); assert.strictEqual(h.subAm, 'ቦሌ'); assert.strictEqual(h.emergency, true);
  assert.deepStrictEqual(h.phones, ['+251 11 000 0070']);                     // the mobile in the map tag is dropped
  assert.strictEqual(F[2].nameAm, 'ሰላም የጥርስ ክሊኒክ'); assert.strictEqual(F[2].kind, 'dentist'); assert.strictEqual(F[2].slug, 'selam-dental-clinic-w2');
  assert.strictEqual(F[3].kind, 'lab');
});

test('wrong map tags: a resort or a church is not care, a misspelt twin is one place, the name decides the kind', () => {
  const F = health.buildFacilities({ bySub: {}, elements: [
    { type: 'way', id: 21, center: { lat: 9.01, lon: 38.76 }, tags: { amenity: 'hospital', name: "The Lion's Den Resort;The Lion’s Den resort", phone: '+251110000071' } },
    { type: 'node', id: 50, lat: 8.95, lon: 38.74, tags: { amenity: 'dentist', name: 'Haile Garment Good news for all nations Church', phone: '0900000071' } },
    { type: 'node', id: 51, lat: 8.9501, lon: 38.7401, tags: { amenity: 'dentist', name: 'Keti Dental Clinic', phone: '0900000071', 'name:am': 'ኬቲ የጥርስ ህክምና' } },
    { type: 'node', id: 52, lat: 8.9502, lon: 38.7402, tags: { amenity: 'dentist', name: 'Keti Dental clunic', phone: '+251 900 000 071' } },
    { type: 'way', id: 26, center: { lat: 9.03, lon: 38.75 }, tags: { amenity: 'hospital', name: 'Zoya clinic' } },
    { type: 'node', id: 32, lat: 9.04, lon: 38.75, tags: { amenity: 'clinic', name: 'International Clinical Laburatory', 'name:am': 'ኢንተርናሽናል ላቡራቶሪ International Clinical Laboratory' } },
    { type: 'node', id: 12, lat: 9.02, lon: 38.74, tags: { amenity: 'hospital', name: 'Federal Police Referal Hospital |' } },
    { type: 'node', id: 60, lat: 9.06, lon: 38.77, tags: { amenity: 'hospital', name: "St. Paul's Hospital Millennium Medical College" } }] });
  const by = n => F.find(f => f.name === n);
  assert.deepStrictEqual(F.map(f => f.name).sort(), ['Federal Police Referal Hospital', 'International Clinical Laburatory', 'Keti Dental Clinic', "St. Paul's Hospital Millennium Medical College", 'Zoya clinic']);
  assert.strictEqual(by('Zoya clinic').kind, 'clinic');
  assert.strictEqual(by('International Clinical Laburatory').kind, 'lab');
  assert.strictEqual(by('International Clinical Laburatory').nameAm, 'ኢንተርናሽናል ላቡራቶሪ');   // the Amharic line keeps only Amharic
  assert.strictEqual(by("St. Paul's Hospital Millennium Medical College").kind, 'hospital');
});

test('a doctor needs a profession, a licence number and who issued it', async () => {
  const { call, sent } = app();
  assert.strictEqual((await call('POST /api/health/submit', { body: Object.assign({}, doctor, { licence: '' }) })).body.error, 'licence');
  assert.strictEqual((await call('POST /api/health/submit', { body: Object.assign({}, doctor, { licenceIssuer: '' }) })).body.error, 'licence');
  assert.strictEqual((await call('POST /api/health/submit', { body: Object.assign({}, doctor, { profession: 'wizard' }) })).body.error, 'profession');
  assert.strictEqual((await call('POST /api/health/submit', { body: Object.assign({}, doctor, { phone: '12345' }) })).body.error, 'phone');
  assert.strictEqual(sent.length, 0);
});

test('a doctor stays hidden until approved; the licence number never goes public', async () => {
  const { call, sent } = app();
  const r = await call('POST /api/health/submit', { body: doctor });
  assert.strictEqual(r.body.ok, true);
  assert.match(sent[0], /MOH-12345-XYZ/); assert.match(sent[0], /Check the licence and call/); assert.match(sent[0], /Selam Dental Clinic \(on the map\)/);
  const S = JSON.parse(fs.readFileSync(STORE, 'utf8')), slug = S.entries[0].slug;
  assert.strictEqual((await call('GET /doctors/:slug', { params: { slug } })).code, 404);
  assert.strictEqual((await call('GET /api/health/directory')).body.doctors.length, 0);
  // a wrong token does nothing; the right one works once
  assert.strictEqual((await call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: 'nope' } })).code, 404);
  assert.match(String((await call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: tokenOf(sent, 0) } })).body), /Live/);
  assert.strictEqual((await call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: tokenOf(sent, 0) } })).code, 404);
  const page = await call('GET /doctors/:slug', { params: { slug } });
  assert.strictEqual(page.code, 200);
  assert.match(page.body, /Dr Selam Tesfaye/); assert.match(page.body, /Licence checked/); assert.match(page.body, /"@type":"Physician"/);
  assert.doesNotMatch(page.body, /MOH-12345/); assert.doesNotMatch(page.body, /900000041|0900 000 041/);   // phone not shown: the doctor did not say so
  const api = (await call('GET /api/health/directory')).body;
  assert.strictEqual(api.doctors.length, 1); assert.doesNotMatch(JSON.stringify(api), /MOH-12345|token|licence"/);
  assert.strictEqual(api.doctors[0].phone, null);
  // the facility page lists the doctor
  const fac = await call('GET /health/:slug', { params: { slug: 'selam-dental-clinic-w2' } });
  assert.match(fac.body, /Dr Selam Tesfaye/);
});

test('a doctor who chose to show the phone gets call + WhatsApp buttons', async () => {
  const { call, sent } = app();
  const r = await call('POST /api/health/submit', { body: Object.assign({}, doctor, { showPhone: true, whatsapp: true, facilityRef: null, facilityName: '', area: 'Bole' }) });
  await call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: tokenOf(sent, 0) } });
  const slug = JSON.parse(fs.readFileSync(STORE, 'utf8')).entries[0].slug, page = (await call('GET /doctors/:slug', { params: { slug } })).body;
  assert.match(page, /tel:\+251900000041/); assert.match(page, /wa\.me\/251900000041/);
});

test('a facility update shows its services only after approval', async () => {
  const { call, sent } = app();
  const r = await call('POST /api/health/submit', { body: { type: 'facility', facilityRef: 'node/1', role: 'manager', name: 'Abebe Kebede', phone: '0900 000 042', publicPhone: '011 000 0081', services: ['Emergency 24/7', 'Maternity & delivery'], hours: '24/7' } });
  assert.strictEqual(r.body.ok, true); assert.match(sent[0], /Facility update via Afiya/);
  let page = (await call('GET /health/:slug', { params: { slug: 'test-general-hospital-n1' } })).body;
  assert.doesNotMatch(page, /Maternity &amp; delivery/); assert.match(page, /has not added its services yet/);
  await call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: tokenOf(sent, 0) } });
  page = (await call('GET /health/:slug', { params: { slug: 'test-general-hospital-n1' } })).body;
  assert.match(page, /Maternity &amp; delivery/); assert.match(page, /Confirmed by the facility/); assert.match(page, /tel:\+251110000081/);
  assert.doesNotMatch(page, /900000042/);                                     // the manager's own mobile is only for our call
});

test('reject, the bot trap, duplicates and hostile text', async () => {
  const { call, sent } = app();
  assert.deepStrictEqual((await call('POST /api/health/submit', { body: Object.assign({}, doctor, { website_url: 'x' }) })).body, { ok: true });
  assert.strictEqual(sent.length, 0);
  const r = await call('POST /api/health/submit', { body: Object.assign({}, doctor, { name: 'Dr <script>alert(1)</script> Abel' }) });
  assert.strictEqual((await call('POST /api/health/submit', { body: Object.assign({}, doctor, { name: 'Dr <script>alert(1)</script> Abel' }) })).body.duplicate, true);
  assert.doesNotMatch(sent[0], /<script>/);
  assert.match(String((await call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'reject' }, query: { t: tokenOf(sent, 0) } })).body), /Rejected/);
  assert.strictEqual(JSON.parse(fs.readFileSync(STORE, 'utf8')).entries[0].status, 'rejected');
});

test('the directory page, a missing page, and which pages are worth indexing', async () => {
  const { call } = app();
  const hub = await call('GET /health');
  assert.match(hub.body, /Test General Hospital/); assert.match(hub.body, /tel:907/); assert.match(hub.body, /afiya-widget\.js/); assert.strictEqual(hub.headers.Vary, 'Accept');
  assert.strictEqual((await call('GET /health/:slug', { params: { slug: 'nope-n9' } })).code, 404);
  const lab = await call('GET /health/:slug', { params: { slug: 'kirkos-lab-n5' } });
  assert.strictEqual(lab.headers['X-Robots-Tag'], 'noindex, follow');           // nothing but a name on the map
  assert.deepStrictEqual(health.findableSlugs(), ['/health/test-general-hospital-n1']);
});

test('the search Bini uses: kind, sub-city, specialty, nearest first, and only what the pages show', async () => {
  const A = app();
  const r = await A.call('POST /api/health/submit', { body: { type: 'doctor', name: 'Dr Hanna Bekele', phone: '0900 000 061', profession: 'specialist', specialty: 'Paediatrics',
    licence: 'MOH-55555', licenceIssuer: 'Ministry of Health', services: ['Child check-ups'], facilityRef: 'node/1' } });
  await A.call('GET /ops/health/:id/:action', { params: { id: r.body.id, action: 'approve' }, query: { t: /approve\?t=([a-f0-9]+)/.exec(A.sent[0])[1] } });
  const S = health.searchHealth;
  assert.deepStrictEqual(S({ kind: 'dentist' }).results.map(f => f.name), ['Selam Dental Clinic']);
  assert.deepStrictEqual(S({ area: 'bole' }).results.map(f => f.name), ['Test General Hospital']);
  assert.deepStrictEqual(S({ area: 'ቦሌ' }).results.map(f => f.name), ['Test General Hospital']);
  const kids = S({ q: 'children' });
  assert.deepStrictEqual(kids.results.map(f => f.name), ['Test General Hospital']);          // a paediatrician works there
  assert.deepStrictEqual(kids.doctors.map(d => d.name), ['Dr Hanna Bekele']);
  const near = S({ lat: 9.03, lng: 38.75 });                                                   // at the dental clinic
  assert.strictEqual(near.results[0].name, 'Selam Dental Clinic'); assert.strictEqual(near.results[0].km, 0);
  const far = S({ q: 'children', lat: 9.03, lng: 38.75 });                                   // the paediatrician's hospital is 4.7 km off
  assert.strictEqual(far.results[0].name, 'Test General Hospital'); assert.ok(far.results[0].km > 3);
  assert.strictEqual(far.nearest[0].name, 'Selam Dental Clinic'); assert.ok(far.nearestNote);   // so the closest places come too
  const eye = S({ kind: 'hospital', q: 'eye' });
  assert.ok(eye.relaxed); assert.strictEqual(eye.results[0].name, 'Test General Hospital');   // nobody lists it: say so, show the general ones
  const json = JSON.stringify([S({}), kids, S({ kind: 'doctor' })]);
  assert.doesNotMatch(json, /MOH-55555|900000061|900000070|0900 000 070/);                                      // no licence, no private or map mobile
  assert.match(S({ kind: 'dentist', area: 'Arada' }).more, /^https:\/\/bina\.et\/health\?q=dental%20clinic%20Arada$/);
});
