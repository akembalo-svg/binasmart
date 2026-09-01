// Additive seed: Adams Pavilion (Sarbet) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0, area: 100, rent: 140000, shop: { name: 'Hibret Bank Branch', am: 'ሕብረት ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-02',  f: 0, area: 70,  rent: 110000, shop: { name: 'Pavilion Café', am: 'ፓቪልዮን ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-03',  f: 0, area: 50,  rent: 90000,  shop: { name: 'Gift & Art Gallery', am: 'ስጦታ እና ሥነ ጥበብ', cat: 'RETAIL', icon: '🖼️' } },
  { n: 'G-04',  f: 0, area: 55,  rent: 95000,  shop: { name: 'Pavilion Pharmacy', am: 'ፓቪልዮን ፋርማሲ', cat: 'PHARMACY', icon: '💊' } },
  // Floor 1
  { n: 'F1-01', f: 1, area: 75,  rent: 95000,  shop: { name: 'Sarbet Silk Boutique', am: 'ሳርቤት ሐር ቡቲክ', cat: 'RETAIL', icon: '👗' } },
  { n: 'F1-02', f: 1, area: 60,  rent: 85000,  shop: { name: 'EyeCare Optician', am: 'የዓይን ክብካቤ መነጽር', cat: 'RETAIL', icon: '👓' } },
  { n: 'F1-03', f: 1, area: 65,  rent: 88000,  shop: null },
  // Floor 2
  { n: 'F2-01', f: 2, area: 90,  rent: 95000,  shop: { name: 'Pavilion Electronics', am: 'ፓቪልዮን ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '💻' } },
  { n: 'F2-02', f: 2, area: 80,  rent: 90000,  shop: { name: 'Vera Beauty Lounge', am: 'ቬራ የውበት ላውንጅ', cat: 'SALON', icon: '💅' } },
  // Floor 3
  { n: 'F3-01', f: 3, area: 280, rent: 180000, shop: { name: 'Pavilion Terrace Restaurant', am: 'ፓቪልዮን ተራስ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3, area: 45,  rent: 60000,  shop: { name: 'Yirgacheffe Coffee Bar', am: 'ይርጋጨፌ ቡና ባር', cat: 'CAFE', icon: '🫘' } },
  // Offices F4+
  { n: 'F4-01', f: 4, area: 200, rent: 135000, shop: { name: 'Axis Architecture Studio', am: 'አክሲስ አርክቴክቸር', cat: 'OFFICE', icon: '📐' } },
  { n: 'F5-01', f: 5, area: 180, rent: 125000, shop: { name: 'Global Visa & Travel Services', am: 'ግሎባል ቪዛ አገልግሎት', cat: 'OFFICE', icon: '🛂' } },
  { n: 'F6-01', f: 6, area: 190, rent: 128000, shop: { name: 'Hope International NGO', am: 'ሆፕ ዓለም አቀፍ ድርጅት', cat: 'OFFICE', icon: '🤝' } },
  { n: 'F7-01', f: 7, area: 200, rent: 130000, shop: { name: 'Sheba Tech Startup Hub', am: 'ሳባ ቴክ ማዕከል', cat: 'OFFICE', icon: '🚀' } },
  { n: 'F8-01', f: 8, area: 170, rent: 120000, shop: { name: 'Tsegaye & Partners Law Office', am: 'ጸጋዬ እና አጋሮች ጠበቆች', cat: 'OFFICE', icon: '⚖️' } },
  { n: 'F8-02', f: 8, area: 90,  rent: 85000,  shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'adams-pavilion' } });
  if (exists) { console.log('adams-pavilion already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Adams Pavilion Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251963000001', fullName: 'Adams Pavilion Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Adams Pavilion', nameAm: 'አዳምስ ፓቪልዮን',
    city: 'Addis Ababa', subCity: 'Sarbet',
    floors: 9, qrSlug: 'adams-pavilion',
    threeD_style: 'modern', threeD_facadeColor: '#a87284',
    threeD_width: 14, threeD_depth: 11,
    signText: 'አዳምስ ፓቪልዮን',
    marketplaceEnabled: true
  }});

  let shopCount = 0;
  for (const u of UNITS) {
    const unit = await prisma.unit.create({ data: {
      buildingId: building.id, number: u.n, floor: u.f,
      areaSqm: u.area, monthlyRent: u.rent,
      status: u.shop ? 'OCCUPIED' : 'VACANT',
      unitType: u.f >= 4 ? 'OFFICE' : 'SHOP'
    }});
    if (!u.shop) continue;

    const tUser = await prisma.user.create({ data: {
      orgId: org.id, phone: '+2519' + String(63000100 + shopCount),
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
      reviewCount: 20 + Math.floor(Math.random() * 160),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Pavilion Terrace Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Business Lunch Set', nameAm: 'የቢዝነስ ምሳ', price: 420, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Terrace Dinner (2p)', nameAm: 'የተራስ እራት ለ2', price: 1400, deliverable: false } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Office workers: lunch set 349 ETB',
        titleAm: 'ለቢሮ ሠራተኞች: ምሳ 349 ብር',
        startsAt: new Date(), endsAt: new Date(Date.now() + 11 * 86400000),
        views: 330, claims: 64
      }});
    }
    if (u.shop.name === 'Yirgacheffe Coffee Bar') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Yirgacheffe Pour-over', nameAm: 'ይርጋጨፌ ቡና', price: 120, deliverable: false } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Roasted Beans 500g', nameAm: 'የተጠበሰ ቡና 500ግ', price: 800, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Bean subscription: 500g weekly -10%',
        titleAm: 'የቡና ደንበኝነት: በሳምንት 500ግ -10%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 15 * 86400000),
        views: 220, claims: 41
      }});
    }
    if (u.shop.name === 'Global Visa & Travel Services') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Schengen Visa Assistance', nameAm: 'የሸንገን ቪዛ እገዛ', price: 8500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Dubai Package (3 nights)', nameAm: 'የዱባይ ጉዞ (3 ሌሊት)', price: 42000 } });
    }
    if (u.shop.name === 'Axis Architecture Studio') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Villa Design Package', nameAm: 'የቪላ ዲዛይን ጥቅል', price: 95000 } });
    }
    if (u.shop.name === 'Gift & Art Gallery') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Ethiopian Painting (canvas)', nameAm: 'የኢትዮጵያ ሥዕል', price: 5500, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
