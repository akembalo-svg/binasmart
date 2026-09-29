'use strict';
// One line per paid model call, so the bill can be explained: /root/storage/ai-usage/<label>-<date>.log holds
// "time model prompt_tokens completion_tokens". ops/ai-cost.js reads every label. Fire-and-forget: a meter that
// fails never fails the call it measures. Accepts Gemini's native usageMetadata or the OpenAI-style usage object.
const fs = require('fs');
const DIR = process.env.BINA_AI_USAGE_DIR || '/root/storage/ai-usage';

function meter(label, model, usage) {
  if (!usage) return;
  const inTok = usage.promptTokenCount != null ? usage.promptTokenCount : usage.prompt_tokens;
  const outTok = usage.candidatesTokenCount != null ? usage.candidatesTokenCount : usage.completion_tokens;
  const now = new Date().toISOString();
  fs.promises.appendFile(DIR + '/' + String(label).replace(/[^a-z0-9-]/gi, '') + '-' + now.slice(0, 10) + '.log',
    now.slice(11, 19) + ' ' + model + ' ' + (inTok || 0) + ' ' + (outTok || 0) + '\n').catch(() => {});
}

module.exports = { meter };
