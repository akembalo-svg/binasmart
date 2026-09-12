'use strict';
// ONE-OFF, ran 2026-09-13: moved Darulle's key, the only one, then Building.ownerKey was dropped.
// Kept as the record of how it was done. Run now, it says the column is gone and stops.
//
// Move plain-text Building.ownerKey values into OwnerKey as sha256 hashes.
//
// Each existing key keeps working unchanged: the owner's saved key hashes to the row this writes. No
// key is printed, logged or written anywhere but as its hash. Safe to run twice.
//
//   node ops/building/migrate-owner-keys.js --dry
//   node ops/building/migrate-owner-keys.js
const { PrismaClient } = require('@prisma/client');
const { hashKey, makeOwnerKeys } = require('../../building/ownerKeys');
const DRY = process.argv.includes('--dry');
const p = new PrismaClient();

(async () => {
  const col = await p.$queryRawUnsafe("select 1 from information_schema.columns where table_name='Building' and column_name='ownerKey'");
  if (!col.length) { console.log('Building.ownerKey no longer exists — every key is already a hash in OwnerKey.'); return p.$disconnect(); }
  const bs = await p.building.findMany({ where: { NOT: { ownerKey: null } }, select: { id: true, qrSlug: true, ownerKey: true } });
  console.log((DRY ? 'DRY RUN — ' : '') + bs.length + ' building(s) holding a plain-text key');
  const k = makeOwnerKeys({ prisma: p });
  for (const b of bs) {
    const h = hashKey(b.ownerKey);
    const have = await p.ownerKey.findUnique({ where: { keyHash: h } });
    if (have) { console.log('  have  ' + b.qrSlug + ' — its hash is already stored'); continue; }
    if (!DRY) await p.ownerKey.create({ data: { buildingId: b.id, keyHash: h, label: 'migrated' } });
    console.log('  ' + (DRY ? 'would' : 'moved') + ' ' + b.qrSlug + '  (' + b.ownerKey.length + '-char key)');
  }
  if (!DRY) {
    // Prove it in-process: the saved key must open its own building through the new check, and nothing else.
    for (const b of bs) {
      const own = await k.check(b.qrSlug, b.ownerKey);
      const other = await k.check('__not-' + b.qrSlug, b.ownerKey);
      console.log('  check ' + b.qrSlug + ': own building ' + (own ? 'OPENS' : 'REFUSED') + ', another building ' + (other ? 'OPENS' : 'refused'));
    }
  }
  console.log('OwnerKey rows now: ' + await p.ownerKey.count());
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
