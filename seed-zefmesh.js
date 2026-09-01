// Additive seed: Zefmesh Grand Mall (Megenagna) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 500, rent: 290000, shop: { name: 'Zefmesh Supermarket', am: 'ዘፍመሽ ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 90,  rent: 135000, shop: { name: 'Abyssinia Bank Branch', am: 'አቢሲኒያ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 70,  rent: 105000, shop: { name: "Mama's Kitchen Café", am: 'የእማማ ወጥ ቤት ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 40,  rent: 80000,  shop: { name: 'Tropical Juice Bar', am: 'ትሮፒካል ጭማቂ', cat: 'CAFE', icon: '🥤' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 100, rent: 110000, shop: { name: 'Zaf Fashion Store', am: 'ዛፍ ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 85,  rent: 100000, shop: { name: 'Gentleman Suits & Ties', am: 'የወንዶች ሱፍ', cat: 'RETAIL', icon: '🤵' } },
  { n: 'F1-03', f: 1, area: 70,  rent: 90000,  shop: { name: 'Runner Shoes & Sports', am: 'የስፖርት ጫማ', cat: 'RETAIL', icon: '👟' } },
  { n: 'F1-04', f: 1, area: 65,  rent: 85000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 130, rent: 125000, shop: { name: 'Digital Electronics Mart', am: 'ዲጂታል ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '💻' } },
  { n: 'F2-02', f: 2, area: 90,  rent: 95000,  shop: { name: 'Baby & Mother Shop', am: 'የእናት እና ልጅ ሱቅ', cat: 'RETAIL', icon: '🍼' } },
  { n: 'F2-03', f: 2, area: 80,  rent: 90000,  shop: { name: 'Sports Gear House', am: 'የስፖርት እቃዎች', cat: 'RETAIL', icon: '⚽' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 350, rent: 200000, shop: { name: 'Zefmesh Restaurant', am: 'ዘፍመሽ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 60,  rent: 70000,  shop: { name: 'Sidamo Coffee Roastery', am: 'ሲዳሞ ቡና', cat: 'CAFE', icon: '🫘' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 400, rent: 210000, shop: { name: 'PowerFit Gym', am: 'ፓወርፊት ጂም', cat: 'GYM', icon: '💪' } },
  { n: 'F4-02', f: 4, area: 130, rent: 105000, shop: { name: 'Serenity Spa & Massage', am: 'ሰሬኒቲ ስፓ', cat: 'SALON', icon: '💆' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 180, rent: 120000, shop: { name: 'Habesha Real Estate Office', am: 'የሀበሻ ሪል እስቴት', cat: 'OFFICE', icon: '🏠' } },
  { n: 'F5-02', f: 5, area: 150, rent: 110000, shop: { name: 'TechHub IT Solutions', am: 'ቴክሀብ አይቲ', cat: 'OFFICE', icon: '🖥️' } },
  // Floor 6
  { n: 'F6-01', f: 6, area: 450, rent: 230000, shop: { name: 'Grand Event Hall', am: 'ግራንድ የዝግጅት አዳራሽ', cat: 'SERVICE', icon: '🎪' } },
  { n: 'F6-02', f: 6, area: 120, rent: 95000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'zefmesh-mall' } });
  if (exists) { console.log('zefmesh-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Zefmesh Grand Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251956000001', fullName: 'Zefmesh Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Zefmesh Grand Mall', nameAm: 'ዘፍመሽ ግራንድ ሞል',
    city: 'Addis Ababa', subCity: 'Megenagna',
    floors: 7, qrSlug: 'zefmesh-mall',
    threeD_style: 'glass', threeD_facadeColor: '#8fbfae',
    threeD_width: 17, threeD_depth: 13,
    signText: 'ዘፍመሽ ሞል',
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
      orgId: org.id, phone: '+2519' + String(56000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-05-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-05-01'), endDate: new Date('2026-04-30'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 30 + Math.floor(Math.random() * 240),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Grand Event Hall') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Wedding Package (full day)', nameAm: 'የሰርግ ጥቅል (ሙሉ ቀን)', price: 85000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Meeting Half-day', nameAm: 'የስብሰባ ግማሽ ቀን', price: 18000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Weekday weddings -20% this season',
        titleAm: 'የሳምንት ቀናት ሰርግ -20%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 20 * 86400000),
        views: 260, claims: 19
      }});
    }
    if (u.shop.name === 'PowerFit Gym') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Monthly Membership', nameAm: 'ወርሃዊ አባልነት', price: 2200 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Couple Plan (monthly)', nameAm: 'የጥንድ እቅድ', price: 3800 } });
    }
    if (u.shop.name === 'Sidamo Coffee Roastery') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Sidamo Beans 1kg (roasted)', nameAm: 'ሲዳሞ ቡና 1ኪግ', price: 1300, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Buna Ceremony Set', nameAm: 'የቡና ሥነ ሥርዓት ስብስብ', price: 2400, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Fresh roast Fridays: beans -15%',
        titleAm: 'አርብ የተጠበሰ ቡና -15%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 8 * 86400000),
        views: 310, claims: 52
      }});
    }
    if (u.shop.name === 'Zefmesh Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Special Tibs', nameAm: 'ስፔሻል ጥብስ', price: 460, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Vegetarian Combo', nameAm: 'የጾም ኮምቦ', price: 260, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
