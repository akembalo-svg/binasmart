'use strict';
// What an owner action would do, read from the database: for the preview when Bini prepares it, and again when the
// owner presses ✅ (design §3.2). Nothing here writes. Every figure comes from these queries — recipients, units,
// amounts, due dates — never from the model.
//
// resolve(kind, building, args) → { ok: true, kind, args, text?, recipients, payload, figures, unitOf, view } | { ok: false, error, … }
//   recipients  what delivery.plan() and the send need, phone and Telegram chat included: stays on the server
//   payload     what the pending action stores: tenancy, invoice ids, units and amounts; no phone number, no name
//   figures     what must still be true at confirm (hashed into the pending action's fingerprint)
//   view        what the card shows; names are read here, on the server, and never reach the model
const { parseFloor, pickBuildings } = require('../tools/building');
const invoiceGen = require('../../../building/invoices');
const { TYPE_AM, invoiceSms, receiptSms } = require('../../../messaging/invoice-text');
const P = require('./policy');

const OPEN = ['PENDING', 'OVERDUE', 'PARTIAL'];          // not PAID, not CANCELLED
const DAY = 86400000;
const REMIND_AHEAD_DAYS = 5;                              // the daily due-date reminder's window (server.js runDailyChecks)
// A short link has exactly this length (bina.et/i/ + 12 characters, messaging/invoice-links.js). Previews use it so SMS
// parts are counted right; the real link is minted only when the send runs, and replaces it.
const LINK_SAMPLE = 'bina.et/i/XXXXXXXXXXXX';
const BUILDING_SELECT = { id: true, name: true, nameAm: true, qrSlug: true, subCity: true, smsMonthlyLimit: true, smsSender: true };
const TENANCY_SELECT = { id: true, userId: true, unit: { select: { number: true, floor: true } },
  shop: { select: { name: true, nameAm: true } }, user: { select: { fullName: true, phone: true, telegramChatId: true } } };
const INVOICE_SELECT = { id: true, tenancyId: true, type: true, amount: true, lateFee: true, dueDate: true, status: true, paymentCode: true };

const occupant = t => (t.shop ? (t.shop.nameAm || t.shop.name) : (t.user && t.user.fullName) || null);
const byNumber = (x, y) => String(x).localeCompare(String(y), undefined, { numeric: true });
const etb = n => Number(n || 0).toLocaleString('en-US');
const iso = d => new Date(d).toISOString().slice(0, 10);
const key = s => String(s == null ? '' : s).trim().toLowerCase();
const total = i => i.amount + (i.lateFee || 0);
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

function reminderText(b, unit, invoices, link) {
  const shown = invoices.slice(0, 6);
  return '🔔 የክፍያ ማሳሰቢያ / Payment reminder\n🏢 ' + (b.nameAm || b.name) + ' — ክፍል ' + unit + '\n'
    + shown.map(i => '• ' + (TYPE_AM[i.type] || 'ክፍያ') + ' ' + etb(total(i)) + ' ብር — ' + iso(i.dueDate) + (i.paymentCode ? ' · ' + i.paymentCode : '')).join('\n')
    + (invoices.length > shown.length ? '\n• … +' + (invoices.length - shown.length) : '')
    + '\n📌 ጠቅላላ / Total: ' + etb(invoices.reduce((s, i) => s + total(i), 0)) + ' ETB\n🔗 ' + link + '\n— ' + b.name + ' · BinaSmart';
}
const reminderSms = (unit, sum, link) => 'የክፍያ ማሳሰቢያ፣ ክፍል ' + String(unit).slice(0, 20) + '፣ ' + etb(sum) + ' ብር። ዝርዝር፦ ' + link;

