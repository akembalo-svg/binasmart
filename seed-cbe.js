// Additive seed: CBE Tower (Commercial Bank of Ethiopia HQ) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// n=unit number, f=floor, area m², rent ETB/mo, shop=null → VACANT
const UNITS = [
  { n: 'G-01',  f: 0,  area: 420, rent: 450000, shop: { name: 'CBE Main Banking Hall', am: 'ዋና የባንክ አገልግሎት አዳራሽ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-02',  f: 0,  area: 120, rent: 120000, shop: { name: 'CBE Birr Service Center', am: 'ሲቢኢ ብር አገልግሎት ማዕከል', cat: 'BANK', icon: '📱' } },
  { n: 'G-03',  f: 0,  area: 60,  rent: 60000,  shop: { name: '24/7 ATM Gallery', am: 'ኤቲኤም አገልግሎት (24/7)', cat: 'BANK', icon: '🏧' } },
  { n: 'F1-01', f: 1,  area: 95,  rent: 90000,  shop: { name: 'Forex Bureau', am: 'የውጭ ምንዛሪ አገልግሎት', cat: 'BANK', icon: '💱' } },
  { n: 'F1-02', f: 1,  area: 80,  rent: 80000,  shop: { name: 'Remittance Center', am: 'የሐዋላ አገልግሎት', cat: 'BANK', icon: '💸' } },
  { n: 'F2-01', f: 2,  area: 260, rent: 110000, shop: { name: 'Tower Restaurant', am: 'የታወር ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F2-02', f: 2,  area: 45,  rent: 45000,  shop: { name: 'Tomoca Coffee Corner', am: 'ቶሞካ ቡና', cat: 'CAFE', icon: '☕' } },
  { n: 'F3-01', f: 3,  area: 150, rent: 70000,  shop: { name: 'CBE History Exhibit', am: 'የባንኩ ታሪክ ማሳያ', cat: 'OTHER', icon: '🏛️' } },
  { n: 'F3-02', f: 3,  area: 85,  rent: 65000,  shop: null },
  { n: 'F5-01', f: 5,  area: 380, rent: 150000, shop: { name: 'Grand Conference Center', am: 'ትልቅ የስብሰባ አዳራሽ', cat: 'SERVICE', icon: '🎤' } },
  { n: 'F5-02', f: 5,  area: 120, rent: 90000,  shop: null },
  { n: 'F10-01', f: 10, area: 900, rent: 200000, shop: { name: 'CBE Digital Banking Division', am: 'ዲጂታል ባንኪንግ ክፍል', cat: 'OFFICE', icon: '💼' } },
  { n: 'F20-01', f: 20, area: 900, rent: 200000, shop: { name: 'CBE International Banking', am: 'ዓለም አቀፍ ባንኪንግ ክፍል', cat: 'OFFICE', icon: '🌍' } },
  { n: 'F30-01', f: 30, area: 900, rent: 200000, shop: { name: 'CBE Executive Offices', am: 'የሥራ አመራር ጽሕፈት ቤቶች', cat: 'OFFICE', icon: '🏢' } },
  { n: 'F46-01', f: 46, area: 300, rent: 180000, shop: { name: 'Sky Lounge & View Deck', am: 'የሰማይ ላውንጅ እና እይታ', cat: 'RESTAURANT', icon: '🌆' } },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'cbe-tower' } });
  if (exists) { console.log('cbe-tower already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'CBE Tower Facility Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251951000001', fullName: 'CBE Facility Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'CBE Tower', nameAm: 'የኢትዮጵያ ንግድ ባንክ ታወር',
    city: 'Addis Ababa', subCity: 'Kirkos',
    floors: 48, qrSlug: 'cbe-tower',
    threeD_style: 'glass', threeD_facadeColor: '#6ea8d8',
    threeD_width: 10, threeD_depth: 10,
    signText: 'ንግድ ባንክ',
    marketplaceEnabled: true
  }});

  let shopCount = 0;
  for (const u of UNITS) {
    const unit = await prisma.unit.create({ data: {
      buildingId: building.id, number: u.n, floor: u.f,
      areaSqm: u.area, monthlyRent: u.rent,
      status: u.shop ? 'OCCUPIED' : 'VACANT',
      unitType: u.f === 0 ? 'SHOP' : 'OFFICE'
    }});
    if (!u.shop) continue;

    const tUser = await prisma.user.create({ data: {
      orgId: org.id, phone: '+2519' + String(51000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-10-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-10-01'), endDate: new Date('2026-09-30'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat === 'BANK' ? 'BANK' : u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.2 + Math.random() * 0.7) * 10) / 10,
      reviewCount: 20 + Math.floor(Math.random() * 120),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Tomoca Coffee Corner') {
      for (const [name, am, price] of [['Macchiato', 'ማኪያቶ', 90], ['Espresso', 'ኤስፕሬሶ', 70], ['Ethiopian Pour-over', 'የጀበና ቡና', 110]]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: true, orderCount: Math.floor(Math.random() * 50) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Morning special: Macchiato + croissant 149 ETB',
        titleAm: 'የጠዋት ልዩ: ማኪያቶ + ክሮሳንት 149 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 5 * 86400000),
        views: 210, claims: 34
      }});
    }
    if (u.shop.name === 'Tower Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Lunch Buffet', nameAm: 'የምሳ ቡፌ', price: 450, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Fasting Platter', nameAm: 'የጾም በያይነቱ', price: 320, deliverable: true } });
    }
    if (u.shop.name === 'Sky Lounge & View Deck') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'View Deck Ticket', nameAm: 'የእይታ ትኬት', price: 300 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Sunset Dinner (2p)', nameAm: 'የፀሐይ ግባት እራት ለ2', price: 2800 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'City-view dinner: 15% off this week',
        titleAm: 'የከተማ እይታ እራት: 15% ቅናሽ በዚህ ሳምንት',
        startsAt: new Date(), endsAt: new Date(Date.now() + 7 * 86400000),
        views: 340, claims: 41
      }});
    }
    if (u.shop.name === 'Grand Conference Center') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Full-day Hall Rental', nameAm: 'የሙሉ ቀን አዳራሽ ኪራይ', price: 25000 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
