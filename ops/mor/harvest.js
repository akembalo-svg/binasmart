#!/usr/bin/env node
'use strict';
// Harvest the Ministry of Revenue (mor.gov.et) public JSON API into /root/legal-sources/mor/api/.
// Sequential, >= 2.5 s between requests, 120 s timeout, 3 attempts with growing pauses.
// Staff fields (User, UserId) are removed before anything is written.
//   node ops/mor/harvest.js [--reuse /tmp] [--only forms,faqs] [--skip-ok]   (--reuse: a probe copy /tmp/mor-<endpoint>.json that parses)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const OUT = '/root/legal-sources/mor/api';
const BASE = 'https://www.mor.gov.et/api/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const args = process.argv.slice(2);
const reuse = args.includes('--reuse') ? args[args.indexOf('--reuse') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const skipOk = args.includes('--skip-ok');
fs.mkdirSync(OUT, { recursive: true });

const LISTS = ['forms', 'form-categories', 'domestic-proclamations', 'domestic-proclamation-categories',
  'domestic-regulations', 'domestic-regulation-categories', 'domestic-directives', 'domestic-directive-categories',
  'custom-proclamations', 'custom-proclamation-categories', 'custom-regulations', 'custom-regulation-categories',
  'custom-directives', 'custom-directive-categories', 'faqs', 'customer-charters', 'brochures', 'other-documents',
  'draft-laws', 'recent-custom-proclamations-regulations', 'only-years'];
const BY_CAT = { 'form-categories': 'forms-by-category', 'domestic-proclamation-categories': 'domestic-proclamation-by-category',
  'domestic-regulation-categories': 'domestic-regulation-by-category', 'domestic-directive-categories': 'domestic-directive-by-category',
  'custom-proclamation-categories': 'custom-proclamation-by-category', 'custom-regulation-categories': 'custom-regulation-by-category',
  'custom-directive-categories': 'custom-directive-by-category' };

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (k === 'User' || k === 'UserId') continue; o[k] = strip(x); } return o; }
  return v;
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const manifestPath = path.join(OUT, 'manifest-api.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
let last = 0;

async function get(endpoint) {
  if (only && !only.includes(endpoint.split('/')[0])) return null;
  if (skipOk && manifest[endpoint] && manifest[endpoint].ok) { const f = path.join(OUT, endpoint.replace(/\//g, '__') + '.json'); console.log(endpoint + ': already ok'); return JSON.parse(fs.readFileSync(f, 'utf8')); }
  const url = BASE + endpoint;
  const file = path.join(OUT, endpoint.replace(/\//g, '__') + '.json');
  const tmp = '/tmp/mor-h-' + process.pid + '.json';
  if (reuse) {
    const r = path.join(reuse, 'mor-' + endpoint + '.json');
    try { const b = fs.readFileSync(r); JSON.parse(b.toString('utf8'));
      return save(endpoint, url, file, b, 200, fs.statSync(r).mtime.toISOString(), 'reused probe copy ' + r); } catch (e) { /* fetch */ }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = 2500 - (Date.now() - last); if (wait > 0) await sleep(wait);
    last = Date.now();
    let code = '000';
    try { code = execFileSync('curl', ['-sS', '-k', '-m', '120', '-A', 'BinaSmart-legal-library/1.0 (+https://bina.et)', '-o', tmp, '-w', '%{http_code}', url], { encoding: 'utf8' }).trim(); }
    catch (e) { code = 'ERR ' + String(e.message).split('\n').slice(-2).join(' ').slice(0, 120); }
    last = Date.now();
    let b = null; try { b = fs.readFileSync(tmp); } catch (e) { /* none */ }
    if (code === '200' && b) { try { JSON.parse(b.toString('utf8')); fs.unlinkSync(tmp); return save(endpoint, url, file, b, 200, new Date().toISOString(), 'fetched'); } catch (e) { code = '200 not-json'; } }
    console.log(`  ${endpoint}: attempt ${attempt} -> ${code}`);
    if (attempt < 3) await sleep(attempt * 15000);
  }
  manifest[endpoint] = { url, ok: false, fetched: new Date().toISOString() };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`${endpoint}: FAILED`);
  return null;
}

function save(endpoint, url, file, b, code, when, how) {
  const j = JSON.parse(b.toString('utf8'));
  const clean = Buffer.from(JSON.stringify(strip(j), null, 1));
  fs.writeFileSync(file, clean);
  const arr = Array.isArray(j) ? j : (Array.isArray(j && j.data) ? j.data : null);
  manifest[endpoint] = { url, ok: true, http: code, fetched: when, how, response_bytes: b.length, response_sha256: sha(b),
    saved: path.basename(file), saved_sha256: sha(clean), items: arr ? arr.length : null, note: 'User/UserId staff fields removed before saving' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`${endpoint}: ok ${b.length} bytes, items=${arr ? arr.length : typeof j} (${how})`);
  return strip(j);
}

(async () => {
  const got = {};
  for (const e of LISTS) got[e] = await get(e);
  for (const [cats, by] of Object.entries(BY_CAT)) {
    const list = got[cats]; if (!Array.isArray(list)) continue;
    for (const c of list) if (c && c.id != null) await get(by + '/' + c.id);
  }
  console.log('DONE');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
