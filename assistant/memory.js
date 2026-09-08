'use strict';
// Per-user memory (AssistantUser), the conversation log (AssistantLog), miss detection and the handover to a
// person. Keys: tg:<telegramId> (stable), web:<uid> (localStorage id, stable per browser), ip:<ip> (logs only).

const MISS_RE = /(የለኝም|አላውቅም|ማረጋገጥ አልችልኩም|መረጃ የለም|I do(n't| not) have|not sure|can(no|')t (help|confirm|find)|don't know|hin qabu|hin beeku|wa\.me\/251911244344)/i;
const HUMAN_RE = /(ሰው (ማነጋገር|መነጋገር|እፈልጋለሁ)|ከሰው ጋር|ኦፕሬተር|ደዋይ|human|real person|talk to (someone|a person|an agent|the team)|operator|manager|complain|ቅሬታ|refund|ገንዘቤ(ን)? መልስ|nama dhugaa|namaan|dubbachuu barbaada)/i;

function userKey({ telegramId, uid, ip } = {}) {
  if (telegramId) return 'tg:' + String(telegramId).replace(/\D/g, '').slice(0, 20);
  if (uid && /^[A-Za-z0-9_-]{6,64}$/.test(String(uid))) return 'web:' + uid;
  return 'ip:' + String(ip || '?').slice(0, 60);
}

function makeMemory({ prisma, now }) {
  const clock = now || Date.now;
  function profileText(u) {
    if (!u) return '';
    const parts = [];
    if (u.name) parts.push('name: ' + u.name);
    if (u.phone) parts.push('phone: ' + u.phone);
    if (u.lang) parts.push('preferred language: ' + u.lang);
    const pl = p => p.label + (p.lat != null ? ' (lat ' + (+p.lat).toFixed(5) + ', lng ' + (+p.lng).toFixed(5) + ')' : '');
    if (u.home && u.home.label) parts.push('home: ' + pl(u.home));
    if (u.work && u.work.label) parts.push('work: ' + pl(u.work));
    if (u.lastPickup && u.lastPickup.label) parts.push('last pickup: ' + pl(u.lastPickup));
    if (u.lastDropoff && u.lastDropoff.label) parts.push('last drop-off: ' + pl(u.lastDropoff));
    if (u.notes) parts.push('notes: ' + u.notes);
    if (u.visits > 1) parts.push('visits: ' + u.visits);
    if (!parts.length) return '';
    return '## What we know about this user (use it naturally, e.g. offer the usual route; never read the phone back aloud unless they ask)\n' + parts.join(' · ') + '\nWhen the user says "home", "work", "ቤት", "ቢሮ", "mana" or "hojii" and a place with coordinates is listed above, pass those coordinates straight to quote_ride or request_ride; never call search_places for the word "home".';
  }
  // A handle for one user: get() the row, touch(patch) to upsert a few fields.
  function forUser(key, seed = {}) {
    const persistent = /^(tg|web):/.test(key);
    let cached = null;
    async function get() {
      if (!persistent) return null;
      if (cached) return cached;
      cached = await prisma.assistantUser.findUnique({ where: { key } }).catch(() => null);
      return cached;
    }
    async function touch(patch = {}) {
      if (!persistent) return null;
      const data = {};
      for (const k of ['name', 'phone', 'lang', 'notes', 'telegramId']) if (patch[k] != null && patch[k] !== '') data[k] = String(patch[k]).slice(0, k === 'notes' ? 400 : 80);
      for (const k of ['home', 'work', 'lastPickup', 'lastDropoff']) if (patch[k]) data[k] = patch[k];
      data.seenAt = new Date(clock());
      const create = { key, ...(seed.telegramId ? { telegramId: String(seed.telegramId) } : {}), ...(seed.name && !data.name ? { name: String(seed.name).slice(0, 80) } : {}), ...data, visits: 1 };
      cached = await prisma.assistantUser.upsert({ where: { key }, create, update: { ...data, ...(patch.visit ? { visits: { increment: 1 } } : {}) } });
      return cached;
    }
    return { key, persistent, get, touch, profile: async () => profileText(await get()) };
  }
  async function log(row) {
    try { await prisma.assistantLog.create({ data: { userKey: row.userKey, channel: row.channel || 'web', lang: row.lang || 'en', message: String(row.message || '').slice(0, 1200), reply: String(row.reply || '').slice(0, 4000), tools: row.tools || [], miss: !!row.miss, ms: row.ms || 0 } }); } catch (e) { /* logging never breaks a reply */ }
  }
  async function misses(days = 7, take = 15) {
    const since = new Date(clock() - days * 86400000);
    return prisma.assistantLog.findMany({ where: { miss: true, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take, select: { message: true, reply: true, lang: true, channel: true, createdAt: true } });
  }
  async function stats(days = 7) {
    const since = new Date(clock() - days * 86400000);
    const [total, miss, byLang] = await Promise.all([
      prisma.assistantLog.count({ where: { createdAt: { gte: since } } }),
      prisma.assistantLog.count({ where: { createdAt: { gte: since }, miss: true } }),
      prisma.assistantLog.groupBy({ by: ['lang'], where: { createdAt: { gte: since } }, _count: { _all: true } }).catch(() => []),
    ]);
    return { total, miss, byLang: Object.fromEntries(byLang.map(b => [b.lang, b._count._all])) };
  }
  return { userKey, forUser, profileText, log, misses, stats, isMiss: r => MISS_RE.test(String(r || '')), wantsHuman: m => HUMAN_RE.test(String(m || '')) };
}

// Handover to Ibrahim on Telegram: at most once per user per 30 minutes; explicit (tool) calls always go.
function makeHandover({ sendTg, chatId, now }) {
  const clock = now || Date.now; const last = new Map();
  return async function handover({ userKey, channel, lang, user, message, reply, history, summary, reason, explicit }) {
    if (!sendTg || !chatId) return false;
    const t = clock();
    if (!explicit && last.has(userKey) && t - last.get(userKey) < 1800000) return false;
    last.set(userKey, t); if (last.size > 5000) last.clear();
    const who = [user && user.name, user && user.phone, userKey].filter(Boolean).join(' · ');
    const turns = (history || []).slice(-4).map(h => (h.role === 'user' ? 'U: ' : 'B: ') + String(h.content).slice(0, 160)).join('\n');
    const lines = ['🙋 Bini handover · ' + (channel || 'web') + ' · ' + (lang || '?'), who, reason ? 'Why: ' + reason : '', summary ? 'Summary: ' + summary : '', turns, 'U: ' + String(message || '').slice(0, 300), reply ? 'B: ' + String(reply || '').slice(0, 300) : '', /^tg:/.test(userKey) ? 'Reply: tg://user?id=' + userKey.slice(3) : ''].filter(Boolean);
    try { await sendTg(chatId, lines.join('\n').slice(0, 3900)); return true; } catch (e) { return false; }
  };
}

// Deterministic backstop: if the user clearly stated a fact to remember and the model did not call remember(),
// we still save it. English, Amharic and Afaan Oromoo patterns; returns [{field, value}].
function extractMemory(msg) {
  const s = String(msg || '').trim(); const out = [];
  // Questions are never facts ("ከቤቴ ወደ ቦሌ ስንት ነው?" must not overwrite home).
  if (/\?|ስንት|how much|meeqa|\bwhere\b|የት\b|eessa/i.test(s)) return out;
  const BAD = /ወደ|ከ\S|ራይድ|ride|ጉዞ|ስንት|http|\d{5,}/;
  const push = (field, v) => { v = String(v || '').replace(/[.።!?,]+$/, '').trim(); if (v && v.length <= 60 && (field === 'phone' || !BAD.test(v)) && !out.some(o => o.field === field)) out.push({ field, value: v }); };
  let m;
  const END = String.raw`([^,.።\n]+?)(?=\s+and\b|[,.።\n]|$)`;
  if ((m = new RegExp(String.raw`\bmy name is ` + END, 'i').exec(s))) push('name', m[1]);
  if ((m = new RegExp(String.raw`\bmy (?:home|house) is (?:in |at )?` + END, 'i').exec(s))) push('home', m[1]);
  if ((m = new RegExp(String.raw`\bmy (?:work|office) is (?:in |at )?` + END, 'i').exec(s))) push('work', m[1]);
  if ((m = /\bmy (?:phone|number) is (\+?[\d\s-]{9,15})/i.exec(s))) push('phone', m[1].replace(/[\s-]/g, ''));
  if ((m = /(?:^|[።.,]\s*)ስሜ\s+([^\s።,]+(?:\s+[^\s።,]+)?)\s+(?:ነው|ይባላል|ነኝ)/.exec(s))) push('name', m[1]);
  if ((m = /(?:^|[።.,]\s*)(?:ቤቴ|የምኖረው|መኖሪያዬ)\s+([^።,\n]{2,40}?)\s+(?:ነው|ነኝ)/.exec(s))) push('home', m[1]);
  if ((m = /(?:^|[።.,]\s*)(?:ቢሮዬ|ሥራዬ|ስራዬ|የምሰራው)\s+([^።,\n]{2,40}?)\s+(?:ነው|ነኝ)/.exec(s))) push('work', m[1]);
  if ((m = /(?:ስልኬ|ስልክ ቁጥሬ)\s+(\+?[\d\s-]{9,15})/.exec(s))) push('phone', m[1].replace(/[\s-]/g, ''));
  if ((m = /\bmaqaan koo ([^,.\n]+)/i.exec(s))) push('name', m[1]);
  if ((m = /\bmanni koo ([^,.\n]+)/i.exec(s))) push('home', m[1]);
  if ((m = /\bhojiin koo ([^,.\n]+)/i.exec(s))) push('work', m[1]);
  return out;
}

module.exports = { makeMemory, makeHandover, userKey, MISS_RE, HUMAN_RE, extractMemory };
