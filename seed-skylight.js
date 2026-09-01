// Additive seed: Ethiopian Skylight Hotel (Bole, by the airport) — hotel demo — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — lobby level
  { n: 'G-01',  f: 0, area: 150, rent: 200000, shop: { name: 'Reservations & Front Desk', am: 'የክፍል ማስያዣ ዴስክ', cat: 'SERVICE', icon: '🛎️' } },
  { n: 'G-02',  f: 0, area: 60,  rent: 110000, shop: { name: 'Skylight Gift & Duty Shop', am: 'ስካይላይት ስጦታ ሱቅ', cat: 'RETAIL', icon: '🎁' } },
  { n: 'G-03',  f: 0, area: 80,  rent: 120000, shop: { name: 'Cloud Lobby Café', am: 'ክላውድ ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 40,  rent: 90000,  shop: { name: 'CBE Forex & ATM Corner', am: 'ምንዛሪ እና ኤቲኤም', cat: 'BANK', icon: '💱' } },
  { n: 'G-05',  f: 0, area: 55,  rent: 95000,  shop: null },
  // Floor 1 — events
  { n: 'F1-01', f: 1, area: 900, rent: 450000, shop: { name: 'Grand Ballroom (2,000 guests)', am: 'ትልቁ አዳራሽ (2,000 እንግዳ)', cat: 'SERVICE', icon: '👑' } },
  { n: 'F1-02', f: 1, area: 400, rent: 250000, shop: { name: 'Skylight Conference Center', am: 'የስብሰባ ማዕከል', cat: 'SERVICE', icon: '🎤' } },
  // Floor 2 — dining
  { n: 'F2-01', f: 2, area: 300, rent: 220000, shop: { name: 'Sapphire Chinese Restaurant', am: 'ሳፋየር የቻይና ምግብ ቤት', cat: 'RESTAURANT', icon: '🥢' } },
  { n: 'F2-02', f: 2, area: 320, rent: 230000, shop: { name: 'Abyssinia Cultural Restaurant', am: 'አቢሲኒያ የባህል ምግብ ቤት', cat: 'RESTAURANT', icon: '🍲' } },
  { n: 'F2-03', f: 2, area: 350, rent: 240000, shop: { name: 'Horizon International Buffet', am: 'ሆራይዘን ቡፌ', cat: 'RESTAURANT', icon: '🍽️' } },
  // Floor 3 — business & family
  { n: 'F3-01', f: 3, area: 120, rent: 130000, shop: { name: 'Executive Business Center', am: 'የቢዝነስ ማዕከል', cat: 'OFFICE', icon: '💼' } },
  { n: 'F3-02', f: 3, area: 150, rent: 120000, shop: { name: 'Skylight Kids Club', am: 'የልጆች ክለብ', cat: 'SERVICE', icon: '🎈' } },
  // Floor 4 — wellness
  { n: 'F4-01', f: 4, area: 400, rent: 260000, shop: { name: 'Skylight Spa & Wellness', am: 'ስፓ እና ደህንነት', cat: 'SALON', icon: '💆' } },
  { n: 'F4-02', f: 4, area: 300, rent: 200000, shop: { name: 'Fitness Center & Pool', am: 'ጂም እና መዋኛ', cat: 'GYM', icon: '🏊' } },
  // Floor 7 — signature suite
  { n: 'F7-01', f: 7, area: 250, rent: 300000, shop: { name: 'Presidential Suite Booking', am: 'የፕሬዝዳንት ስዊት', cat: 'SERVICE', icon: '⭐' } },
  { n: 'F7-02', f: 7, area: 100, rent: 120000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'skylight-hotel' } });
  if (exists) { console.log('skylight-hotel already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Skylight Hotel Commercial Office', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251965000001', fullName: 'Skylight Commercial Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Ethiopian Skylight Hotel', nameAm: 'የኢትዮጵያ ስካይላይት ሆቴል',
    city: 'Addis Ababa', subCity: 'Bole (Airport Road)',
    floors: 8, qrSlug: 'skylight-hotel',
    threeD_style: 'glass', threeD_facadeColor: '#b0885f',
    threeD_width: 24, threeD_depth: 14,
    signText: 'ስካይላይት ሆቴል ★★★★★',
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
      orgId: org.id, phone: '+2519' + String(65000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-08-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-08-15'), endDate: new Date('2026-08-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.4 + Math.random() * 0.5) * 10) / 10,
      reviewCount: 100 + Math.floor(Math.random() * 500),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Reservations & Front Desk') {
      for (const [name, am, price] of [
        ['Deluxe Room (per night)', 'ዲላክስ ክፍል በሌሊት', 9500],
        ['Executive Room (per night)', 'ኤግዘክዩቲቭ ክፍል', 14500],
        ['Airport Layover Day-room', 'የትራንዚት የቀን ክፍል', 5500]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 200) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Ethiopian Airlines passengers: day-room -25%',
        titleAm: 'ለኢትዮጵያ አየር መንገድ መንገደኞች: የቀን ክፍል -25%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 20 * 86400000),
        views: 720, claims: 96
      }});
    }
    if (u.shop.name === 'Grand Ballroom (2,000 guests)') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Grand Wedding (1,000 guests)', nameAm: 'ትልቅ ሰርግ (1,000 እንግዳ)', price: 850000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Conference Day Package (500p)', nameAm: 'የስብሰባ ቀን ጥቅል', price: 350000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Book 2026 weddings now: 10% early-bird',
        titleAm: 'የ2026 ሰርግ ቀድመው ያስይዙ: 10% ቅናሽ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000),
        views: 530, claims: 31
      }});
    }
    if (u.shop.name === 'Abyssinia Cultural Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Cultural Dinner + Dance Show', nameAm: 'የባህል እራት + ውዝዋዜ', price: 1200, deliverable: false } });
    }
    if (u.shop.name === 'Horizon International Buffet') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Dinner Buffet (per person)', nameAm: 'የእራት ቡፌ', price: 1600, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Friday Seafood Night', nameAm: 'የአርብ የባህር ምግብ ምሽት', price: 2200, deliverable: false } });
    }
    if (u.shop.name === 'Skylight Spa & Wellness') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Full-day Spa Package', nameAm: 'የሙሉ ቀን ስፓ', price: 4500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Couples Massage (90min)', nameAm: 'የጥንድ ማሳጅ', price: 5200 } });
    }
    if (u.shop.name === 'Presidential Suite Booking') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Presidential Suite (per night)', nameAm: 'የፕሬዝዳንት ስዊት በሌሊት', price: 65000 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
