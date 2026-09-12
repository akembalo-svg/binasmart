'use strict';
// The demo hospital named nine doctors who do not exist.
//
//   OPD — General      Dr. Tena, Dr. Selam
//   Pediatrics         Dr. Hiwot, Dr. Fikir
//   Radiology / X-Ray  Dr. Bereket
//   Cardiology         Dr. Tesfa
//   Dental             Dr. Meron
//   Maternity          Dr. Emebet, Dr. Rahel
//
// Those are ordinary Amharic given names, so somewhere in Addis Ababa there is a real Dr Meron and a
// real Dr Hiwot, and this listed them at a hospital that does not exist, with a floor, a room and a
// consultation fee. An invented rating is a claim about a business; an invented doctor is a claim
// about a person.
//
// Department.doctors is already used loosely — the other entries are "Walk-in", "Open 24/7",
// "Walk-in with doctor referral", and each element renders as its own chip on the page. So a role and
// a count fits the field as it is actually used, keeps what the demonstration needs (this department
// is staffed, by this many) and invents nobody.
//
//   node ops/business/depersonalise-demo-doctors.js [--dry]
//
// Scoped to buildings that announce themselves as demonstrations, so a real hospital entering its
// real consultants is never touched. Only entries that look like a person's name are replaced;
// "Walk-in" and "Open 24/7" are left exactly as they are.
const { PrismaClient } = require('@prisma/client');
const { isDemo } = require('../../hotels/rules');
const prisma = new PrismaClient();

const NAMED = /^\s*(dr\.?|prof\.?|sr\.?|nurse)\s+\S/i;   // an entry naming a person
const ROLE = { DENTAL: 'dentist', PHARMACY: 'pharmacist' };

const label = (dept, n) => {
  const role = Object.keys(ROLE).find(k => dept.toUpperCase().includes(k));
  const word = role ? ROLE[role] : 'doctor';
  return n === 1 ? '1 ' + word : n + ' ' + word + 's';
};

(async () => {
  const dry = process.argv.includes('--dry');
  const departments = await prisma.department.findMany({
    include: { building: { select: { qrSlug: true, name: true, subCity: true } } },
    orderBy: [{ floor: 'asc' }, { name: 'asc' }] });

  let changed = 0, skipped = 0;
  for (const d of departments) {
    if (!isDemo(d.building)) {
      if ((d.doctors || []).some(x => NAMED.test(x))) {
        console.log('  left alone (real building): ' + d.building.qrSlug + ' / ' + d.name);
        skipped++;
      }
      continue;
    }
    const named = (d.doctors || []).filter(x => NAMED.test(x));
    if (!named.length) continue;
    const kept = (d.doctors || []).filter(x => !NAMED.test(x));
    const next = [...kept, label(d.name, named.length)];
    console.log('  ' + d.name.padEnd(20).slice(0, 20) + ' ' + JSON.stringify(d.doctors) + '  ->  ' + JSON.stringify(next));
    if (!dry) await prisma.department.update({ where: { id: d.id }, data: { doctors: next } });
    changed++;
  }

  console.log('');
  console.log((dry ? 'would change ' : 'changed ') + changed + ' department(s)'
    + (skipped ? ', left ' + skipped + ' alone in real buildings' : ''));
  const left = (await prisma.department.findMany({ include: { building: true } }))
    .filter(d => isDemo(d.building) && (d.doctors || []).some(x => NAMED.test(x)));
  console.log('demo departments still naming a person: ' + left.length);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
