// Additive seed: Flamingo Mall (Kazanchis / Meskel Flower) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 380, rent: 240000, shop: { name: 'Flamingo Supermarket', am: 'ፍላሚንጎ ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 75,  rent: 115000, shop: { name: 'Global Bank Branch', am: 'ግሎባል ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 65,  rent: 100000, shop: { name: 'Flamingo Café & Terrace', am: 'ፍላሚንጎ ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 40,  rent: 80000,  shop: { name: 'Meskel Flower Boutique', am: 'መስቀል አበባ ሱቅ', cat: 'RETAIL', icon: '🌺' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 85,  rent: 95000,  shop: { name: 'Pink Label Fashion', am: 'ፒንክ ሌብል ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 65,  rent: 80000,  shop: { name: 'Little Flamingo Kids', am: 'የልጆች ልብስ', cat: 'RETAIL', icon: '🧒' } },
  { n: 'F1-03', f: 1, area: 60,  rent: 78000,  shop: { name: 'Handbag & Shoe Salon', am: 'ቦርሳ እና ጫማ', cat: 'RETAIL', icon: '👜' } },
  { n: 'F1-04', f: 1, area: 55,  rent: 72000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 95,  rent: 92000,  shop: { name: 'Vision Electronics', am: 'ቪዥን ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📱' } },
  { n: 'F2-02', f: 2, area: 70,  rent: 82000,  shop: { name: 'Homeline Kitchen Store', am: 'የወጥ ቤት እቃ', cat: 'RETAIL', icon: '🍳' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 290, rent: 175000, shop: { name: 'Flamingo Garden Restaurant', am: 'ፍላሚንጎ ጋርደን ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 45,  rent: 58000,  shop: { name: 'Tropicana Juice Bar', am: 'ትሮፒካና ጭማቂ', cat: 'CAFE', icon: '🥤' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 200, rent: 130000, shop: { name: 'Rosa Spa & Beauty', am: 'ሮዛ ስፓ እና ውበት', cat: 'SALON', icon: '💅' } },
  { n: 'F4-02', f: 4, area: 160, rent: 110000, shop: { name: 'Kazanchis Business Suites', am: 'የቢዝነስ ቢሮዎች', cat: 'OFFICE', icon: '💼' } },
  { n: 'F4-03', f: 4, area: 80,  rent: 80000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'flamingo-mall' } });
  if (exists) { console.log('flamingo-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Flamingo Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251973000001', fullName: 'Flamingo Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Flamingo Mall', nameAm: 'ፍላሚንጎ ሞል',
    city: 'Addis Ababa', subCity: 'Kazanchis (Meskel Flower)',
    floors: 5, qrSlug: 'flamingo-mall',
    threeD_style: 'modern', threeD_facadeColor: '#d99aa8',
    threeD_width: 16, threeD_depth: 12,
    signText: 'ፍላሚንጎ ሞል',
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
      orgId: org.id, phone: '+2519' + String(73000100 + shopCount),
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
      reviewCount: 25 + Math.floor(Math.random() * 210),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Meskel Flower Boutique') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Rose Bouquet (12 stems)', nameAm: 'የጽጌረዳ እቅፍ', price: 1000, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Event Flower Arrangement', nameAm: 'የዝግጅት አበባ', price: 8500, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Same-day flower delivery FREE in Kazanchis',
        titleAm: 'በካዛንቺስ የቀኑ ዲሊቨሪ ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 86400000),
        views: 310, claims: 57
      }});
    }
    if (u.shop.name === 'Flamingo Garden Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Garden Lunch Special', nameAm: 'የጋርደን ምሳ', price: 360, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Weekend BBQ Platter', nameAm: 'የቅዳሜ-እሁድ ጥብስ', price: 780, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'UN staff lunch club: 10 lunches 2,999 ETB',
        titleAm: 'የምሳ ክለብ: 10 ምሳ 2,999 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 18 * 86400000),
        views: 280, claims: 43
      }});
    }
    if (u.shop.name === 'Rosa Spa & Beauty') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Bridal Beauty Package', nameAm: 'የሙሽሪት ውበት ጥቅል', price: 7500 } });
    }
    if (u.shop.name === 'Kazanchis Business Suites') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Furnished Office (monthly)', nameAm: 'የተዘጋጀ ቢሮ ወርሃዊ', price: 22000 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
