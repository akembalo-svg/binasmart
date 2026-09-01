// Additive seed: Unity Park (Grand Palace, Arat Kilo) — venue/attraction demo — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// f0 = Park grounds, f1 = Palace & events level
const UNITS = [
  // Park grounds
  { n: 'PG-01', f: 0, area: 120, rent: 150000, shop: { name: 'Unity Park Ticket Office', am: 'የአንድነት ፓርክ ትኬት ቢሮ', cat: 'SERVICE', icon: '🎟️' } },
  { n: 'PG-02', f: 0, area: 200, rent: 180000, shop: { name: 'Zoo & Black-Mane Lions', am: 'የአንበሳ መካነ አራዊት', cat: 'SERVICE', icon: '🦁' } },
  { n: 'PG-03', f: 0, area: 90,  rent: 120000, shop: { name: 'Unity Souvenir Shop', am: 'የመታሰቢያ እቃዎች ሱቅ', cat: 'RETAIL', icon: '🎁' } },
  { n: 'PG-04', f: 0, area: 150, rent: 160000, shop: { name: 'Traditional Food Pavilion', am: 'የባህል ምግብ አዳራሽ', cat: 'RESTAURANT', icon: '🍲' } },
  { n: 'PG-05', f: 0, area: 60,  rent: 90000,  shop: { name: 'Palace Garden Café', am: 'የቤተ መንግሥት ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'PG-06', f: 0, area: 40,  rent: 70000,  shop: { name: 'Ice Cream & Snacks Kiosk', am: 'አይስ ክሬም ኪዮስክ', cat: 'CAFE', icon: '🍦' } },
  { n: 'PG-07', f: 0, area: 55,  rent: 80000,  shop: { name: 'Royal Photo Studio', am: 'የፎቶ ስቱዲዮ', cat: 'SERVICE', icon: '📸' } },
  { n: 'PG-08', f: 0, area: 50,  rent: 75000,  shop: null },
  // Palace & events level
  { n: 'PL-01', f: 1, area: 500, rent: 300000, shop: { name: 'Grand Banquet Hall', am: 'ትልቁ የግብዣ አዳራሽ', cat: 'SERVICE', icon: '👑' } },
  { n: 'PL-02', f: 1, area: 300, rent: 200000, shop: { name: 'Palace Museum Gallery', am: 'የቤተ መንግሥት ሙዚየም', cat: 'SERVICE', icon: '🏛️' } },
  { n: 'PL-03', f: 1, area: 120, rent: 110000, shop: { name: 'Menelik Exhibition Hall', am: 'የምኒልክ ኤግዚቢሽን', cat: 'SERVICE', icon: '📜' } },
  { n: 'PL-04', f: 1, area: 80,  rent: 90000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'unity-park' } });
  if (exists) { console.log('unity-park already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Unity Park Visitor Services', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251964000001', fullName: 'Unity Park Admin Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Unity Park', nameAm: 'አንድነት ፓርክ',
    city: 'Addis Ababa', subCity: 'Arat Kilo (Grand Palace)',
    floors: 2, qrSlug: 'unity-park',
    threeD_style: 'modern', threeD_facadeColor: '#7db07d',
    threeD_width: 30, threeD_depth: 20,
    signText: 'አንድነት ፓርክ 🌳',
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
      orgId: org.id, phone: '+2519' + String(64000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-12-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-12-01'), endDate: new Date('2026-11-30'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.3 + Math.random() * 0.6) * 10) / 10,
      reviewCount: 80 + Math.floor(Math.random() * 400),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Unity Park Ticket Office') {
      for (const [name, am, price] of [
        ['Adult Entry Ticket', 'የአዋቂ መግቢያ', 200],
        ['Kids Entry Ticket', 'የልጆች መግቢያ', 100],
        ['Foreign Visitor Ticket', 'የውጭ ጎብኚ መግቢያ', 600]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 300) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'School groups (20+): 50% off entry',
        titleAm: 'የትምህርት ቤት ቡድኖች (20+): 50% ቅናሽ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000),
        views: 890, claims: 132
      }});
    }
    if (u.shop.name === 'Zoo & Black-Mane Lions') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Zoo Combo Ticket', nameAm: 'የመካነ አራዊት ኮምቦ', price: 150, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Guided Wildlife Tour', nameAm: 'የመመሪያ ጉብኝት', price: 400, deliverable: false } });
    }
    if (u.shop.name === 'Grand Banquet Hall') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Wedding Package (300 guests)', nameAm: 'የሰርግ ጥቅል (300 እንግዳ)', price: 250000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Corporate Gala Evening', nameAm: 'የድርጅት ምሽት', price: 180000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Weekday events at the palace -15%',
        titleAm: 'የሳምንት ቀናት ዝግጅቶች -15%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 25 * 86400000),
        views: 410, claims: 23
      }});
    }
    if (u.shop.name === 'Palace Museum Gallery') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Guided Palace Tour (1h)', nameAm: 'የቤተ መንግሥት ጉብኝት', price: 350, deliverable: false } });
    }
    if (u.shop.name === 'Unity Souvenir Shop') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Unity Park T-Shirt', nameAm: 'የአንድነት ፓርክ ቲሸርት', price: 750, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Lion of Judah Miniature', nameAm: 'የይሁዳ አንበሳ ቅርስ', price: 1200, deliverable: true } });
    }
    if (u.shop.name === 'Traditional Food Pavilion') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Cultural Lunch + Coffee Ceremony', nameAm: 'የባህል ምሳ + ቡና ሥነ ሥርዓት', price: 650, deliverable: false } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
