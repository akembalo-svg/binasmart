// Additive seed: Marathon Tower (Gurd Shola) — office tower + showroom — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — showroom level
  { n: 'G-01',  f: 0,  area: 400, rent: 320000, shop: { name: 'Marathon EV & Motor Showroom', am: 'ማራቶን የመኪና ማሳያ', cat: 'RETAIL', icon: '🚗' } },
  { n: 'G-02',  f: 0,  area: 80,  rent: 120000, shop: { name: 'Enat Bank Branch', am: 'እናት ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0,  area: 60,  rent: 95000,  shop: { name: 'Finish Line Café', am: 'ፊኒሽ ላይን ካፌ', cat: 'CAFE', icon: '☕' } },
  // Floor 1
  { n: 'F1-01', f: 1,  area: 90,  rent: 100000, shop: { name: 'Car Accessories & Tyres', am: 'የመኪና እቃዎች እና ጎማ', cat: 'RETAIL', icon: '🛞' } },
  { n: 'F1-02', f: 1,  area: 85,  rent: 95000,  shop: { name: 'Awash Insurance Office', am: 'አዋሽ ኢንሹራንስ', cat: 'OFFICE', icon: '🛡️' } },
  { n: 'F1-03', f: 1,  area: 70,  rent: 85000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2,  area: 280, rent: 175000, shop: { name: 'Podium Restaurant', am: 'ፖዲየም ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F2-02', f: 2,  area: 50,  rent: 60000,  shop: { name: 'Gold Medal Coffee', am: 'የወርቅ ሜዳሊያ ቡና', cat: 'CAFE', icon: '🥇' } },
  // Floor 3
  { n: 'F3-01', f: 3,  area: 350, rent: 200000, shop: { name: 'Marathon Runners Gym', am: 'ማራቶን ጂም', cat: 'GYM', icon: '🏃' } },
  // Offices
  { n: 'F5-01', f: 5,  area: 220, rent: 145000, shop: { name: 'SafariCom Ethiopia Office', am: 'ሳፋሪኮም ቢሮ', cat: 'OFFICE', icon: '📡' } },
  { n: 'F6-01', f: 6,  area: 200, rent: 135000, shop: { name: 'Kifiya Fintech Solutions', am: 'ክፍያ ፊንቴክ', cat: 'OFFICE', icon: '💳' } },
  { n: 'F8-01', f: 8,  area: 210, rent: 140000, shop: { name: 'Elite Engineering Consult', am: 'ኤሊት ኢንጂነሪንግ', cat: 'OFFICE', icon: '⚙️' } },
  { n: 'F10-01', f: 10, area: 250, rent: 160000, shop: { name: 'Hub64 Co-working Space', am: 'ሀብ64 የጋራ ሥራ ቦታ', cat: 'OFFICE', icon: '💻' } },
  { n: 'F12-01', f: 12, area: 200, rent: 150000, shop: { name: 'Sky Events & Rooftop Lounge', am: 'ስካይ ላውንጅ', cat: 'SERVICE', icon: '🌆' } },
  { n: 'F12-02', f: 12, area: 90,  rent: 95000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'marathon-tower' } });
  if (exists) { console.log('marathon-tower already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Marathon Tower Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251971000001', fullName: 'Marathon Tower Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Marathon Tower', nameAm: 'ማራቶን ታወር',
    city: 'Addis Ababa', subCity: 'Gurd Shola',
    floors: 14, qrSlug: 'marathon-tower',
    threeD_style: 'glass', threeD_facadeColor: '#9aa3ad',
    threeD_width: 14, threeD_depth: 12,
    signText: 'ማራቶን ታወር',
    marketplaceEnabled: true
  }});

  let shopCount = 0;
  for (const u of UNITS) {
    const unit = await prisma.unit.create({ data: {
      buildingId: building.id, number: u.n, floor: u.f,
      areaSqm: u.area, monthlyRent: u.rent,
      status: u.shop ? 'OCCUPIED' : 'VACANT',
      unitType: u.f >= 5 ? 'OFFICE' : 'SHOP'
    }});
    if (!u.shop) continue;

    const tUser = await prisma.user.create({ data: {
      orgId: org.id, phone: '+2519' + String(71000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-02-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-02-15'), endDate: new Date('2026-02-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.1 + Math.random() * 0.8) * 10) / 10,
      reviewCount: 30 + Math.floor(Math.random() * 220),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Marathon EV & Motor Showroom') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'EV Test Drive Booking', nameAm: 'የኤሌክትሪክ መኪና ሙከራ', price: 0 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Hyundai Service Package (annual)', nameAm: 'ዓመታዊ የጥገና ጥቅል', price: 45000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'EV week: free home-charger with every order',
        titleAm: 'የEV ሳምንት: ከእያንዳንዱ ትዕዛዝ ጋር ነፃ ቻርጀር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 86400000),
        views: 480, claims: 29
      }});
    }
    if (u.shop.name === 'Hub64 Co-working Space') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Hot Desk (monthly)', nameAm: 'ተንቀሳቃሽ ዴስክ ወርሃዊ', price: 6500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Private Office (4p, monthly)', nameAm: 'የግል ቢሮ ለ4 ሰው', price: 28000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Startups: first month hot desk 50% off',
        titleAm: 'ለስታርታፖች: የመጀመሪያ ወር 50% ቅናሽ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 20 * 86400000),
        views: 340, claims: 61
      }});
    }
    if (u.shop.name === 'Marathon Runners Gym') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Monthly Membership', nameAm: 'ወርሃዊ አባልነት', price: 2400 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Running Club (weekly coached)', nameAm: 'የሩጫ ክለብ', price: 1200 } });
    }
    if (u.shop.name === 'Sky Events & Rooftop Lounge') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Rooftop Event Evening (100p)', nameAm: 'የጣራ ላይ ዝግጅት', price: 95000 } });
    }
    if (u.shop.name === 'Podium Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Office Lunch Delivery', nameAm: 'የቢሮ ምሳ ዲሊቨሪ', price: 320, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
