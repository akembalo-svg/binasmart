'use strict';
// The rules every owner action follows (owner actions design §3.3), as pure functions: which actions exist, which
// count as bulk, quiet hours and the day in Addis Ababa time, how long a preview stays valid, who may confirm, which
// months invoices may be created for, and how a notice is cleaned and framed. No database and no clock of its own.
const crypto = require('crypto');

const KINDS = ['message', 'remind_unpaid', 'send_invoice', 'create_invoices', 'record_payment'];
// The dashboard answer an action falls back to when actions are off (agents/owner/rules.js CANT keys).
const CATEGORY = { message: 'message', remind_unpaid: 'message', send_invoice: 'invoice', create_invoices: 'invoice', record_payment: 'paid' };
const EXPIRY_MS = 10 * 60000;
const BULK_PER_DAY = 2;
const QUIET_FROM = 21, QUIET_TO = 7;          // Addis Ababa hours: 21:00–07:00
const ADDIS_MS = 3 * 3600000;                 // UTC+3 all year
// 'BinaSmart · <building name, at most 40>፦ ' is at most 54 characters; 250 more stay inside one GeezSMS message (334),
// with room for the one-time Telegram start link.
const NOTICE_MAX = 250;
const MAX_UNITS = 50;
const MAX_INVOICE_UNITS = 20;
const METHODS = ['CASH', 'TELEBIRR', 'CBE_BIRR', 'BANK_TRANSFER'];   // the pay buttons in public/owner.html
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const addisHour = now => new Date(now.getTime() + ADDIS_MS).getUTCHours();
const isQuiet = now => { const h = addisHour(now); return h >= QUIET_FROM || h < QUIET_TO; };
function addisDayStart(now) {
  const d = new Date(now.getTime() + ADDIS_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ADDIS_MS);
}
const addisClock = at => new Date(new Date(at).getTime() + ADDIS_MS).toISOString().slice(11, 16);

// A message or a reminder run that reaches more than one tenant is bulk: at most two a day, and not in quiet hours
// unless urgent. A single unit's message, reminder or invoice, and a payment, are not (§3.3).
const isBulk = (kind, recipients) => (kind === 'message' || kind === 'remind_unpaid') && recipients > 1;

// Only an owner confirms; the dashboard session is the owner's key; staff only when the building switched that on.
const mayConfirm = (role, staffConfirm) => role === 'owner' || role === 'dashboard' || (role === 'staff' && staffConfirm === true);

// 22 URL-safe characters (128 random bits): the only thing a button carries.
const newId = (randomBytes = crypto.randomBytes) => randomBytes(16).toString('base64url');

// Invoices may be created from three months back to next month (Addis months).
function monthAllowed(ym, now) {
  const m = MONTH_RE.exec(String(ym == null ? '' : ym));
  if (!m) return false;
  const d = new Date(now.getTime() + ADDIS_MS);
  const cur = d.getUTCFullYear() * 12 + d.getUTCMonth();
  const want = Number(m[1]) * 12 + Number(m[2]) - 1;
  return want >= cur - 3 && want <= cur + 1;
}

// The owner's words, tidied only: spaces, line breaks, length. A name token means the model wrote it, not the owner.
function cleanNotice(raw) {
  const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return { ok: false, error: 'text_required' };
  if (/\[\[\s*P\d+\s*\]\]/i.test(text)) return { ok: false, error: 'text_tokens' };
  if (text.length > NOTICE_MAX) return { ok: false, error: 'text_too_long' };
  return { ok: true, text };
}

// What a tenant reads in Telegram: the building above, the owner's text, the signature below — added by code (§3.3).
// The SMS carries the owner's text alone; the delivery layer puts 'BinaSmart · <building>፦ ' in front of it.
const noticeTelegram = (building, text) => '📢 ' + (building.nameAm || building.name) + '\n\n' + text + '\n\n— ' + building.name + ' · BinaSmart';

// Unit numbers as the owner or the model gave them: an array, or one string separated by commas.
function unitList(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[,;፣،]+/);
  return [...new Set(parts.map(u => String(u == null ? '' : u).trim().slice(0, 20)).filter(Boolean))];
}

const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('base64url');

module.exports = { KINDS, CATEGORY, EXPIRY_MS, BULK_PER_DAY, NOTICE_MAX, MAX_UNITS, MAX_INVOICE_UNITS, METHODS, ID_RE, MONTH_RE,
  addisHour, isQuiet, addisDayStart, addisClock, isBulk, mayConfirm, newId, monthAllowed, cleanNotice, noticeTelegram, unitList, fingerprint };
