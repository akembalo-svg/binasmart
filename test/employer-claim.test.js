'use strict';
// jobs/claim.js: a company's own address, approved by a person. Every name and number below is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.EMPLOYER_CLAIMS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
delete process.env.BINASMART_TG_TOKEN;            // nothing is sent anywhere from a test
const claim = require('../jobs/claim');
const Fastify = require('fastify');

function app() {
  const emp = { id: 'e1', slug: 'sample-plc', name: 'Sample PLC', address: null, lat: null, lng: null };
  const updates = [];
  const prisma = { employer: {
    findUnique: async ({ where }) => (where.slug === emp.slug ? emp : null),
    update: async ({ where, data }) => { updates.push({ where, data }); Object.assign(emp, data); return emp; },
  } };
  const f = Fastify();
  claim(f, { prisma, shell: o => o.body, escH: s => String(s == null ? '' : s).replace(/</g, '&lt;'), OWNER_KEY: 'k' });
  return { f, emp, updates };
}
const good = { slug: 'sample-plc', name: 'Sample Person', role: 'HR officer', phone: '0900000042', address: 'Sample Building 3rd floor, Bole', confirm: true };
const latest = () => fs.readdirSync(process.env.EMPLOYER_CLAIMS_DIR).map(f => JSON.parse(fs.readFileSync(path.join(process.env.EMPLOYER_CLAIMS_DIR, f), 'utf8'))).sort((a, b) => b.at.localeCompare(a.at))[0];

test('map links and typed coordinates give a point in Ethiopia; anything else gives none', async () => {
  assert.deepEqual(await claim.pointFrom('https://www.google.com/maps/place/X/@9.0123,38.7612,17z'), { lat: 9.0123, lng: 38.7612 });
  assert.deepEqual(await claim.pointFrom('https://www.google.com/maps?q=9.0123,38.7612'), { lat: 9.0123, lng: 38.7612 });
  assert.deepEqual(await claim.pointFrom('9.0123, 38.7612'), { lat: 9.0123, lng: 38.7612 });
  assert.equal(await claim.pointFrom('https://www.google.com/maps/@51.5,-0.12,15z'), null, 'London is not an Ethiopian office');
  assert.equal(await claim.pointFrom('around Bole'), null);
});

test('a claim is stored, pending, and changes nothing on the company page', async () => {
  const { f, emp, updates } = app();
  const r = await f.inject({ method: 'POST', url: '/api/employer-claims', payload: { ...good, lat: 9.0123, lng: 38.7612 } });
  assert.equal(r.json().ok, true);
  assert.equal(updates.length, 0);
  assert.equal(emp.address, null);
  const c = latest();
  assert.equal(c.status, 'pending');
  assert.deepEqual(c.proposed.point, { lat: 9.0123, lng: 38.7612, how: 'device location' });
  assert.equal((fs.statSync(path.join(process.env.EMPLOYER_CLAIMS_DIR, c.id + '.json')).mode & 0o777), 0o600);
});

test('required fields, the confirmation and a pin outside Ethiopia are refused; the hidden field fools bots', async () => {
  const { f } = app();
  const post = p => f.inject({ method: 'POST', url: '/api/employer-claims', payload: p }).then(r => r.json());
  assert.equal((await post({ ...good, name: '' })).error, 'name_required');
  assert.equal((await post({ ...good, phone: '12' })).error, 'phone_required');
  assert.equal((await post({ ...good, confirm: false })).error, 'confirm_required');
  assert.equal((await post({ ...good, lat: 51.5, lng: -0.12 })).error, 'bad_pin');
  const before = fs.readdirSync(process.env.EMPLOYER_CLAIMS_DIR).length;
  assert.equal((await post({ ...good, fax: 'x' })).ok, true);
  assert.equal(fs.readdirSync(process.env.EMPLOYER_CLAIMS_DIR).length, before, 'a bot submission is not stored');
});

test('approve writes the address, the pin and locationChecked; the claimant stays private; the link works once', async () => {
  const { f, emp } = app();
  await f.inject({ method: 'POST', url: '/api/employer-claims', payload: { ...good, lat: 9.0123, lng: 38.7612, note: 'behind the sample station', publicPhone: '0110000042' } });
  const c = latest();
  assert.equal((await f.inject({ url: '/ops/employer-claims/' + c.id + '/approve?t=wrong' })).statusCode, 404);
  const r = await f.inject({ url: '/ops/employer-claims/' + c.id + '/approve?t=' + c.token });
  assert.match(r.body, /Approved/);
  assert.equal(emp.address, good.address);
  assert.equal(emp.lat, 9.0123);
  assert.ok(emp.locationChecked instanceof Date);
  assert.match(emp.locationNote, /behind the sample station · Given by the company \(HR officer\) and confirmed by BinaSmart/);
  assert.equal(emp.phone, '0110000042');
  assert.doesNotMatch(JSON.stringify(emp), /Sample Person|0900000042/, 'the claimant is never written to the company');
  assert.match((await f.inject({ url: '/ops/employer-claims/' + c.id + '/approve?t=' + c.token })).body, /Already approved/);
});

test('the queue needs the owner key', async () => {
  const { f } = app();
  assert.equal((await f.inject({ url: '/ops/employer-claims' })).statusCode, 401);
  assert.equal((await f.inject({ url: '/ops/employer-claims?key=k' })).statusCode, 200);
});
