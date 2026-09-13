'use strict';
// A soul is who an agent is. The tuned instructions stay private in prompts/<name>.txt; the public
// agents/<name>/SOUL.md is what runs when they are not deployed, and it must always exist.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { loadSoul } = require('../../assistant/kit/soul');

function tmpAgents(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'souls-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'SOUL.md'), text);
  }
  return dir;
}

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

test('Afiya and Asmat both have a public soul in the repository', () => {
  for (const name of ['afiya', 'asmat']) {
    const p = path.join(__dirname, '..', '..', 'agents', name, 'SOUL.md');
    assert.ok(fs.readFileSync(p, 'utf8').trim().length > 40, name + ' SOUL.md is missing or empty');
  }
});
