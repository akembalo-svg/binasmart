// Additive seed: Hilton Addis Ababa (Menelik II Ave) — heritage hotel demo — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — lobby & arcade
  { n: 'G-01',  f: 0, area: 160, rent: 220000, shop: { name: 'Front Desk & Reservations', am: 'የክፍል ማስያዣ ዴስክ', cat: 'SERVICE', icon: '🛎️' } },
  { n: 'G-02',  f: 0, area: 70,  rent: 120000, shop: { name: 'Kaffa House Café', am: 'ካፋ ሀውስ ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-03',  f: 0, area: 50,  rent: 95000,  shop: { name: 'Lobby Bookshop & Press', am: 'መጻሕፍት እና ጋዜጣ', cat: 'RETAIL', icon: '📚' } },
  { n: 'G-04',  f: 0, area: 45,  rent: 90000,  shop: { name: 'Heritage Jewelry & Crafts', am: 'ቅርስ ጌጣጌጥ እና እደ ጥበብ', cat: 'RETAIL', icon: '💍' } },
  { n: 'G-05',  f: 0, area: 55,  rent: 100000, shop: { name: 'Travel & Excursion Desk', am: 'የጉዞ ዴስክ', cat: 'SERVICE', icon: '🧳' } },
  { n: 'G-06',  f: 0, area: 40,  rent: 85000,  shop: null },
  // Floor 1 — dining & events
  { n: 'F1-01', f: 1, area: 320, rent: 250000, shop: { name: 'Harar Grill Restaurant', am: 'ሐረር ግሪል ምግብ ቤት', cat: 'RESTAURANT', icon: '🥩' } },
  { n: 'F1-02', f: 1, area: 280, rent: 220000, shop: { name: 'Gazebo Poolside Restaurant', am: 'ጋዜቦ የመዋኛ ዳር ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F1-03', f: 1, area: 600, rent: 350000, shop: { name: 'Unity Ballroom & Conferences', am: 'የስብሰባ እና የግብዣ አዳራሽ', cat: 'SERVICE', icon: '🎤' } },
  // Floor 2 — business
  { n: 'F2-01', f: 2, area: 120, rent: 130000, shop: { name: 'Business Center', am: 'የቢዝነስ ማዕከል', cat: 'OFFICE', icon: '💼' } },
  { n: 'F2-02', f: 2, area: 100, rent: 120000, shop: { name: 'Airline & Embassy Services', am: 'የአየር መንገድ እና ኤምባሲ አገልግሎት', cat: 'OFFICE', icon: '✈️' } },
  // Floor 3 — wellness (the famous pool)
  { n: 'F3-01', f: 3, area: 500, rent: 320000, shop: { name: 'Thermal Pool Club (hot springs)', am: 'የፍልውሃ መዋኛ ክለብ', cat: 'GYM', icon: '♨️' } },
  { n: 'F3-02', f: 3, area: 150, rent: 140000, shop: { name: 'Hilton Fitness & Tennis', am: 'ጂም እና ቴኒስ', cat: 'GYM', icon: '🎾' } },
  // Floor 8 — executive
  { n: 'F8-01', f: 8, area: 200, rent: 230000, shop: { name: 'Executive Lounge & Suites', am: 'ኤግዘክዩቲቭ ላውንጅ', cat: 'SERVICE', icon: '⭐' } },
  { n: 'F8-02', f: 8, area: 80,  rent: 110000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'hilton-addis' } });
  if (exists) { console.log('hilton-addis already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Hilton Addis Commercial Office', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251967000001', fullName: 'Hilton Commercial Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Hilton Addis Ababa', nameAm: 'ሂልተን አዲስ አበባ',
    city: 'Addis Ababa', subCity: 'Menelik II Ave (near ECA)',
    floors: 10, qrSlug: 'hilton-addis',
    threeD_style: 'modern', threeD_facadeColor: '#c4cbd4',
    threeD_width: 28, threeD_depth: 10,
    signText: 'ሂልተን አዲስ አበባ',
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
      orgId: org.id, phone: '+2519' + String(67000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-06-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-06-15'), endDate: new Date('2026-06-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.3 + Math.random() * 0.6) * 10) / 10,
      reviewCount: 120 + Math.floor(Math.random() * 500),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Front Desk & Reservations') {
      for (const [name, am, price] of [
        ['Guest Room (per night)', 'መደበኛ ክፍል በሌሊት', 13500],
        ['Executive Room (per night)', 'ኤግዘክዩቲቭ ክፍል', 19500],
        ['Diplomat Long-stay (monthly)', 'የዲፕሎማት የወር ቆይታ', 320000]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 180) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'ECA & embassy staff: long-stay rate -15%',
        titleAm: 'ለECA እና ኤምባሲ ሠራተኞች: የረዥም ቆይታ -15%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000),
        views: 560, claims: 38
      }});
    }
    if (u.shop.name === 'Thermal Pool Club (hot springs)') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Thermal Pool Day Pass', nameAm: 'የፍልውሃ የቀን መግቢያ', price: 2500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Family Annual Membership', nameAm: 'የቤተሰብ ዓመታዊ አባልነት', price: 150000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Weekend family swim: 2 kids FREE with parents',
        titleAm: 'የቅዳሜ-እሁድ ዋና: 2 ልጆች ከወላጆች ጋር ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 18 * 86400000),
        views: 610, claims: 104
      }});
    }
    if (u.shop.name === 'Harar Grill Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Signature Steak Dinner', nameAm: 'ልዩ ስቴክ እራት', price: 2400, deliverable: false } });
    }
    if (u.shop.name === 'Unity Ballroom & Conferences') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Conference Day (300p)', nameAm: 'የስብሰባ ቀን (300 ሰው)', price: 280000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Wedding Package (500 guests)', nameAm: 'የሰርግ ጥቅል (500 እንግዳ)', price: 550000 } });
    }
    if (u.shop.name === 'Travel & Excursion Desk') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Entoto & City Tour (half-day)', nameAm: 'የእንጦጦ ጉብኝት', price: 3800 } });
    }
    if (u.shop.name === 'Kaffa House Café') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Traditional Coffee Ceremony', nameAm: 'የቡና ሥነ ሥርዓት', price: 450, deliverable: false } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
