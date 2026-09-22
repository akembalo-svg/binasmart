'use strict';
// The harvest scripts live in a PUBLIC repository, so what may not be in them is tested: a server address, a
// user name, an absolute path on somebody's computer, a key. The server is named by BINA_SERVER and has no default.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', '..', 'ops', 'harvest', 'telecom');
const FILES = ['common.py', 'crawl_tel.py', 'finalize_tel.py', 'ship_tel.py', 'verify_tel.py', 'eca_rest_index.py', 'eca_rest_save.py', 'recon_fetch.py', 'README.md', '.gitignore'];

test('every file of the harvest tooling is there, and the output folder is git-ignored', () => {
  for (const f of FILES) assert.ok(fs.existsSync(path.join(DIR, f)), f + ' is missing');
  assert.match(fs.readFileSync(path.join(DIR, '.gitignore'), 'utf8'), /^out\/$/m);
});

test('no server address, user name, absolute personal path or key is in any of them', () => {
  for (const f of FILES) {
    const t = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.equal(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t), false, f + ' has an IP address');
    assert.equal(/root@|\b[a-z][\w.-]*@[a-z0-9][\w.-]*\.[a-z]{2,}\b/i.test(t), false, f + ' names a user or an address');
    assert.equal(/[A-Za-z]:\\Users\\|\/Users\/|\/home\/[a-z]/i.test(t), false, f + ' has a personal absolute path');
    assert.equal(/BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*=|token\s*=|password\s*=/i.test(t), false, f + ' looks like it holds a secret');
    assert.equal(/251[79]\d{8}|\b0[79]\d{8}\b/.test(t), false, f + ' has a phone number');
  }
});

test('the server comes from BINA_SERVER, with no default, in both scripts that use ssh', () => {
  for (const f of ['ship_tel.py', 'verify_tel.py']) {
    const t = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.match(t, /os\.environ\.get\("BINA_SERVER",\s*""\)/, f);
    assert.match(t, /BINA_SERVER=user@host|set BINA_SERVER/, f + ' does not say how to set it');
  }
});

test('the scripts are standard-library Python only', () => {
  const STD = new Set(['gzip', 'hashlib', 'io', 'json', 'os', 're', 'ssl', 'sys', 'time', 'urllib', 'zlib', 'base64', 'subprocess', 'concurrent', 'collections', 'html', 'http', 'common']);
  for (const f of FILES.filter(x => x.endsWith('.py'))) {
    const t = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of t.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][\w.]*)(?:\s+import\s+([\w, ]+))?/gm)) {
      const top = m[1].split('.')[0];
      assert.ok(STD.has(top), f + ' imports ' + top + ', which is not standard library');
    }
  }
});

test('ship_tel.py refuses to run without BINA_SERVER, and does so before it touches a network', { skip: spawnSync('python3', ['--version']).status !== 0 && 'no python3' }, () => {
  const env = { ...process.env }; delete env.BINA_SERVER;
  const r = spawnSync('python3', [path.join(DIR, 'ship_tel.py'), 'www.example.et'], { env, encoding: 'utf8', timeout: 20000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /BINA_SERVER/);
});

test('every script compiles', { skip: spawnSync('python3', ['--version']).status !== 0 && 'no python3' }, () => {
  for (const f of FILES.filter(x => x.endsWith('.py'))) {
    const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf8").read())', path.join(DIR, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, f + ': ' + r.stderr);
  }
});

test('the README says how to re-run, pace, agent, keep-alive, soft-404, resume, ship and verify', () => {
  const t = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
  for (const w of [/5 seconds|5 s/, /BinaSmart-research/, /robots\.txt/, /keep-?alive/i, /soft-404/i, /[Rr]esume/, /ship_tel\.py/, /verify_tel\.py/, /BINA_SERVER/, /freshness\.js/])
    assert.match(t, w);
});
