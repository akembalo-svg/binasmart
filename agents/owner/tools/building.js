'use strict';
// The building tool pack for the owner agent: ten read-only questions an owner asks about their building.
// Each tool is a pure function over the records loadBuildings() returned for the owner's scope, so the only
// database access — and the only place scope and privacy are enforced — is ../building-data.js. Outputs
// project named fields explicitly: nothing is passed through whole.
//
// An owner must read the same number from Bini as from the owner dashboard, so where server.js already
// computes a figure these tools follow it, and say which endpoint beside the code.
const { loadBuildings } = require('../building-data');
const { foldEthiopic } = require('../../../assistant/lang');

const DAY = 86400000;
const VAT_RATE = 0.15;                     // the same rate as server.js (VAT Proclamation 1341/2024); a test pins it
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const OPEN = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS']);   // /api/owner/:slug/overview openMaintenance
// The options of the public QR maintenance form (public/building.html #m-type; server.js /api/b/:slug/maintenance
// stores whatever is posted, upper-cased). Anything else a stranger typed is reported as OTHER.
const REPAIR_TYPES = new Set(['PLUMBING', 'ELECTRIC', 'LIFT', 'CLEANING', 'SECURITY', 'GENERAL']);
const RESULT_LIMIT = 5000;                 // callBini cuts a tool result at 6000 characters

const iso = d => d ? new Date(d).toISOString().slice(0, 10) : null;
const monthOf = d => new Date(d).toISOString().slice(0, 7);
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const daysSince = (d, now) => Math.max(0, Math.floor((now - d) / DAY));
const occupant = t => t ? (t.shop ? (t.shop.nameAm || t.shop.name) : (t.user && t.user.fullName) || null) : null;
const repairType = t => { const k = String(t == null ? '' : t).trim().toUpperCase(); return REPAIR_TYPES.has(k) ? k : 'OTHER'; };
// The contract's dates, falling back to the tenancy's only when a tenancy has no Contract row.
const contractEnd = t => (t.contract && t.contract.endDate) || t.endDate || null;
const contractStart = t => (t.contract && t.contract.startDate) || t.startDate || null;
const notPaid = i => i.status !== 'PAID';

// The records of one building out of a (possibly multi-building) load.
function view(data, b) {
  const units = data.units.filter(u => u.buildingId === b.id);
  const unitIds = new Set(units.map(u => u.id));
  return {
    b, units,
    byUnit: new Map(units.map(u => [u.id, u])),
    invoices: data.invoices.filter(i => i.tenancy && unitIds.has(i.tenancy.unitId)),
    repairs: data.repairs.filter(r => (r.buildingId || (r.tenancy && r.tenancy.unit && r.tenancy.unit.buildingId)) === b.id),
    expenses: data.expenses.filter(e => e.buildingId === b.id),
    ended: data.ended.filter(t => unitIds.has(t.unitId)),
  };
}

// How recent the records are. Carried by every money answer so an owner never reads July as today.
function asOf(v) {
  let inv = null, pay = null;
  for (const i of v.invoices) {
    if (!inv || i.dueDate > inv) inv = i.dueDate;
    if (i.paidDate && (!pay || i.paidDate > pay)) pay = i.paidDate;
  }
  return { newestInvoice: iso(inv), newestPayment: iso(pay) };
}

// Open repairs two ways. openRepairs is the dashboard's tile: requests carrying the building id (the QR form)
// that are OPEN, ASSIGNED or IN_PROGRESS. openRepairsAll adds requests filed against a tenancy with no
// building id, which the dashboard does not show.
function openRepairs(v) {
  const open = v.repairs.filter(r => OPEN.has(r.status));
  return { openRepairs: open.filter(r => r.buildingId === v.b.id).length, openRepairsAll: open.length };
}

function currentOccupant(v, unitId, tenancyId) {
  const t = ((v.byUnit.get(unitId) || {}).tenancies || [])[0];
  return t && t.id === tenancyId ? occupant(t) : null;   // an old tenancy's invoice names nobody
}

