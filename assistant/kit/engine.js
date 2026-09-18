'use strict';
// One order for every agent. It is the order /api/afiya and /api/asmat followed by hand until 13 Sep 2026,
// and the order matters more than any single step: what must be answered without a model (an emergency,
// an arrest) is answered before a model is asked anything, and what a model must never say is removed
// before the reply leaves, whatever the prompt asked for.
//
//   gates → scope → prompt → model (+ tool rounds) → retry → filters → grounding → finish → log / audit
//
// An agent is a definition (agents/<name>/rules.js). The engine owns the order; the definition owns the
// content. Nothing here knows about health, law or buildings.
//
// Options a route may pass: scope (what the agent may read — decided by the route's own authentication,
// never by the model) and channel (how the request arrived, for the log and the audit). A definition must
// decide what it may read from c.scope alone, never from c.user or the request body — both are attacker
// controlled, and the engine never derives scope from either.

const REQUIRED = ['name', 'soul', 'gates', 'inScope', 'redirect', 'finish', 'fallback'];
const TOOL_RESULT_LIMIT = 6000; // callBini sends JSON.stringify(out).slice(0, 6000) to the model
const { sourcesFrom } = require('./sources');
// Not a dep: every agent gets this filter, and no definition may choose to be without it.
const { fixCalendarMarker, fixGregorianDates } = require('../grounding');
const { tidyAnswer, stripIntro } = require('../tidy');

// What the engine hands contextFor. Only the two list fields of a knowledge declaration are passed, copied, so a
// definition can neither change k or the voice lookups nor be mutated by the index.
function knowledgeOptions(agent, l) {
  const o = { lang: l };
  const kn = agent && agent.knowledge;
  if (!kn || typeof kn !== 'object') return o;
  if (Array.isArray(kn.prefer)) o.prefer = kn.prefer.slice();
  if (Array.isArray(kn.exclude)) o.exclude = kn.exclude.slice();
  return o;
}

