'use strict';
// What an owner action would do, read from the records: recipients, texts, amounts — and the refusals. Over a Prisma
// double (test/owner/actions-fixture.js): no database, no network, no real building.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeActionResolver, LINK_SAMPLE } = require('../../agents/owner/actions/resolve');
const { fakePrisma, data, NOW } = require('./actions-fixture');

const setup = (d = data()) => { const prisma = fakePrisma(d); return { prisma, r: makeActionResolver({ prisma, now: () => NOW }) }; };
const B1 = d => d.buildings[0];

test('a message to all active tenants: one recipient each, the owner\'s text framed by code, no phone in the payload', async () => {
  const d = data(); const { r } = setup(d);
  const out = await r.resolve('message', B1(d), { target: 'all', text: 'ነገ ውሃ ይቋረጣል' });
  assert.equal(out.ok, true);
  assert.deepEqual(out.payload.recipients, [{ tenancyId: 't1', unit: '101' }, { tenancyId: 't2', unit: '102' }, { tenancyId: 't3', unit: '201' }]);
  assert.equal(out.text, 'ነገ ውሃ ይቋረጣል');
  assert.equal(out.recipients[0].text, '📢 ዴሞ ታወር\n\nነገ ውሃ ይቋረጣል\n\n— Demo Tower · BinaSmart');
  assert.equal(out.recipients[0].smsText, 'ነገ ውሃ ይቋረጣል', 'the SMS label is added by the delivery layer');
  assert.equal(out.recipients[0].telegramChatId, '5551');
  assert.equal(out.recipients[0].phone, '0900000001');
  assert.equal(JSON.stringify(out.payload).includes('0900000001'), false, 'no phone number is ever stored');
  assert.equal(JSON.stringify(out.payload).includes('Demo Shop One'), false, 'no tenant name is ever stored');
});

test('a message to one floor and to named units, and the refusals for a floor or unit that is not there', async () => {
  const d = data(); const { r } = setup(d);
  const floor = await r.resolve('message', B1(d), { target: 'floor', floor: '2ኛ ፎቅ', text: 'ሊፍቱ ይጠገናል' });
  assert.deepEqual(floor.payload.recipients, [{ tenancyId: 't3', unit: '201' }]);
  assert.equal(floor.args.floor, 2);
  const units = await r.resolve('message', B1(d), { target: 'units', units: '102, 101', text: 'እባክዎ ይለፉ' });
  assert.deepEqual(units.payload.recipients.map(x => x.unit), ['101', '102']);
  assert.deepEqual(await r.resolve('message', B1(d), { target: 'floor', floor: '9', text: 'x' }), { ok: false, error: 'floor_unknown', floors: [1, 2] });
  assert.deepEqual(await r.resolve('message', B1(d), { target: 'units', units: '999', text: 'x' }), { ok: false, error: 'unit_unknown', units: ['999'] });
  assert.deepEqual(await r.resolve('message', B1(d), { target: 'units', units: '202', text: 'x' }), { ok: false, error: 'unit_vacant', units: ['202'] });
  assert.deepEqual(await r.resolve('message', B1(d), { target: 'all', text: '   ' }), { ok: false, error: 'text_required' });
  assert.deepEqual(await r.resolve('message', B1(d), { text: 'x' }), { ok: false, error: 'target_required' });
});

test('reminders go only to tenants with an unpaid invoice due now or within five days, with their own figures', async () => {
  const d = data(); const { r } = setup(d);
  const out = await r.resolve('remind_unpaid', B1(d), {});
  assert.deepEqual(out.payload.recipients, [
    { tenancyId: 't1', unit: '101', invoiceIds: ['i2', 'i1'], totalEtb: 20500 },
    { tenancyId: 't2', unit: '102', invoiceIds: ['i3'], totalEtb: 12000 },
  ], 'unit 201\'s invoice is due in December, and 102\'s July invoice is paid');
  assert.equal(out.view.totalEtb, 32500);
  assert.match(out.recipients[0].text, /ክፍል 101/);
  assert.match(out.recipients[0].text, /10,500 ብር — 2026-08-05 · BS-1000-i2/);
  assert.match(out.recipients[0].text, /📌 ጠቅላላ \/ Total: 20,500 ETB/);
  assert.ok(out.recipients[0].text.includes(LINK_SAMPLE), 'the real short link is minted only when the send runs');
  assert.equal(out.recipients[0].smsText, 'የክፍያ ማሳሰቢያ፣ ክፍል 101፣ 20,500 ብር። ዝርዝር፦ ' + LINK_SAMPLE);
  assert.equal(out.recipients[0].invoiceId, 'i2');
});

test('reminders can be limited to units, and say when there is nothing to remind about', async () => {
  const d = data(); const { r } = setup(d);
  assert.deepEqual((await r.resolve('remind_unpaid', B1(d), { units: '102' })).payload.recipients, [{ tenancyId: 't2', unit: '102', invoiceIds: ['i3'], totalEtb: 12000 }]);
  assert.deepEqual(await r.resolve('remind_unpaid', B1(d), { units: '201' }), { ok: false, error: 'nothing_unpaid' });
});

