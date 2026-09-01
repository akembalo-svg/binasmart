// One-off Amharic social broadcast for BinaSmart news posts
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');

const TG_TOK = process.env.BINASMART_TG_TOKEN;
const TG_CH  = process.env.BINA_TG_CHANNEL;
const FB_ID  = process.env.BINA_FB_PAGE_ID;
const FB_TOK = process.env.BINA_FB_PAGE_TOKEN;

const slugs = process.argv.slice(2);

async function tgPhoto(photo, caption){
  const r = await fetch('https://api.telegram.org/bot'+TG_TOK+'/sendPhoto', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: TG_CH, photo, caption, parse_mode:'HTML' })
  });
  const j = await r.json();
  return j.ok ? 'OK' : 'FAIL ' + JSON.stringify(j).slice(0,200);
}
async function fbPhoto(message, photo){
  const r = await fetch('https://graph.facebook.com/v21.0/'+FB_ID+'/photos', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ url: photo, caption: message, access_token: FB_TOK })
  });
  const j = await r.json();
  return (j.id||j.post_id) ? 'OK '+(j.post_id||j.id) : 'FAIL ' + JSON.stringify(j.error||j).slice(0,250);
}

(async()=>{
  for (const slug of slugs){
    const p = await prisma.newsPost.findUnique({ where:{ slug } });
    if (!p){ console.log(slug, '-> NOT FOUND'); continue; }
    const url = 'https://bina.et/news/' + p.slug;
    const og  = 'https://bina.et/static/og-' + p.slug + '.png';
    const title = p.titleAm || p.title;
    const tags = '#ቢናዜና #ቴክኖሎጂ #BinaZena #Ethiopia';
    const msg = (p.heroEmoji||'📰') + ' ' + title + '\n\n' + p.excerpt +
                '\n\n📖 ሙሉውን ጽሑፍ በአማርኛ ያንብቡ፦\n' + url + '\n\n' + tags;
    console.log('--- ' + slug);
    console.log('  Telegram:', await tgPhoto(og, msg).catch(e=>'ERR '+e.message));
    console.log('  Facebook:', await fbPhoto(msg, og).catch(e=>'ERR '+e.message));
  }
  process.exit(0);
})();
