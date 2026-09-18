#!/usr/bin/env node
'use strict';
// A private test server for workspaces/ on 127.0.0.1:4299 — the same engine, model and knowledge as the live
// API, without touching it. node --env-file=.env ops/workspaces-harness.js
const path = require('path');
const fastify = require('fastify')({ logger: false, bodyLimit: 1024 * 1024 });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
fastify.register(require('@fastify/cors'), { origin: true });
fastify.register(require('@fastify/static'), { root: path.join(__dirname, '..', 'public'), prefix: '/static/' });
const { makeEngine } = require('../assistant/kit/engine');
const { makeKnowledge } = require('../knowledge');
const { dropUngrounded } = require('../assistant/grounding');
const { makeMemory } = require('../assistant/memory');
const lang = require('../assistant/lang');
const knowledge = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY || '' });
const memory = makeMemory({ prisma });

async function callModel(system, messages, maxTokens) {
  const r = await fetch(process.env.BINI_API_BASE.replace(/\/+$/, '') + '/chat/completions', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.BINI_API_KEY },
    body: JSON.stringify({ model: process.env.BINI_API_MODEL, max_tokens: maxTokens, reasoning_effort: 'none', messages: [{ role: 'system', content: system }].concat(messages) }) });
  const d = await r.json();
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}
function limiter(windowMs, max) { const m = new Map(); return k => { const now = Date.now(); const h = (m.get(k) || []).filter(t => now - t < windowMs); if (h.length >= max) return false; h.push(now); m.set(k, h); return true; }; }
const runAgent = makeEngine({ callModel, contextFor: (q, o) => knowledge.contextFor(q, o), lang, memory,
  handover: async () => false, dropUngrounded, isEval: () => true, prisma, audit: async () => {} });
const { makeVerifier } = require('../workspaces/verify');
const verifier = makeVerifier({ knowledge });
require('../workspaces/routes')(fastify, { prisma, runAgent, isMiss: memory.isMiss, limiter, staffKey: process.env.OWNER_KEY, verifier });
knowledge.load().then(()=>console.log('knowledge loaded'));
fastify.listen({ port: 4299, host: '127.0.0.1' }).then(() => console.log('harness on 4299'));