test('sending an invoice takes each unit\'s newest unpaid invoice, and reports units that have none', async () => {
  const d = data(); const { r } = setup(d);
  const out = await r.resolve('send_invoice', B1(d), { units: '101,102' });
  assert.deepEqual(out.payload.invoices, [
    { tenancyId: 't1', unit: '101', invoiceId: 'i1', type: 'RENT', totalEtb: 10000, dueDate: '2026-09-05' },
    { tenancyId: 't2', unit: '102', invoiceId: 'i3', type: 'RENT', totalEtb: 12000, dueDate: '2026-09-05' },
  ]);
  assert.equal(out.view.rows[0].occupant, 'Demo Shop One (አማርኛ)');
  assert.match(out.recipients[0].smsText, /^የክፍያ መጠየቂያ፣ ክፍል 101፣ 10,000 ብር/);
  d.invoices = d.invoices.filter(i => i.tenancyId !== 't1');
  assert.deepEqual(await r.resolve('send_invoice', B1(d), { units: '101' }), { ok: false, error: 'no_open_invoice', units: ['101'] });
});

test('creating a month\'s invoices lists who gets one and who already has one, and refuses a month out of range', async () => {
  const d = data(); const { r } = setup(d);
  const out = await r.resolve('create_invoices', B1(d), { month: '2026-09' });
  assert.deepEqual(out.payload.create, [{ tenancyId: 't3', unit: '201', amount: 15000 }], '101 and 102 already have a September rent invoice');
  assert.equal(out.payload.skipped, 2);
  assert.equal(out.view.totalEtb, 15000);
  assert.equal(out.view.dueDate, '2026-09-05');
  const october = await r.resolve('create_invoices', B1(d), { month: '2026-10' });
  assert.deepEqual(october.payload.create.map(x => [x.unit, x.amount]), [['101', 11000], ['102', 12000], ['201', 15000]], 'the contract rent wins over the unit rent');
  assert.deepEqual(await r.resolve('create_invoices', B1(d), { month: '2027-01' }), { ok: false, error: 'bad_month' });
  assert.deepEqual(await r.resolve('create_invoices', B1(d), { month: 'next' }), { ok: false, error: 'bad_month' });
  d.invoices.push({ id: 'ix', tenancyId: 't3', type: 'RENT', amount: 15000, lateFee: 0, dueDate: new Date('2026-09-05T00:00:00Z'), status: 'PENDING', paymentCode: 'BS-1000-ix' });
  assert.deepEqual(await r.resolve('create_invoices', B1(d), { month: '2026-09' }), { ok: false, error: 'nothing_to_create', month: '2026-09', skipped: 3 });
});

test('a payment matches the amount the owner said, refuses a part payment, and takes the oldest unpaid invoice when no amount is given', async () => {
  const d = data(); const { r } = setup(d);
  const exact = await r.resolve('record_payment', B1(d), { unit: '101', amount: '10,500', method: 'telebirr' });
  assert.deepEqual(exact.payload, { tenancyId: 't1', unit: '101', invoiceId: 'i2', type: 'RENT', totalEtb: 10500, dueDate: '2026-08-05',
    method: 'TELEBIRR', statusBefore: 'OVERDUE', otherOpen: 1 }, 'the late fee is part of the total');
  assert.equal(exact.view.occupant, 'Demo Shop One (አማርኛ)');
  const oldest = await r.resolve('record_payment', B1(d), { unit: '101' });
  assert.equal(oldest.payload.invoiceId, 'i2');
  assert.equal(oldest.payload.method, 'CASH');
  assert.deepEqual(await r.resolve('record_payment', B1(d), { unit: '101', amount: 5000 }),
    { ok: false, error: 'amount_mismatch', unit: '101', amount: 5000, totals: [10500, 10000] });
  d.invoices.find(i => i.id === 'i5').status = 'PAID';
  assert.deepEqual(await r.resolve('record_payment', B1(d), { unit: '201' }), { ok: false, error: 'no_open_invoice', units: ['201'] });
  assert.deepEqual(await r.resolve('record_payment', B1(d), { unit: '101', method: 'cheque' }), { ok: false, error: 'bad_method' });
  assert.deepEqual(await r.resolve('record_payment', B1(d), { unit: '101, 102' }), { ok: false, error: 'one_unit' });
});

test('the figures — not the wording — decide whether a preview is still valid', async () => {
  const d = data(); const { r } = setup(d);
  const before = await r.resolve('remind_unpaid', B1(d), {});
  const same = await r.resolve('remind_unpaid', B1(d), {});
  assert.deepEqual(same.figures, before.figures);
  d.invoices.find(i => i.id === 'i1').status = 'PAID';
  const after = await r.resolve('remind_unpaid', B1(d), {});
  assert.notDeepEqual(after.figures, before.figures);
});

test('one building at a time: the owner\'s other building is picked by name, and an unknown name is nobody\'s', async () => {
  const d = data(); const { prisma, r } = setup(d);
  const all = await r.buildings(['b1', 'b2']);
  assert.deepEqual(r.pickBuilding(all, 'Demo Annex').map(b => b.id), ['b2']);
  assert.deepEqual(r.pickBuilding(all, 'Demo').map(b => b.id), ['b1', 'b2'], 'part of a name can match both: the service asks which');
  assert.deepEqual(r.pickBuilding(all, 'Other Plaza'), []);
  assert.equal(prisma.calls.some(c => c[0] === 'building.findMany'), true);
});
