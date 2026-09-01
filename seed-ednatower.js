// Additive seed: Edna Tower (Bole Medhanealem) — mixed-use high-rise — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — retail podium
  { n: 'G-01',  f: 0,  area: 150, rent: 190000, shop: { name: 'SportZone Flagship Store', am: 'ስፖርትዞን መደብር', cat: 'RETAIL', icon: '👟' } },
  { n: 'G-02',  f: 0,  area: 80,  rent: 125000, shop: { name: 'Nib Bank Branch', am: 'ንብ ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0,  area: 70,  rent: 110000, shop: { name: 'Tower Café & Bakery', am: 'ታወር ካፌ እና ዳቦ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0,  area: 50,  rent: 90000,  shop: null },
  // Floor 1 — dining
  { n: 'F1-01', f: 1,  area: 320, rent: 200000, shop: { name: 'Edna Sky Food Court', am: 'ኤድና የምግብ አዳራሽ', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F1-02', f: 1,  area: 90,  rent: 95000,  shop: { name: 'Gelateria & Dessert Bar', am: 'ጄላቶ እና ጣፋጭ', cat: 'CAFE', icon: '🍨' } },
  // Floor 2 — entertainment
  { n: 'F2-01', f: 2,  area: 380, rent: 230000, shop: { name: 'Edna Gaming & E-sports Arena', am: 'ኤድና ጌሚንግ አሬና', cat: 'SERVICE', icon: '🎮' } },
  // Floor 3 — wellness
  { n: 'F3-01', f: 3,  area: 300, rent: 190000, shop: { name: 'Summit Fitness & Spa', am: 'ሰሚት ጂም እና ስፓ', cat: 'GYM', icon: '💪' } },
  // Offices
  { n: 'F6-01', f: 6,  area: 220, rent: 150000, shop: { name: 'Zana Media Production', am: 'ዛና ሚዲያ', cat: 'OFFICE', icon: '🎥' } },
  { n: 'F8-01', f: 8,  area: 200, rent: 140000, shop: { name: 'Qene Games Studio', am: 'ቅኔ ጌምስ ስቱዲዮ', cat: 'OFFICE', icon: '🕹️' } },
  { n: 'F10-01', f: 10, area: 210, rent: 145000, shop: { name: 'Horizon Digital Agency', am: 'ሆራይዘን ዲጂታል', cat: 'OFFICE', icon: '📈' } },
  { n: 'F12-01', f: 12, area: 190, rent: 135000, shop: { name: 'Addis Legal Chambers', am: 'የሕግ ቢሮ', cat: 'OFFICE', icon: '⚖️' } },
  // Serviced apartments
  { n: 'F15-01', f: 15, area: 400, rent: 350000, shop: { name: 'Edna Serviced Apartments', am: 'ኤድና አገልግሎት ያላቸው መኖሪያዎች', cat: 'SERVICE', icon: '🏠' } },
  // Rooftop
  { n: 'F17-01', f: 17, area: 280, rent: 260000, shop: { name: 'Horizon 360 Rooftop Restaurant', am: 'ሆራይዘን 360 የጣራ ላይ ምግብ ቤት', cat: 'RESTAURANT', icon: '🌇' } },
  { n: 'F17-02', f: 17, area: 90,  rent: 110000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'edna-tower' } });
  if (exists) { console.log('edna-tower already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Edna Tower Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251972000001', fullName: 'Edna Tower Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Edna Tower', nameAm: 'ኤድና ታወር',
    city: 'Addis Ababa', subCity: 'Bole Medhanealem',
    floors: 18, qrSlug: 'edna-tower',
    threeD_style: 'glass', threeD_facadeColor: '#e0a878',
    threeD_width: 13, threeD_depth: 12,
    signText: 'ኤድና ታወር',
    marketplaceEnabled: true
  }});

  let shopCount = 0;
  for (const u of UNITS) {
    const unit = await prisma.unit.create({ data: {
      buildingId: building.id, number: u.n, floor: u.f,
      areaSqm: u.area, monthlyRent: u.rent,
      status: u.shop ? 'OCCUPIED' : 'VACANT',
      unitType: u.f >= 6 && u.f < 15 ? 'OFFICE' : 'SHOP'
    }});
    if (!u.shop) continue;

    const tUser = await prisma.user.create({ data: {
      orgId: org.id, phone: '+2519' + String(72000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-01-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-01-15'), endDate: new Date('2026-12-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.1 + Math.random() * 0.8) * 10) / 10,
      reviewCount: 30 + Math.floor(Math.random() * 250),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Edna Gaming & E-sports Arena') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Gaming Hour Pass', nameAm: 'የጨዋታ ሰዓት', price: 250 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'E-sports Tournament Entry', nameAm: 'የውድድር መግቢያ', price: 600 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'FIFA tournament Saturday: prize pool 50K',
        titleAm: 'የቅዳሜ FIFA ውድድር: ሽልማት 50ሺ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 6 * 86400000),
        views: 520, claims: 118
      }});
    }
    if (u.shop.name === 'Edna Serviced Apartments') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Studio Apartment (monthly)', nameAm: 'ስቱዲዮ መኖሪያ ወርሃዊ', price: 85000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: '2-Bedroom Serviced (monthly)', nameAm: '2 መኝታ ወርሃዊ', price: 145000 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Diaspora summer stay: 3 months -12%',
        titleAm: 'የዲያስፖራ የበጋ ቆይታ: 3 ወር -12%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000),
        views: 390, claims: 27
      }});
    }
    if (u.shop.name === 'Horizon 360 Rooftop Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Sunset Dinner (2p, window)', nameAm: 'የፀሐይ ግባት እራት ለ2', price: 2600, deliverable: false } });
    }
    if (u.shop.name === 'SportZone Flagship Store') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Running Shoes Collection', nameAm: 'የሩጫ ጫማዎች', price: 5800, deliverable: true } });
    }
    if (u.shop.name === 'Edna Sky Food Court') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Lunch Combo', nameAm: 'የምሳ ኮምቦ', price: 340, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
