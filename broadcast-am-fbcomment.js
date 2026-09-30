// Broadcast in Amharic. Facebook: link goes in the FIRST COMMENT, not the post body.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TG_TOK = process.env.BINASMART_TG_TOKEN;
const TG_CH  = (process.env.BINA_TG_CHANNEL || process.env.BINA_DIGEST_CHANNEL);
const FB_ID  = process.env.BINA_FB_PAGE_ID;
const FB_TOK = process.env.BINA_FB_PAGE_TOKEN;
// --fb-only / --tg-only let a failed channel be retried WITHOUT re-sending the other.
// Retrying the whole script to fix Facebook posted the same article to Telegram three times.
const rawArgs = process.argv.slice(2);
const fbOnly  = rawArgs.includes('--fb-only');
const tgOnly  = rawArgs.includes('--tg-only');
const slugs   = rawArgs.filter(a => !a.startsWith('--'));

async function tgPhoto(photo, caption){
  const r = await fetch('https://api.telegram.org/bot'+TG_TOK+'/sendPhoto', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: TG_CH, photo, caption, parse_mode:'HTML' })
  });
  const j = await r.json();
  return j.ok ? 'OK' : 'FAIL ' + JSON.stringify(j).slice(0,200);
}

async function fbPhotoNoLink(message, photo){
  const r = await fetch('https://graph.facebook.com/v21.0/'+FB_ID+'/photos', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ url: photo, caption: message, access_token: FB_TOK })
  });
  return await r.json();
}

async function fbComment(postId, message){
  const r = await fetch('https://graph.facebook.com/v21.0/'+postId+'/comments', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ message, access_token: FB_TOK })
  });
  const j = await r.json();
  return j.id ? 'OK '+j.id : 'FAIL ' + JSON.stringify(j.error||j).slice(0,250);
}

(async()=>{
  for (const slug of slugs){
    const p = await prisma.newsPost.findUnique({ where:{ slug } });
    if (!p){ console.log(slug,'-> NOT FOUND'); continue; }
    const url   = 'https://bina.et/news/' + p.slug;
    const og    = 'https://bina.et/static/og-' + p.slug + '.png';
    const title = p.titleAm || p.title;
    const tags  = '#ቢናዜና #ቴክኖሎጂ #BinaZena #Ethiopia';

    // Telegram: link inline (Telegram does not penalise links)
    const tgMsg = (p.heroEmoji||'📰')+' '+title+'\n\n'+p.excerpt+
                  '\n\n📖 ሙሉውን ጽሑፍ በአማርኛ ያንብቡ፦\n'+url+'\n\n'+tags;

    // Facebook: link IN THE BODY. The comment API returns #200 permissions error, so a
    // "link in comments" post sends readers to a dead end. Reduced reach with a working
    // link beats good reach with none. Revert if/when pages_manage_engagement is granted.
    const fbMsg = (p.heroEmoji||'📰')+' '+title+'\n\n'+p.excerpt+
                  '\n\n📖 ሙሉውን ጽሑፍ በአማርኛ ያንብቡ፦\n'+url+'\n\n'+tags;
    const fbCmt = '📖 ሙሉውን ጽሑፍ በአማርኛ ያንብቡ፦\n'+url;

    console.log('--- '+slug);
    if (fbOnly) { console.log('  Telegram: SKIPPED (--fb-only)'); }
    else { console.log('  Telegram:', await tgPhoto(og, tgMsg).catch(e=>'ERR '+e.message)); }

    const fb = tgOnly
      ? { skipped: true }
      : await fbPhotoNoLink(fbMsg, og).catch(e=>({error:{message:e.message}}));
    if (fb.skipped) console.log('  Facebook: SKIPPED (--tg-only)');
    const postId = fb.post_id || fb.id;
    if (!postId){ console.log('  Facebook: FAIL', JSON.stringify(fb.error||fb).slice(0,250)); continue; }
    console.log('  Facebook post (no link):', postId);
    console.log('  FB link comment:', await fbComment(postId, fbCmt).catch(e=>'ERR '+e.message));
  }
  process.exit(0);
})();
