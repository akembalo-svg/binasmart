// Additive seed: Ambassador Mall (Churchill Avenue) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 200, rent: 220000, shop: { name: 'Ambassador Garment Flagship', am: 'አምባሳደር ልብስ ስፌት መደብር', cat: 'RETAIL', icon: '🤵' } },
  { n: 'G-02',  f: 0, area: 80,  rent: 115000, shop: { name: 'Bunna Bank Branch', am: 'ቡና ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 65,  rent: 100000, shop: { name: 'Ambassador Café', am: 'አምባሳደር ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 45,  rent: 82000,  shop: { name: 'Churchill Bookshop', am: 'ቸርችል መጻሕፍት', cat: 'RETAIL', icon: '📚' } },
  // Floor 1 — formal wear floor
  { n: 'F1-01', f: 1, area: 90,  rent: 98000,  shop: { name: 'Master Tailor Atelier', am: 'ማስተር የልብስ ስፌት', cat: 'SERVICE', icon: '✂️' } },
  { n: 'F1-02', f: 1, area: 70,  rent: 85000,  shop: { name: 'Tie & Shirt Gallery', am: 'ከረባት እና ሸሚዝ', cat: 'RETAIL', icon: '👔' } },
  { n: 'F1-03', f: 1, area: 65,  rent: 80000,  shop: { name: 'Formal Shoes & Leather', am: 'የክት ጫማ እና ቆዳ', cat: 'RETAIL', icon: '👞' } },
  { n: 'F1-04', f: 1, area: 60,  rent: 75000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 95,  rent: 90000,  shop: { name: 'Classic Barber & Grooming', am: 'ክላሲክ ፀጉር ቤት', cat: 'SALON', icon: '💈' } },
  { n: 'F2-02', f: 2, area: 75,  rent: 82000,  shop: { name: 'Photo & Passport Studio', am: 'ፎቶ እና ፓስፖርት ስቱዲዮ', cat: 'SERVICE', icon: '📸' } },
  { n: 'F2-03', f: 2, area: 70,  rent: 80000,  shop: { name: 'Piassa Gold & Watches', am: 'ፒያሳ ወርቅ እና ሰዓት', cat: 'RETAIL', icon: '⌚' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 300, rent: 175000, shop: { name: 'Ambassador Restaurant', am: 'አምባሳደር ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 50,  rent: 60000,  shop: { name: 'Tomoca Heritage Coffee', am: 'ቶሞካ ቅርስ ቡና', cat: 'CAFE', icon: '🫘' } },
  // Floor 4 — the theatre homage
  { n: 'F4-01', f: 4, area: 450, rent: 230000, shop: { name: 'Ambassador Cinema & Theatre', am: 'አምባሳደር ሲኒማ እና ቲያትር', cat: 'SERVICE', icon: '🎭' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 180, rent: 115000, shop: { name: 'Churchill Business Center', am: 'ቸርችል የቢዝነስ ማዕከል', cat: 'OFFICE', icon: '💼' } },
  { n: 'F5-02', f: 5, area: 90,  rent: 82000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'ambassador-mall' } });
  if (exists) { console.log('ambassador-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Ambassador Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251974000001', fullName: 'Ambassador Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Ambassador Mall', nameAm: 'አምባሳደር ሞል',
    city: 'Addis Ababa', subCity: 'Churchill Avenue',
    floors: 6, qrSlug: 'ambassador-mall',
    threeD_style: 'classic', threeD_facadeColor: '#5f9ea0',
    threeD_width: 16, threeD_depth: 13,
    signText: 'አምባሳደር ሞል',
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
      orgId: org.id, phone: '+2519' + String(74000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-06-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-06-01'), endDate: new Date('2026-05-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.1 + Math.random() * 0.8) * 10) / 10,
      reviewCount: 35 + Math.floor(Math.random() * 280),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Ambassador Garment Flagship') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Ambassador Suit (ready-made)', nameAm: 'አምባሳደር ሱፍ', price: 14500, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Custom Suit (measured)', nameAm: 'በልክ የተሰፋ ሱፍ', price: 22000, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Graduation season: suit + shirt + tie -20%',
        titleAm: 'የምረቃ ወቅት: ሱፍ + ሸሚዝ + ከረባት -20%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 21 * 86400000),
        views: 460, claims: 71
      }});
    }
    if (u.shop.name === 'Ambassador Cinema & Theatre') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Cinema Ticket', nameAm: 'የፊልም ትኬት', price: 300, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Theatre Night (Ethiopian drama)', nameAm: 'የቲያትር ምሽት', price: 500, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Classic film Sundays: ticket + popcorn 349 ETB',
        titleAm: 'የእሁድ ክላሲክ ፊልም: ትኬት + ፖፕኮርን 349 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 12 * 86400000),
        views: 390, claims: 84
      }});
    }
    if (u.shop.name === 'Master Tailor Atelier') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Suit Alteration', nameAm: 'የሱፍ ማስተካከያ', price: 1200 } });
    }
    if (u.shop.name === 'Photo & Passport Studio') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Passport Photos (8pc, 10min)', nameAm: 'የፓስፖርት ፎቶ', price: 250 } });
    }
    if (u.shop.name === 'Ambassador Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Executive Lunch Buffet', nameAm: 'የሥራ ምሳ ቡፌ', price: 420, deliverable: false } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
