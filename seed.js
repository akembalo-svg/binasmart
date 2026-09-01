// Seed: Darulle Building with 24 units, 15 shops, products & offers
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNITS = [
  { n:'G-01', f:0, area:85, rent:35000, shop:{ name:'Habesha Supermarket', am:'ሀበሻ ሱፐርማርኬት', cat:'RETAIL', icon:'🛒' } },
  { n:'G-02', f:0, area:35, rent:18000, shop:{ name:'Zemen Pharmacy', am:'ዘመን ፋርማሲ', cat:'PHARMACY', icon:'💊' } },
  { n:'G-03', f:0, area:28, rent:18000, shop:null },
  { n:'G-04', f:0, area:42, rent:25000, shop:{ name:'Abebe Coffee', am:'አበበ ቡና', cat:'CAFE', icon:'☕' } },
  { n:'1-01', f:1, area:65, rent:28000, shop:{ name:'Selam Law Office', am:'ሰላም ጠበቃ', cat:'OFFICE', icon:'⚖️' } },
  { n:'1-02', f:1, area:45, rent:22000, shop:{ name:'Ethio Accounting', am:'ኢትዮ አካውንቲንግ', cat:'OFFICE', icon:'📊' } },
  { n:'1-03', f:1, area:50, rent:22000, shop:null },
  { n:'1-04', f:1, area:38, rent:20000, shop:{ name:'Rose Beauty Salon', am:'ሮዝ ውበት ሳሎን', cat:'SALON', icon:'💇‍♀️' } },
  { n:'2-01', f:2, area:90, rent:38000, shop:{ name:'Tech Solutions PLC', am:'ቴክ ሶሉሽንስ', cat:'OFFICE', icon:'💻' } },
  { n:'2-02', f:2, area:55, rent:28000, shop:{ name:'Dr. Mulugeta Clinic', am:'ዶ/ር ሙሉጌታ ክሊኒክ', cat:'CLINIC', icon:'🏥' } },
  { n:'2-03', f:2, area:45, rent:20000, shop:null },
  { n:'2-04', f:2, area:40, rent:22000, shop:{ name:'Axum Travel', am:'አክሱም ጉዞ', cat:'SERVICE', icon:'✈️' } },
  { n:'3-01', f:3, area:120, rent:85000, shop:{ name:'CBE Branch', am:'ንግድ ባንክ', cat:'BANK', icon:'🏦' } },
  { n:'3-02', f:3, area:60, rent:32000, shop:{ name:'Hassan Real Estate', am:'ሀሰን ሪል እስቴት', cat:'OFFICE', icon:'🏘️' } },
  { n:'3-03', f:3, area:50, rent:26000, shop:{ name:'Birhan Insurance', am:'ብርሃን ኢንሹራንስ', cat:'OFFICE', icon:'🛡️' } },
  { n:'3-04', f:3, area:50, rent:21000, shop:null },
  { n:'4-01', f:4, area:75, rent:36000, shop:{ name:'Alem Consulting', am:'አለም አማካሪ', cat:'OFFICE', icon:'📈' } },
  { n:'4-02', f:4, area:55, rent:28000, shop:{ name:'Hamer Marketing', am:'ሀመር ማርኬቲንግ', cat:'OFFICE', icon:'📣' } },
  { n:'4-03', f:4, area:45, rent:22000, shop:{ name:'Lidya Design Studio', am:'ሊድያ ዲዛይን', cat:'SERVICE', icon:'🎨' } },
  { n:'4-04', f:4, area:65, rent:28000, shop:null },
  { n:'5-01', f:5, area:150, rent:65000, shop:{ name:'Royal Gym', am:'ሮያል ጂም', cat:'GYM', icon:'💪' } },
  { n:'5-02', f:5, area:100, rent:45000, shop:{ name:'Sky Restaurant', am:'ስካይ ሬስቶራንት', cat:'RESTAURANT', icon:'🍽️' } },
  { n:'5-03', f:5, area:80, rent:35000, shop:null },
  { n:'5-04', f:5, area:70, rent:32000, shop:{ name:'Elite Spa', am:'ኢሊት ስፓ', cat:'SALON', icon:'🧖‍♀️' } },
];

