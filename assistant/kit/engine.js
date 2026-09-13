'use strict';
// One order for every agent. It is the order /api/afiya and /api/asmat followed by hand until 13 Sep 2026,
// and the order matters more than any single step: what must be answered without a model (an emergency,
// an arrest) is answered before a model is asked anything, and what a model must never say is removed
// before the reply leaves, whatever the prompt asked for.
//
//   gates → scope → prompt → model → retry → filters → grounding → finish → log
//
// An agent is a definition (agents/<name>/rules.js). The engine owns the order; the definition owns the
// content. Nothing here knows about health or law.

const REQUIRED = ['name', 'soul', 'gates', 'inScope', 'redirect', 'finish', 'fallback'];

function makeEngine(deps) {
  const { callModel, contextFor, lang: L, memory, handover, dropUngrounded, isEval } = deps;
  const warn = deps.warn || (m => console.warn(m));

  return async function handle(agent, req, reply) {
    for (const k of REQUIRED) if (agent[k] == null) throw new Error('agent ' + (agent.name || '?') + ' is missing ' + k);
    const t0 = Date.now();
    const b = req.body || {};
    const msg = String(b.message || '').trim().slice(0, 2000);
    if (!msg) return reply.code(400).send({ error: 'message required' });
    const ip = req.headers['x-real-ip'] || req.ip;
    const user = (b.user && typeof b.user === 'object') ? b.user : {};
    const channel = user.telegramId ? 'telegram' : (user.uid ? 'web' : 'api');
    const userKey = memory.userKey({ telegramId: user.telegramId, uid: user.uid, ip, evaluation: isEval(req) });
    const lang = L.detect(msg);
    const l = (lang === 'am' || lang === 'am-latin') ? 'am' : (lang === 'om' ? 'om' : 'en');
    const c = { msg, lang, l, user, channel, userKey };

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
      const ctx = await Promise.resolve().then(() => contextFor(msg, { lang: l })).catch(() => '');
      const extra = agent.context ? (await agent.context(c, deps)) || {} : {};
      const sys = agent.soul + '\n\n' + L.directive(lang)
        + (ctx ? '\n\n## Information you may use\n' + ctx : '')
        + (extra.prompt || '')
        + (agent.instruct ? agent.instruct(c) : '');
      const grounding = extra.grounding != null ? String(ctx || '') + ' ' + extra.grounding : ctx;
      const maxTokens = agent.maxTokens || 700;
      const ask = async system => String(await callModel(system, [{ role: 'user', content: msg }], maxTokens, {}) || '').trim();

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

      // 6. Grounding: a figure nobody gave the model is dropped.
      const g = dropUngrounded(text, grounding);
      if (g.dropped.length) warn('[' + agent.name + '] dropped ungrounded ' + g.dropped.map(x => x.text).join(', '));
      text = g.text;

      // 7. Finish: what the definition appends deterministically (nudges, notices, the disclosure).
      text = agent.finish(c, text, extra.state || {});

      memory.log({ userKey, channel, lang: l, message: msg, reply: text, tools: [agent.name],
        miss: memory.isMiss(text, { tools: [agent.name], message: msg }), ms: Date.now() - t0 });
      return Object.assign({ reply: text }, agent.okFlags || {});
    } catch (e) {
      req.log && req.log.error({ err: e }, agent.name + ' failed');
      return { reply: agent.fallback(c) };
    }
  };
}

module.exports = { makeEngine, REQUIRED };
