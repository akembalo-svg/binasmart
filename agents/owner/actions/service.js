'use strict';
// Owner actions with ✅ confirm (owner actions design §3).
//
// prepare() is all Bini's prepare tools can reach: it validates in code, reads every figure from the database, stores a
// pending action (OwnerAction) and returns the preview card. Nothing is sent and nothing is written except that row and
// its audit line.
//
// press() is the only way an action runs. The owner presses ✅ (or ✖, or ⚠️ urgent) in Telegram or in the dashboard chat,
// and code — never the model — checks: the same channel the action was prepared in; for Telegram, the presser's link
// still holds an owner approval for the building (re-read now, as for every owner message) and the card is in their
// chat; for the dashboard, the same building's owner key; the building's actions switch is still on; the action is not
// expired (10 minutes) and not used (pending → running in one statement); quiet hours and the daily bulk limit. Then
// the figures are resolved again: if anything changed — a tenant paid, a tenancy ended, a tenant linked Telegram, the
// SMS balance ran short — the card becomes a new preview instead of running.
//
// Execution reuses the dashboard's code through `ops` (building/invoice-ops.js markPaid and sendInvoice,
// building/invoices.js, the delivery layer), and the card is edited with the result.
//
// deps:
//   store     agents/owner/actions/store.js makeOwnerActionStore
//   resolver  agents/owner/actions/resolve.js makeActionResolver
//   delivery  { plan }                                         messaging/delivery.js
//   ops       { tenantBuilding(b), sendBatch({ building, kind, text, recipients, actor }), sendInvoice({ buildingId, invoiceId, actor }),
//               markPaid({ invoiceId, method, actor }), generateInvoices(buildingId, month), invoiceLink(invoiceId, kind) }
//   access    { scopeFor(telegramId), ownerChatsForBuilding(buildingId) }   agents/owner/access.js
//   switches  (buildingIds) → { on, staff }                   agents/owner/actions/store.js makeActionSwitches
//   audit     (buildingId, action, detail, amount, actor)
const P = require('./policy');
const card = require('./card');
const { LINK_SAMPLE } = require('./resolve');

