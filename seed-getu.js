// Additive seed: Getu Commercial Center (22 Mazoria / Haile Gebreselassie Ave) — does NOT touch existing data
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  // Ground
  { n: 'G-01',  f: 0,  area: 110, rent: 150000, shop: { name: 'Wegagen Bank Branch', am: 'ወጋገን ባንክ ቅርንጫፍ', cat: 'BANK', icon: '🏦' } },
  { n: 'G-02',  f: 0,  area: 90,  rent: 130000, shop: { name: 'Getu Electronics Center', am: 'ጌቱ ኤሌክትሮኒክስ', cat: 'RETAIL', icon: '📺' } },
  { n: 'G-03',  f: 0,  area: 60,  rent: 100000, shop: { name: 'Elilta Café', am: 'እልልታ ካፌ', cat: 'CAFE', icon: '☕' } },
  { n: 'G-04',  f: 0,  area: 55,  rent: 95000,  shop: { name: 'Hiwot Pharmacy', am: 'ሕይወት ፋርማሲ', cat: 'PHARMACY', icon: '💊' } },
  // Floor 1
  { n: 'F1-01', f: 1,  area: 80,  rent: 100000, shop: { name: 'Mobile Wholesale Hub', am: 'የሞባይል ጅምላ', cat: 'RETAIL', icon: '📱' } },
  { n: 'F1-02', f: 1,  area: 75,  rent: 95000,  shop: { name: 'Computer & Accessories', am: 'ኮምፒውተር እና እቃዎች', cat: 'RETAIL', icon: '💻' } },
  { n: 'F1-03', f: 1,  area: 60,  rent: 80000,  shop: { name: 'Print & Copy Express', am: 'ህትመት እና ኮፒ', cat: 'SERVICE', icon: '🖨️' } },
  // Floor 2
  { n: 'F2-01', f: 2,  area: 85,  rent: 90000,  shop: { name: 'Addis Fashion Corner', am: 'አዲስ ፋሽን', cat: 'RETAIL', icon: '👗' } },
  { n: 'F2-02', f: 2,  area: 65,  rent: 80000,  shop: { name: 'Glow Cosmetics', am: 'ግሎው ኮስሞቲክስ', cat: 'RETAIL', icon: '💄' } },
  { n: 'F2-03', f: 2,  area: 70,  rent: 82000,  shop: null },
  // Floor 3
  { n: 'F3-01', f: 3,  area: 300, rent: 180000, shop: { name: 'Getu Restaurant', am: 'ጌቱ ምግብ ቤት', cat: 'RESTAURANT', icon: '🍽️' } },
  { n: 'F3-02', f: 3,  area: 50,  rent: 60000,  shop: { name: 'Juice & Snack Corner', am: 'ጭማቂ እና መክሰስ', cat: 'CAFE', icon: '🥤' } },
  // Offices F4+
  { n: 'F4-01', f: 4,  area: 220, rent: 140000, shop: { name: 'Horizon Import & Export', am: 'ሆራይዘን አስመጪ እና ላኪ', cat: 'OFFICE', icon: '🚢' } },
  { n: 'F5-01', f: 5,  area: 200, rent: 135000, shop: { name: 'Getu Medical Clinic', am: 'ጌቱ ክሊኒክ', cat: 'CLINIC', icon: '🏥' } },
  { n: 'F6-01', f: 6,  area: 180, rent: 125000, shop: { name: 'Precise Accounting Firm', am: 'የሂሳብ አገልግሎት', cat: 'OFFICE', icon: '🧮' } },
  { n: 'F8-01', f: 8,  area: 200, rent: 130000, shop: { name: 'BlueNile Software Solutions', am: 'ብሉናይል ሶፍትዌር', cat: 'OFFICE', icon: '🖥️' } },
  { n: 'F10-01', f: 10, area: 190, rent: 125000, shop: { name: 'Unity Consulting Group', am: 'ዩኒቲ አማካሪዎች', cat: 'OFFICE', icon: '📊' } },
  { n: 'F11-01', f: 11, area: 210, rent: 135000, shop: null },
];

