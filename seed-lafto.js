// Additive seed: Lafto Mall (Nifas Silk-Lafto, South Addis) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 400, rent: 220000, shop: { name: 'Lafto Supermarket', am: 'ላፍቶ ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 80,  rent: 110000, shop: { name: 'Oromia Bank Branch', am: 'ኦሮሚያ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 55,  rent: 85000,  shop: { name: 'Lafto Café & Juice', am: 'ላፍቶ ካፌ እና ጭማቂ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 60,  rent: 90000,  shop: { name: 'Fresh Butcher & Dairy', am: 'ሥጋ እና ወተት ውጤቶች', cat: 'RETAIL', icon: '🥩' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 85,  rent: 90000,  shop: { name: 'Lafto Fashion Center', am: 'ላፍቶ ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 65,  rent: 78000,  shop: { name: 'Sneaker Street', am: 'ስኒከር ስትሪት', cat: 'RETAIL', icon: '👟' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 75000,  shop: { name: 'Kids World Clothing', am: 'የልጆች ልብስ ዓለም', cat: 'RETAIL', icon: '🧒' } },
  { n: 'F1-04', f: 1, area: 55,  rent: 70000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 95,  rent: 92000,  shop: { name: 'HomeTech Electronics', am: 'ሆምቴክ ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📺' } },
  { n: 'F2-02', f: 2, area: 70,  rent: 80000,  shop: { name: 'Furniture & Mattress House', am: 'የቤት እቃ እና ፍራሽ', cat: 'RETAIL', icon: '🛏️' } },
  { n: 'F2-03', f: 2, area: 60,  rent: 72000,  shop: { name: 'Mobile & Repair Hub', am: 'ሞባይል ሽያጭ እና ጥገና', cat: 'SERVICE', icon: '🔧' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 300, rent: 165000, shop: { name: 'Lafto Family Restaurant', am: 'ላፍቶ የቤተሰብ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 50,  rent: 58000,  shop: { name: 'Buna Bet Traditional Coffee', am: 'ቡና ቤት', cat: 'CAFE', icon: '🫖' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 280, rent: 150000, shop: { name: 'Lafto Fitness & Boxing Gym', am: 'ላፍቶ ጂም እና ቦክስ', cat: 'GYM', icon: '🥊' } },
  { n: 'F4-02', f: 4, area: 120, rent: 95000,  shop: { name: 'Hana Beauty & Braids', am: 'ሀና ውበት እና ሹሩባ', cat: 'SALON', icon: '💇‍♀️' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 350, rent: 160000, shop: { name: 'Lafto Mini Cinema', am: 'ላፍቶ ሚኒ ሲኒማ', cat: 'SERVICE', icon: '🎬' } },
  { n: 'F5-02', f: 5, area: 100, rent: 80000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'lafto-mall' } });
  if (exists) { console.log('lafto-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Lafto Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251962000001', fullName: 'Lafto Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Lafto Mall', nameAm: 'ላፍቶ ሞል',
    city: 'Addis Ababa', subCity: 'Nifas Silk-Lafto',
    floors: 6, qrSlug: 'lafto-mall',
    threeD_style: 'modern', threeD_facadeColor: '#88a5a0',
    threeD_width: 16, threeD_depth: 12,
    signText: 'ላፍቶ ሞል',
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
      orgId: org.id, phone: '+2519' + String(62000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-10-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-10-01'), endDate: new Date('2026-09-30'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 20 + Math.floor(Math.random() * 170),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Lafto Mini Cinema') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Movie Ticket', nameAm: 'የፊልም ትኬት', price: 250, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Kids Matinee Ticket', nameAm: 'የልጆች የቀን ትኬት', price: 150, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Saturday kids matinee: 2 for 1',
        titleAm: 'ቅዳሜ የልጆች ፊልም: 2 በ1 ዋጋ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 9 * 86400000),
        views: 310, claims: 72
      }});
    }
    if (u.shop.name === 'Lafto Fitness & Boxing Gym') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Monthly Membership', nameAm: 'ወርሃዊ አባልነት', price: 1800 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Boxing Classes (8 sessions)', nameAm: 'የቦክስ ስልጠና (8 ጊዜ)', price: 3200 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Student discount: membership 1,400 ETB',
        titleAm: 'ለተማሪዎች: አባልነት 1,400 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 86400000),
        views: 270, claims: 58
      }});
    }
    if (u.shop.name === 'Lafto Family Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Family Beyaynetu (4p)', nameAm: 'የቤተሰብ በያይነቱ', price: 850, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Tibs Firfir', nameAm: 'ጥብስ ፍርፍር', price: 380, deliverable: true } });
    }
    if (u.shop.name === 'Fresh Butcher & Dairy') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Premium Beef (per kg)', nameAm: 'ምርጥ ሥጋ በኪሎ', price: 950, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Fresh Ayib (cottage cheese)', nameAm: 'አይብ', price: 320, deliverable: true } });
    }
    if (u.shop.name === 'Hana Beauty & Braids') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Full Braiding (Shuruba)', nameAm: 'ሙሉ ሹሩባ', price: 1500 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
