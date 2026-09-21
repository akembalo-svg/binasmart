'use strict';
// One office = its behaviour (gov/tenants.json, in the repo, reviewed) + its operations
// (/root/storage/gov/offices.json, on the server, mode 600, never in git), joined by id.
// Why two files and not a Prisma table: docs/superpowers/specs/2026-09-18-government-widget-design.md §2.
//
// offices.json: { "offices": [ { id, status: demo|trial|paid|suspended, origins: ["https://host"],
//   publicKey: "pk_...", quotaPerDay, visitorPerHour?, networkPerHour?, trialStart?, trialEnd?,
//   agreementSignedOn?, evalReport?, enabled?, contact? } ] }
// `contact` is a person at the office. Nothing in this module logs, returns in an error, or prints it.
const fs = require('fs');
const path = require('path');

const TENANTS_FILE = path.join(__dirname, 'tenants.json');
const OPS_FILE = '/root/storage/gov/offices.json';
// Every source knowledge/index.js can hold. A tenant lists what it reads; the rest is excluded for it.
// test/gov/registry.test.js fails when the index names a source that is not here.
const ALL_SOURCES = ['law', 'health', 'eservices', 'business', 'guide', 'news', 'web', 'page', 'skill', 'llms',
  'docs', 'addis', 'travel', 'banking', 'telecom', 'mor', 'style', 'style-om', 'watch'];
const STATUSES = ['demo', 'trial', 'paid', 'suspended'];
const SERVABLE = new Set(['demo', 'trial', 'paid']);
const ID = /^[a-z0-9-]{2,32}$/;
const ORIGIN = /^https:\/\/[a-z0-9.-]+(:\d{2,5})?$/;
const PUBLIC_KEY = /^pk_[a-z0-9]{16,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const stampOf = f => { try { const s = fs.statSync(f); return s.mtimeMs + ':' + s.size; } catch { return 'none'; } };
const both = o => o && typeof o.am === 'string' && typeof o.en === 'string';

function validateTenant(t) {
  const p = [];
  if (!t || !ID.test(String(t.id))) return ['id'];
  for (const k of ['institution', 'assistantName', 'role', 'greeting', 'intro', 'placeholder', 'footer']) if (!both(t[k])) p.push(k);
  if (!Array.isArray(t.sources) || !t.sources.length || t.sources.some(s => !ALL_SOURCES.includes(s) || /^style/.test(s))) p.push('sources');
  for (const k of ['prefer', 'exclude']) if (!Array.isArray(t[k]) || t[k].some(e => typeof e !== 'string' || !e.includes(':'))) p.push(k);
  if (!/^https:\/\//.test(String(t.home || ''))) p.push('home');
  if (!t.refuse || typeof t.refuse !== 'object') p.push('refuse');
  if (!Array.isArray(t.contacts)) p.push('contacts');
  return p;
}

function validateOps(o) {
  const p = [];
  if (!STATUSES.includes(o.status)) p.push('status');
  if (!Array.isArray(o.origins) || o.origins.some(x => !ORIGIN.test(String(x)))) p.push('origins');
  if (!PUBLIC_KEY.test(String(o.publicKey || ''))) p.push('publicKey');
  if (!(Number(o.quotaPerDay) > 0)) p.push('quotaPerDay');
  if (o.status === 'trial' && !(DAY.test(String(o.trialStart)) && DAY.test(String(o.trialEnd)))) p.push('trialStart/trialEnd');
  return p;
}

const excludeFor = t => ALL_SOURCES.filter(s => !t.sources.includes(s)).concat(t.exclude || []);

function effectiveStatus(ops, today) {
  if (!ops || ops.enabled === false) return 'off';
  if (!STATUSES.includes(ops.status)) return 'off';
  if (ops.status === 'trial' && String(ops.trialEnd) < today) return 'expired';
  return ops.status;
}

function makeRegistry({ tenantsFile = TENANTS_FILE, opsFile = process.env.GOV_OFFICES_FILE || OPS_FILE,
  reloadMs = 5000, now = Date.now, warn = m => console.error(m) } = {}) {
  let cache = { stamp: '', offices: new Map() }, checkedAt = -Infinity;

  function load() {
    const tj = readJson(tenantsFile), oj = readJson(opsFile);
    const tenants = tj && Array.isArray(tj.tenants) ? tj.tenants : [];
    const ops = new Map((oj && Array.isArray(oj.offices) ? oj.offices : [])
      .filter(o => o && ID.test(String(o.id))).map(o => [o.id, o]));
    const out = new Map();
    for (const t of tenants) {
      const bad = validateTenant(t);
      if (bad.length) { warn('[gov] tenant ' + (t && ID.test(String(t.id)) ? t.id : '?') + ' ignored, bad: ' + bad.join(', ')); continue; }
      let o = ops.get(t.id) || null;
      if (o) {
        const badOps = validateOps(o);
        if (badOps.length) { warn('[gov] office ' + t.id + ' operations ignored, bad: ' + badOps.join(', ')); o = null; }
      }
      out.set(t.id, { tenant: t, ops: o, exclude: excludeFor(t) });
    }
    return out;
  }
  function refresh() {
    const t = now();
    if (t - checkedAt < reloadMs) return;
    checkedAt = t;
    const s = stampOf(tenantsFile) + '|' + stampOf(opsFile);
    if (s !== cache.stamp) cache = { stamp: s, offices: load() };
  }
  const today = () => new Date(now()).toISOString().slice(0, 10);

  return {
    get(id) { refresh(); return cache.offices.get(String(id)) || null; },
    status(office) { return effectiveStatus(office && office.ops, today()); },
    servable(office) { return SERVABLE.has(effectiveStatus(office && office.ops, today())); },
    version() { refresh(); return cache.stamp; },
    ids() { refresh(); return [...cache.offices.keys()]; },
  };
}

module.exports = { makeRegistry, ALL_SOURCES, STATUSES, excludeFor, effectiveStatus, validateOps, validateTenant, OPS_FILE, PUBLIC_KEY, ORIGIN };
