// Additive seed: Edna Mall (Bole Medhanealem) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 160, rent: 180000, shop: { name: "Kaldi's Coffee", am: 'ካልዲስ ቡና', cat: 'CAFE', icon: '☕' } },
  { n: 'G-02',  f: 0, area: 450, rent: 260000, shop: { name: 'Edna Supermarket', am: 'ኤድና ሱፐርማርኬት', cat: 'RETAIL', icon: '🛒' } },
  { n: 'G-03',  f: 0, area: 70,  rent: 95000,  shop: { name: 'Green Pharmacy', am: 'ግሪን ፋርማሲ', cat: 'PHARMACY', icon: '💊' } },
  { n: 'G-04',  f: 0, area: 55,  rent: 90000,  shop: { name: 'Mobile & Electronics', am: 'ሞባይል እና ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📱' } },
  { n: 'G-05',  f: 0, area: 60,  rent: 95000,  shop: null },
  // Floor 1
  { n: 'F1-01', f: 1, area: 110, rent: 120000, shop: { name: 'Bole Fashion Boutique', am: 'ቦሌ ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 85,  rent: 100000, shop: { name: 'Kids Toy Kingdom', am: 'የልጆች መጫወቻ', cat: 'RETAIL', icon: '🧸' } },
  { n: 'F1-03', f: 1, area: 75,  rent: 95000,  shop: { name: 'Shoe Palace', am: 'የጫማ ቤተ መንግሥት', cat: 'RETAIL', icon: '👟' } },
  { n: 'F1-04', f: 1, area: 65,  rent: 85000,  shop: { name: 'Glamour Beauty Salon', am: 'ግላመር የውበት ሳሎን', cat: 'SALON', icon: '💇‍♀️' } },
  // Floor 2
  { n: 'F2-01', f: 2, area: 380, rent: 220000, shop: { name: 'Edna Food Court', am: 'ኤድና ፉድ ኮርት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F2-02', f: 2, area: 45,  rent: 60000,  shop: { name: 'Fresh Juice Bar', am: 'ጭማቂ ቤት', cat: 'CAFE', icon: '🥤' } },
  { n: 'F2-03', f: 2, area: 300, rent: 200000, shop: { name: 'Arcade Game Zone', am: 'የጨዋታ ዞን', cat: 'SERVICE', icon: '🎮' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 700, rent: 320000, shop: { name: 'Matti Multiplex Cinema', am: 'ማቲ መልቲፕሌክስ ሲኒማ', cat: 'SERVICE', icon: '🎬' } },
  { n: 'F3-02', f: 3, area: 120, rent: 110000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'edna-mall' } });
  if (exists) { console.log('edna-mall already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Edna Mall Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251953000001', fullName: 'Edna Mall Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Edna Mall', nameAm: 'ኤድና ሞል',
    city: 'Addis Ababa', subCity: 'Bole Medhanealem',
    floors: 4, qrSlug: 'edna-mall',
    threeD_style: 'modern', threeD_facadeColor: '#d9995b',
    threeD_width: 20, threeD_depth: 16,
    signText: 'ኤድና ሞል',
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
      orgId: org.id, phone: '+2519' + String(53000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-08-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-08-01'), endDate: new Date('2026-07-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 40 + Math.floor(Math.random() * 300),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Matti Multiplex Cinema') {
      for (const [name, am, price] of [
        ['Movie Ticket (2D)', 'የፊልም ትኬት', 350],
        ['Popcorn + Drink Combo', 'ፖፕኮርን + መጠጥ', 250],
        ['VIP Recliner Seat', 'ቪአይፒ መቀመጫ', 600]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 150) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Tuesday: all 2D tickets 199 ETB',
        titleAm: 'ማክሰኞ: ሁሉም 2D ትኬቶች 199 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 6 * 86400000),
        views: 780, claims: 154
      }});
    }
    if (u.shop.name === 'Arcade Game Zone') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Kids Day Pass', nameAm: 'የልጆች የቀን መግቢያ', price: 500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: '20 Game Tokens', nameAm: '20 የጨዋታ ቶከን', price: 300 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Weekend family pack: 2 kids + parents -25%',
        titleAm: 'የቅዳሜ-እሁድ የቤተሰብ ጥቅል -25%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 4 * 86400000),
        views: 340, claims: 58
      }});
    }
    if (u.shop.name === "Kaldi's Coffee") {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Caramel Macchiato', nameAm: 'ካራሜል ማኪያቶ', price: 140, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Ice Cream Sundae', nameAm: 'አይስ ክሬም', price: 180, deliverable: false } });
    }
    if (u.shop.name === 'Edna Food Court') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Pizza Margherita', nameAm: 'ፒዛ', price: 420, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Shiro + Injera', nameAm: 'ሽሮ በእንጀራ', price: 220, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
