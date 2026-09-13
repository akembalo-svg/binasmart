'use strict';
// A soul is who an agent is. The tuned instructions stay private in prompts/<name>.txt; the public
// agents/<name>/SOUL.md is what runs when they are not deployed. A missing public stub is only a
// problem when the private prompt is ALSO missing — an agent with neither does not start.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { loadSoul } = require('../../assistant/kit/soul');

const tmpDirs = [];
function tmpAgents(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souls-'));
  tmpDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'SOUL.md'), text);
  }
  return dir;
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('the private prompt wins when it is deployed', () => {
  const publicDir = tmpAgents({ demo: 'public stub' });
  const soul = loadSoul('demo', { publicDir, load: (name, stub) => 'private for ' + name + ' (stub was: ' + stub + ')' });
  assert.equal(soul, 'private for demo (stub was: public stub)');
});

test('without the private prompt, the public SOUL.md runs', () => {
  const publicDir = tmpAgents({ demo: '  public stub\n' });
  assert.equal(loadSoul('demo', { publicDir, load: (name, stub) => stub }), 'public stub');
});

test('an agent without a SOUL.md does not start', () => {
  const publicDir = tmpAgents({});
  assert.throws(() => loadSoul('ghost', { publicDir, load: (n, s) => s }), /agents\/ghost\/SOUL\.md/);
});

test('a missing public stub does not stop an agent whose private prompt is deployed', () => {
  const publicDir = tmpAgents({});
  const soul = loadSoul('ghost', { publicDir, load: (n, s) => s ? s : 'private ' + n });
  assert.equal(soul, 'private ghost');
});

test('Afiya and Asmat both have a public soul in the repository', () => {
  for (const name of ['afiya', 'asmat']) {
    const p = path.join(__dirname, '..', '..', 'agents', name, 'SOUL.md');
    assert.ok(fs.readFileSync(p, 'utf8').trim().length > 40, name + ' SOUL.md is missing or empty');
  }
});
