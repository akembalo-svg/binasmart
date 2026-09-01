// Additive seed: Friendship Mall (Bole Road) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 480, rent: 280000, shop: { name: 'Friendship Supermarket', am: 'ፍሬንድሺፕ ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 85,  rent: 130000, shop: { name: 'Dashen Bank Branch', am: 'ዳሽን ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 65,  rent: 105000, shop: { name: 'Garden Café', am: 'ጋርደን ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 55,  rent: 95000,  shop: { name: 'Friendship Bakery', am: 'ፍሬንድሺፕ ዳቦ ቤት', cat: 'CAFE', icon: '🥐' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 95,  rent: 110000, shop: { name: 'Ladies Fashion Gallery', am: 'የሴቶች ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 70,  rent: 90000,  shop: { name: 'Cosmetics & Care', am: 'ኮስሞቲክስ', cat: 'RETAIL', icon: '💄' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 85000,  shop: { name: 'Smart Phone Center', am: 'ስማርት ስልክ ማዕከል', cat: 'RETAIL', icon: '📱' } },
  { n: 'F1-04', f: 1, area: 75,  rent: 90000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 200, rent: 150000, shop: { name: 'Modern Furniture Gallery', am: 'ዘመናዊ የቤት እቃ', cat: 'RETAIL', icon: '🛋️' } },
  { n: 'F2-02', f: 2, area: 110, rent: 105000, shop: { name: 'Carpet & Curtain House', am: 'ምንጣፍ እና መጋረጃ', cat: 'RETAIL', icon: '🧶' } },
  { n: 'F2-03', f: 2, area: 90,  rent: 95000,  shop: { name: 'Kitchen & Homeware', am: 'የወጥ ቤት እቃዎች', cat: 'RETAIL', icon: '🍳' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 320, rent: 190000, shop: { name: 'Friendship Restaurant', am: 'ፍሬንድሺፕ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 160, rent: 120000, shop: { name: 'Little Stars Kids Corner', am: 'የልጆች ማዕዘን', cat: 'SERVICE', icon: '🎈' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 220, rent: 140000, shop: { name: 'Excel Training Center', am: 'ኤክሴል ማሰልጠኛ', cat: 'OFFICE', icon: '🎓' } },
  { n: 'F4-02', f: 4, area: 100, rent: 90000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'friendship-mall' } });
  if (exists) { console.log('friendship-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Friendship Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251955000001', fullName: 'Friendship Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Friendship Mall', nameAm: 'ፍሬንድሺፕ ሞል',
    city: 'Addis Ababa', subCity: 'Bole Road',
    floors: 5, qrSlug: 'friendship-mall',
    threeD_style: 'modern', threeD_facadeColor: '#bcab8e',
    threeD_width: 16, threeD_depth: 12,
    signText: 'ፍሬንድሺፕ ሞል',
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
      orgId: org.id, phone: '+2519' + String(55000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-06-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-06-01'), endDate: new Date('2026-05-31'),
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

    if (u.shop.name === 'Friendship Supermarket') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Weekly Family Basket', nameAm: 'የሳምንት የቤተሰብ ቅርጫት', price: 3500, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Imported Cheese Selection', nameAm: 'የውጭ አይብ', price: 850, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Family basket delivered FREE this week',
        titleAm: 'የቤተሰብ ቅርጫት በነፃ ይደርስዎታል',
        startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86400000),
        views: 450, claims: 71
      }});
    }
    if (u.shop.name === 'Friendship Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Beyaynetu Platter', nameAm: 'በያይነቱ', price: 280, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Doro Wot Special', nameAm: 'ዶሮ ወጥ ስፔሻል', price: 520, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Lunch combo + juice 320 ETB (12–2pm)',
        titleAm: 'የምሳ ኮምቦ + ጭማቂ 320 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 9 * 86400000),
        views: 380, claims: 66
      }});
    }
    if (u.shop.name === 'Friendship Bakery') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Fresh Croissant', nameAm: 'ክሮሳንት', price: 90, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Honey Bread (Ambasha)', nameAm: 'አምባሻ በማር', price: 150, deliverable: true } });
    }
    if (u.shop.name === 'Excel Training Center') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Computer Course (1 month)', nameAm: 'የኮምፒውተር ኮርስ', price: 4500 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
