// Additive seed: Dembel City Center (Bole Road) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 550, rent: 320000, shop: { name: 'Shoa Supermarket', am: 'ሸዋ ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 95,  rent: 145000, shop: { name: 'Berhan Bank Branch', am: 'ብርሃን ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 70,  rent: 110000, shop: { name: 'Dembel Café & Pastry', am: 'ደንበል ካፌ እና ኬክ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 35,  rent: 70000,  shop: { name: 'Bloom Flower Shop', am: 'የአበባ ሱቅ', cat: 'RETAIL', icon: '💐' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 65,  rent: 95000,  shop: { name: 'Diamond Jewelry Palace', am: 'የአልማዝ ጌጣጌጥ', cat: 'RETAIL', icon: '💎' } },
  { n: 'F1-02', f: 1, area: 50,  rent: 80000,  shop: { name: 'Swiss Watch Gallery', am: 'የሰዓት ማዕከል', cat: 'RETAIL', icon: '⌚' } },
  { n: 'F1-03', f: 1, area: 80,  rent: 95000,  shop: { name: 'Milano Fashion', am: 'ሚላኖ ፋሽን', cat: 'RETAIL', icon: '👔' } },
  { n: 'F1-04', f: 1, area: 75,  rent: 90000,  shop: { name: 'Queen Habesha Boutique', am: 'ንግሥት የሀበሻ ልብስ', cat: 'RETAIL', icon: '👗' } },
  // Floor 2
  { n: 'F2-01', f: 2, area: 120, rent: 120000, shop: { name: 'City Electronics', am: 'ሲቲ ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '💻' } },
  { n: 'F2-02', f: 2, area: 85,  rent: 90000,  shop: { name: 'BookWorld & Stationery', am: 'መጻሕፍት እና ጽሕፈት መሳሪያ', cat: 'RETAIL', icon: '📚' } },
  { n: 'F2-03', f: 2, area: 55,  rent: 75000,  shop: { name: 'Vision Optics', am: 'የመነጽር ማዕከል', cat: 'RETAIL', icon: '👓' } },
  { n: 'F2-04', f: 2, area: 70,  rent: 85000,  shop: null },
  // Floor 3
  { n: 'F3-01', f: 3, area: 400, rent: 230000, shop: { name: 'Metro Food Court', am: 'ሜትሮ ፉድ ኮርት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 45,  rent: 60000,  shop: { name: 'Gelato Ice Cream', am: 'ጄላቶ አይስ ክሬም', cat: 'CAFE', icon: '🍦' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 600, rent: 300000, shop: { name: 'Dembel Cinema', am: 'ደንበል ሲኒማ', cat: 'SERVICE', icon: '🎬' } },
  // Floor 5–7 offices
  { n: 'F5-01', f: 5, area: 200, rent: 130000, shop: { name: 'Nile Insurance Office', am: 'ናይል ኢንሹራንስ', cat: 'OFFICE', icon: '🛡️' } },
  { n: 'F6-01', f: 6, area: 180, rent: 120000, shop: { name: 'Selam Travel & Tours', am: 'ሰላም ጉዞ እና ቱሪዝም', cat: 'OFFICE', icon: '🧳' } },
  { n: 'F7-01', f: 7, area: 160, rent: 115000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'dembel-city-center' } });
  if (exists) { console.log('dembel-city-center already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Dembel City Center Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251958000001', fullName: 'Dembel Management Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Dembel City Center', nameAm: 'ደንበል ሲቲ ሴንተር',
    city: 'Addis Ababa', subCity: 'Bole Road',
    floors: 8, qrSlug: 'dembel-city-center',
    threeD_style: 'modern', threeD_facadeColor: '#9cb89a',
    threeD_width: 19, threeD_depth: 13,
    signText: 'ደንበል ሲቲ ሴንተር',
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
      orgId: org.id, phone: '+2519' + String(58000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-03-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-03-01'), endDate: new Date('2026-02-28'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 45 + Math.floor(Math.random() * 320),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Dembel Cinema') {
      for (const [name, am, price] of [
        ['Movie Ticket', 'የፊልም ትኬት', 380],
        ['Family Pack (4 tickets + popcorn)', 'የቤተሰብ ጥቅል', 1700],
        ['Premiere Night Seat', 'የፕሪሚየር መቀመጫ', 700]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 140) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Sunday family pack -25%',
        titleAm: 'እሁድ የቤተሰብ ጥቅል -25%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 8 * 86400000),
        views: 540, claims: 92
      }});
    }
    if (u.shop.name === 'Dembel Café & Pastry') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Signature Cake Slice', nameAm: 'ልዩ ኬክ', price: 190, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Macchiato', nameAm: 'ማኪያቶ', price: 95, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Cake + macchiato combo 249 ETB',
        titleAm: 'ኬክ + ማኪያቶ 249 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86400000),
        views: 390, claims: 81
      }});
    }
    if (u.shop.name === 'Metro Food Court') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Executive Lunch', nameAm: 'የሥራ ምሳ', price: 380, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Pizza Family Size', nameAm: 'ትልቅ ፒዛ', price: 650, deliverable: true } });
    }
    if (u.shop.name === 'Selam Travel & Tours') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Lalibela Weekend Package', nameAm: 'የላሊበላ የቅዳሜ-እሁድ ጉዞ', price: 14500 } });
    }
    if (u.shop.name === 'Bloom Flower Shop') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Rose Bouquet (12)', nameAm: 'የጽጌረዳ እቅፍ', price: 1100, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
