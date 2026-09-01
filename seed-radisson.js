// Additive seed: Radisson Blu Addis Ababa (Kazanchis) — business hotel demo — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — lobby
  { n: 'G-01',  f: 0, area: 140, rent: 210000, shop: { name: 'Front Desk & Reservations', am: 'የክፍል ማስያዣ ዴስክ', cat: 'SERVICE', icon: '🛎️' } },
  { n: 'G-02',  f: 0, area: 260, rent: 240000, shop: { name: 'Verres en Vers Brasserie', am: 'ቬር ኦን ቬር ብራሰሪ', cat: 'RESTAURANT', icon: '🥂' } },
  { n: 'G-03',  f: 0, area: 90,  rent: 130000, shop: { name: 'Blu Lobby Bar & Lounge', am: 'ብሉ ላውንጅ ባር', cat: 'CAFE', icon: '🍸' } },
  { n: 'G-04',  f: 0, area: 40,  rent: 85000,  shop: { name: 'Kazanchis Gift Corner', am: 'ካዛንቺስ ስጦታ ሱቅ', cat: 'RETAIL', icon: '🎁' } },
  { n: 'G-05',  f: 0, area: 45,  rent: 90000,  shop: null },
  // Floor 1 — meetings & events
  { n: 'F1-01', f: 1, area: 450, rent: 320000, shop: { name: 'Grand Meeting & Ballroom', am: 'ትልቅ የስብሰባ አዳራሽ', cat: 'SERVICE', icon: '🎤' } },
  { n: 'F1-02', f: 1, area: 160, rent: 150000, shop: { name: 'Boardroom Suites (x4)', am: 'የቦርድ ስብሰባ ክፍሎች', cat: 'SERVICE', icon: '💼' } },
  // Floor 2 — wellness
  { n: 'F2-01', f: 2, area: 300, rent: 220000, shop: { name: 'Indoor Pool & Sauna Club', am: 'የቤት ውስጥ መዋኛ እና ሳውና', cat: 'GYM', icon: '🏊' } },
  { n: 'F2-02', f: 2, area: 140, rent: 140000, shop: { name: 'Blu Fitness Studio', am: 'ብሉ ጂም', cat: 'GYM', icon: '💪' } },
  { n: 'F2-03', f: 2, area: 100, rent: 120000, shop: { name: 'Serene Day Spa', am: 'ሰሪን ስፓ', cat: 'SALON', icon: '💆' } },
  // Floor 3 — business
  { n: 'F3-01', f: 3, area: 110, rent: 125000, shop: { name: 'Executive Business Lounge', am: 'የቢዝነስ ላውንጅ', cat: 'OFFICE', icon: '🖥️' } },
  { n: 'F3-02', f: 3, area: 90,  rent: 105000, shop: { name: 'NGO & UN Liaison Office', am: 'የተባበሩት መንግሥታት አገናኝ ቢሮ', cat: 'OFFICE', icon: '🕊️' } },
  // Floor 8 — signature
  { n: 'F8-01', f: 8, area: 180, rent: 200000, shop: { name: 'Business Class Suites', am: 'የቢዝነስ ክላስ ስዊቶች', cat: 'SERVICE', icon: '⭐' } },
  { n: 'F8-02', f: 8, area: 70,  rent: 95000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'radisson-blu' } });
  if (exists) { console.log('radisson-blu already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Radisson Blu Addis Commercial Office', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251968000001', fullName: 'Radisson Commercial Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Radisson Blu Addis Ababa', nameAm: 'ራዲሰን ብሉ አዲስ አበባ',
    city: 'Addis Ababa', subCity: 'Kazanchis',
    floors: 9, qrSlug: 'radisson-blu',
    threeD_style: 'glass', threeD_facadeColor: '#5f7ea6',
    threeD_width: 18, threeD_depth: 12,
    signText: 'ራዲሰን ብሉ',
    marketplaceEnabled: true
  }});

  let shopCount = 0;
  for (const u of UNITS) {
    const unit = await prisma.unit.create({ data: {
      buildingId: building.id, number: u.n, floor: u.f,
      areaSqm: u.area, monthlyRent: u.rent,
      status: u.shop ? 'OCCUPIED' : 'VACANT',
      unitType: 'SHOP'
    }});
    if (!u.shop) continue;

    const tUser = await prisma.user.create({ data: {
      orgId: org.id, phone: '+2519' + String(68000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-05-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-05-15'), endDate: new Date('2026-05-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.3 + Math.random() * 0.6) * 10) / 10,
      reviewCount: 90 + Math.floor(Math.random() * 400),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Front Desk & Reservations') {
      for (const [name, am, price] of [
        ['Standard Room (per night)', 'መደበኛ ክፍል በሌሊት', 12000],
        ['Business Class Room (per night)', 'የቢዝነስ ክላስ ክፍል', 17500],
        ['Conference Delegate Package (room+meals)', 'የስብሰባ ተሳታፊ ጥቅል', 21000]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 160) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'AU & UN summit weeks: delegate rate -20%',
        titleAm: 'የAU/UN ስብሰባ ሳምንታት: የተሳታፊ ዋጋ -20%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000),
        views: 490, claims: 44
      }});
    }
    if (u.shop.name === 'Verres en Vers Brasserie') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Set Lunch (2 courses)', nameAm: 'ሴት ምሳ (2 ኮርስ)', price: 1400, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'French Dinner Tasting', nameAm: 'የፈረንሳይ እራት', price: 3200, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Business set lunch 999 ETB (Mon–Fri)',
        titleAm: 'የቢዝነስ ምሳ 999 ብር (ሰኞ–አርብ)',
        startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 86400000),
        views: 420, claims: 89
      }});
    }
    if (u.shop.name === 'Grand Meeting & Ballroom') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Full-day Conference (250p)', nameAm: 'የሙሉ ቀን ስብሰባ (250 ሰው)', price: 240000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Product Launch Evening', nameAm: 'የምርት ማስተዋወቂያ ምሽት', price: 160000 } });
    }
    if (u.shop.name === 'Indoor Pool & Sauna Club') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Pool + Sauna Day Pass', nameAm: 'መዋኛ + ሳውና የቀን መግቢያ', price: 2200 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Corporate Membership (annual)', nameAm: 'የድርጅት አባልነት', price: 140000 } });
    }
    if (u.shop.name === 'Boardroom Suites (x4)') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Boardroom Half-day (12p)', nameAm: 'የቦርድ ክፍል ግማሽ ቀን', price: 18000 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
