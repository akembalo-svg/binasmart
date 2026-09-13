'use strict';
// Who an agent is. The tuned instructions are private (prompts/<name>.txt, see ../prompt.js); the public
// agents/<name>/SOUL.md is the stub that runs when they are not deployed. A missing public stub is only
// a warning as long as the private prompt is deployed; an agent with neither a private prompt nor a
// public SOUL.md does not start.
const fs = require('fs'), path = require('path');
const { loadPrompt } = require('../prompt');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'agents');

function loadSoul(name, { publicDir = PUBLIC_DIR, load = loadPrompt } = {}) {
  let stub = '';
  try {
    stub = fs.readFileSync(path.join(publicDir, name, 'SOUL.md'), 'utf8').trim();
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('agents/' + name + '/SOUL.md could not be read (' + e.code + ')');
  }
  const result = load(name, stub);
  if (!result) {
    throw new Error('agent ' + name + ' has no soul: no private prompt and agents/' + name + '/SOUL.md is missing or empty');
  }
  if (!stub) console.warn('agents/' + name + '/SOUL.md is missing: running on the private prompt only');
  return result;
}

module.exports = { loadSoul, PUBLIC_DIR };
