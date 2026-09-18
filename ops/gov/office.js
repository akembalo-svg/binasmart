'use strict';
// The only way an office's operational record changes. Run by a person, on the server (design D13).
//   node ops/gov/office.js --list
//   node ops/gov/office.js --show mols                                (the public key as its length only)
//   node ops/gov/office.js --init mols --origins https://mols.gov.et,https://www.mols.gov.et [--quota 500]
//   node ops/gov/office.js --agreement mols --signed-on 2026-10-01
//   node ops/gov/office.js --enable mols --status trial [--report <path>]
//   node ops/gov/office.js --enable mols --status paid  [--report <path>]
//   node ops/gov/office.js --status mols suspended|demo               (always allowed, takes effect within 5 s)
// --enable runs ops/gov/gate.js on the report (default /root/bini-eval/gov-<id>-latest.json) and its verdicts,
// and refuses unless the gate passes, the evaluation is at most 7 days old and an agreement date is recorded.
// A trial starts today, ends trialDays (30, Y2) later, and caps the office at quotaPerDayTrial (500, Y2).
// Every change and every refusal is appended to office-audit.log next to the offices file.
// Never prints a contact or the public key. A contact is added by hand to the file, by Ibrahim.
// GOV_OFFICES_FILE points the script at another file (the tests use a temporary one).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OPS_FILE, ORIGIN, STATUSES } = require('../../gov/registry');

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GATE_AGE_DAYS = 7;
const ON = ['trial', 'paid'];
const defaultFile = () => process.env.GOV_OFFICES_FILE || OPS_FILE;
const auditFile = file => path.join(path.dirname(file), 'office-audit.log');

function read(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j.offices) ? j : { offices: [] }; }
  catch (e) { if (e.code === 'ENOENT') return { offices: [] }; throw e; }
}
function write(file, j) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}
// One JSON line per change or refusal: who asked for what, never a key or a contact.
function audit(file, entry, now) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(auditFile(file), JSON.stringify(Object.assign({ at: new Date(now).toISOString() }, entry)) + '\n', { mode: 0o600 });
}
function refuse(file, now, entry, message) {
  audit(file, Object.assign({ ok: false }, entry, { refused: message }), now);
  throw new Error(message);
}
function checkOrigins(list) { for (const o of list) if (!ORIGIN.test(o)) throw new Error('not an exact https origin: ' + o); return list; }
function find(file, now, j, id, action) {
  const o = j.offices.find(x => x.id === id);
  if (!o) refuse(file, now, { id: String(id), action }, 'no office ' + id + '; run --init first');
  return o;
}

function init({ file = defaultFile(), id, origins = [], quotaPerDay = 500, now = Date.now() }) {
  const j = read(file);
  if (j.offices.some(o => o.id === id)) refuse(file, now, { id, action: 'init' }, 'office ' + id + ' exists');
  const rec = { id, status: 'demo', origins: checkOrigins(origins), publicKey: 'pk_' + crypto.randomBytes(12).toString('hex'),
    quotaPerDay: Number(quotaPerDay), createdAt: new Date(now).toISOString() };
  j.offices.push(rec); write(file, j);
  audit(file, { ok: true, id, action: 'init', to: 'demo', origins: rec.origins.length, quotaPerDay: rec.quotaPerDay }, now);
  return rec;
}

function agreement({ file = defaultFile(), id, signedOn, now = Date.now() }) {
  if (!DAY.test(String(signedOn)) || Number.isNaN(Date.parse(signedOn))) refuse(file, now, { id, action: 'agreement' }, '--signed-on YYYY-MM-DD');
  if (String(signedOn) > new Date(now).toISOString().slice(0, 10)) refuse(file, now, { id, action: 'agreement' }, 'the agreement date ' + signedOn + ' is in the future');
  const j = read(file), o = find(file, now, j, id, 'agreement');
  o.agreementSignedOn = signedOn; write(file, j);
  audit(file, { ok: true, id, action: 'agreement', signedOn }, now);
  return o;
}