// Invoice statuses: /overview and /accounting count every status, CANCELLED included — invoiced is the sum of
// all of a month's invoices, collected is PAID, outstanding is everything not PAID. The tools do the same and
// report cancelledCount beside it. No code path sets an invoice to CANCELLED today (13 Sep 2026), so the
// count is 0 in practice; if one is ever added, change the dashboard and these tools together.
function monthInvoices(v, month) { return v.invoices.filter(i => monthOf(i.dueDate) === month); }

// ---- Floors. The owner dashboard shows Unit.floor as it is stored ("Ground" for 0, "F2" for 2; Tenants tab,
// ordered by floor then number) and never reads a floor out of a unit number, so neither do these tools.
// Unit.floor is a required column, so a building can only lack floor data by having every unit left on 0
// while its Building.floors says it has more than one floor.
const floorDataMissing = v => v.units.length > 1 && v.units.every(u => !u.floor) && Number(v.b.floors) > 1;
const floorsInRecords = v => [...new Set(v.units.map(u => u.floor))].sort((x, y) => x - y);
// The floor in words, so a reply says "1ኛ ፎቅ" or "ground floor" instead of misreading "floor": 1.
const floorWords = f => (f === 0 ? { floorAm: 'ምድር ቤት (ግራውንድ)', floorEn: 'ground floor' }
  : f < 0 ? { floorAm: 'ከርሰ ምድር ' + -f, floorEn: 'basement ' + -f } : { floorAm: f + 'ኛ ፎቅ', floorEn: 'floor ' + f });
const byNumber = (x, y) => String(x.number).localeCompare(String(y.number), undefined, { numeric: true });

// Ordinal and cardinal floor words, folded (ሦ→ሶ, ሥ→ስ …) like the input. Longest first, so ከርሰ ምድር wins over ምድር.
const FLOOR_WORDS = [
  ['ከርሰ ምድር', -1], ['basement', -1], ['underground', -1], ['ቤዝመንት', -1],
  ['ምድር ቤት', 0], ['ምድር', 0], ['ግራውንድ', 0], ['ግራውንድ ፍሎር', 0], ['ground', 0], ['lobby', 0],
  ['አንደኛ', 1], ['ሁለተኛ', 2], ['ሶስተኛ', 3], ['አራተኛ', 4], ['አምስተኛ', 5], ['ስድስተኛ', 6], ['ሰባተኛ', 7], ['ስምንተኛ', 8], ['ዘጠነኛ', 9], ['አስረኛ', 10],
  ['first', 1], ['second', 2], ['third', 3], ['fourth', 4], ['fifth', 5], ['sixth', 6], ['seventh', 7], ['eighth', 8], ['ninth', 9], ['tenth', 10],
  ['አንድ', 1], ['ሁለት', 2], ['ሶስት', 3], ['አራት', 4], ['አምስት', 5], ['ስድስት', 6], ['ሰባት', 7], ['ስምንት', 8], ['ዘጠኝ', 9], ['አስር', 10],
].map(([w, n]) => [foldEthiopic(w), n]).sort((a, b) => b[0].length - a[0].length);

// "2", 2, "2ፎቅ", "2ኛ ፎቅ", "floor 2", "F2", "2nd", "ሁለተኛ ፎቅ", "ground", "ግራውንድ", "ምድር ቤት", "G", "B1" → a number, or null.
function parseFloor(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? Math.trunc(x) : null;
  const s = foldEthiopic(String(x == null ? '' : x)).trim().toLowerCase();
  if (!s) return null;
  let m = /(?:^|[^a-z])b(\d{1,2})(?![\d])/.exec(s);
  if (m) return -Number(m[1]);
  m = /-?\d{1,3}/.exec(s);
  if (m) return Number(m[0]);
  if (/^(g|gf|g\.?f\.?)$/.test(s)) return 0;
  for (const [w, n] of FLOOR_WORDS) if (s.includes(w)) return n;
  return null;
}