function makeEngine(deps) {
  const { callModel, contextFor, lang: L, memory, handover, dropUngrounded, isEval } = deps;
  const warn = deps.warn || (m => console.warn(m));

  return async function handle(agent, req, reply, options = {}) {
    for (const k of REQUIRED) if (agent[k] == null) throw new Error('agent ' + (agent.name || '?') + ' is missing ' + k);
    if (Array.isArray(agent.tools) && agent.tools.length && typeof agent.executor !== 'function')
      throw new Error('agent ' + agent.name + ' has tools but no executor');
    const t0 = Date.now();
    const b = req.body || {};
    const msg = String(b.message || '').trim().slice(0, 2000);
    if (!msg) return reply.code(400).send({ error: 'message required' });
    const ip = req.headers['x-real-ip'] || req.ip;
    const user = (b.user && typeof b.user === 'object') ? b.user : {};
    const channel = options.channel || (user.telegramId ? 'telegram' : (user.uid ? 'web' : 'api'));
    const userKey = memory.userKey({ telegramId: user.telegramId, uid: user.uid, ip, evaluation: isEval(req) });
    const lang = L.detect(msg);
    const l = (lang === 'am' || lang === 'am-latin') ? 'am' : (lang === 'om' ? 'om' : 'en');
    // scope is options.scope alone (set by the route from its own auth) — the request body is never consulted.
    const c = { msg, lang, l, user, channel, userKey, scope: options.scope || null };

    // 1. Gates: answered without the model. The first that matches is the answer. A gate's own `log` (not
    // agent.log) still writes to the chat log even when agent.log === false: gates answer fixed texts they
    // own, never model output, so there is nothing private in them for log: false to keep out.
    for (const gate of agent.gates) {
      if (!gate.test(c)) continue;
      const g = gate.answer(c);
      const text = g.body.reply;
      if (g.log) memory.log({ userKey, channel, lang: l, message: msg, reply: text, tools: g.log, miss: false, ms: Date.now() - t0 });
      if (g.handover) Promise.resolve(handover({ userKey, channel, lang: l, user, message: msg, reply: text, history: [],
        explicit: true, reason: g.handover })).catch(() => {});
      return g.body;
    }

    // 2. Scope: anything off-subject goes back with a link, and costs nothing.
    if (!agent.inScope(c)) return { reply: agent.redirect(c), redirected: true };

    // 2b. Limit (options.limit, set by the route): checked only here, after the gates and the scope, so an
    // emergency, an urgent answer or a redirect is never counted and never refused. Nothing below runs.
    if (options.limit && !options.limit(c))
      return { reply: (agent.limited || agent.fallback)(c), limited: true };

    // Declared before the try so a failure after tools ran can still be audited with what they did.
    const toolResults = [];
    const runAudit = () => {
      const tools = toolResults.map(r => r.name);
      Promise.resolve().then(() => agent.audit(c, { tools }, deps))
        .catch(e => warn('[' + agent.name + '] audit failed: ' + (e && e.message || e)));
    };

    try {
      // 3. Prompt. An agent may declare knowledge: { prefer, exclude } (see knowledge/index.js, pageMatcher);
      // an agent that declares nothing gets exactly the call every agent made before.
      const ctx = agent.knowledge === false ? ''
        : await Promise.resolve().then(() => contextFor(msg, knowledgeOptions(agent, l))).catch(() => '');
      const extra = agent.context ? (await agent.context(c, deps)) || {} : {};
      const sys = agent.soul + '\n\n' + L.directive(lang)
        + (ctx ? '\n\n## Information you may use\n' + ctx : '')
        + (extra.prompt || '')
        + (agent.instruct ? agent.instruct(c) : '');
      const maxTokens = agent.maxTokens || 700;

      // Tools: read-only functions bound to c.scope by the definition. Every call and result is kept, because
      // the results are the only place a figure in the answer may come from — except a round the cloud model
      // never finished. callBini clears opts.tools and opts.execute on this same options object when it falls
      // back to GLM with no tools; each ask below gets its own opts object so that a fallback on one round
      // never disqualifies another, and this round's own tool calls are discarded (never credited to an answer
      // that was written without seeing them) the moment the fallback shows on its opts.
      const run = Array.isArray(agent.tools) && agent.tools.length ? agent.executor(c, deps) : null;
      const ask = async system => {
        const startLen = toolResults.length;
        const o = run ? { tools: agent.tools, label: agent.name, execute: async (name, args) => {
          let out;
          try { out = await run(name, args); }
          catch (e) { warn('[' + agent.name + '] tool ' + name + ' failed: ' + (e && e.message || e)); out = { error: 'tool failed' }; }
          toolResults.push({ name, args, out });
          return out;
        } } : {};
        const text = String(await callModel(system, [{ role: 'user', content: msg }], maxTokens, o) || '').trim();
        if (o.tools === null || o.execute === null) toolResults.length = startLen; // GLM fallback: discard this ask's calls
        return text;
      };

      // 4. Model, and one retry when the definition says the answer is missing something it must carry.
      let text = await ask(sys);
      if (agent.retry && text && agent.retry.needed(c, text)) {
        const second = await ask(sys + agent.retry.suffix(c));
        if (second && agent.retry.accepts(second)) text = second;
        else warn('[' + agent.name + '] ' + agent.retry.warning);
      }

      // 5. Output filters: what this agent must never say.
      for (const filter of agent.filters || []) {
        const f = filter(text);
        if (f.removed) warn('[' + agent.name + '] removed ' + f.removed + ' ' + f.what);
        text = f.text;
      }

      // 5c. How the answer looks: the context's bracket numbers and Source lines are reference furniture the
      // model was shown, not something a customer should read (owner's instruction, 2026-09-17).
      const tidied = tidyAnswer(text);
      if (tidied.removed) warn('[' + agent.name + '] removed reference furniture');
      text = tidied.text;
      // The engine sends one message at a time, so the model cannot know it has already introduced itself.
      // A definition that lists its display names (agent.names) gets every later self-introduction removed;
      // the chat page shows its own greeting card, so nothing is lost.
      if (Array.isArray(agent.names) && agent.names.length) {
        const si = stripIntro(text, agent.names);
        if (si.removed) warn('[' + agent.name + '] removed a repeated self-introduction');
        if (si.text) text = si.text;
      }

      // 6. Grounding: a figure nobody gave the model — not a document, not a tool, not the question the user
      // just asked — is dropped. A figure the user typed is not a recommendation: the dosage rule is the
      // filter above, which runs first and removes a dose however it arrived. Each tool
      // result is cut to the same length callBini actually sent the model, so a figure past that cut (one the
      // model itself never saw) can't ground anything either.
      const documents = extra.grounding != null ? String(ctx || '') + ' ' + extra.grounding : ctx;
      const grounding = toolResults.length
        ? String(documents || '') + ' ' + toolResults.map(r => JSON.stringify(r.out).slice(0, TOOL_RESULT_LIMIT)).join(' ')
        : documents;
      // 5b. The calendar a date claims to be in. A Gregorian date carrying ዓ.ም. names a year seven to eight
      // years from the one on the document; the marker is rewritten, never the sentence dropped.
      const cal = fixCalendarMarker(text, grounding);
      if (cal.fixed) warn('[' + agent.name + '] rewrote ' + cal.fixed + ' Gregorian date(s) marked as Ethiopian');
      text = fixGregorianDates(cal.text, grounding, msg, agent.name, warn);   // and the date itself (assistant/dates.js)
      const g = dropUngrounded(text, grounding, msg);
      if (g.dropped.length) warn('[' + agent.name + '] dropped ungrounded ' + g.dropped.map(x => x.text).join(', '));
      text = g.text;

      // 7. Finish: what the definition appends deterministically (nudges, notices, the disclosure).
      text = agent.finish(c, text, Object.assign({}, extra.state || {}, { toolResults }));

      // 8. Record. Agents that read private records (log: false) keep the answer out of the chat log and are
      // audited instead: who asked, when, which tools — never the answer.
      if (agent.log !== false) memory.log({ userKey, channel, lang: l, message: msg, reply: text, tools: [agent.name],
        miss: memory.isMiss(text, { tools: [agent.name], message: msg }), ms: Date.now() - t0 });
      if (agent.audit) runAudit();
      // The documents the answer's knowledge came from, for the chat page's "From:" line (at most two, public
      // links only). Added only when there are some, so every other response keeps its exact shape.
      const sources = agent.knowledge === false ? [] : sourcesFrom(ctx, agent.sourceMax || 2, { detail: agent.sourceDetail === true });
      // 9. What the definition adds to the response besides the reply (agent.body, optional): fields decided by code
      // during this request, e.g. the owner agent's prepared action and its buttons. `reply` itself cannot be replaced.
      const more = typeof agent.body === 'function' ? (agent.body(c) || {}) : {};
      return Object.assign({ reply: text }, agent.okFlags || {}, sources.length ? { sources } : {}, more, { reply: text });
    } catch (e) {
      req.log && req.log.error({ err: e }, agent.name + ' failed');
      if (agent.audit && toolResults.length) runAudit();
      return { reply: agent.fallback(c) };
    }
  };
}

module.exports = { makeEngine, REQUIRED, knowledgeOptions };
