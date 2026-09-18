'use strict';
// Limits and the ledger for the government widget, on api/usage.js (durable across restarts).
//
//   limits  /root/storage/gov/limits  visitor (salted hash of office + device id) and network (salted hash of
//           the address nginx saw), hour buckets, day files kept 2 days. Pseudonymous, short-lived.
//   ledger  /root/storage/gov/ledger  office:<id> x outcome, kept 400 days: the statement reads it. It holds
//           no address, no device id, no question.
//
// Checked by the engine AFTER the gates (assistant/kit/engine.js step 2b), so an emergency, a danger-abroad
// answer or a refusal is never limited. Only 'answered' spends the office's daily quota and is billable.
const crypto = require('crypto');
const { makeUsage } = require('../api/usage');

const ROOT = '/root/storage/gov';
const OUTCOMES = ['answered', 'refused', 'emergency', 'urgent', 'limited', 'error', 'fb-up', 'fb-down', 'report'];
const DEFAULTS = { visitorPerHour: 20, networkPerHour: 200, quotaPerDay: 500 };
const MIN_SALT = 32;
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
// The ledger key is built only from a well-formed office id, so no caller's mistake (a question passed where
// the id belongs) can write free text into a file kept 400 days.
const OFFICE_ID = /^[a-z0-9-]{2,32}$/;
const officeKey = id => 'office:' + (OFFICE_ID.test(String(id)) ? String(id) : 'unknown');

function outcomeOf(out) {
  if (!out || typeof out !== 'object') return 'error';
  if (out.emergency === true) return 'emergency';
  if (out.urgent === true) return 'urgent';
  if (out.limited === true) return 'limited';
  if (out.redirected === true) return 'refused';
  if (out.answered === true) return 'answered';
  return 'error';
}

function makeMeter({ root = process.env.GOV_STORAGE_DIR || ROOT, salt = process.env.API_KEY_PEPPER || '',
  now = Date.now, timer = true, limits, ledger } = {}) {
  if (String(salt).length < MIN_SALT) throw new Error('gov meter needs a salt of ' + MIN_SALT + '+ characters (API_KEY_PEPPER)');
  limits = limits || makeUsage({ dir: root + '/limits', proc: 'gov', retainDays: 2, now, timer });
  ledger = ledger || makeUsage({ dir: root + '/ledger', proc: 'gov', retainDays: 400, now, timer });
  const h = s => crypto.createHash('sha256').update(String(s) + '|' + salt).digest('hex').slice(0, 16);

  // The two per-person limits. true = go ahead (and the question is charged to both).
  function allowVisitor({ office, uid = '', ip = '', visitorPerHour, networkPerHour }) {
    const t = now(), o = officeKey(office);
    const v = uid ? 'v:' + h(office + '|' + String(uid).slice(0, 64)) : '';
    const n = 'n:' + h(ip);
    if (v && limits.count('hour', v, t) >= num(visitorPerHour, DEFAULTS.visitorPerHour)) { ledger.deny(o, 'visitor-limit', t); return false; }
    if (limits.count('hour', n, t) >= num(networkPerHour, DEFAULTS.networkPerHour)) { ledger.deny(o, 'network-limit', t); return false; }
    if (v) limits.hit(v, 'q', ['hour'], t);
    limits.hit(n, 'q', ['hour'], t);
    return true;
  }

  return {
    limits, ledger, allowVisitor,
    allow(opts) {
      const t = now(), o = officeKey(opts.office);
      if (ledger.count('day', o, t) >= num(opts.quotaPerDay, DEFAULTS.quotaPerDay)) { ledger.deny(o, 'office-quota', t); return false; }
      return allowVisitor(opts);
    },
    record(office, outcome) {
      const k = OUTCOMES.includes(outcome) ? outcome : 'error';
      ledger.hit(officeKey(office), k, k === 'answered' ? ['day'] : []);
    },
    stop() { limits.stop(); ledger.stop(); },
  };
}

module.exports = { makeMeter, outcomeOf, OUTCOMES, DEFAULTS };
