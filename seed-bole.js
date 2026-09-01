// Additive seed: Bole International Airport — Terminal retail (does NOT touch existing data)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — Arrivals
  { n: 'G-01',  f: 0, area: 180, rent: 220000, shop: { name: 'Ethiopian Airlines Ticket Office', am: 'የኢትዮጵያ አየር መንገድ ትኬት ቢሮ', cat: 'OFFICE', icon: '✈️' } },
  { n: 'G-02',  f: 0, area: 60,  rent: 150000, shop: { name: 'CBE Forex Counter', am: 'የንግድ ባንክ ምንዛሪ', cat: 'BANK', icon: '💱' } },
  { n: 'G-03',  f: 0, area: 90,  rent: 130000, shop: { name: 'Car Rental Hub', am: 'የመኪና ኪራይ', cat: 'SERVICE', icon: '🚗' } },
  { n: 'G-04',  f: 0, area: 45,  rent: 95000,  shop: { name: 'Tomoca Coffee Arrivals', am: 'ቶሞካ ቡና', cat: 'CAFE', icon: '☕' } },
  { n: 'G-05',  f: 0, area: 40,  rent: 90000,  shop: { name: 'Ethio Telecom SIM Shop', am: 'ኢትዮ ቴሌኮም ሲም', cat: 'SERVICE', icon: '📶' } },
  // Floor 1 — Departures
  { n: 'F1-01', f: 1, area: 350, rent: 380000, shop: { name: 'Duty Free Addis', am: 'ከቀረጥ ነፃ ሱቅ', cat: 'RETAIL', icon: '🛍️' } },
  { n: 'F1-02', f: 1, area: 70,  rent: 140000, shop: { name: 'Habesha Souvenirs', am: 'የሀበሻ ስጦታዎች', cat: 'RETAIL', icon: '🎁' } },
  { n: 'F1-03', f: 1, area: 220, rent: 200000, shop: { name: 'Sky Restaurant & Bar', am: 'ስካይ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F1-04', f: 1, area: 50,  rent: 85000,  shop: { name: 'Book & Press', am: 'መጻሕፍት እና ጋዜጣ', cat: 'RETAIL', icon: '📚' } },
  { n: 'F1-05', f: 1, area: 65,  rent: 120000, shop: null },
  // Floor 2 — Lounges
  { n: 'F2-01', f: 2, area: 400, rent: 250000, shop: { name: 'Cloud Nine Lounge', am: 'ክላውድ ናይን ላውንጅ', cat: 'SERVICE', icon: '🛋️' } },
  { n: 'F2-02', f: 2, area: 120, rent: 110000, shop: { name: 'Airport Spa & Wellness', am: 'ስፓ እና ደህንነት', cat: 'SALON', icon: '💆' } },
  { n: 'F2-03', f: 2, area: 90,  rent: 100000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'bole-airport' } });
  if (exists) { console.log('bole-airport already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Bole Terminal Retail Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251952000001', fullName: 'Terminal Commercial Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Bole Int’l Airport — Terminal', nameAm: 'ቦሌ ዓለም አቀፍ አውሮፕላን ማረፊያ',
    city: 'Addis Ababa', subCity: 'Bole',
    floors: 3, qrSlug: 'bole-airport',
    threeD_style: 'glass', threeD_facadeColor: '#9db8c8',
    threeD_width: 28, threeD_depth: 14,
    signText: 'ቦሌ አየር ማረፊያ ✈',
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
      orgId: org.id, phone: '+2519' + String(52000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-11-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-11-01'), endDate: new Date('2026-10-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.1 + Math.random() * 0.8) * 10) / 10,
      reviewCount: 30 + Math.floor(Math.random() * 200),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Duty Free Addis') {
      for (const [name, am, price] of [
        ['Ethiopian Coffee Gift Box 1kg', 'የቡና ስጦታ ጥቅል 1ኪግ', 1800],
        ['Perfume Selection', 'ሽቶዎች', 4500],
        ['Ethiopian Honey Wine (Tej)', 'ጠጅ', 950]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 80) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: '2 coffee gift boxes → 3rd FREE',
        titleAm: '2 የቡና ጥቅል ይግዙ → 3ኛው ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 10 * 86400000),
        views: 520, claims: 87
      }});
    }
    if (u.shop.name === 'Cloud Nine Lounge') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Lounge Pass (3h)', nameAm: 'የላውንጅ መግቢያ (3 ሰዓት)', price: 1600 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Shower + Nap Room', nameAm: 'ሻወር + ማረፊያ ክፍል', price: 900 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Long layover? Lounge + shower bundle -20%',
        titleAm: 'ረዥም ትራንዚት? ላውንጅ + ሻወር -20%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 86400000),
        views: 410, claims: 63
      }});
    }
    if (u.shop.name === 'Tomoca Coffee Arrivals') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Macchiato', nameAm: 'ማኪያቶ', price: 100, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Beans To-Go 500g', nameAm: 'ቡና 500ግ', price: 700, deliverable: false } });
    }
    if (u.shop.name === 'Habesha Souvenirs') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Handwoven Scarf (Netela)', nameAm: 'ነጠላ', price: 1200 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Mini Jebena Set', nameAm: 'ትንሽ ጀበና ስብስብ', price: 850 } });
    }
    if (u.shop.name === 'Sky Restaurant & Bar') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Transit Breakfast', nameAm: 'ቁርስ', price: 380 } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
