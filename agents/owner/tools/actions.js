'use strict';
// The five prepare tools Bini for owners may call (owner actions design §3.2). Each one only asks
// agents/owner/actions/service.js to PREPARE: the service validates in code, reads the figures from the database and
// stores a pending action; the owner's ✅ is what runs it. No tool here sends, writes a record, or confirms.
//
// The model gets back a short result with no id, no name and no phone number. What the owner reads — the card — is
// built by code from the database and replaces the model's words in the reply (agents/owner/rules.js finish).
const P = require('../actions/policy');

const KIND_OF = { prepare_message: 'message', prepare_reminders: 'remind_unpaid', prepare_invoice_send: 'send_invoice',
  prepare_invoices: 'create_invoices', prepare_payment: 'record_payment' };
const NAMES = new Set(Object.keys(KIND_OF));
const MAX_CALLS = 3;   // per owner message: a refused call may be corrected, never an action per call

const BUILDING = { type: 'string', description: 'Only when the owner has more than one building: its name. Omit otherwise.' };
const UNITS = { type: 'string', description: 'Unit numbers exactly as the owner wrote them, separated by commas, e.g. "211, 212".' };
const def = (name, description, properties = {}, required = []) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: Object.assign({ building: BUILDING }, properties), required } } });

const DEFS = [
  def('prepare_message', 'Prepare a message from the owner to tenants: all active tenants, one floor, or named units. It does NOT send: the owner sees a preview with the exact text and presses ✅ to send it. Call it once, only when the owner asked to send a message and wrote what it says.',
    { target: { type: 'string', enum: ['all', 'floor', 'units'], description: 'all tenants, one floor, or named units.' },
      floor: { type: 'string', description: 'For target floor: the floor as the owner said it ("2", "ground", "2ኛ ፎቅ").' },
      units: UNITS,
      text: { type: 'string', description: 'The message in the owner\'s own words and language, at most ' + P.NOTICE_MAX + ' characters. You may fix spelling and punctuation only. Never add a name, a token, an amount or a date the owner did not write. The building name and signature are added by the system.' } },
    ['target', 'text']),
  def('prepare_reminders', 'Prepare payment reminders for tenants with unpaid invoices that are due now or within 5 days; each tenant gets their own amounts and due dates from the records. units limits it to those units. It does NOT send: the owner confirms with ✅.',
    { units: UNITS }),
  def('prepare_invoice_send', 'Prepare sending each named unit\'s newest unpaid invoice to its tenant. It does NOT send: the owner confirms with ✅.',
    { units: UNITS }, ['units']),
  def('prepare_invoices', 'Prepare creating the monthly rent invoices of one month for every active tenant; tenants who already have that month\'s rent invoice are skipped. Creating does not send them. Nothing is created until the owner confirms with ✅.',
    { month: { type: 'string', description: 'The month as YYYY-MM, e.g. 2026-10. "this month" is the month of today\'s date.' } }, ['month']),
  def('prepare_payment', 'Prepare recording that one unit paid: it matches the unit\'s oldest unpaid invoice, or the unpaid invoice whose total equals amount. After the owner confirms with ✅ the invoice is marked paid and the tenant gets a receipt.',
    { unit: { type: 'string', description: 'The unit number as the owner wrote it.' },
      amount: { type: 'number', description: 'The amount in birr the owner said was paid, if they said one.' },
      method: { type: 'string', enum: P.METHODS, description: 'CASH unless the owner named telebirr, CBE Birr or a bank transfer.' } },
    ['unit']),
];

// bind({ actions, scope, channel, turn }) → execute(name, args). turn is the agent's per-message record (c.actionTurn):
// the first successful prepare is kept in turn.prepared, the last refusal in turn.refused.
function bind({ actions, scope, channel, turn }) {
  return async function execute(name, args) {
    const kind = KIND_OF[name];
    if (!kind) return { error: 'unknown tool ' + String(name) };
    if (turn.prepared) return { error: 'one action per message: a preview is already shown to the owner' };
    if (++turn.calls > MAX_CALLS) return { error: 'too many attempts in one message' };
    if (!actions) { turn.refused = { ok: false, error: 'actions_off', kind }; return { error: 'owner actions are off for this building' }; }
    const r = await actions.prepare({ kind, args: args && typeof args === 'object' ? args : {}, scope, channel });
    if (r.ok) { turn.prepared = r; turn.refused = null; return r.model; }
    turn.refused = r;
    return { error: r.error };
  };
}

module.exports = { DEFS, NAMES, KIND_OF, MAX_CALLS, bind };
