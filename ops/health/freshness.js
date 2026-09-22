#!/usr/bin/env node
'use strict';
// Is the PUBLIC data still alive? — the daily staleness check.
//
//   node --env-file=.env ops/health/freshness.js             normal run (cron)
//   node --env-file=.env ops/health/freshness.js --dry-run   print what would be sent, send nothing
//
// ops/health/check.js answers "is the machine up?". This answers the question that actually cost us:
// "is there anything inside it?". On 2026-09-19 every cinema programme had been expired for nine days
// and /cinema — plus the list_events MCP tool that every AI assistant can call — had been answering
// "BinaSmart has no events" to the whole internet, with nothing broken and nothing alerting.
//
// Same manners as check.js: speak only when something CHANGES. One message when a dataset goes stale,
// one when it comes back. A checker that messages every morning is muted within a week.
//
// Cron, 06:45 UTC (09:45 Addis), after the tender harvest at 06:15 and before autopublish at 07:00:
//   45 6 * * * cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/health/freshness.js >> /var/log/bina-freshness.log 2>&1

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const DRY = process.argv.includes('--dry-run');
const STATE = '/root/storage/bina-freshness.json';
const RIDER = process.env.BINA_RIDER_BOT_TOKEN;
const OWNER = process.env.BINA_OWNER_TG_CHAT;
const CINEMA_ON = process.env.CINEMA_ENABLED === '1';

const prisma = new PrismaClient();
const one = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

// Each check returns null when the data is fresh, or a short sentence when it is not. The sentence is
// what Ibrahim reads on his phone, so it says what died and what to do, not which table it counted.
const CHECKS = {
  'Cinema programmes': async () => {
    if (!CINEMA_ON) return null;
    const live = await one(`SELECT count(*)::int AS n FROM "Programme" WHERE active = true AND "dateTo" > now()`);
    if (live > 0) return null;
    const last = await one(`SELECT COALESCE(EXTRACT(DAY FROM now() - max("dateTo")), 999)::int AS n FROM "Programme" WHERE active = true`);
    return `no cinema programme is current (last one ended ${last} days ago). /cinema and the list_events tool are empty — someone must add this week's Alem/Gast programme.`;
  },
  'Shows on sale': async () => {
    if (!CINEMA_ON) return null;
    const n = await one(`SELECT count(*)::int AS n FROM "Show" WHERE status = 'onsale' AND "startsAt" > now()`);
    return n > 0 ? null : 'no show is on sale, so nobody can buy a ticket and list_events returns nothing.';
  },
  'Open tenders': async () => {
    const n = await one(`SELECT count(*)::int AS n FROM "Tender" WHERE published = true AND (deadline IS NULL OR deadline > now())`);
    return n > 0 ? null : 'not one open tender left. The harvest (06:15) or autopublish (07:00/15:00) has stopped — check /var/log/bina-tender-autopublish.log.';
  },
  'Tender publishing': async () => {
    // The queue drains twice a day; four quiet days means the pipeline is stuck, not that Ethiopia
    // stopped tendering.
    const d = await one(`SELECT COALESCE(EXTRACT(DAY FROM now() - max("publishedAt")), 999)::int AS n FROM "Tender" WHERE published = true`);
    return d <= 4 ? null : `no tender published for ${d} days — the harvest or autopublish cron has stopped.`;
  },
  'News': async () => {
    const d = await one(`SELECT COALESCE(EXTRACT(DAY FROM now() - max("publishedAt")), 999)::int AS n FROM "NewsPost" WHERE published = true`);
    return d <= 14 ? null : `nothing published for ${d} days. Candidates are collected every morning but only you can publish them.`;
  },
  'Films to watch': async () => {
    const n = await one(`SELECT count(*)::int AS n FROM "Film" WHERE status = 'public' AND rights IS NOT NULL AND rights <> '' AND ("rightsUntil" IS NULL OR "rightsUntil" > now())`);
    return n > 0 ? null : 'no film is watchable — every licence has expired or been withdrawn, and list_films returns nothing.';
  },
  'Knowledge base': async () => {
    const n = await one(`SELECT count(*)::int AS n FROM "KnowledgeChunk"`);
    return n > 100 ? null : `only ${n} knowledge chunks — the ingest (03:30) has emptied or failed. search_knowledge is the most used tool on the platform.`;
  },
  // Rules, fees and authorities change, and a knowledge pack that nobody re-fetches keeps answering
  // with last year's rule for ever — the quietest way to be wrong. banking, business and travel have a
  // sources.json and a weekly job that re-fetches them (ops/packs/freshness.js). The rest — eservices,
  // law, health, mor — were fetched once by hand, so this is the only thing watching them.
  'Knowledge packs': async () => {
    const stale = knowledgePacks().filter(p => !p.auto && p.ageDays > MAX_PACK_AGE_DAYS);
    if (!stale.length) return null;
    return stale.map(p => `${p.pack} (${p.files} files) last fetched ${p.ageDays} days ago`).join('; ')
      + ` — no weekly refresh exists for these, so a changed rule or a renamed authority would go unnoticed. Re-fetch, or give the pack a sources.json so ops/packs/freshness.js can watch it.`;
  },

  // Not checked: BinaPool corridors. They are defined in code (ride/pool/corridors.js), not in a
  // table, so they cannot go stale — only a deploy can remove them.
};