async function main() {
  // wipe (idempotent re-seed)
  await prisma.orderItem.deleteMany(); await prisma.order.deleteMany();
  await prisma.review.deleteMany(); await prisma.favorite.deleteMany();
  await prisma.offer.deleteMany(); await prisma.product.deleteMany();
  await prisma.jobPost.deleteMany(); await prisma.shop.deleteMany();
  await prisma.meterReading.deleteMany(); await prisma.meter.deleteMany();
  await prisma.invoice.deleteMany(); await prisma.contract.deleteMany();
  await prisma.maintenanceRequest.deleteMany(); await prisma.lead.deleteMany();
  await prisma.tenancy.deleteMany(); await prisma.unit.deleteMany();
  await prisma.buildingEvent.deleteMany(); await prisma.qrScanEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.building.deleteMany();
  await prisma.paymentRecord.deleteMany(); await prisma.screeningConsent.deleteMany();
  await prisma.scoreDispute.deleteMany(); await prisma.tenantProfile.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.user.deleteMany(); await prisma.organization.deleteMany();

  const org = await prisma.organization.create({ data: { name: 'Darulle Properties', plan: 'PRO' } });

  const owner = await prisma.user.create({ data: {
    orgId: org.id, phone: '+251911000001', fullName: 'Fuad K.', role: 'OWNER', language: 'am'
  }});

  const building = await prisma.building.create({ data: {
    orgId: org.id, ownerId: owner.id,
    name: 'Darulle Building', nameAm: 'ዳሩሌ ህንፃ',
    city: 'Addis Ababa', subCity: 'Bole',
    floors: 6, qrSlug: 'darulle',
    threeD_style: 'modern', threeD_facadeColor: '#c2a875',
    threeD_width: 12, threeD_depth: 8,
    signText: 'ዳሩሌ ህንፃ',
    marketplaceEnabled: true
  }});

  let shopCount = 0, prodCount = 0;
  for (const u of UNITS) {
    const unit = await prisma.unit.create({ data: {
      buildingId: building.id, number: u.n, floor: u.f,
      areaSqm: u.area, monthlyRent: u.rent,
      status: u.shop ? 'OCCUPIED' : 'VACANT',
      unitType: u.f === 0 ? 'SHOP' : 'OFFICE'
    }});

    if (u.shop) {
      const tUser = await prisma.user.create({ data: {
        orgId: org.id, phone: '+2519' + String(11000100 + shopCount),
        fullName: u.shop.name + ' Owner', role: 'TENANT'
      }});
      const tenancy = await prisma.tenancy.create({ data: {
        unitId: unit.id, userId: tUser.id,
        startDate: new Date('2025-09-01'), active: true
      }});
      await prisma.contract.create({ data: {
        tenancyId: tenancy.id,
        startDate: new Date('2025-09-01'), endDate: new Date('2026-08-31'),
        monthlyRent: u.rent
      }});
      const shop = await prisma.shop.create({ data: {
        tenancyId: tenancy.id, name: u.shop.name, nameAm: u.shop.am,
        category: u.shop.cat, phone: tUser.phone, icon: u.shop.icon,
        avgRating: 4 + Math.random(), reviewCount: 10 + Math.floor(Math.random()*60),
        isOpenNow: true
      }});
      shopCount++;

      if (u.shop.name === 'Abebe Coffee') {
        const prods = [
          ['Macchiato','ማኪያቶ',80],['Croissant','ክሮሳንት',120],['Special Tea','ልዩ ሻይ',50],['Fresh Juice','ጭማቂ',90]
        ];
        for (const [name, am, price] of prods) {
          await prisma.product.create({ data: { shopId: shop.id, name, nameAm: am, price, deliverable: true, orderCount: Math.floor(Math.random()*40) }});
          prodCount++;
        }
        await prisma.offer.create({ data: {
          shopId: shop.id,
          title: 'Buy 2 Macchiato → 1 FREE Croissant',
          titleAm: '2 ማኪያቶ ይግዙ → 1 ክሮሳንት ነፃ',
          startsAt: new Date(), endsAt: new Date(Date.now() + 86400000),
          views: 156, claims: 23
        }});
      }
      if (u.shop.name === 'Royal Gym') {
        await prisma.product.create({ data: { shopId: shop.id, name: 'Monthly Membership', nameAm: 'ወርሃዊ አባልነት', price: 1500 }});
        await prisma.product.create({ data: { shopId: shop.id, name: 'Day Pass', nameAm: 'የቀን ትኬት', price: 200 }});
        prodCount += 2;
        await prisma.offer.create({ data: {
          shopId: shop.id, title: 'First month -50% for building tenants',
          titleAm: 'ለህንፃው ተከራዮች የመጀመሪያ ወር -50%',
          startsAt: new Date(), endsAt: new Date(Date.now() + 7*86400000),
          views: 89, claims: 12
        }});
      }
      if (u.shop.name === 'Sky Restaurant') {
        await prisma.product.create({ data: { shopId: shop.id, name: 'Weekend Buffet', nameAm: 'የቅዳሜ-እሁድ ቡፌ', price: 950 }});
        prodCount++;
      }
    }
  }

  const stats = {
    org: org.name, building: building.name, qrSlug: building.qrSlug,
    units: await prisma.unit.count(),
    occupied: await prisma.unit.count({ where: { status: 'OCCUPIED' } }),
    shops: await prisma.shop.count(),
    products: await prisma.product.count(),
    offers: await prisma.offer.count(),
    users: await prisma.user.count()
  };
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
