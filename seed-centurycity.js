// Additive seed: Century City Mall (CMC, Bole) — distinct from Century Mall Gerji — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 460, rent: 270000, shop: { name: 'City Fresh Hypermarket', am: 'ሲቲ ፍሬሽ ሃይፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 85,  rent: 120000, shop: { name: 'Bank of Abyssinia Branch', am: 'አቢሲኒያ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 65,  rent: 100000, shop: { name: 'City Roast Café', am: 'ሲቲ ሮስት ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 45,  rent: 85000,  shop: { name: 'Sweet House Chocolatier', am: 'ጣፋጭ ቤት ቸኮሌት', cat: 'RETAIL', icon: '🍫' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 95,  rent: 100000, shop: { name: 'Urban Style Fashion', am: 'አርባን ስታይል ፋሽን', cat: 'RETAIL', icon: '👕' } },
  { n: 'F1-02', f: 1, area: 75,  rent: 88000,  shop: { name: 'Silk Road Boutique', am: 'ሲልክ ሮድ ቡቲክ', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 78000,  shop: { name: 'Watch & Accessory Bar', am: 'ሰዓት እና አክሰሰሪ', cat: 'RETAIL', icon: '⌚' } },
  { n: 'F1-04', f: 1, area: 65,  rent: 80000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 110, rent: 108000, shop: { name: 'Smart Home Electronics', am: 'ስማርት ሆም ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📺' } },
  { n: 'F2-02', f: 2, area: 80,  rent: 90000,  shop: { name: 'Sports & Outdoor Gear', am: 'የስፖርት እቃዎች', cat: 'RETAIL', icon: '⛺' } },
  { n: 'F2-03', f: 2, area: 70,  rent: 82000,  shop: { name: 'Green Life Pharmacy', am: 'ግሪን ላይፍ ፋርማሲ', cat: 'PHARMACY', icon: '💊' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 350, rent: 195000, shop: { name: 'City Terrace Food Hall', am: 'ሲቲ ተራስ የምግብ አዳራሽ', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 55,  rent: 62000,  shop: { name: 'Boba & Bubble Tea', am: 'ቦባ ሻይ', cat: 'CAFE', icon: '🧋' } },
  // Floor 4 — family entertainment
  { n: 'F4-01', f: 4, area: 450, rent: 240000, shop: { name: 'FunPark Roller & Games', am: 'ፈንፓርክ ሮለር እና ጨዋታዎች', cat: 'SERVICE', icon: '🎡' } },
  { n: 'F4-02', f: 4, area: 150, rent: 110000, shop: { name: 'VR & Laser Tag Arena', am: 'VR እና ሌዘር ታግ', cat: 'SERVICE', icon: '🔫' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 300, rent: 170000, shop: { name: 'City Cinema Twin Screens', am: 'ሲቲ ሲኒማ', cat: 'SERVICE', icon: '🎬' } },
  { n: 'F5-02', f: 5, area: 90,  rent: 85000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'century-city-mall' } });
  if (exists) { console.log('century-city-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Century City Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251970000001', fullName: 'Century City Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Century City Mall', nameAm: 'ሴንቸሪ ሲቲ ሞል',
    city: 'Addis Ababa', subCity: 'CMC, Bole',
    floors: 7, qrSlug: 'century-city-mall',
    threeD_style: 'modern', threeD_facadeColor: '#8fae6f',
    threeD_width: 18, threeD_depth: 14,
    signText: 'ሴንቸሪ ሲቲ ሞል',
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
      orgId: org.id, phone: '+2519' + String(70000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-03-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-03-15'), endDate: new Date('2026-03-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 30 + Math.floor(Math.random() * 260),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'FunPark Roller & Games') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Roller Skating (1h + skates)', nameAm: 'ሮለር ስኬቲንግ (1 ሰዓት)', price: 450 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Kids Birthday Package', nameAm: 'የልደት ጥቅል', price: 9500 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Family Sunday: skate + games bundle -30%',
        titleAm: 'የቤተሰብ እሁድ: ስኬት + ጨዋታ -30%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 12 * 86400000),
        views: 420, claims: 95
      }});
    }
    if (u.shop.name === 'VR & Laser Tag Arena') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'VR Session (30min)', nameAm: 'VR ጨዋታ (30 ደቂቃ)', price: 350 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Laser Tag Match (team)', nameAm: 'ሌዘር ታግ ጨዋታ', price: 500 } });
    }
    if (u.shop.name === 'City Cinema Twin Screens') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Movie Ticket', nameAm: 'የፊልም ትኬት', price: 300, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Late show Thursdays: 2 tickets 449 ETB',
        titleAm: 'ሐሙስ ማታ: 2 ትኬት 449 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 10 * 86400000),
        views: 360, claims: 67
      }});
    }
    if (u.shop.name === 'City Terrace Food Hall') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Mixed Cuisine Combo', nameAm: 'ድብልቅ ምግብ ኮምቦ', price: 390, deliverable: true } });
    }
    if (u.shop.name === 'Sweet House Chocolatier') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Gift Chocolate Box', nameAm: 'የስጦታ ቸኮሌት', price: 1200, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