// A pack is "auto" when it has the registry ops/packs/freshness.js needs. Age is taken from the
// newest `fetched:` date in the pack's own front matter, so it measures the knowledge, not the file.
const KNOWLEDGE_DIR = path.join(__dirname, '..', '..', 'knowledge');
const MAX_PACK_AGE_DAYS = 60;
function knowledgePacks() {
  let dirs = [];
  try { dirs = fs.readdirSync(KNOWLEDGE_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  return dirs.map(pack => {
    const dir = path.join(KNOWLEDGE_DIR, pack);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return null; }
    if (!files.length) return null;
    let newest = 0;
    for (const f of files) {
      try {
        const head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 800);
        const m = /^fetched:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(head);
        if (m) newest = Math.max(newest, new Date(m[1] + 'T00:00:00Z').getTime());
      } catch { /* an unreadable file is not a freshness fact */ }
    }
    if (!newest) return null;
    return { pack, files: files.length, ageDays: Math.floor((Date.now() - newest) / 86_400_000), auto: fs.existsSync(path.join(dir, 'sources.json')) };
  }).filter(Boolean);
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { stale: [] }; } }
function saveState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s)); }

async function send(text) {
  if (DRY) { console.log('[dry-run] would send:\n' + text + '\n'); return true; }
  if (!RIDER || !OWNER) { console.error('cannot alert: BINA_RIDER_BOT_TOKEN or BINA_OWNER_TG_CHAT missing'); return false; }
  const r = await fetch('https://api.telegram.org/bot' + RIDER + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: OWNER, text, disable_web_page_preview: true }),
  }).then(x => x.json()).catch(() => null);
  return !!(r && r.ok);
}

(async () => {
  const names = Object.keys(CHECKS);
  const results = await Promise.allSettled(names.map(n => CHECKS[n]()));
  const stale = [];
  const lines = names.map((n, i) => {
    const r = results[i];
    // A check that threw is itself a finding: the table it reads may be gone.
    const reason = r.status === 'fulfilled' ? r.value : `check failed: ${String((r.reason && r.reason.message) || r.reason).slice(0, 120)}`;
    if (reason) stale.push({ name: n, reason });
    return (reason ? '🔴 ' : '🟢 ') + n + (reason ? ' — ' + reason : '');
  });
  console.log(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${stale.length} stale of ${names.length}`);
  lines.forEach(l => console.log('  ' + l));

  const prev = loadState();
  const was = new Set(prev.stale || []);
  const now = new Set(stale.map(s => s.name));
  const started = stale.filter(s => !was.has(s.name));
  const recovered = [...was].filter(n => !now.has(n));

  if (started.length) {
    await send('⚠️ BinaSmart data going stale\n\n' + started.map(s => '• ' + s.name + ': ' + s.reason).join('\n\n')
      + '\n\nNothing is broken — the pages are up, they just have nothing to show. AI assistants calling the MCP tools see the same emptiness.');
  }
  if (recovered.length) await send('✅ Back to normal: ' + recovered.join(', '));

  saveState({ stale: [...now], checkedAt: new Date().toISOString() });
  await prisma.$disconnect();
  process.exit(0);
})().catch(async e => {
  console.error('[freshness] failed: ' + e.message);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
