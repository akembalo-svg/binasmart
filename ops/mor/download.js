#!/usr/bin/env node
'use strict';
// Download every document referenced by the harvested MoR API JSON (/root/legal-sources/mor/api/*.json)
// into /root/legal-sources/mor/files/<endpoint>/<id>.<ext>. Sequential, >= 2.5 s apart, resumable.
// Inline base64 PDFs (some endpoints embed the file in the JSON) are decoded instead of fetched.
// Writes manifest.json: source URL, endpoint, id, title, number, year, category, sha256, bytes, pages, fetched.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = '/root/legal-sources/mor';
const API = path.join(ROOT, 'api');
const FILES = path.join(ROOT, 'files');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const MAX = 60 * 1024 * 1024;

const LIST_ORDER = ['forms', 'domestic-proclamations', 'domestic-regulations', 'domestic-directives', 'custom-proclamations',
  'custom-regulations', 'custom-directives', 'customer-charters', 'brochures', 'other-documents', 'draft-laws',
  'recent-custom-proclamations-regulations'];

const mpath = path.join(ROOT, 'manifest.json');
const manifest = fs.existsSync(mpath) ? JSON.parse(fs.readFileSync(mpath, 'utf8')) : { files: {} };

function items(endpoint) {
  const f = path.join(API, endpoint.replace(/\//g, '__') + '.json');
  if (!fs.existsSync(f)) return [];
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return Array.isArray(j) ? j : (Array.isArray(j && j.data) ? j.data : []);
}
function catOf(it) {
  for (const [k, v] of Object.entries(it)) if (/Category$/.test(k) && v && typeof v === 'object') return { name: v.name || null, engName: v.engName || null, id: v.id };
  return null;
}
const isB64Pdf = s => typeof s === 'string' && s.startsWith('JVBERi');
const isDocUrl = (k, s) => typeof s === 'string' && /^https?:\/\/(www\.)?mor\.gov\.et\//i.test(s) && !/cover/i.test(k) && !/\.(jpe?g|png|gif|webp)$/i.test(s);
const encode = u => /%[0-9A-Fa-f]{2}/.test(u) ? u : encodeURI(u);

function pdfPages(file) {
  try { const o = execFileSync('pdfinfo', [file], { encoding: 'utf8' }); const m = /Pages:\s+(\d+)/.exec(o); return m ? +m[1] : null; } catch (e) { return null; }
}

(async () => {
  // Collect: list endpoints first, then anything only in by-category files.
  const byCatFiles = fs.readdirSync(API).filter(f => /-by-category__/.test(f)).map(f => f.replace(/\.json$/, '').replace(/__/g, '/'));
  const want = []; const seenUrl = new Map();
  for (const ep of [...LIST_ORDER, ...byCatFiles]) {
    for (const it of items(ep)) {
      for (const [k, v] of Object.entries(it)) {
        let key = null;
        if (isDocUrl(k, v)) key = v; else if (isB64Pdf(v)) key = 'base64:' + sha(Buffer.from(v, 'base64'));
        if (!key) continue;
        if (seenUrl.has(key)) { seenUrl.get(key).alsoIn.push(ep + '#' + it.id); continue; }
        const rec = { key, endpoint: ep, id: it.id, field: k, title: it.title || it.name || null, number: it.number ?? null, year: it.year ?? null,
          status: it.status || null, category: catOf(it), date: it.date || it.printedDate || it.createdAt || null, alsoIn: [], b64: isB64Pdf(v) ? v : null };
        seenUrl.set(key, rec); want.push(rec);
      }
    }
  }
  const byCatOnly = want.filter(w => /by-category/.test(w.endpoint));
  console.log(`documents referenced: ${want.length} unique (by-category-only: ${byCatOnly.length})`);
  let last = 0, n = 0;
  for (const w of want) {
    n++;
    const dir = path.join(FILES, w.endpoint.split('/')[0]); fs.mkdirSync(dir, { recursive: true });
    const base = w.id + (w.field !== 'pdfFile' ? '-' + w.field : '');
    const prev = manifest.files[w.key];
    if (prev && prev.ok && fs.existsSync(path.join(ROOT, prev.path))) { continue; }
    const rec = { source_url: w.b64 ? null : w.key, embedded_in: w.b64 ? 'https://www.mor.gov.et/api/' + w.endpoint : null, endpoint: w.endpoint, id: w.id,
      title: w.title, number: w.number, year: w.year, status: w.status, category: w.category, date: w.date, also_listed_in: w.alsoIn };
    let buf = null, err = null, http = null;
    if (w.b64) { buf = Buffer.from(w.b64, 'base64'); }
    else {
      const tmp = '/tmp/mor-dl-' + process.pid;
      for (let attempt = 1; attempt <= 4 && !buf; attempt++) {
        const wait = 2500 - (Date.now() - last); if (wait > 0) await sleep(wait);
        try { http = execFileSync('curl', ['-sS', '-k', '-m', '600', '--connect-timeout', '20', '--max-filesize', String(MAX), '-A', 'BinaSmart-legal-library/1.0 (+https://bina.et)', '-o', tmp, '-w', '%{http_code}', encode(w.key)], { encoding: 'utf8' }).trim(); }
        catch (e) { http = 'ERR'; err = String(e.message).split('\n').filter(Boolean).slice(-1)[0]; }
        last = Date.now();
        if (http === '200' && fs.existsSync(tmp)) { buf = fs.readFileSync(tmp); err = null; }
        else { console.log(`  [${n}/${want.length}] ${w.endpoint}#${w.id} attempt ${attempt}: ${http} ${err || ''}`); if (attempt < 4) await sleep(attempt * 10000); }
        try { fs.unlinkSync(tmp); } catch (e) { /* */ }
      }
    }
    if (buf) {
      const head = buf.slice(0, 8).toString('latin1');
      const ext = head.startsWith('%PDF') ? 'pdf' : head.startsWith('PK') ? 'zip' : head.startsWith('\xD0\xCF') ? 'doc' : /^\s*</.test(head) ? 'html' : 'bin';
      const file = path.join(dir, base + '.' + ext);
      fs.writeFileSync(file, buf);
      Object.assign(rec, { ok: ext === 'pdf' || ext === 'zip' || ext === 'doc', kind: ext, path: path.relative(ROOT, file), bytes: buf.length, sha256: sha(buf),
        pages: ext === 'pdf' ? pdfPages(file) : null, fetched: new Date().toISOString(), http });
      if (!rec.ok) rec.error = 'not a document (' + ext + ')';
    } else Object.assign(rec, { ok: false, error: err || ('http ' + http), fetched: new Date().toISOString() });
    manifest.files[w.key] = rec;
    fs.writeFileSync(mpath, JSON.stringify(manifest, null, 1));
    console.log(`[${n}/${want.length}] ${w.endpoint}#${w.id} ${rec.ok ? 'ok ' + rec.bytes + ' B ' + (rec.pages || '?') + 'p' : 'FAIL ' + rec.error}`);
  }
  // duplicates by content
  const bySha = {};
  for (const r of Object.values(manifest.files)) if (r.ok) (bySha[r.sha256] = bySha[r.sha256] || []).push(r.endpoint + '#' + r.id);
  manifest.duplicates_by_content = Object.values(bySha).filter(a => a.length > 1);
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 1));
  const ok = Object.values(manifest.files).filter(r => r.ok);
  console.log(`DONE ok=${ok.length} failed=${Object.values(manifest.files).length - ok.length} bytes=${ok.reduce((s, r) => s + r.bytes, 0)} content-duplicates=${manifest.duplicates_by_content.length}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
