'use strict';
// bina.et/i/<token>: unguessable, 60 days, one invoice. Over a fake Prisma.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeInvoiceLinks, LINK_DAYS } = require('../../messaging/invoice-links');
const { renderInvoicePage, renderGonePage } = require('../../messaging/invoice-page');

const DAY = 86400000;
function fakePrisma(clock) {
  const db = { links: [], reads: 0, invoices: [{ id: 'inv1', type: 'RENT', amount: 12500, lateFee: 1250, dueDate: new Date('2026-10-05T00:00:00Z'),
    paymentCode: 'BS-1234-211', status: 'PENDING', paidDate: null, method: null,
    tenancy: { shop: { name: 'Demo Shop' }, user: { fullName: 'Demo Tenant', phone: '0900000001' },
      unit: { number: '211', building: { name: 'Demo Tower', nameAm: 'ዴሞ ታወር', tinNumber: '0000000000', bankAccounts: [{ bank: 'CBE', account: '1000000000000' }] } } } }] };
  return { db,
    invoiceLink: {
      findFirst: async ({ where }) => db.links.filter(l => l.invoiceId === where.invoiceId && l.kind === where.kind && l.expiresAt > where.expiresAt.gt)
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null,
      create: async ({ data }) => { if (db.links.some(l => l.token === data.token)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
        const l = { ...data, createdAt: clock() }; db.links.push(l); return l; },
      findUnique: async ({ where }) => { db.reads++; return db.links.find(l => l.token === where.token) || null; },
    },
    invoice: { findUnique: async ({ where }) => db.invoices.find(i => i.id === where.id) || null },
  };
}
const T0 = new Date('2026-10-01T09:00:00Z');

test('a link token is 12 random URL-safe characters, never the invoice id or payment code', async () => {
  const clock = { t: T0 };
  const p = fakePrisma(() => clock.t);
  const links = makeInvoiceLinks({ prisma: p, now: () => clock.t });
  const a = await links.linkFor('inv1', 'invoice'), b = await links.linkFor('inv1', 'receipt');
  for (const l of [a, b]) {
    assert.match(l, /^bina\.et\/i\/[A-Za-z0-9_-]{12}$/);
    assert.doesNotMatch(l, /inv1|BS-1234/);
  }
  assert.notEqual(a, b);
  assert.equal(p.db.links[0].expiresAt.getTime(), T0.getTime() + LINK_DAYS * DAY);
  assert.equal(LINK_DAYS, 60);
});

test('a fresh link is reused; one with under a week left is replaced; a token clash draws again', async () => {
  const clock = { t: T0 };
  const p = fakePrisma(() => clock.t);
  const bytes = [Buffer.alloc(9, 1), Buffer.alloc(9, 1), Buffer.alloc(9, 2), Buffer.alloc(9, 3)];
  const links = makeInvoiceLinks({ prisma: p, now: () => clock.t, randomBytes: () => bytes.shift() });
  const first = await links.linkFor('inv1', 'invoice');
  assert.equal(await links.linkFor('inv1', 'invoice'), first);
  clock.t = new Date(T0.getTime() + 54 * DAY);
  const second = await links.linkFor('inv1', 'invoice');
  assert.notEqual(second, first, 'six days left: a new link');
  assert.equal(second, 'bina.et/i/' + Buffer.alloc(9, 2).toString('base64url'), 'the clashing draw was skipped');
});

test('malformed, unknown and expired tokens resolve to nothing; malformed ones never reach the database', async () => {
  const clock = { t: T0 };
  const p = fakePrisma(() => clock.t);
  const links = makeInvoiceLinks({ prisma: p, now: () => clock.t });
  for (const bad of ['', 'short', 'has space in it', '../../etc/passwd', 'x'.repeat(40), null]) assert.equal(await links.resolve(bad), null);
  assert.equal(p.db.reads, 0);
  assert.equal(await links.resolve('AAAAAAAAAAAA'), null);
  const token = (await links.linkFor('inv1', 'invoice')).split('/').pop();
  assert.ok(await links.resolve(token));
  clock.t = new Date(T0.getTime() + 61 * DAY);
  assert.equal(await links.resolve(token), null);
});

test('a valid token gives that one invoice with its unit and building, and the page shows only that', async () => {
  const p = fakePrisma(() => T0);
  const links = makeInvoiceLinks({ prisma: p, now: () => T0 });
  const found = await links.resolve((await links.linkFor('inv1', 'invoice')).split('/').pop());
  assert.deepEqual([found.kind, found.invoice.id, found.unit.number, found.building.name], ['invoice', 'inv1', '211', 'Demo Tower']);
  const html = renderInvoicePage(found);
  for (const s of ['211', '12,500 ETB', '1,250 ETB', '13,750 ETB', '2026-10-05', 'BS-1234-211', 'CBE', '1000000000000', 'ዴሞ ታወር', 'noindex']) assert.ok(html.includes(s), s);
  for (const s of ['Demo Shop', 'Demo Tenant', '0900000001']) assert.equal(html.includes(s), false, s);
});

test('the page escapes building text, shows a paid receipt without bank accounts, and the gone page says nothing', () => {
  const inv = { type: 'RENT', amount: 100, lateFee: 0, dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-1-1', status: 'PAID', paidDate: new Date('2026-10-06T00:00:00Z'), method: 'CASH' };
  const html = renderInvoicePage({ kind: 'receipt', invoice: inv, unit: { number: '<b>1</b>' }, building: { name: '<img src=x onerror=alert(1)>', nameAm: '', bankAccounts: [{ bank: 'CBE', account: '1' }] } });
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<b>1</b>'), false);
  assert.match(html, /Receipt/);
  assert.match(html, /2026-10-06 · CASH/);
  assert.equal(html.includes('Pay to'), false);
  const gone = renderGonePage();
  assert.match(gone, /noindex/);
  assert.match(gone, /not valid or has expired/);
  assert.match(renderGonePage({ slow: true }), /try again in a few minutes/);
});