// ---- Finding a tenant by the name the owner typed. The search runs here, on the server, over the names the
// loader selected (shop name, shop Amharic name, the tenancy's person); the model gets back units, floors and
// tokens, never a name. Written forms that are the same name to a reader compare equal: Ethiopic letter
// families folded (ሀ/ሐ/ኀ, ሰ/ሠ, አ/ዐ, ጸ/ፀ), Latin case and accents, spaces and punctuation.
const squash = s => foldEthiopic(String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const wordsOf = s => foldEthiopic(String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')).toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// An Ethiopic syllable without its vowel (ዶ→ደ, ች→ቸ), so ሰነድ and ሰነዶች, ማረጋገጫ and ማረጋገጪያ share a stem.
const skeleton = w => [...w].map(ch => { const c = ch.codePointAt(0); return c >= 0x1200 && c <= 0x135A ? String.fromCodePoint(c - ((c - 0x1200) % 8)) : ch; }).join('');
// Words that say nothing about which tenant: generic business words, and words an owner's question carries.
const SEARCH_STOP = new Set(['the', 'and', 'of', 'shop', 'store', 'office', 'plc', 'ltd', 'company', 'who', 'where', 'which', 'floor', 'unit',
  'ሱቅ', 'ቢሮ', 'ቤት', 'ድርጅት', 'ኩባንያ', 'ማህበር', 'ሀላፊነቱ', 'የተወሰነ', 'የግል', 'ፎቅ', 'ክፍል', 'ስንተኛ', 'የት', 'ማን', 'ማናቸው', 'ነው', 'እሺ', 'ያለው', 'ያሉት']
  .map(w => skeleton(squash(w))));
const stems = s => wordsOf(s).flatMap(w => {
  const k = skeleton(w);
  // Amharic prefixes የ (of), ለ (to), በ (at), ከ (from) on a longer word
  return /^[የለበከ]/.test(w) && [...k].length > 3 ? [k, k.slice(1)] : [k];
}).filter(k => [...k].length >= 2 && !SEARCH_STOP.has(k));
function stemMatch(a, b) {
  if (a === b) return true;
  const [s, l] = [...a].length <= [...b].length ? [a, b] : [b, a];
  return [...s].length >= 3 && l.startsWith(s);
}
// 3 = the same name, 2 = the name contains what was typed, 1 = every typed word is in the name, below 1 = the
// share of typed words that are.
function nameScore(query, name) {
  const q = squash(query), n = squash(name);
  if (!q || !n) return 0;
  if (q === n) return 3;
  if ([...q].length >= 3 && n.includes(q)) return 2;
  const qs = stems(query), ns = stems(name);
  if (!qs.length || !ns.length) return 0;
  const hit = qs.filter(a => ns.some(b => stemMatch(a, b))).length;
  return hit === qs.length ? 1 : 0.9 * hit / qs.length;
}
const matchLabel = s => (s >= 3 ? 'same name' : s >= 2 ? 'name contains the words' : s >= 1 ? 'all words' : 'some words');

// The owner's own message, folded the same way. A search term must be words the owner typed: the model can
// neither search names the owner never wrote nor learn our spelling of a name letter by letter.
function typedByOwner(name, question) {
  const words = wordsOf(name).map(squash).filter(Boolean);
  const q = squash(question);
  return words.length > 0 && words.every(w => q.includes(w));
}

const TOOLS = {
  data_health(v, a, now) {
    const rentMonths = new Set(v.invoices.filter(i => i.type === 'RENT').map(i => monthOf(i.dueDate)));
    const missing = [];
    for (let k = 0; k < 3; k++) {
      // This month's rent invoices fall due on the 5th (generateInvoicesForBuilding); not missing before the 6th.
      if (k === 0 && now.getUTCDate() < 6) continue;
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7);
      if (!rentMonths.has(m)) missing.push(m);
    }
    let expired = 0;
    for (const u of v.units) for (const t of u.tenancies) { const e = contractEnd(t); if (e && e < now) expired++; }
    return { units: v.units.length, activeTenancies: v.units.filter(u => u.tenancies.length).length,
      invoices: v.invoices.length, invoicesPaid: v.invoices.filter(i => i.status === 'PAID').length,
      rentMonthsWithoutInvoices: missing, expensesRecorded: v.expenses.length,
      ...openRepairs(v), contractsExpiredStillActive: expired, floorDataMissing: floorDataMissing(v), ...asOf(v) };
  },

  // The Tenants tab for one floor: every unit whose Unit.floor is that floor, as the dashboard lists them.
  floor(v, a) {
    const f = parseFloor(a.floor);
    const floors = floorsInRecords(v);
    if (floorDataMissing(v)) return { floor: f, floorDataMissing: true, floorsInRecords: floors, units: [] };
    if (f == null) return { understood: false, floorsInRecords: floors, units: [] };
    const units = v.units.filter(u => u.floor === f).sort(byNumber).map(u => {
      const t = u.tenancies[0];
      return { number: u.number, status: u.status, occupant: occupant(t), contractEnd: t ? iso(contractEnd(t)) : null,
        monthlyRentEtb: u.monthlyRent, areaSqm: u.areaSqm, type: u.unitType };
    });
    return { floor: f, ...floorWords(f), count: units.length, occupied: units.filter(u => u.status === 'OCCUPIED').length,
      vacant: units.filter(u => u.status !== 'OCCUPIED').length, units: units.slice(0, 60), floorsInRecords: floors };
  },

  // Tenants whose name matches what the owner typed. ctx.question is the owner's message (see typedByOwner).
  find_tenant(v, a, now, ctx) {
    const name = String(a.name == null ? '' : a.name).trim().slice(0, 80);
    if (!name) return { error: 'name required' };
    if (!typedByOwner(name, ctx && ctx.question)) return { error: 'copy the name exactly as the owner wrote it in this message' };
    const rows = [];
    for (const u of v.units) for (const t of u.tenancies) {
      const fields = [['business', t.shop && t.shop.nameAm], ['business', t.shop && t.shop.name], ['person', t.user && t.user.fullName]];
      let best = 0, on = null;
      for (const [kind, n] of fields) { const s = n ? nameScore(name, n) : 0; if (s > best) { best = s; on = kind; } }
      if (best > 0) rows.push({ score: best, row: { unit: u.number, floor: u.floor, ...floorWords(u.floor), occupant: occupant(t), status: u.status,
        contractEnd: iso(contractEnd(t)), monthlyRentEtb: u.monthlyRent, match: matchLabel(best), matchedOn: on } });
    }
    rows.sort((x, y) => y.score - x.score || byNumber({ number: x.row.unit }, { number: y.row.unit }));
    // the closest kind of match only: a same-name match is not diluted by every shop sharing one word with it
    const top = rows.length ? rows[0].score : 0;
    const kept = rows.filter(r => (top >= 1 ? r.score >= 1 : true));
    return { found: kept.length > 0, count: kept.length, matches: kept.slice(0, 10).map(r => r.row), truncated: kept.length > 10 };
  },

  // /api/owner/:slug/overview stats: expectedMonthly sums Unit.monthlyRent of OCCUPIED units; vacant is
  // units - occupied (so a RESERVED or MAINTENANCE unit counts as vacant there too — otherStatus says how many).
  overview(v) {
    const occ = v.units.filter(u => u.status === 'OCCUPIED');
    const vacantOnly = v.units.filter(u => u.status === 'VACANT').length;
    return { units: v.units.length, occupied: occ.length, vacant: v.units.length - occ.length,
      otherStatus: v.units.length - occ.length - vacantOnly,
      expectedMonthlyRentEtb: sum(occ, u => u.monthlyRent), rentIfAllLetEtb: sum(v.units, u => u.monthlyRent),
      ...openRepairs(v), ...asOf(v) };
  },

  // /api/owner/:slug/overview collection for the current month (invoiceCount, paidCount, collected, outstanding):
  // invoices by due date in the UTC calendar month, every type and status.
  rent_month(v, a, now) {
    const month = a.month || monthOf(now);
    const all = monthInvoices(v, month);
    const paid = all.filter(i => i.status === 'PAID');
    const unpaid = all.filter(notPaid);
    const overdue = unpaid.filter(i => i.dueDate < now);   // /units marks a not-PAID invoice past its due date OVERDUE
    return { month, invoices: all.length, invoicedEtb: sum(all, i => i.amount),
      paidCount: paid.length, paidEtb: sum(paid, i => i.amount),
      unpaidCount: unpaid.length, unpaidEtb: sum(unpaid, i => i.amount),
      overdueCount: overdue.length, overdueEtb: sum(overdue, i => i.amount),
      partialCount: all.filter(i => i.status === 'PARTIAL').length, cancelledCount: all.filter(i => i.status === 'CANCELLED').length,
      lateFeesEtb: sum(all, i => i.lateFee), ...asOf(v) };
  },

  // Every invoice not PAID, as /overview's outstanding; overdue = due date passed, as /units.
  unpaid(v, a, now) {
    const list = v.invoices
      .filter(i => notPaid(i) && (!a.month || monthOf(i.dueDate) === a.month))
      .map(i => ({ unit: (v.byUnit.get(i.tenancy.unitId) || {}).number || null, occupant: currentOccupant(v, i.tenancy.unitId, i.tenancyId),
        type: i.type, amountEtb: i.amount, dueDate: iso(i.dueDate), daysLate: i.dueDate < now ? daysSince(i.dueDate, now) : 0, status: i.status,
        overdue: i.dueDate < now }))
      .sort((x, y) => y.daysLate - x.daysLate);
    const overdue = list.filter(r => r.overdue);
    return { count: list.length, totalEtb: sum(list, r => r.amountEtb), overdueCount: overdue.length, overdueEtb: sum(overdue, r => r.amountEtb),
      invoices: list.slice(0, 40).map(({ overdue: _o, ...r }) => r), truncated: list.length > 40, ...asOf(v) };
  },

  // Rent as /units shows it (Unit.monthlyRent); contract dates and rent from Contract, as /units and the report.
  unit(v, a) {
    const n = String(a.number || '').trim().toLowerCase();
    const u = v.units.find(x => String(x.number).toLowerCase() === n);
    if (!u) return { found: false };
    const t = u.tenancies[0];
    return { found: true, number: u.number, floor: u.floor, areaSqm: u.areaSqm, monthlyRentEtb: u.monthlyRent, status: u.status, type: u.unitType,
      occupant: occupant(t), contractStart: t ? iso(contractStart(t)) : null, contractEnd: t ? iso(contractEnd(t)) : null,
      contractRentEtb: t && t.contract ? t.contract.monthlyRent : null,
      invoices: v.invoices.filter(i => i.tenancy.unitId === u.id).sort((x, y) => y.dueDate - x.dueDate).slice(0, 12)
        .map(i => ({ type: i.type, amountEtb: i.amount, dueDate: iso(i.dueDate), paidDate: iso(i.paidDate), status: i.status })),
      // requests filed against this unit's tenancy; QR-form requests carry the unit only in their free text
      openRepairs: v.repairs.filter(r => OPEN.has(r.status) && r.tenancy && r.tenancy.unit && r.tenancy.unit.number === u.number).length,
      ...asOf(v) };
  },

  // No dashboard equivalent. Marking an invoice paid (/api/admin/invoices/:id/pay) writes paidDate but never
  // daysLate, so a paid invoice's lateness is paidDate - dueDate. Cancelled invoices are not late payments.
  late_payers(v, a, now) {
    const months = Math.min(Math.max(parseInt(a.months, 10) || 3, 1), 12);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
    const rows = new Map();
    for (const i of v.invoices) {
      if (i.type !== 'RENT' || i.status === 'CANCELLED' || i.dueDate < from || i.dueDate > now) continue;
      const days = i.status === 'PAID'
        ? (i.paidDate ? Math.max(0, Math.floor((i.paidDate - i.dueDate) / DAY)) : (i.daysLate || 0))
        : daysSince(i.dueDate, now);
      const r = rows.get(i.tenancy.unitId) || { invoices: 0, late: 0, days: 0 };
      r.invoices++;
      if (days > 0) { r.late++; r.days += days; }
      rows.set(i.tenancy.unitId, r);
    }
    const units = [...rows].filter(([, r]) => r.late >= 2)
      .map(([id, r]) => { const u = v.byUnit.get(id) || {}; return { unit: u.number || null, occupant: occupant((u.tenancies || [])[0]),
        lateInvoices: r.late, ofInvoices: r.invoices, averageDaysLate: Math.round(r.days / r.late) }; })
      .sort((x, y) => y.lateInvoices - x.lateInvoices || y.averageDaysLate - x.averageDaysLate);
    return { months, from: iso(from), units: units.slice(0, 40), ...asOf(v) };
  },

  // Every unit that is not OCCUPIED, so count = /overview stats.vacant; status tells VACANT from RESERVED etc.
  vacant(v) {
    const endedAt = new Map();
    for (const t of v.ended) if (t.endDate && (!endedAt.has(t.unitId) || t.endDate > endedAt.get(t.unitId))) endedAt.set(t.unitId, t.endDate);
    const units = v.units.filter(u => u.status !== 'OCCUPIED')
      .map(u => ({ number: u.number, floor: u.floor, areaSqm: u.areaSqm, monthlyRentEtb: u.monthlyRent, status: u.status,
        vacantSince: iso(endedAt.get(u.id)), enquiries: u._count ? u._count.leads : 0 }))
      .sort((x, y) => String(x.number).localeCompare(String(y.number), undefined, { numeric: true }));
    return { count: units.length, units: units.slice(0, 60) };
  },

  // Contract.endDate, as the daily renewal report (runDailyChecks: active tenancies whose contract ends between
  // now and now + 90 days) and /units contractDays. ending = end date from now to now + N days; expired = end
  // date already passed while the tenancy is still active. The dashboard's red contract tag (contractDays <= 60)
  // covers both lists.
  contracts_ending(v, a, now) {
    const days = Math.min(Math.max(parseInt(a.days, 10) || 60, 1), 365);
    const until = new Date(now.getTime() + days * DAY);
    const ending = [], expired = [];
    for (const u of v.units) for (const t of u.tenancies) {
      const end = contractEnd(t);
      if (!end) continue;
      const row = { unit: u.number, occupant: occupant(t), endDate: iso(end) };
      if (end < now) expired.push(row);
      else if (end <= until) ending.push(row);
    }
    ending.sort((x, y) => x.endDate.localeCompare(y.endDate));
    expired.sort((x, y) => x.endDate.localeCompare(y.endDate));
    return { days, endingCount: ending.length, ending: ending.slice(0, 40), expiredCount: expired.length, expired: expired.slice(0, 40) };
  },

  // Every in-scope request (QR form and tenancy-filed). Its open count is openRepairsAll; overview's openRepairs
  // is the dashboard tile.
  repairs(v, a) {
    const all = String(a.status || 'open') === 'all';
    const list = v.repairs.filter(r => all || OPEN.has(r.status)).sort((x, y) => y.createdAt - x.createdAt)
      .map(r => ({ unit: r.tenancy && r.tenancy.unit ? r.tenancy.unit.number : null, type: repairType(r.type), status: r.status,
        reported: iso(r.createdAt), resolved: iso(r.resolvedAt), assigned: !!r.assignedTo }));
    return { count: list.length, repairs: list.slice(0, 40) };
  },

  // /api/owner/:slug/accounting: invoiced = every invoice due in the month, collected = PAID,
  // outstanding = invoiced - collected, output VAT on invoiced, input VAT from expenses.
  money(v, a, now) {
    const month = a.month || monthOf(now);
    const inv = monthInvoices(v, month);
    const invoiced = sum(inv, i => i.amount);
    const collected = sum(inv.filter(i => i.status === 'PAID'), i => i.amount);
    const exps = v.expenses.filter(e => monthOf(e.date) === month);
    const byCategory = {};
    for (const e of exps) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const expenses = sum(exps, e => e.amount);
    const outputVat = v.b.vatRegistered ? Math.round(v.b.vatInclusive ? invoiced * VAT_RATE / (1 + VAT_RATE) : invoiced * VAT_RATE) : 0;
    const inputVat = v.b.vatRegistered ? sum(exps, e => e.vatAmount) : 0;
    return { month, invoicedEtb: invoiced, collectedEtb: collected, outstandingEtb: invoiced - collected,
      cancelledCount: inv.filter(i => i.status === 'CANCELLED').length,
      expensesEtb: expenses, expensesByCategory: byCategory,
      vatRegistered: !!v.b.vatRegistered, outputVatEtb: outputVat, inputVatEtb: inputVat, netVatEtb: outputVat - inputVat,
      collectedMinusExpensesEtb: collected - expenses, ...asOf(v) };
  },
};

const BUILDING = { type: 'string', description: 'Only when the owner has more than one building: its name. Omit otherwise.' };
const MONTH_ARG = { type: 'string', description: 'Calendar month as YYYY-MM, e.g. 2026-09. Omit for the current month.' };
const def = (name, description, properties = {}) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: Object.assign({ building: BUILDING }, properties) } } });