// gateResult is what ops/gov/gate.js returned; reportAt is when that evaluation ran.
function setStatus({ file = defaultFile(), id, status, gateResult, trialDays = 30, quotaPerDay = 500, now = Date.now(), report = '' }) {
  const entry = { id, action: 'status', to: status };
  if (!STATUSES.includes(status)) refuse(file, now, entry, 'status must be one of ' + STATUSES.join(', '));
  const j = read(file), o = find(file, now, j, id, 'status');
  entry.from = o.status;
  if (ON.includes(status)) {
    if (status === 'trial' && o.trialStart) refuse(file, now, entry, 'trial already used for ' + id + ' (' + o.trialStart + '..' + o.trialEnd + ')');
    if (!DAY.test(String(o.agreementSignedOn || ''))) refuse(file, now, entry, 'no agreement recorded for ' + id + ' (--agreement ' + id + ' --signed-on YYYY-MM-DD)');
    if (!gateResult || gateResult.pass !== true) refuse(file, now, entry, 'the evaluation gate does not pass: ' + ((gateResult && gateResult.reasons) || ['no result']).join('; '));
    const age = (now - Date.parse(gateResult.reportAt)) / DAY_MS;
    if (!(age >= 0 && age <= MAX_GATE_AGE_DAYS)) refuse(file, now, entry, 'the passing evaluation must be at most ' + MAX_GATE_AGE_DAYS + ' days old (run ops/gov/eval.js again)');
    if (!Array.isArray(o.origins) || !o.origins.length) refuse(file, now, entry, 'no origins for ' + id);
    o.evalReport = report;
  }
  if (status === 'trial') {
    o.trialStart = new Date(now).toISOString().slice(0, 10);
    o.trialEnd = new Date(now + trialDays * DAY_MS).toISOString().slice(0, 10);
    o.quotaPerDay = Number(quotaPerDay);
  }
  o.status = status; o.statusChangedAt = new Date(now).toISOString();
  write(file, j);
  audit(file, Object.assign({ ok: true }, entry, status === 'trial' ? { trialStart: o.trialStart, trialEnd: o.trialEnd, quotaPerDay: o.quotaPerDay } : {},
    ON.includes(status) ? { report, reportAt: gateResult.reportAt } : {}), now);
  return o;
}

function list({ file = defaultFile() } = {}) {
  return read(file).offices.map(o => [o.id, o.status, 'origins=' + (o.origins || []).length, 'quota=' + o.quotaPerDay,
    'trial=' + (o.trialStart || '-') + '..' + (o.trialEnd || '-'), 'agreement=' + (o.agreementSignedOn || '-')].join('  '));
}

function show({ file = defaultFile(), id }) {
  const o = read(file).offices.find(x => x.id === id);
  if (!o) throw new Error('no office ' + id);
  return Object.entries(o).filter(([k]) => k !== 'contact').map(([k, v]) => k.padEnd(18) + (k === 'publicKey'
    ? '(' + String(v || '').length + ' characters)' : typeof v === 'object' ? JSON.stringify(v) : String(v)));
}

if (require.main === module) {
  const a = process.argv.slice(2), at = n => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const KNOWN = ['--list', '--show', '--init', '--origins', '--quota', '--agreement', '--signed-on', '--enable', '--status', '--report'];
  try {
    const unknown = a.find(x => x.startsWith('--') && !KNOWN.includes(x));
    if (unknown) { console.error('office: no such option: ' + unknown); process.exit(2); }
    if (a.includes('--list')) console.log(list().join('\n') || '(no offices)');
    else if (a.includes('--show')) console.log(show({ id: at('--show') }).join('\n'));
    else if (a.includes('--init')) {
      const r = init({ id: at('--init'), origins: String(at('--origins') || '').split(',').filter(Boolean), quotaPerDay: Number(at('--quota') || 500) });
      console.log(show({ id: r.id }).join('\n'));
    } else if (a.includes('--agreement')) console.log('recorded: ' + agreement({ id: at('--agreement'), signedOn: at('--signed-on') }).agreementSignedOn);
    else if (a.includes('--enable')) {
      const id = at('--enable'), status = at('--status');
      if (!ON.includes(status)) { console.error('office: --enable takes --status trial or --status paid'); process.exit(2); }
      const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(x => x.id === id);
      if (!t || !t.gate) throw new Error('no tenant ' + id + ' with a gate in gov/tenants.json');
      const report = at('--report') || '/root/bini-eval/gov-' + id + '-latest.json';
      const vfile = report.replace(/\.json$/, '-verdicts.json');
      for (const f of [report, vfile]) if (!fs.existsSync(f)) refuse(defaultFile(), Date.now(), { id, action: 'status', to: status }, 'no evaluation report at ' + f + ' (run ops/gov/eval.js)');
      const { gate } = require('./gate');
      const gateResult = gate({ report: JSON.parse(fs.readFileSync(report, 'utf8')), verdicts: JSON.parse(fs.readFileSync(vfile, 'utf8')), office: id, thresholds: t.gate });
      const o = setStatus({ id, status, gateResult, trialDays: t.trialDays || 30, quotaPerDay: t.quotaPerDayTrial || 500, report });
      console.log(id + ' is now ' + o.status + (status === 'trial' ? ' until ' + o.trialEnd + ', ' + o.quotaPerDay + ' answered questions a day' : ''));
    } else if (a.includes('--status')) {
      const id = at('--status'), status = a[a.indexOf('--status') + 1 + 1];
      if (ON.includes(status)) { console.error('office: switching on is --enable ' + id + ' --status ' + status + ' (it checks the gate and the agreement)'); process.exit(2); }
      console.log(id + ' is now ' + setStatus({ id, status }).status);
    } else { console.error('see the header of ops/gov/office.js'); process.exit(2); }
  } catch (e) { console.error('office: ' + e.message); process.exit(1); }
}

module.exports = { init, agreement, setStatus, list, show };
