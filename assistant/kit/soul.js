'use strict';
// Who an agent is. The tuned instructions are private (prompts/<name>.txt, see ../prompt.js); the public
// agents/<name>/SOUL.md is the stub that runs when they are not deployed. A missing SOUL.md is a
// startup error rather than an empty system prompt: an agent with no soul is an unconstrained model.
const fs = require('fs'), path = require('path');
const { loadPrompt } = require('../prompt');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'agents');

function loadSoul(name, { publicDir = PUBLIC_DIR, load = loadPrompt } = {}) {
  let stub = '';
  try { stub = fs.readFileSync(path.join(publicDir, name, 'SOUL.md'), 'utf8').trim(); } catch (e) { /* reported below */ }
  if (!stub) throw new Error('agents/' + name + '/SOUL.md is missing: every agent needs a public soul');
  return load(name, stub);
}

module.exports = { loadSoul, PUBLIC_DIR };