const DEFS = [
  def('data_health', 'What the records of the building contain and what is missing: units, tenancies, invoices, payments, months with no rent invoices, expenses, open repairs, contracts past their end date, and how recent the records are. Use it for questions about the records themselves ("what is missing", "is my data complete") or a general "how is my building" question. Never for a question that names a tenant, shop, office, unit or floor.'),
  def('overview', 'Units occupied and vacant (vacant = not occupied, as on the dashboard), expected monthly rent of the occupied units (the dashboard figure), rent if every unit were let, open repairs (openRepairs is the dashboard figure; openRepairsAll adds requests filed by tenants), and how recent the records are.'),
  def('rent_month', 'All invoices due in one month, as on the dashboard: how many, invoiced, paid, unpaid (the dashboard\'s outstanding) and overdue amounts in ETB, cancelled invoices, late fees.', { month: MONTH_ARG }),
  def('unpaid', 'Invoices not paid yet, oldest first: unit, tenant or shop, amount in ETB, due date, days late; total unpaid and how much of it is already overdue. Use it for any list or amount of who owes, whose payment date has come or passed, and who has not paid.', { month: { type: 'string', description: 'Optional YYYY-MM to limit to one month.' } }),
  def('unit', 'One unit by its number: rent, size, floor, status, tenant or shop, contract start, end and rent, last 12 invoices, open repairs filed by its tenant.', { number: { type: 'string', description: 'The unit number as written on the contract, e.g. 707 or G-003.' } }),
  def('late_payers', 'Units that paid rent late (or have not paid) at least twice in the last N months, with average days late.', { months: { type: 'integer', description: 'How many recent months, 1-12. Default 3.' } }),
  def('vacant', 'Units that are not occupied: number, floor, size, rent, status, vacant since, enquiries received.'),
  def('contracts_ending', 'Contracts that end within the next N days (ending) and contracts whose end date has already passed while the tenant is still in the unit (expired): unit, tenant or shop, end date.', { days: { type: 'integer', description: '1-365. Default 60.' } }),
  def('repairs', 'Repair requests: unit, category, status, reported and resolved dates, whether someone is assigned.', { status: { type: 'string', enum: ['open', 'all'], description: 'open (default) or all.' } }),
  def('floor', 'The units on one floor, as the Tenants tab lists them: unit number, status (occupied or vacant), tenant or shop, contract end, rent. Use it for "who is on floor 2", "2ፎቅ ያሉት ተከራዮች". floorsInRecords lists the floors that have units.',
    { floor: { type: 'string', description: 'The floor as the owner said it: a number (0 = ground), "ground", "ግራውንድ", "ምድር ቤት", "2ፎቅ", "ሁለተኛ ፎቅ".' } }),
  def('find_tenant', 'Find a tenant or business by the name the owner wrote ("which floor is X on", "where is X", "the unit of X"). The search runs on the server over the records, tolerant of spelling; it returns unit, floor, status, contract end, rent and the tenant as a token. Also use it when the owner asks for information about any named tenant, shop or office, including a name that sounds like a service or a document office; then call unit with the unit number for the full picture.',
    { name: { type: 'string', description: 'The name copied exactly as the owner wrote it in this message, without other words. Do not translate or transliterate it.' } }),
  def('money', 'One month of money, as the dashboard\'s accounting tab: invoiced, collected, outstanding, cancelled invoices, expenses by category, VAT collected, VAT paid on expenses, net VAT, collected minus expenses. Figures only, not tax advice.', { month: MONTH_ARG }),
];

