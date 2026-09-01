// Additive seed: Sarbet Mall (Sarbet / Old Airport) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 380, rent: 230000, shop: { name: 'Sarbet Fresh Market', am: 'ሳርቤት ትኩስ ገበያ', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 75,  rent: 110000, shop: { name: 'Zemen Bank Branch', am: 'ዘመን ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 60,  rent: 95000,  shop: { name: 'Sarbet Corner Café', am: 'ሳርቤት ኮርነር ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 50,  rent: 85000,  shop: { name: 'Lulu Pharmacy', am: 'ሉሉ ፋርማሲ', cat: 'PHARMACY', icon: '💊' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 85,  rent: 95000,  shop: { name: 'Diplomat Fashion House', am: 'ዲፕሎማት ፋሽን', cat: 'RETAIL', icon: '👔' } },
  { n: 'F1-02', f: 1, area: 70,  rent: 85000,  shop: { name: 'Enat Baby Shop', am: 'እናት የልጆች እቃ', cat: 'RETAIL', icon: '🍼' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 78000,  shop: { name: 'Artisan Gift & Décor', am: 'የእጅ ሥራ ስጦታ', cat: 'RETAIL', icon: '🏺' } },
  { n: 'F1-04', f: 1, area: 65,  rent: 80000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 90,  rent: 92000,  shop: { name: 'Optics & Hearing Center', am: 'መነጽር እና መስሚያ', cat: 'RETAIL', icon: '👓' } },
  { n: 'F2-02', f: 2, area: 110, rent: 100000, shop: { name: 'Bright Smile Dental Clinic', am: 'ብራይት ስማይል የጥርስ ክሊኒክ', cat: 'CLINIC', icon: '🦷' } },
  { n: 'F2-03', f: 2, area: 70,  rent: 82000,  shop: { name: 'Sarbet Stationery & Print', am: 'ጽሕፈት መሳሪያ እና ህትመት', cat: 'SERVICE', icon: '🖨️' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 300, rent: 175000, shop: { name: 'Terrace Restaurant Sarbet', am: 'ተራስ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 50,  rent: 60000,  shop: { name: 'Gelato & Waffle Bar', am: 'ጄላቶ እና ዋፍል', cat: 'CAFE', icon: '🧇' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 320, rent: 170000, shop: { name: 'Balance Yoga & Fitness', am: 'ባላንስ ዮጋ እና ጂም', cat: 'GYM', icon: '🧘' } },
  { n: 'F4-02', f: 4, area: 100, rent: 85000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'sarbet-mall' } });
  if (exists) { console.log('sarbet-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Sarbet Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251961000001', fullName: 'Sarbet Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Sarbet Mall', nameAm: 'ሳርቤት ሞል',
    city: 'Addis Ababa', subCity: 'Sarbet (Old Airport)',
    floors: 5, qrSlug: 'sarbet-mall',
    threeD_style: 'modern', threeD_facadeColor: '#ab9cc4',
    threeD_width: 15, threeD_depth: 12,
    signText: 'ሳርቤት ሞል',
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
      orgId: org.id, phone: '+2519' + String(61000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-09-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-09-01'), endDate: new Date('2026-08-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.1 + Math.random() * 0.8) * 10) / 10,
      reviewCount: 20 + Math.floor(Math.random() * 190),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Bright Smile Dental Clinic') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Dental Checkup + Cleaning', nameAm: 'የጥርስ ምርመራ + ጽዳት', price: 2200 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Teeth Whitening', nameAm: 'ጥርስ ማንጻት', price: 6500 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Family dental day Saturdays: kids checkup FREE',
        titleAm: 'ቅዳሜ የቤተሰብ ቀን: የልጆች ምርመራ ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 16 * 86400000),
        views: 240, claims: 37
      }});
    }
    if (u.shop.name === 'Balance Yoga & Fitness') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Yoga Monthly (unlimited)', nameAm: 'ዮጋ ወርሃዊ', price: 2800 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Morning Fitness Plan', nameAm: 'የጠዋት ስፖርት እቅድ', price: 2000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Sunrise yoga week: first class FREE',
        titleAm: 'የጠዋት ዮጋ ሳምንት: የመጀመሪያ ክፍለ ጊዜ ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 10 * 86400000),
        views: 260, claims: 49
      }});
    }
    if (u.shop.name === 'Terrace Restaurant Sarbet') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Sunday Brunch Buffet', nameAm: 'የእሁድ ብራንች ቡፌ', price: 550, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Doro Wot Delivery', nameAm: 'ዶሮ ወጥ ዲሊቨሪ', price: 480, deliverable: true } });
    }
    if (u.shop.name === 'Artisan Gift & Décor') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Handwoven Basket (Mesob)', nameAm: 'መሶብ', price: 2600, deliverable: true } });
    }
    if (u.shop.name === 'Sarbet Corner Café') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Macchiato', nameAm: 'ማኪያቶ', price: 80, deliverable: false } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