function makeActionResolver({ prisma, now = () => new Date() }) {
  const buildings = ids => prisma.building.findMany({ where: { id: { in: ids } }, select: BUILDING_SELECT });
  const activeTenancies = buildingId => prisma.tenancy.findMany({ where: { active: true, unit: { buildingId } }, select: TENANCY_SELECT });
  const recipient = (t, text, smsText, invoiceId = null) => ({ tenancyId: t.id, userId: t.userId,
    telegramChatId: (t.user && t.user.telegramChatId) || null, phone: (t.user && t.user.phone) || null, text, smsText, invoiceId });
  const unitOf = ts => Object.fromEntries(ts.map(t => [t.id, t.unit.number]));
  const sortTenancies = ts => ts.slice().sort((x, y) => byNumber(x.unit.number, y.unit.number) || String(x.id).localeCompare(String(y.id)));

  // The units the owner named, matched as the unit tool matches them (the number as written, any case).
  async function namedUnits(buildingId, all, raw, max = P.MAX_UNITS) {
    const list = P.unitList(raw);
    if (!list.length) return fail('units_required');
    if (list.length > max) return fail('too_many_units', { max });
    const known = await prisma.unit.findMany({ where: { buildingId }, select: { number: true } });
    const byKey = new Map(known.map(u => [key(u.number), u.number]));
    const unknown = list.filter(u => !byKey.has(key(u)));
    if (unknown.length) return fail('unit_unknown', { units: unknown.slice(0, 10) });
    const want = new Set(list.map(key));
    const tenancies = all.filter(t => want.has(key(t.unit.number)));
    const vacant = list.filter(u => !tenancies.some(t => key(t.unit.number) === key(u))).map(u => byKey.get(key(u)));
    if (vacant.length) return fail('unit_vacant', { units: vacant.slice(0, 10) });
    return { ok: true, tenancies, units: list.map(u => byKey.get(key(u))) };
  }

  async function message(b, args) {
    const clean = P.cleanNotice(args.text);
    if (!clean.ok) return fail(clean.error);
    const all = await activeTenancies(b.id);
    let chosen, target = args.target, floor = null, units = null;
    if (target === 'all') chosen = all;
    else if (target === 'floor') {
      floor = parseFloor(args.floor);
      const floors = [...new Set((await prisma.unit.findMany({ where: { buildingId: b.id }, select: { floor: true } })).map(u => u.floor))].sort((x, y) => x - y);
      if (floor == null || !floors.includes(floor)) return fail('floor_unknown', { floors });
      chosen = all.filter(t => t.unit.floor === floor);
    } else if (target === 'units') {
      const picked = await namedUnits(b.id, all, args.units);
      if (!picked.ok) return picked;
      chosen = picked.tenancies; units = picked.units;
    } else return fail('target_required');
    if (!chosen.length) return fail('no_recipients');
    chosen = sortTenancies(chosen);
    const telegramText = P.noticeTelegram(b, clean.text);
    return { ok: true, kind: 'message', args: { target, floor, units, text: clean.text }, text: clean.text,
      recipients: chosen.map(t => recipient(t, telegramText, clean.text)),
      payload: { recipients: chosen.map(t => ({ tenancyId: t.id, unit: t.unit.number })) },
      figures: { tenancies: chosen.map(t => t.id), text: clean.text },
      unitOf: unitOf(chosen),
      view: { target, floor, count: chosen.length, units: [...new Set(chosen.map(t => t.unit.number))], telegramText } };
  }

  async function reminders(b, args) {
    const all = await activeTenancies(b.id);
    let scope = all, units = null;
    if (P.unitList(args.units).length) {
      const picked = await namedUnits(b.id, all, args.units);
      if (!picked.ok) return picked;
      scope = picked.tenancies; units = picked.units;
    }
    const invoices = await prisma.invoice.findMany({ where: { tenancyId: { in: scope.map(t => t.id) }, status: { in: OPEN },
      dueDate: { lte: new Date(now().getTime() + REMIND_AHEAD_DAYS * DAY) } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], select: INVOICE_SELECT });
    const byTenancy = new Map();
    for (const i of invoices) (byTenancy.get(i.tenancyId) || byTenancy.set(i.tenancyId, []).get(i.tenancyId)).push(i);
    const chosen = sortTenancies(scope.filter(t => byTenancy.has(t.id)));
    if (!chosen.length) return fail('nothing_unpaid');
    const rows = chosen.map(t => { const inv = byTenancy.get(t.id); return { t, inv, sum: inv.reduce((s, i) => s + total(i), 0) }; });
    return { ok: true, kind: 'remind_unpaid', args: { units },
      recipients: rows.map(r => recipient(r.t, reminderText(b, r.t.unit.number, r.inv, LINK_SAMPLE), reminderSms(r.t.unit.number, r.sum, LINK_SAMPLE), r.inv[0].id)),
      payload: { recipients: rows.map(r => ({ tenancyId: r.t.id, unit: r.t.unit.number, invoiceIds: r.inv.map(i => i.id), totalEtb: r.sum })) },
      figures: rows.map(r => [r.t.id, r.inv.map(i => [i.id, i.amount, i.lateFee, i.status, iso(i.dueDate)])]),
      unitOf: unitOf(chosen),
      view: { count: rows.length, units: [...new Set(chosen.map(t => t.unit.number))], totalEtb: rows.reduce((s, r) => s + r.sum, 0),
        sampleUnit: rows[0].t.unit.number, sample: reminderText(b, rows[0].t.unit.number, rows[0].inv, LINK_SAMPLE) } };
  }

  async function invoiceSend(b, args) {
    const all = await activeTenancies(b.id);
    const picked = await namedUnits(b.id, all, args.units, P.MAX_INVOICE_UNITS);
    if (!picked.ok) return picked;
    const ts = sortTenancies(picked.tenancies);
    const open = await prisma.invoice.findMany({ where: { tenancyId: { in: ts.map(t => t.id) }, status: { in: OPEN } },
      orderBy: [{ dueDate: 'desc' }, { id: 'asc' }], select: INVOICE_SELECT });
    const rows = [], skipped = [];
    for (const t of ts) {
      const inv = open.find(i => i.tenancyId === t.id);   // the newest unpaid invoice of this tenancy
      if (inv) rows.push({ t, inv }); else skipped.push(t.unit.number);
    }
    if (!rows.length) return fail('no_open_invoice', { units: skipped.slice(0, 10) });
    return { ok: true, kind: 'send_invoice', args: { units: picked.units },
      recipients: rows.map(r => recipient(r.t, 'invoice', invoiceSms({ invoice: r.inv, tenancy: { unit: { number: r.t.unit.number } }, link: LINK_SAMPLE }), r.inv.id)),
      payload: { invoices: rows.map(r => ({ tenancyId: r.t.id, unit: r.t.unit.number, invoiceId: r.inv.id, type: r.inv.type, totalEtb: total(r.inv), dueDate: iso(r.inv.dueDate) })), skipped },
      figures: rows.map(r => [r.t.id, r.inv.id, r.inv.amount, r.inv.lateFee, r.inv.status]),
      unitOf: unitOf(rows.map(r => r.t)),
      view: { rows: rows.map(r => ({ unit: r.t.unit.number, occupant: occupant(r.t), type: r.inv.type, totalEtb: total(r.inv), dueDate: iso(r.inv.dueDate) })), skipped } };
  }

  async function invoices(b, args) {
    const month = String(args.month == null ? '' : args.month).trim();
    if (!P.monthAllowed(month, now())) return fail('bad_month');
    const plan = await invoiceGen.planInvoicesForBuilding(prisma, b.id, invoiceGen.monthWhen(month));
    if (!plan.create.length) return fail('nothing_to_create', { month, skipped: plan.skip.length });
    const create = plan.create.slice().sort((x, y) => byNumber(x.unit, y.unit) || String(x.tenancyId).localeCompare(String(y.tenancyId)));
    return { ok: true, kind: 'create_invoices', args: { month }, recipients: [],
      payload: { month, create: create.map(r => ({ tenancyId: r.tenancyId, unit: r.unit, amount: r.amount })), skipped: plan.skip.length },
      figures: { create: create.map(r => [r.tenancyId, r.amount]), skipped: plan.skip.map(r => r.tenancyId).sort() },
      unitOf: {},
      view: { month, dueDate: iso(plan.dueDate), count: create.length, totalEtb: create.reduce((s, r) => s + (r.amount || 0), 0),
        rows: create, skipped: plan.skip.length, zero: create.filter(r => !r.amount).map(r => r.unit) } };
  }

  async function payment(b, args) {
    const method = args.method == null || args.method === '' ? 'CASH' : String(args.method).trim().toUpperCase();
    if (!P.METHODS.includes(method)) return fail('bad_method');
    const all = await activeTenancies(b.id);
    const picked = await namedUnits(b.id, all, args.unit, 1);
    if (!picked.ok) return picked.error === 'too_many_units' ? fail('one_unit') : picked;
    const t = sortTenancies(picked.tenancies)[0];
    const open = await prisma.invoice.findMany({ where: { tenancyId: t.id, status: { in: OPEN } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], select: INVOICE_SELECT });
    if (!open.length) return fail('no_open_invoice', { units: [t.unit.number] });
    let inv = open[0];
    let amount = null;
    if (args.amount != null && String(args.amount).trim() !== '') {
      amount = Math.round(Number(String(args.amount).replace(/[,\s]/g, '').replace(/(ብር|birr|etb)$/i, '')));
      if (!Number.isFinite(amount) || amount <= 0) return fail('bad_amount');
      inv = open.find(i => total(i) === amount);
      // The invoice has no field for a part paid: an amount that is no invoice's total is refused, not guessed.
      if (!inv) return fail('amount_mismatch', { unit: t.unit.number, amount, totals: open.slice(0, 5).map(total) });
    }
    return { ok: true, kind: 'record_payment', args: { unit: t.unit.number, amount, method },
      recipients: [recipient(t, 'receipt', receiptSms({ invoice: inv, tenancy: { unit: { number: t.unit.number } }, link: LINK_SAMPLE }), inv.id)],
      payload: { tenancyId: t.id, unit: t.unit.number, invoiceId: inv.id, type: inv.type, totalEtb: total(inv), dueDate: iso(inv.dueDate), method, statusBefore: inv.status, otherOpen: open.length - 1 },
      figures: [t.id, inv.id, inv.amount, inv.lateFee, inv.status, method],
      unitOf: unitOf([t]),
      view: { unit: t.unit.number, occupant: occupant(t), type: inv.type, totalEtb: total(inv), dueDate: iso(inv.dueDate), method, statusBefore: inv.status, otherOpen: open.length - 1 } };
  }

  const BY_KIND = { message, remind_unpaid: reminders, send_invoice: invoiceSend, create_invoices: invoices, record_payment: payment };
  async function resolve(kind, building, args) {
    const fn = BY_KIND[kind];
    if (!fn) return fail('bad_kind');
    return fn(building, args && typeof args === 'object' ? args : {});
  }

  return { buildings, pickBuilding: pickBuildings, resolve };
}

module.exports = { makeActionResolver, LINK_SAMPLE, OPEN, REMIND_AHEAD_DAYS, BUILDING_SELECT, TENANCY_SELECT, reminderText, reminderSms };
