// Additive seed: Friendship City Center (Bole Road, Friendship Square) — distinct from Friendship Mall — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 550, rent: 330000, shop: { name: 'City Department Store', am: 'ሲቲ ዲፓርትመንት መደብር', cat: 'RETAIL', icon: '🏬' } },
  { n: 'G-02',  f: 0, area: 90,  rent: 135000, shop: { name: 'CBE Premium Branch', am: 'ንግድ ባንክ ፕሪሚየም ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-03',  f: 0, area: 70,  rent: 115000, shop: { name: 'Square Café Roasters', am: 'ስኩዌር ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0, area: 55,  rent: 95000,  shop: { name: 'Duty-Style Perfumery', am: 'ሽቶ መደብር', cat: 'RETAIL', icon: '🌸' } },
  // Floor 1 — brands
  { n: 'F1-01', f: 1, area: 120, rent: 130000, shop: { name: 'International Brands Outlet', am: 'ዓለም አቀፍ ብራንዶች', cat: 'RETAIL', icon: '🛍️' } },
  { n: 'F1-02', f: 1, area: 85,  rent: 100000, shop: { name: 'Denim & Street Wear', am: 'ጂንስ እና ስትሪት ዌር', cat: 'RETAIL', icon: '👖' } },
  { n: 'F1-03', f: 1, area: 75,  rent: 90000,  shop: { name: 'Sportswear Pro Shop', am: 'የስፖርት ልብስ', cat: 'RETAIL', icon: '🎽' } },
  { n: 'F1-04', f: 1, area: 65,  rent: 82000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 110, rent: 112000, shop: { name: 'iStore Electronics & Repair', am: 'አይስቶር ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📱' } },
  { n: 'F2-02', f: 2, area: 85,  rent: 95000,  shop: { name: 'Optics & Sunglass Hut', am: 'መነጽር እና የፀሐይ መነጽር', cat: 'RETAIL', icon: '🕶️' } },
  { n: 'F2-03', f: 2, area: 75,  rent: 88000,  shop: { name: 'Kids Planet Toys', am: 'የልጆች ፕላኔት', cat: 'RETAIL', icon: '🪀' } },
  // Floor 3 — food hall
  { n: 'F3-01', f: 3, area: 420, rent: 240000, shop: { name: 'Friendship Food Hall', am: 'ፍሬንድሺፕ የምግብ አዳራሽ', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 55,  rent: 65000,  shop: { name: 'Crepe & Waffle Corner', am: 'ክሬፕ እና ዋፍል', cat: 'CAFE', icon: '🥞' } },
  // Floor 4 — cineplex
  { n: 'F4-01', f: 4, area: 550, rent: 280000, shop: { name: 'Square Cineplex (3 screens)', am: 'ስኩዌር ሲኒማ', cat: 'SERVICE', icon: '🎬' } },
  // Floor 5–6 offices
  { n: 'F5-01', f: 5, area: 220, rent: 145000, shop: { name: 'Ethio-China Trade Office', am: 'ኢትዮ-ቻይና ንግድ ቢሮ', cat: 'OFFICE', icon: '🤝' } },
  { n: 'F6-01', f: 6, area: 200, rent: 135000, shop: { name: 'Grand Realty & Property', am: 'ግራንድ ሪልቲ', cat: 'OFFICE', icon: '🏠' } },
  { n: 'F6-02', f: 6, area: 95,  rent: 90000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'friendship-city-center' } });
  if (exists) { console.log('friendship-city-center already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Friendship City Center Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251975000001', fullName: 'Friendship City Center Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Friendship City Center', nameAm: 'ፍሬንድሺፕ ሲቲ ሴንተር',
    city: 'Addis Ababa', subCity: 'Bole Road (Friendship Square)',
    floors: 8, qrSlug: 'friendship-city-center',
    threeD_style: 'glass', threeD_facadeColor: '#6b87c9',
    threeD_width: 19, threeD_depth: 14,
    signText: 'ፍሬንድሺፕ ሲቲ ሴንተር',
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
      orgId: org.id, phone: '+2519' + String(75000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-07-15'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-07-15'), endDate: new Date('2026-07-14'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.1 + Math.random() * 0.8) * 10) / 10,
      reviewCount: 40 + Math.floor(Math.random() * 300),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Square Cineplex (3 screens)') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Movie Ticket (2D)', nameAm: 'የፊልም ትኬት', price: 350, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Premiere + Dinner Combo', nameAm: 'ፕሪሚየር + እራት', price: 1200, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Date night Fridays: 2 tickets + crepe 799 ETB',
        titleAm: 'የአርብ ምሽት: 2 ትኬት + ክሬፕ 799 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 10 * 86400000),
        views: 440, claims: 86
      }});
    }
    if (u.shop.name === 'City Department Store') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Home Essentials Bundle', nameAm: 'የቤት እቃዎች ጥቅል', price: 4500, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'New store opening: everything -10% this month',
        titleAm: 'የመክፈቻ ቅናሽ: ሁሉም -10% በዚህ ወር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 25 * 86400000),
        views: 520, claims: 97
      }});
    }
    if (u.shop.name === 'iStore Electronics & Repair') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Phone Screen Repair (same day)', nameAm: 'የስልክ ስክሪን ጥገና', price: 2800 } });
    }
    if (u.shop.name === 'Friendship Food Hall') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Food Hall Combo', nameAm: 'የምግብ አዳራሽ ኮምቦ', price: 380, deliverable: true } });
    }
    if (u.shop.name === 'Grand Realty & Property') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Property Valuation Service', nameAm: 'የንብረት ግምት አገልግሎት', price: 9500 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