async function main() {
  const exists = await prisma.building.findUnique({ where: { qrSlug: 'getu-commercial' } });
  if (exists) { console.log('getu-commercial already exists — aborting (no changes)'); return; }

  const org = await prisma.organization.create({ data: { name: 'Getu Commercial Center Management', plan: 'PRO' } });
  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251959000001', fullName: 'Getu Commercial Office', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Getu Commercial Center', nameAm: 'ጌቱ የንግድ ማዕከል',
    city: 'Addis Ababa', subCity: '22 Mazoria (Haile Gebreselassie Ave)',
    floors: 12, qrSlug: 'getu-commercial',
    threeD_style: 'glass', threeD_facadeColor: '#8899b0',
    threeD_width: 13, threeD_depth: 11,
    signText: 'ጌቱ የንግድ ማዕከል',
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
      orgId: org.id, phone: '+2519' + String(59000100 + shopCount),
      fullName: u.shop.name + ' Manager', role: 'TENANT'
    }});
    const tenancy = await prisma.tenancy.create({ data: {
      unitId: unit.id, userId: tUser.id,
      startDate: new Date('2025-02-01'), active: true
    }});
    await prisma.contract.create({ data: {
      tenancyId: tenancy.id,
      startDate: new Date('2025-02-01'), endDate: new Date('2026-01-31'),
      monthlyRent: u.rent
    }});
    const shop = await prisma.shop.create({ data: {
      tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
      category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
      avgRating: Math.round((4.0 + Math.random() * 0.9) * 10) / 10,
      reviewCount: 25 + Math.floor(Math.random() * 200),
      isOpenNow: true
    }});
    shopCount++;

    if (u.shop.name === 'Getu Electronics Center') {
      await prisma.product.create({ data: { shopId: shop.id, name: '55" Smart TV', nameAm: '55 ኢንች ስማርት ቲቪ', price: 68000, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Home Theater Set', nameAm: 'ሆም ቲያትር', price: 32000, deliverable: true } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'TV + wall mount installed FREE',
        titleAm: 'ቲቪ + ግድግዳ ማስቀመጫ በነፃ ይገጠማል',
        startsAt: new Date(), endsAt: new Date(Date.now() + 9 * 86400000),
        views: 300, claims: 27
      }});
    }
    if (u.shop.name === 'Getu Medical Clinic') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Full Health Checkup', nameAm: 'ሙሉ የጤና ምርመራ', price: 3500 } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Dental Cleaning', nameAm: 'የጥርስ ጽዳት', price: 1800 } });
      await prisma.offer.create({ data: {
        shopId: shop.id,
        title: 'Building tenants: checkup -30%',
        titleAm: 'ለህንፃው ተከራዮች ምርመራ -30%',
        startsAt: new Date(), endsAt: new Date(Date.now() + 15 * 86400000),
        views: 210, claims: 33
      }});
    }
    if (u.shop.name === 'Print & Copy Express') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Business Cards (500)', nameAm: 'የንግድ ካርድ (500)', price: 1500, deliverable: true } });
      await prisma.product.create({ data: { shopId: shop.id, name: 'Banner Print (per m²)', nameAm: 'ባነር ህትመት', price: 800 } });
    }
    if (u.shop.name === 'Getu Restaurant') {
      await prisma.product.create({ data: { shopId: shop.id, name: 'Office Lunch Delivery', nameAm: 'የቢሮ ምሳ ዲሊቨሪ', price: 300, deliverable: true } });
    }
  }

  console.log(JSON.stringify({
    building: building.name, qrSlug: building.qrSlug, floors: building.floors,
    units: UNITS.length, shops: shopCount, vacant: UNITS.filter(u => !u.shop).length
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
