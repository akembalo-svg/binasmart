// BinaSmart public MCP server (streamable HTTP, stateless). pm2 "bina-mcp" on 127.0.0.1:3021;
// nginx proxies https://bina.et/mcp here. Docs: GET /mcp.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { makeLimiter } from './lib/limiter.mjs';
import { registerRideTools, toolError } from './tools/ride.mjs';
import { registerDirectoryTools } from './tools/directory.mjs';
import { registerGuideTools, loadGuides } from './tools/guides.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
const DOCS_MD = fs.existsSync(path.join(here, 'docs.md')) ? fs.readFileSync(path.join(here, 'docs.md'), 'utf8') : '# BinaSmart MCP server\n';

const INSTRUCTIONS =
  'BinaSmart (bina.et) is Ethiopia\'s all-in-one digital platform. Tools: fixed-price ride-hailing in Addis Ababa only ' +
  '(quote_ride → request_ride → get_ride_status / cancel_ride), a directory of buildings, hotels, hospitals and shops ' +
  '(search_places, get_hotel_rooms, get_hospital_departments), upcoming events (list_events) and 22 bilingual Digital ' +
  'Ethiopia guides (get_ethiopia_guide). Before request_ride ALWAYS confirm pickup, drop-off, tier, fare and the rider\'s ' +
  'Ethiopian phone with the user. Never invent fares or official portal names — quote_ride and the guides hold them. ' +
  'Cite source_url in answers. Site guide: https://bina.et/llms.txt';

export function json(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }

// One McpServer per request (stateless). `callerKey` feeds the per-caller limiters.
export function buildServer({ rideApi, db, guides, callerKey, callsRL, bookRL }) {
  const server = new McpServer({ name: 'binasmart', version: VERSION }, { instructions: INSTRUCTIONS });
  const wrap = (name, fn) => async (args) => {
    if (!callsRL(callerKey)) return toolError('Slow down — too many tool calls from this session. Wait a minute and try again.');
    if (name === 'request_ride' && !bookRL(callerKey)) return toolError('Slow down — this session has booked too many rides this hour.');
    const t0 = Date.now(); let ok = true;
    try { const r = await fn(args); ok = !r.isError; return r; }
    catch (e) { ok = false; console.error(`[mcp] ${name} threw:`, e && e.message); return toolError('Internal error in BinaSmart MCP. Try again or use https://bina.et.'); }
    finally { console.log(JSON.stringify({ t: 'tool', name, ms: Date.now() - t0, ok, caller: String(callerKey).slice(0, 24) })); }
  };
  registerRideTools(server, { api: rideApi, wrap, json });
  registerDirectoryTools(server, { db, wrap, json });
  registerGuideTools(server, { guides, wrap, json });
  return server;
}

export function createApp({ rideApi, db, guides, callLimit = { windowMs: 60_000, max: 30 }, bookLimit = { windowMs: 3_600_000, max: 10 } }) {
  const callsRL = makeLimiter(callLimit.windowMs, callLimit.max);
  const bookRL = makeLimiter(bookLimit.windowMs, bookLimit.max);
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.post('/mcp', async (req, res) => {
    const callerKey = req.headers['mcp-session-id'] || req.headers['x-real-ip'] || req.ip || 'anon';
    try {
      const server = buildServer({ rideApi, db, guides, callerKey, callsRL, bookRL });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp] transport error:', e && e.message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  app.get('/mcp', (_req, res) => { res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.send(DOCS_MD); });
  app.delete('/mcp', (_req, res) => res.sendStatus(405));
  app.get('/mcp/health', async (_req, res) => {
    const out = { ok: true, db: true, ride_api: true };
    try { await db.query('SELECT 1', []); } catch { out.db = false; }
    try { const s = await rideApi.settings(); if (!s || s.ok === false) out.ride_api = false; } catch { out.ride_api = false; }
    out.ok = out.db && out.ride_api;
    res.status(out.ok ? 200 : 503).json(out);
  });
  return app;
}

// Entry point is start.mjs (pm2 runs scripts through its own wrapper, so an argv[1] "run if main" check never fires).
export async function main() {
  const [{ default: pg }, { databaseUrl }, { makeRideApi }] = await Promise.all([import('pg'), import('./lib/env.mjs'), import('./lib/rideApi.mjs')]);
  const PORT = Number(process.env.PORT || 3021);
  const db = new pg.Pool({ connectionString: databaseUrl(), max: 4, idleTimeoutMillis: 30_000 });
  db.on('error', e => console.error('[mcp] pg pool error:', e.message));
  const rideApi = makeRideApi({ baseUrl: process.env.RIDE_API || 'http://127.0.0.1:4210', timeoutMs: 8000 });
  const guides = await loadGuides(path.join(here, '..', 'public'));
  const app = createApp({ rideApi, db, guides });
  app.listen(PORT, '127.0.0.1', () => console.log(`binasmart MCP server on 127.0.0.1:${PORT}, guides loaded: ${guides.size}`));
}