// Exact slug, name or Amharic name first; part of a name only when nothing matches exactly and the owner
// wrote at least three characters (so "Test Plaza" is not also "Test Plaza Annex", and "a" is nobody).
function pickBuildings(buildings, building) {
  const q = building == null ? '' : String(building).trim().toLowerCase();
  if (!q) return buildings;
  const names = b => [b.qrSlug, b.name, b.nameAm].filter(Boolean).map(n => String(n).toLowerCase());
  const exact = buildings.filter(b => names(b).includes(q));
  if (exact.length || q.length < 3) return exact;
  return buildings.filter(b => names(b).some(n => n.includes(q)));
}

// Shorten list arrays, longest first, until the whole result fits RESULT_LIMIT. Totals, counts and dates
// are never touched; a shortened building and the result say truncated: true.
function fit(result) {
  let size = JSON.stringify(result).length;
  if (size <= RESULT_LIMIT) return result;
  const lists = [];
  for (const b of result.buildings) for (const k of Object.keys(b)) if (Array.isArray(b[k])) lists.push([b, k]);
  while (size > RESULT_LIMIT) {
    let best = null;
    for (const l of lists) if (l[0][l[1]].length && (!best || l[0][l[1]].length > best[0][best[1]].length)) best = l;
    if (!best) break;
    const [b, k] = best;
    b[k] = b[k].slice(0, Math.floor(b[k].length * 3 / 4));
    b.truncated = true;
    size = JSON.stringify(result).length;
  }
  result.truncated = true;
  return result;
}

