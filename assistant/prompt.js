'use strict';
// Operational prompts are not published.
//
// Each agent's full instructions — the order it must answer in, the exact refusal wording, the rules
// that keep a template blank and an assessment honest — are the part that took the work, so they live
// in prompts/<name>.txt, outside the repository.
//
// The code still runs without them: every caller supplies a short stub. That is on purpose. The
// deterministic safety gates ARE published, because being able to read them is the point — anyone
// evaluating BinaSmart can open assistant/afiya.js and confirm for themselves that an emergency reply
// is produced by code and never reaches a model. What is withheld is the craft, not the safety.
const fs = require('fs'), path = require('path');

function loadPrompt(name, stub) {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'prompts', name + '.txt'), 'utf8').trim();
    if (t) return t;
  } catch (e) { /* not deployed here — run on the stub */ }
  return stub;
}

module.exports = { loadPrompt };
