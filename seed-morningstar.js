// Additive seed: Morning Star Mall (Bole Road) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 140, rent: 160000, shop: { name: 'Star Electronics Plaza', am: 'ስታር ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📺' } },
  { n: 'G-02',  f: 0, area: 75,  rent: 115000, shop: { name: 'Morning Star Café', am: 'ሞርኒንግ ስታር ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-03',  f: 0, area: 55,  rent: 95000,  shop: { name: 'Gold Star Jewelry', am: 'ጎልድ ስታር ጌጣጌጥ', cat: 'RETAIL', icon: '💍' } },
  { n: 'G-04',  f: 0, area: 45,  rent: 85000,  shop: { name: 'Mobile Corner', am: 'ሞባይል ኮርነር', cat: 'RETAIL', icon: '📱' } },
  // Floor 1 — boutique row
  { n: 'F1-01', f: 1, area: 60,  rent: 80000,  shop: { name: 'Bella Boutique', am: 'ቤላ ቡቲክ', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 55,  rent: 75000,  shop: { name: 'Star Kids Wear', am: 'የልጆች ልብስ', cat: 'RETAIL', icon: '🧒' } },
  { n: 'F1-03', f: 1, area: 55,  rent: 75000,  shop: { name: 'Leather & Bags Addis', am: 'የቆዳ እቃዎች', cat: 'RETAIL', icon: '👜' } },
  { n: 'F1-04', f: 1, area: 50,  rent: 70000,  shop: { name: 'Perfume Corner', am: 'ሽቶ ኮርነር', cat: 'RETAIL', icon: '🌸' } },
  { n: 'F1-05', f: 1, area: 60,  rent: 78000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 90,  rent: 95000,  shop: { name: 'Curtain & Fabric House', am: 'መጋረጃ እና ጨርቅ', cat: 'RETAIL', icon: '🧵' } },
  { n: 'F2-02', f: 2, area: 70,  rent: 85000,  shop: { name: 'Star Beauty Salon', am: 'ስታር የውበት ሳሎን', cat: 'SALON', icon: '💇‍♀️' } },
  { n: 'F2-03', f: 2, area: 65,  rent: 80000,  shop: { name: 'Tailor & Design Studio', am: 'ልብስ ስፌት ስቱዲዮ', cat: 'SERVICE', icon: '✂️' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 280, rent: 170000, shop: { name: 'Star View Restaurant', am: 'ስታር ቪው ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 55,  rent: 65000,  shop: { name: 'Game & Internet Zone', am: 'ጌም እና ኢንተርኔት', cat: 'SERVICE', icon: '🎮' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 160, rent: 110000, shop: { name: 'Sunrise Language School', am: 'የቋንቋ ትምህርት ቤት', cat: 'OFFICE', icon: '📖' } },
  { n: 'F4-02', f: 4, area: 90,  rent: 85000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'morning-star-mall' } });
  if (exists) { console.log('morning-star-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Morning Star Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251957000001', fullName: 'Morning Star Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Morning Star Mall', nameAm: 'ሞርኒንግ ስታር ሞል',
    city: 'Addis Ababa', subCity: 'Bole Road',
    floors: 5, qrSlug: 'morning-star-mall',
    threeD_style: 'modern', threeD_facadeColor: '#d9b46b',
    threeD_width: 15, threeD_depth: 12,
    signText: 'ሞርኒንግ ስታር',
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
      orgId: org.id, phone: '+2519' + String(57000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-04-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 20 + Math.floor(Math.random() * 180),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Bella Boutique') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Evening Dress Collection', nameAm: 'የምሽት ቀሚሶች', price: 3800, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Summer Scarf Set', nameAm: 'የበጋ ሻርፕ ስብስብ', price: 950, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Season clear-out: dresses -40%',
        titleAm: 'የወቅት ማጠናቀቂያ: ቀሚሶች -40%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 6 * 86400000),
        views: 275, claims: 49
      }});
    }
    if (u.shop.name === 'Morning Star Café') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Full Breakfast (chechebsa + juice)', nameAm: 'ሙሉ ቁርስ (ጨጨብሳ + ጭማቂ)', price: 240, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Macchiato', nameAm: 'ማኪያቶ', price: 85, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Early bird 7–9am: breakfast 199 ETB',
        titleAm: 'የጠዋት ቅናሽ 7–9: ቁርስ 199 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 10 * 86400000),
        views: 330, claims: 74
      }});
    }
    if (u.shop.name === 'Tailor & Design Studio') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Custom Suit Tailoring', nameAm: 'ሱፍ በልክ', price: 6500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Habesha Kemis (custom)', nameAm: 'የሀበሻ ቀሚስ በልክ', price: 9000 } });
    }
    if (u.shop.name === 'Star View Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Mixed Grill Platter', nameAm: 'ድብልቅ ጥብስ', price: 520, deliverable: true } });
    }
    if (u.shop.name === 'Sunrise Language School') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'English Course (3 months)', nameAm: 'የእንግሊዝኛ ኮርስ (3 ወር)', price: 5500 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