// Tenants' and shops' names never go to the model, which runs outside the server. Before a result leaves the
// executor every occupant in it is replaced by a token such as [[P1]] — the same name keeps the same token for
// the whole question — and execute.names maps each token back, so the agent puts names into the finished reply
// on the server. Every tool reports a tenant or shop under the key `occupant`; a tool that reports a name
// under any other key must be added to NAME_KEYS (test/owner/building-tools.test.js scans every tool's
// executor output for the fixture's names).
const NAME_KEYS = new Set(['occupant']);

function tokenize(value, tokens, names) {
  if (Array.isArray(value)) return value.map(x => tokenize(x, tokens, names));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const [k, x] of Object.entries(value)) {
    if (NAME_KEYS.has(k) && typeof x === 'string' && x) {
      if (!tokens.has(x)) { const token = '[[P' + (tokens.size + 1) + ']]'; tokens.set(x, token); names.set(token, x); }
      out[k] = tokens.get(x);
    } else out[k] = tokenize(x, tokens, names);
  }
  return out;
}

// bind(scope, { question }): question is the owner's message for this turn, the only text find_tenant may search.
function makeExecutor({ prisma, now = () => new Date(), warn = m => console.warn(m) }) {
  return function bind(scope, ctx = {}) {
    const turn = { question: String((ctx && ctx.question) || '') };
    let loading = null;   // one load per question, however many tools the model calls
    const tokens = new Map(), names = new Map();   // name -> token and token -> name, for this question only
    async function execute(name, args) {
      if (typeof name !== 'string' || !Object.hasOwn(TOOLS, name)) return { error: 'unknown tool ' + String(name) };
      const fn = TOOLS[name];
      args = args && typeof args === 'object' ? args : {};
      if (args.month != null && !MONTH.test(String(args.month))) return { error: 'month must look like 2026-09' };
      const t = now();
      let data;
      try {
        if (!loading) loading = loadBuildings(prisma, scope && scope.buildingIds, t);
        data = await loading;
      } catch (e) {
        loading = null;
        warn('[owner] records unavailable: ' + (e && e.message || e));
        return { error: 'records unavailable' };
      }
      const bs = pickBuildings(data.buildings, args.building);
      if (!bs.length) return { error: 'no such building for this owner' };
      // tokens before fit, so the size checked is the size the model is sent
      return fit({ buildings: bs.map(b => Object.assign({ building: b.name, buildingAm: b.nameAm || null },
        tokenize(fn(view(data, b), args, t, turn), tokens, names))) });
    }
    execute.names = names;
    return execute;
  };
}

module.exports = { TOOLS, DEFS, VAT_RATE, REPAIR_TYPES, NAME_KEYS, view, makeExecutor, pickBuildings, parseFloor, nameScore, typedByOwner };