const errKind = e => String((e && (e.code || e.name)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';
const VERBS = ['confirm', 'cancel', 'urgent'];

function makeOwnerActions({ store, resolver, delivery, ops, access, switches, audit, now = () => new Date(), randomId = P.newId, log = () => {} }) {
  const note = (buildingId, action, detail, amount, actor) =>
    Promise.resolve().then(() => audit(buildingId, action, detail, amount == null ? null : amount, actor || null)).catch(() => {});
  const tbOf = b => Object.assign({}, ops.tenantBuilding(b), { name: b.name });
  const figuresOf = (fresh, plan) => ({ f: fresh.figures, p: plan ? { counts: plan.counts, smsParts: plan.smsParts, withinLimit: plan.withinLimit } : null });

  async function planFor(b, fresh) {
    return fresh.recipients.length ? delivery.plan({ building: ops.tenantBuilding(b), recipients: fresh.recipients }) : null;
  }

  async function createPending({ b, kind, fresh, plan, channel, preparedBy, preparedRole, preparedTg, cards = [], staff = false, changed = false }) {
    const a = { id: randomId(), buildingId: b.id, kind, status: 'pending', channel, preparedBy, preparedRole, preparedTg: preparedTg || null,
      args: fresh.args, payload: fresh.payload, text: fresh.text || null, fingerprint: P.fingerprint(figuresOf(fresh, plan)),
      bulk: P.isBulk(kind, fresh.recipients.length), urgent: false, cards, expiresAt: new Date(now().getTime() + P.EXPIRY_MS) };
    const view = card.preview(a, fresh, plan, { now: now(), tb: tbOf(b), staff, changed });
    a.cardText = view.text;
    await store.create(a);
    return { a, view };
  }

  const refuse = (error, extra = {}) => ({ ok: false, error, ...extra });

  // scope: from the route (owner key) or from the Telegram link, plus actionsOn / staffConfirm from the switches.
  async function prepare({ kind, args = {}, scope, channel }) {
    if (!P.KINDS.includes(kind)) return refuse('error');
    const ids = (scope && Array.isArray(scope.buildingIds)) ? scope.buildingIds : [];
    if (!ids.length) return refuse('no_building');
    try {
      const bs = resolver.pickBuilding(await resolver.buildings(ids), args.building);
      if (bs.length !== 1) return refuse(bs.length ? 'which_building' : 'no_building');
      const b = bs[0];
      if (!(scope.actionsOn || []).includes(b.id)) return refuse('actions_off', { kind });
      const web = channel === 'owner-web';
      const role = web ? 'dashboard' : ((scope.roles || {})[b.id] || 'staff');
      const preparedBy = web ? 'dashboard' : ((scope.accessIds || {})[b.id] || 'telegram');
      const fresh = await resolver.resolve(kind, b, args);
      if (!fresh.ok) return refuse(fresh.error, fresh);
      const plan = await planFor(b, fresh);
      if (plan && !plan.withinLimit) return refuse('sms_limit', { needed: plan.smsParts, remaining: plan.remaining });
      if (P.isBulk(kind, fresh.recipients.length) && await store.countBulkSince(b.id, P.addisDayStart(now()), null) >= P.BULK_PER_DAY) return refuse('bulk_limit');
      const staff = !P.mayConfirm(role, (scope.staffConfirm || []).includes(b.id));
      if (staff && (web || !(await access.ownerChatsForBuilding(b.id)).length)) return refuse('no_owner_chat');
      const { a, view } = await createPending({ b, kind, fresh, plan, channel, preparedBy, preparedRole: role, preparedTg: web ? null : scope.telegramId, staff });
      note(b.id, 'OWNER_ACTION_PREPARED', card.auditDetail(a, { recipients: fresh.recipients.length, plan }), null, preparedBy);
      return { ok: true, id: a.id, kind, staff, card: staff ? card.sentToOwner(view.text) : view, model: card.forModel(a, fresh) };
    } catch (e) {
      log('[owner-actions] prepare error: ' + errKind(e));
      return refuse('error');
    }
  }

  // For a staff-prepared action on Telegram: the card each linked owner gets, with the buttons.
  async function ownerCards(id) {
    const a = await store.get(id);
    if (!a || a.status !== 'pending' || a.channel !== 'owner-telegram' || P.mayConfirm(a.preparedRole, false)) return [];
    const view = { text: a.cardText, buttons: card.buttons(a, now()) };
    return (await access.ownerChatsForBuilding(a.buildingId)).map(c => ({ chatId: String(c.chatId), text: view.text, buttons: view.buttons }));
  }

  async function attachCard(id, chatId, messageId) {
    const a = await store.get(id);
    if (!a || messageId == null) return false;
    const cards = (Array.isArray(a.cards) ? a.cards : []).filter(c => !(String(c.chatId) === String(chatId) && Number(c.messageId) === Number(messageId)));
    cards.push({ chatId: String(chatId), messageId: Number(messageId) });
    await store.setCards(id, cards.slice(-5));
    return true;
  }

  async function authorise(a, actor) {
    if (!actor || actor.channel !== a.channel) return { ok: false, reason: 'channel' };
    const sw = await switches([a.buildingId]);
    if (!sw.on.includes(a.buildingId)) return { ok: false, reason: 'actions_off' };
    if (actor.channel === 'owner-web')
      return String(actor.buildingId) === String(a.buildingId) ? { ok: true, actor: 'dashboard', role: 'dashboard' } : { ok: false, reason: 'building' };
    if (actor.channel !== 'owner-telegram' || !actor.telegramId || String(actor.chatId) !== String(actor.telegramId)) return { ok: false, reason: 'chat' };
    const scope = await access.scopeFor(actor.telegramId);
    if (!scope || !scope.buildingIds.includes(a.buildingId)) return { ok: false, reason: 'access' };
    const role = (scope.roles || {})[a.buildingId];
    const accessId = (scope.accessIds || {})[a.buildingId] || 'telegram';
    if (!P.mayConfirm(role, sw.staff.includes(a.buildingId))) return { ok: false, reason: 'role', actor: accessId };
    const onCard = (Array.isArray(a.cards) ? a.cards : []).some(c => String(c.chatId) === String(actor.chatId))
      || (a.preparedTg && String(a.preparedTg) === String(actor.telegramId));
    if (!onCard) return { ok: false, reason: 'not_this_card', actor: accessId };
    return { ok: true, actor: accessId, role };
  }

  // The Telegram cards to edit with the outcome: every card of the action, and the one pressed.
  function cardsOf(a, actor) {
    const list = (Array.isArray(a.cards) ? a.cards : []).map(c => ({ chatId: String(c.chatId), messageId: Number(c.messageId) }));
    if (actor && actor.channel === 'owner-telegram' && actor.messageId != null && !list.some(c => c.chatId === String(actor.chatId) && c.messageId === Number(actor.messageId)))
      list.push({ chatId: String(actor.chatId), messageId: Number(actor.messageId) });
    return list;
  }
  // edits carry the id their buttons act on: a replaced action's card gets the new pending action's id.
  const outcome = (a, actor, view, extra) => {
    const id = (extra && extra.id) || a.id;
    return Object.assign({ id, card: view, edits: cardsOf(a, actor).map(c => ({ ...c, id, text: view.text, buttons: view.buttons })) }, extra);
  };
  async function settled(id, actor) {
    const a = await store.get(id);
    return outcome(a, actor, card.final(a), { ok: false, status: a.status, toast: card.toast(a.status) });
  }

  async function press({ id, verb, actor }) {
    if (!P.ID_RE.test(String(id || '')) || !VERBS.includes(verb)) return { ok: false, status: 'gone', toast: card.toast('gone'), edits: [] };
    const a = await store.get(id);
    if (!a) return { ok: false, status: 'gone', toast: card.toast('gone'), edits: [] };
    const who = await authorise(a, actor);
    if (!who.ok) {
      note(a.buildingId, 'OWNER_ACTION_REFUSED', card.auditDetail(a, { reason: 'press refused: ' + who.reason }), null, who.actor || (actor && actor.channel));
      return { ok: false, status: 'not_allowed', toast: card.toast('not_allowed'), edits: [] };
    }
    if (a.status !== 'pending') return outcome(a, actor, card.final(a), { ok: false, status: a.status, toast: card.toast(a.status) });
    const t = now();

    if (verb === 'cancel') {
      if (!(await store.transition(a.id, 'pending', 'cancelled', { confirmedBy: who.actor, confirmedAt: t }))) return settled(a.id, actor);
      note(a.buildingId, 'OWNER_ACTION_CANCELLED', card.auditDetail(a, {}), null, who.actor);
      return outcome(a, actor, card.final({ ...a, status: 'cancelled' }), { ok: true, status: 'cancelled', toast: card.toast('cancelled') });
    }
    if (new Date(a.expiresAt) <= t) {
      if (await store.transition(a.id, 'pending', 'expired', {})) note(a.buildingId, 'OWNER_ACTION_EXPIRED', card.auditDetail(a, { reason: 'pressed after expiry' }), null, who.actor);
      return settled(a.id, actor);
    }

    let b = (await resolver.buildings([a.buildingId]))[0];
    if (a.bulk && P.isQuiet(t) && verb !== 'urgent') {
      // Nothing changes: the card shows the ⚠️ button, the action stays pending until it expires.
      const fresh = b ? await resolver.resolve(a.kind, b, a.args) : null;
      const view = fresh && fresh.ok ? card.preview(a, fresh, await planFor(b, fresh), { now: t, tb: tbOf(b) }) : { text: a.cardText, buttons: card.buttons(a, t) };
      return outcome(a, actor, view, { ok: false, status: 'quiet', toast: card.toast('quiet') });
    }

    if (!(await store.claim(a.id, t, { confirmedBy: who.actor, urgent: verb === 'urgent' }))) return settled(a.id, actor);
    note(a.buildingId, 'OWNER_ACTION_CONFIRMED', card.auditDetail(a, { urgent: verb === 'urgent' }), null, who.actor);
    const stop = async (status, result, reason) => {
      await store.finish(a.id, status, result);
      note(a.buildingId, status === 'failed' ? 'OWNER_ACTION_FAILED' : 'OWNER_ACTION_REFUSED', card.auditDetail(a, { reason }), null, who.actor);
      return settled(a.id, actor);
    };

    let fresh, plan;
    try {
      b = (await resolver.buildings([a.buildingId]))[0];
      if (!b) return stop('refused', { error: 'no_building' }, 'building gone');
      fresh = await resolver.resolve(a.kind, b, a.args);
      if (!fresh.ok) return stop('refused', { ...fresh }, 'at confirm: ' + fresh.error);
      plan = await planFor(b, fresh);
    } catch (e) {
      log('[owner-actions] confirm error: ' + errKind(e));
      return stop('refused', { error: 'error' }, 'at confirm: ' + errKind(e));
    }

    if (P.fingerprint(figuresOf(fresh, plan)) !== a.fingerprint) {
      await store.finish(a.id, 'replaced', null);
      const { a: next, view } = await createPending({ b, kind: a.kind, fresh, plan, channel: a.channel, preparedBy: a.preparedBy,
        preparedRole: a.preparedRole, preparedTg: a.preparedTg, cards: Array.isArray(a.cards) ? a.cards : [], changed: true });
      note(a.buildingId, 'OWNER_ACTION_REPLACED', card.auditDetail(a, { reason: 'records changed; new preview ' + next.id }), null, who.actor);
      return outcome(a, actor, view, { ok: false, status: 'replaced', id: next.id, toast: card.toast('changed') });
    }
    if (plan && !plan.withinLimit) return stop('refused', { error: 'sms_limit', needed: plan.smsParts, remaining: plan.remaining }, 'sms limit');
    if (a.bulk && await store.countBulkSince(a.buildingId, P.addisDayStart(t), a.id) >= P.BULK_PER_DAY) return stop('refused', { error: 'bulk_limit' }, 'bulk limit');

    let result;
    try {
      result = await run(a, b, fresh, who.actor);
    } catch (e) {
      log('[owner-actions] run error: ' + errKind(e));
      return stop('failed', { error: errKind(e) }, 'run error ' + errKind(e));
    }
    const status = result.error === 'already_paid' ? 'refused' : (result.error ? 'failed' : 'done');
    await store.finish(a.id, status, result);
    note(a.buildingId, status === 'done' ? 'OWNER_ACTION_DONE' : status === 'refused' ? 'OWNER_ACTION_REFUSED' : 'OWNER_ACTION_FAILED',
      card.auditDetail(a, result), result.totalEtb || null, who.actor);
    const done = await store.get(a.id);
    return outcome(done, actor, card.final(done), { ok: status === 'done', status, toast: card.toast(status), result });
  }

  // The dashboard's own code does the work; the delivery layer records every message.
  async function run(a, b, fresh, actor) {
    const unitOf = id => fresh.unitOf[id];
    const notReached = results => [...new Set((results || []).filter(x => x.status === 'failed').map(x => unitOf(x.tenancyId)).filter(Boolean))];
    switch (a.kind) {
      case 'message': {
        const r = await ops.sendBatch({ building: b, kind: 'notice', text: fresh.text, recipients: fresh.recipients, actor });
        return { counts: r.counts, batchIds: r.batchId ? [r.batchId] : [], notReached: notReached(r.results), error: r.error || null };
      }
      case 'remind_unpaid': {
        const recipients = [];
        for (const x of fresh.recipients) {
          const link = await ops.invoiceLink(x.invoiceId, 'invoice');
          recipients.push({ ...x, text: x.text.split(LINK_SAMPLE).join(link), smsText: x.smsText.split(LINK_SAMPLE).join(link) });
        }
        const r = await ops.sendBatch({ building: b, kind: 'reminder', text: null, recipients, actor });
        return { counts: r.counts, batchIds: r.batchId ? [r.batchId] : [], notReached: notReached(r.results), error: r.error || null };
      }
      case 'send_invoice': {
        const counts = { telegram: 0, sms: 0, none: 0, sent: 0, test: 0, failed: 0 };
        const batchIds = [], missed = [];
        for (const inv of fresh.payload.invoices) {
          const r = await ops.sendInvoice({ buildingId: b.id, invoiceId: inv.invoiceId, actor });
          if (!r.ok) { counts.none++; counts.failed++; missed.push(inv.unit); continue; }
          counts[r.channel] = (counts[r.channel] || 0) + 1;
          if (r.delivered) counts.sent++; else if (r.status === 'test') counts.test++; else { counts.failed++; missed.push(inv.unit); }
          if (r.batchId) batchIds.push(r.batchId);
        }
        return { counts, batchIds, notReached: missed, error: null };
      }
      case 'create_invoices': {
        const r = await ops.generateInvoices(b.id, fresh.args.month);
        return { created: r.created, skipped: r.skipped, month: fresh.args.month, error: null };
      }
      case 'record_payment': {
        const p = fresh.payload;
        const r = await ops.markPaid({ invoiceId: p.invoiceId, method: p.method, actor });
        if (!r.ok) return { error: r.error, invoiceId: p.invoiceId, unit: p.unit };
        const rc = r.receipt ? await r.receipt : null;
        return { invoiceId: p.invoiceId, unit: p.unit, totalEtb: p.totalEtb, error: null,
          receipt: rc ? { channel: rc.channel, status: rc.status, errorKind: rc.errorKind || null, batchId: rc.batchId || null } : null,
          batchIds: rc && rc.batchId ? [rc.batchId] : [] };
      }
      default: throw new Error('unknown kind');
    }
  }

  // Pending actions nobody pressed within 10 minutes. Their Telegram buttons stay until pressed; a press then shows expired.
  async function expireOld() {
    let n = 0;
    for (const a of await store.expiredPending(now())) {
      if (await store.transition(a.id, 'pending', 'expired', {})) {
        n++;
        note(a.buildingId, 'OWNER_ACTION_EXPIRED', a.kind + ' · ' + a.channel + ' · not confirmed within 10 minutes · id ' + a.id, null, a.preparedBy);
      }
    }
    return n;
  }

  return { prepare, press, ownerCards, attachCard, expireOld };
}

module.exports = { makeOwnerActions };
