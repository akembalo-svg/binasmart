// Additive seed: Abenezer Mall (Megenagna) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 420, rent: 250000, shop: { name: 'Abenezer Supermarket', am: 'አቤኔዘር ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 80,  rent: 120000, shop: { name: 'Coop Bank Branch', am: 'ኮፕ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 60,  rent: 100000, shop: { name: 'Abenezer Café', am: 'አቤኔዘር ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 45,  rent: 85000,  shop: { name: 'Fresh Bakery Corner', am: 'ትኩስ ዳቦ ቤት', cat: 'CAFE', icon: '🍞' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 90,  rent: 100000, shop: { name: 'Elegant Ladies Wear', am: 'የሴቶች ልብስ', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 70,  rent: 88000,  shop: { name: 'Classic Menswear', am: 'የወንዶች ልብስ', cat: 'RETAIL', icon: '👔' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 80000,  shop: { name: 'Shoe & Bag Gallery', am: 'ጫማ እና ቦርሳ', cat: 'RETAIL', icon: '👜' } },
  { n: 'F1-04', f: 1, area: 55,  rent: 75000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 100, rent: 105000, shop: { name: 'Techno Electronics', am: 'ቴክኖ ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '💻' } },
  { n: 'F2-02', f: 2, area: 75,  rent: 85000,  shop: { name: 'Kitchen Plus Homeware', am: 'የወጥ ቤት እቃዎች', cat: 'RETAIL', icon: '🍳' } },
  { n: 'F2-03', f: 2, area: 60,  rent: 78000,  shop: { name: 'Toy & Gift Land', am: 'መጫወቻ እና ስጦታ', cat: 'RETAIL', icon: '🎁' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 320, rent: 185000, shop: { name: 'Abenezer Restaurant', am: 'አቤኔዘር ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 55,  rent: 65000,  shop: { name: 'Aroma Coffee House', am: 'አሮማ ቡና ቤት', cat: 'CAFE', icon: '🫖' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 250, rent: 150000, shop: { name: 'Little Angels Kids Play', am: 'የልጆች መጫወቻ ማዕከል', cat: 'SERVICE', icon: '🎠' } },
  { n: 'F4-02', f: 4, area: 90,  rent: 90000,  shop: { name: 'Royal Beauty & Spa', am: 'ሮያል ውበት እና ስፓ', cat: 'SALON', icon: '💅' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 200, rent: 125000, shop: { name: 'Grace Training Institute', am: 'ግሬስ ማሰልጠኛ', cat: 'OFFICE', icon: '🎓' } },
  { n: 'F5-02', f: 5, area: 110, rent: 95000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'abenezer-mall' } });
  if (exists) { console.log('abenezer-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Abenezer Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251960000001', fullName: 'Abenezer Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Abenezer Mall', nameAm: 'አቤኔዘር ሞል',
    city: 'Addis Ababa', subCity: 'Megenagna',
    floors: 6, qrSlug: 'abenezer-mall',
    threeD_style: 'modern', threeD_facadeColor: '#c98a7a',
    threeD_width: 16, threeD_depth: 13,
    signText: 'አቤኔዘር ሞል',
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
      orgId: org.id, phone: '+2519' + String(60000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-01-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-01-01'), endDate: new Date('2026-12-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 25 + Math.floor(Math.random() * 220),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Little Angels Kids Play') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Kids Day Pass', nameAm: 'የልጆች የቀን መግቢያ', price: 400 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Birthday Party Package', nameAm: 'የልደት ፓርቲ ጥቅል', price: 12000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'School-break special: day pass 299 ETB',
        titleAm: 'የትምህርት እረፍት ልዩ: የቀን መግቢያ 299 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 12 * 86400000),
        views: 380, claims: 88
      }});
    }
    if (u.shop.name === 'Abenezer Café') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Macchiato', nameAm: 'ማኪያቶ', price: 85, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Breakfast Ful Special', nameAm: 'ፉል ስፔሻል', price: 180, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Buy 5 macchiatos → 6th free (loyalty)',
        titleAm: '5 ማኪያቶ ይግዙ → 6ኛው ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 86400000),
        views: 290, claims: 61
      }});
    }
    if (u.shop.name === 'Abenezer Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Kitfo Firfir Combo', nameAm: 'ክትፎ ፍርፍር ኮምቦ', price: 430, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Family Platter (4p)', nameAm: 'የቤተሰብ በያይነቱ', price: 980, deliverable: true } });
    }
    if (u.shop.name === 'Techno Electronics') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Laptop (Core i5)', nameAm: 'ላፕቶፕ Core i5', price: 55000, deliverable: true } });
    }
    if (u.shop.name === 'Grace Training Institute') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Accounting Software Course', nameAm: 'የአካውንቲንግ ሶፍትዌር ኮርስ', price: 4800 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
