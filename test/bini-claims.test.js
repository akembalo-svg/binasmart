// company_request is for a company or hotel page, never for BinaSmart itself (28 Sep 2026: a question about driver
// commission reached the team as a "hotel claim" for a hotel called "BinaSmart").
const test = require('node:test');
const assert = require('node:assert');
const { makeExecutor } = require('../assistant/tools');

test('company_request refuses BinaSmart itself, lets real names through', async () => {
  const log = console.log; console.log = () => {};
  try {
    const ex = makeExecutor({ base: 'http://127.0.0.1:1', dryRun: true });
    const ask = company => ex('company_request', { company, kind: 'hotel', name: 'Test Person', phone: '0900000012', request: 'x' });
    for (const c of ['BinaSmart', 'Bina Smart', 'bina.et', 'Bini', 'BinaRide', 'ቢና ስማርት']) assert.strictEqual((await ask(c)).error, 'not_a_listing', c);
    for (const c of ['Ghion Hotel', 'Binasmart Real Estate']) assert.strictEqual((await ask(c)).dryRun, true, c);
  } finally { console.log = log; }
});

test('the same request twice in one turn goes to the team once', async () => {
  const log = console.log; console.log = () => {};
  try {
    let calls = 0;
    const ex = makeExecutor({ base: 'http://x', fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ ok: true }) }; } });
    const a = { company: 'Some New Hotel', kind: 'hotel', name: 'Test Person', phone: '0900000012', request: 'add rooms', rooms: [{ name: 'Twin', price: 3000 }] };
    const b = { request: 'add rooms', rooms: [{ price: 3000, name: 'Twin' }], phone: '0900000012', name: 'Test Person', kind: 'hotel', company: 'Some New Hotel' };
    const r1 = await ex('company_request', a), r2 = await ex('company_request', b);
    assert.strictEqual(calls, 1); assert.ok(r1.ok && r2.ok); assert.match(r2.note, /Already sent/);
  } finally { console.log = log; }
});
