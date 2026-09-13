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
// never by the model) and channel (how the request arrived, for the log and the audit).

const REQUIRED = ['name', 'soul', 'gates', 'inScope', 'redirect', 'finish', 'fallback'];

function makeEngine(deps) {
  const { callModel, contextFor, lang: L, memory, handover, dropUngrounded, isEval } = deps;
  const warn = deps.warn || (m => console.warn(m));

  return async function handle(agent, req, reply, options = {}) {
    for (const k of REQUIRED) if (agent[k] == null) throw new Error('agent ' + (agent.name || '?') + ' is missing ' + k);
    if (agent.tools && typeof agent.executor !== 'function') throw new Error('agent ' + agent.name + ' has tools but no executor');
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
    const c = { msg, lang, l, user, channel, userKey, scope: options.scope || null };

    // 1. Gates: answered without the model. The first that matches is the answer.
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

    try {
      // 3. Prompt.
      const ctx = agent.knowledge === false ? ''
        : await Promise.resolve().then(() => contextFor(msg, { lang: l })).catch(() => '');
      const extra = agent.context ? (await agent.context(c, deps)) || {} : {};
      const sys = agent.soul + '\n\n' + L.directive(lang)
        + (ctx ? '\n\n## Information you may use\n' + ctx : '')
        + (extra.prompt || '')
        + (agent.instruct ? agent.instruct(c) : '');
      const maxTokens = agent.maxTokens || 700;

      // Tools: read-only functions bound to c.scope by the definition. Every call and result is kept, because
      // the results are the only place a figure in the answer may come from.
      const toolResults = [];
      const run = agent.tools && agent.tools.length ? agent.executor(c, deps) : null;
      const optsFor = () => run ? { tools: agent.tools, execute: async (name, args) => {
        const out = await run(name, args);
        toolResults.push({ name, args, out });
        return out;
      } } : {};
      const ask = async system => String(await callModel(system, [{ role: 'user', content: msg }], maxTokens, optsFor()) || '').trim();

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

      // 6. Grounding: a figure nobody gave the model — not a document, not a tool — is dropped.
      const documents = extra.grounding != null ? String(ctx || '') + ' ' + extra.grounding : ctx;
      const grounding = toolResults.length ? String(documents || '') + ' ' + JSON.stringify(toolResults.map(r => r.out)) : documents;
      const g = dropUngrounded(text, grounding);
      if (g.dropped.length) warn('[' + agent.name + '] dropped ungrounded ' + g.dropped.map(x => x.text).join(', '));
      text = g.text;

      // 7. Finish: what the definition appends deterministically (nudges, notices, the disclosure).
      text = agent.finish(c, text, Object.assign({}, extra.state || {}, { toolResults }));

      // 8. Record. Agents that read private records (log: false) keep the answer out of the chat log and are
      // audited instead: who asked, when, which tools — never the answer.
      if (agent.log !== false) memory.log({ userKey, channel, lang: l, message: msg, reply: text, tools: [agent.name],
        miss: memory.isMiss(text, { tools: [agent.name], message: msg }), ms: Date.now() - t0 });
      if (agent.audit) {
        const tools = toolResults.map(r => r.name);
        Promise.resolve().then(() => agent.audit(c, { tools }, deps))
          .catch(e => warn('[' + agent.name + '] audit failed: ' + (e && e.message || e)));
      }
      return Object.assign({ reply: text }, agent.okFlags || {});
    } catch (e) {
      req.log && req.log.error({ err: e }, agent.name + ' failed');
      return { reply: agent.fallback(c) };
    }
  };
}

module.exports = { makeEngine, REQUIRED };
