'use strict';
// Authenticating the building is not the same as owning the row.
//
// Every `/api/owner/:slug/<thing>/:id/<action>` route in server.js takes a key that proves you own a
// BUILDING, and then acts on a row identified only by its id. If it does not also check that the row
// belongs to that building, one building's owner can act on another's data. Seven such routes exist.
// Six were right. /order/:id/status was not, and could cancel any order in the system by id.
//
// server.js starts a listener on require, so it cannot be imported into a test. Reading it is the
// honest alternative: this pins the rule across every route at once, including ones written later,
// which is the part a test of the single fixed route would not do.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// Slice each route from its declaration to the `});` that closes it at column 0.
function routeBodies(source) {
  const out = [];
  const re = /fastify\.post\('(\/api\/owner\/:slug\/[^']*:id[^']*)'/g;
  let m;
  while ((m = re.exec(source))) {
    const end = source.indexOf('\n});', m.index);
    out.push({ route: m[1], body: source.slice(m.index, end === -1 ? source.length : end) });
  }
  return out;
}

test('every owner route that acts on a row by id checks the row belongs to that building', () => {
  const routes = routeBodies(SRC);
  assert.ok(routes.length >= 7, 'found only ' + routes.length + ' owner-by-id routes; the regex has drifted');

  const missing = routes.filter(r => !/buildingId !== b\.id/.test(r.body)).map(r => r.route);
  assert.deepEqual(missing, [],
    'These routes authenticate the building but then act on a row by id without checking it belongs ' +
    'to that building, so one owner can act on another owner\'s data:\n  ' + missing.join('\n  ') +
    '\nEvery sibling route does `const b = await prisma.building.findUnique({ where: { qrSlug: ' +
    'req.params.slug } })`, looks the row up, and returns 404 when `row...buildingId !== b.id`.');
});

test('and every one of them authenticates first', () => {
  const missing = routeBodies(SRC).filter(r => !/authBuildingFail/.test(r.body)).map(r => r.route);
  assert.deepEqual(missing, [], 'owner routes with no authBuildingFail call: ' + missing.join(', '));
});

// Guard the guard: if the regex ever stops matching the file, the two tests above pass vacuously.
test('the scan actually finds the known routes', () => {
  const names = routeBodies(SRC).map(r => r.route);
  for (const expected of ['/api/owner/:slug/order/:id/status', '/api/owner/:slug/booking/:id/status',
    '/api/owner/:slug/invoice/:id/send'])
    assert.ok(names.includes(expected), 'scan missed ' + expected + '; found: ' + names.join(', '));
});
