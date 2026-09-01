// Additive seed: Bole Medhanealem Mall — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 430, rent: 260000, shop: { name: 'Medhanealem Supermarket', am: 'መድኃኔዓለም ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 85,  rent: 125000, shop: { name: 'Amhara Bank Branch', am: 'አማራ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 65,  rent: 105000, shop: { name: 'Selam Café & Pastry', am: 'ሰላም ካፌ እና ኬክ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 50,  rent: 90000,  shop: { name: 'Flower & Church Goods', am: 'አበባ እና የቤተ ክርስቲያን እቃዎች', cat: 'RETAIL', icon: '🕯️' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 90,  rent: 100000, shop: { name: 'Nardos Fashion Boutique', am: 'ናርዶስ ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 70,  rent: 88000,  shop: { name: 'Habesha Wedding House', am: 'የሀበሻ ሰርግ ቤት', cat: 'RETAIL', icon: '💒' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 80000,  shop: { name: 'Gold & Silver Corner', am: 'ወርቅ እና ብር', cat: 'RETAIL', icon: '💍' } },
  { n: 'F1-04', f: 1, area: 55,  rent: 75000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 100, rent: 105000, shop: { name: 'Digital World Electronics', am: 'ዲጂታል ወርልድ', cat: 'RETAIL', icon: '💻' } },
  { n: 'F2-02', f: 2, area: 70,  rent: 85000,  shop: { name: 'Memory Photo Studio', am: 'ሜሞሪ ፎቶ ስቱዲዮ', cat: 'SERVICE', icon: '📸' } },
  { n: 'F2-03', f: 2, area: 65,  rent: 80000,  shop: { name: 'Baby & Toys Corner', am: 'የልጆች እቃ እና መጫወቻ', cat: 'RETAIL', icon: '🧸' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 310, rent: 180000, shop: { name: 'Medhanealem Family Restaurant', am: 'መድኃኔዓለም ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 50,  rent: 60000,  shop: { name: 'Tsion Juice & Smoothies', am: 'ጽዮን ጭማቂ', cat: 'CAFE', icon: '🥤' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 300, rent: 165000, shop: { name: 'Champion Fitness Club', am: 'ቻምፒዮን ጂም', cat: 'GYM', icon: '🏋️' } },
  { n: 'F4-02', f: 4, area: 100, rent: 90000,  shop: { name: 'Eden Beauty Salon', am: 'ኤደን የውበት ሳሎን', cat: 'SALON', icon: '💇‍♀️' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 180, rent: 115000, shop: { name: 'Wisdom Tutoring Center', am: 'ጥበብ ማጠናከሪያ ትምህርት', cat: 'OFFICE', icon: '📖' } },
  { n: 'F5-02', f: 5, area: 95,  rent: 85000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'bole-medhanealem-mall' } });
  if (exists) { console.log('bole-medhanealem-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Bole Medhanealem Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251969000001', fullName: 'Medhanealem Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Bole Medhanealem Mall', nameAm: 'ቦሌ መድኃኔዓለም ሞል',
    city: 'Addis Ababa', subCity: 'Bole Medhanealem',
    floors: 6, qrSlug: 'bole-medhanealem-mall',
    threeD_style: 'modern', threeD_facadeColor: '#9d7f9e',
    threeD_width: 17, threeD_depth: 13,
    signText: 'መድኃኔዓለም ሞል',
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
      orgId: org.id, phone: '+2519' + String(69000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-04-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-04-15'), endDate: new Date('2026-04-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 25 + Math.floor(Math.random() * 240),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Habesha Wedding House') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Bridal Habesha Kemis (custom)', nameAm: 'የሙሽራ ሀበሻ ቀሚስ', price: 18000, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Groom Suit Rental', nameAm: 'የሙሽራ ሱፍ ኪራይ', price: 4500, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Wedding season: full couple package -15%',
        titleAm: 'የሰርግ ወቅት: የሙሽራ እና ሙሽሪት ጥቅል -15%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 21 * 86400000),
        views: 350, claims: 46
      }});
    }
    if (u.shop.name === 'Memory Photo Studio') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Wedding Photography (full day)', nameAm: 'የሰርግ ፎቶግራፍ', price: 25000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Family Portrait Session', nameAm: 'የቤተሰብ ፎቶ', price: 2200 } });
    }
    if (u.shop.name === 'Champion Fitness Club') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Monthly Membership', nameAm: 'ወርሃዊ አባልነት', price: 2000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Morning hours (6–9am): membership 1,500 ETB',
        titleAm: 'የጠዋት ሰዓታት: አባልነት 1,500 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 15 * 86400000),
        views: 280, claims: 52
      }});
    }
    if (u.shop.name === 'Medhanealem Family Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Sunday Family Feast (6p)', nameAm: 'የእሁድ የቤተሰብ ግብዣ', price: 1500, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Fasting Beyaynetu', nameAm: 'የጾም በያይነቱ', price: 240, deliverable: true } });
    }
    if (u.shop.name === 'Selam Café & Pastry') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Holiday Cake (custom)', nameAm: 'የበዓል ኬክ', price: 1600, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
