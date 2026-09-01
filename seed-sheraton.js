// Additive seed: Sheraton Addis (Taitu St, near National Palace) — luxury hotel demo — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground — lobby & arcade
  { n: 'G-01',  f: 0, area: 180, rent: 260000, shop: { name: 'Front Desk & Reservations', am: 'የክፍል ማስያዣ ዴስክ', cat: 'SERVICE', icon: '🛎️' } },
  { n: 'G-02',  f: 0, area: 55,  rent: 130000, shop: { name: 'Royal Jewelry Arcade', am: 'ሮያል ጌጣጌጥ', cat: 'RETAIL', icon: '💎' } },
  { n: 'G-03',  f: 0, area: 70,  rent: 140000, shop: { name: 'Ethiopian Art Gallery', am: 'የሥነ ጥበብ ጋለሪ', cat: 'RETAIL', icon: '🖼️' } },
  { n: 'G-04',  f: 0, area: 60,  rent: 120000, shop: { name: 'Fendika Gift Boutique', am: 'ፈንድቃ ስጦታ ቡቲክ', cat: 'RETAIL', icon: '🎁' } },
  { n: 'G-05',  f: 0, area: 50,  rent: 110000, shop: null },
  // Floor 1 — dining
  { n: 'F1-01', f: 1, area: 300, rent: 280000, shop: { name: 'Les Arcades Fine Dining', am: 'ሌዛርካድ ልዩ ምግብ ቤት', cat: 'RESTAURANT', icon: '🥂' } },
  { n: 'F1-02', f: 1, area: 260, rent: 240000, shop: { name: 'Stagioni Italian Restaurant', am: 'ስታጆኒ የጣሊያን ምግብ ቤት', cat: 'RESTAURANT', icon: '🍝' } },
  { n: 'F1-03', f: 1, area: 320, rent: 250000, shop: { name: 'Summerfields Terrace', am: 'ሰመርፊልድስ ተራስ', cat: 'RESTAURANT', icon: '🍽️' } },
  // Floor 2 — events
  { n: 'F2-01', f: 2, area: 1000, rent: 500000, shop: { name: 'Lalibela Grand Ballroom', am: 'ላሊበላ ትልቅ አዳራሽ', cat: 'SERVICE', icon: '👑' } },
  { n: 'F2-02', f: 2, area: 300, rent: 220000, shop: { name: 'Meetings & Summit Suites', am: 'የስብሰባ አዳራሾች', cat: 'SERVICE', icon: '🎤' } },
  // Floor 3 — leisure
  { n: 'F3-01', f: 3, area: 450, rent: 300000, shop: { name: 'Aqva Club Pool & Spa', am: 'አኳ ክለብ መዋኛ እና ስፓ', cat: 'GYM', icon: '🏊' } },
  { n: 'F3-02', f: 3, area: 200, rent: 180000, shop: { name: 'Gaslight Night Club', am: 'ጋዝላይት ክለብ', cat: 'SERVICE', icon: '🎷' } },
  { n: 'F3-03', f: 3, area: 120, rent: 130000, shop: { name: 'Executive Health Spa', am: 'ኤግዘክዩቲቭ ስፓ', cat: 'SALON', icon: '💆' } },
  // Floor 5 — signature
  { n: 'F5-01', f: 5, area: 300, rent: 350000, shop: { name: 'Villa & Suite Collection', am: 'ቪላ እና ስዊት ስብስብ', cat: 'SERVICE', icon: '⭐' } },
  { n: 'F5-02', f: 5, area: 90,  rent: 120000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'sheraton-addis' } });
  if (exists) { console.log('sheraton-addis already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Sheraton Addis Commercial Office', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251966000001', fullName: 'Sheraton Commercial Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Sheraton Addis', nameAm: 'ሸራተን አዲስ',
    city: 'Addis Ababa', subCity: 'Taitu St (near National Palace)',
    floors: 6, qrSlug: 'sheraton-addis',
    threeD_style: 'classic', threeD_facadeColor: '#dcc794',
    threeD_width: 26, threeD_depth: 15,
    signText: 'ሸራተን አዲስ ★★★★★',
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
      orgId: org.id, phone: '+2519' + String(66000100 + shopCount),
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
      avgRating: Math.round((4.5 + Math.random() * 0.4) * 10) / 10,
      reviewCount: 150 + Math.floor(Math.random() * 600),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Front Desk & Reservations') {
      for (const [name, am, price] of [
        ['Classic Room (per night)', 'ክላሲክ ክፍል በሌሊት', 18500],
        ['Club Room (per night)', 'ክለብ ክፍል', 26000],
        ['Weekend Escape (2 nights + brunch)', 'የቅዳሜ-እሁድ ጥቅል', 42000]
      ]) {
        await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: false, orderCount: Math.floor(Math.random() * 150) } });
      }
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Honeymoon package: villa night + spa -20%',
        titleAm: 'የጫጉላ ጥቅል: ቪላ + ስፓ -20%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000),
        views: 640, claims: 42
      }});
    }
    if (u.shop.name === 'Lalibela Grand Ballroom') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Royal Wedding (800 guests)', nameAm: 'ሮያል ሰርግ (800 እንግዳ)', price: 1200000 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Gala Dinner Package (400p)', nameAm: 'ጋላ እራት ጥቅል', price: 600000 } });
    }
    if (u.shop.name === 'Summerfields Terrace') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Sunday Family Brunch', nameAm: 'የእሁድ የቤተሰብ ብራንች', price: 2800, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Sunday brunch: kids under 12 FREE',
        titleAm: 'የእሁድ ብራንች: ከ12 ዓመት በታች ልጆች ነፃ',
        startsAt: new Date(), endsAt: new Date(Date.now() + 21 * 86400000),
        views: 480, claims: 77
      }});
    }
    if (u.shop.name === 'Aqva Club Pool & Spa') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Aqva Day Pass (heated pool)', nameAm: 'የአኳ የቀን መግቢያ', price: 3500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Annual Membership', nameAm: 'ዓመታዊ አባልነት', price: 180000 } });
    }
    if (u.shop.name === 'Villa & Suite Collection') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Royal Villa (per night)', nameAm: 'ሮያል ቪላ በሌሊት', price: 120000 } });
    }
    if (u.shop.name === 'Les Arcades Fine Dining') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Chef Tasting Menu (5 courses)', nameAm: 'የሼፍ ልዩ ምናሌ', price: 4800, deliverable: false } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
