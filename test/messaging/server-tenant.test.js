'use strict';
// server.js wiring for tenant Telegram, pinned by reading the file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const block = (sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at > 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at)); };

test('the tenant Telegram routes authenticate, never read the body, and remove only a tenancy of that building', () => {
  for (const sig of ["fastify.get('/api/owner/:slug/tenant-telegram'", "fastify.post('/api/owner/:slug/tenant-telegram/:tenancyId/remove'"]) {
    const body = block(sig);
    assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') > 0, sig);
    assert.doesNotMatch(body, /req\.body/, sig);
  }
  const rm = block("fastify.post('/api/owner/:slug/tenant-telegram/:tenancyId/remove'");
  assert.match(rm, /t\.unit\.buildingId !== b\.id/);
  assert.match(rm, /tenantLink\.removeForBuilding\(b\.id, t\.id\)/);
  assert.match(src, /const tenantLink = makeTenantLink\(\{ store: makeTenantLinkStore\(prisma\), audit \}\);/);
});

test('the poster route checks the slug and the owner key before the database, is not indexed, and encodes only the start link', () => {
  const body = block("fastify.get('/tenant-poster/:slug'");
  const slugAt = body.indexOf('/^[A-Za-z0-9-]{1,60}$/.test('), authAt = body.indexOf('authBuildingFail(req, reply, slug)'), dbAt = body.indexOf('prisma.building.findUnique(');
  assert.ok(slugAt > 0 && slugAt < authAt && authAt < dbAt, 'slug check, then owner key, then the database');
  assert.match(body, /'X-Robots-Tag', 'noindex, nofollow'/);
  assert.match(body, /'Cache-Control', 'no-store'/);
  assert.match(body, /QRCode\.toString\(tenantStartUrl\(b\.qrSlug\)/);
});

test('the old unit-number webhook links nobody any more', () => {
  const body = block("fastify.post('/api/tg-webhook'");
  assert.doesNotMatch(body, /telegramChatId|prisma\.|sendTg\(/);
  assert.match(body, /x-telegram-bot-api-secret-token/);
});

test('the bot gets the tenant link service', () => {
  const ride = block("const rideMod = require('./ride')(fastify, {", '\n});');
  assert.match(ride, /tenantTelegram: tenantLink,/);
  assert.ok(src.indexOf('const tenantLink = ') < src.indexOf("const rideMod = require('./ride')(fastify, {"));
  assert.match(fs.readFileSync(path.join(ROOT, 'ride', 'index.js'), 'utf8'), /tenant: deps\.tenantTelegram \|\| null/);
});
