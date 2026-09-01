// Additive seed: Century Mall (Gerji, Bole) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 520, rent: 300000, shop: { name: 'Century Supermarket', am: 'ሴንቸሪ ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-02',  f: 0, area: 90,  rent: 140000, shop: { name: 'Awash Bank Branch', am: 'አዋሽ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 60,  rent: 100000, shop: { name: 'Century Café', am: 'ሴንቸሪ ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 50,  rent: 95000,  shop: { name: 'Perfume & Cosmetics', am: 'ሽቶ እና ኮስሞቲክስ', cat: 'RETAIL', icon: '🌸' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 100, rent: 115000, shop: { name: 'Gold & Jewelry House', am: 'የወርቅ ቤት', cat: 'RETAIL', icon: '💍' } },
  { n: 'F1-02', f: 1, area: 85,  rent: 105000, shop: { name: 'Men’s Fashion Hub', am: 'የወንዶች ፋሽን', cat: 'RETAIL', icon: '👔' } },
  { n: 'F1-03', f: 1, area: 85,  rent: 105000, shop: { name: 'Habesha Kemis Boutique', am: 'የሀበሻ ቀሚስ ሱቅ', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-04', f: 1, area: 70,  rent: 90000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 120, rent: 125000, shop: { name: 'Electronics World', am: 'ኤሌክትሮኒክስ ወርልድ', cat: 'RETAIL', icon: '💻' } },
  { n: 'F2-02', f: 2, area: 80,  rent: 95000,  shop: { name: 'Home & Furniture Deco', am: 'የቤት እቃ እና ጌጣጌጥ', cat: 'RETAIL', icon: '🛋️' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 420, rent: 240000, shop: { name: 'Century Food Court', am: 'ሴንቸሪ ፉድ ኮርት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 50,  rent: 65000,  shop: { name: 'Sweet Corner Pastry', am: 'ጣፋጭ ኮርነር', cat: 'CAFE', icon: '🧁' } },
  // Floor 4
  { n: 'F4-01', f: 4, area: 650, rent: 330000, shop: { name: 'Century Cinema', am: 'ሴንቸሪ ሲኒማ', cat: 'SERVICE', icon: '🎬' } },
  { n: 'F4-02', f: 4, area: 200, rent: 150000, shop: { name: 'Kids Play Land', am: 'የልጆች መጫወቻ ስፍራ', cat: 'SERVICE', icon: '🎠' } },
  // Floor 5
  { n: 'F5-01', f: 5, area: 380, rent: 200000, shop: { name: 'Olympia Fitness Center', am: 'ኦሎምፒያ ጂም', cat: 'GYM', icon: '💪' } },
  { n: 'F5-02', f: 5, area: 110, rent: 100000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'century-mall' } });
  if (exists) { console.log('century-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Century Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251954000001', fullName: 'Century Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Century Mall', nameAm: 'ሴንቸሪ ሞል',
    city: 'Addis Ababa', subCity: 'Gerji, Bole',
    floors: 6, qrSlug: 'century-mall',
    threeD_style: 'glass', threeD_facadeColor: '#7fa8c9',
    threeD_width: 18, threeD_depth: 14,
    signText: 'ሴንቸሪ ሞል',
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
      orgId: org.id, phone: '+2519' + String(54000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-07-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-07-01'), endDate: new Date('2026-06-30'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 35 + Math.floor(Math.random() * 260),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Century Cinema') {
      for (const [name, am, price] of [
        ['Movie Ticket', 'የፊልም ትኬት', 400],
        ['Couple Seat + Combo', 'የጥንድ መቀመጫ + ኮምቦ', 1100],
        ['Popcorn Large', 'ትልቅ ፖፕኮርን', 200]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 120) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Midweek movie night: 2 tickets 599 ETB',
        titleAm: 'የሳምንት አጋማሽ ፊልም: 2 ትኬት 599 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 5 * 86400000),
        views: 610, claims: 98
      }});
    }
    if (u.shop.name === 'Olympia Fitness Center') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Monthly Membership', nameAm: 'ወርሃዊ አባልነት', price: 2500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Personal Training (8 sessions)', nameAm: 'የግል ስልጠና (8 ጊዜ)', price: 6000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'New year shape-up: join with a friend -30%',
        titleAm: 'ከጓደኛዎ ጋር ይመዝገቡ -30%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 12 * 86400000),
        views: 290, claims: 44
      }});
    }
    if (u.shop.name === 'Century Food Court') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Kitfo Special', nameAm: 'ክትፎ ስፔሻል', price: 480, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Burger + Fries', nameAm: 'በርገር + ፍራይስ', price: 350, deliverable: true } });
    }
    if (u.shop.name === 'Sweet Corner Pastry') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Black Forest Slice', nameAm: 'ብላክ ፎረስት ኬክ', price: 160, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Birthday Cake (1kg)', nameAm: 'የልደት ኬክ 1ኪግ', price: 1400, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
