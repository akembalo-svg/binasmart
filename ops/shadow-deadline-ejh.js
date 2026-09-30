// Shadow test: old deadlineFrom vs the wider one, on real pages we currently hold with no deadline.
// READ ONLY — fetches the source pages and compares. Writes nothing.
const { PrismaClient } = require('@prisma/client');
const NEW = require('./_deadline-candidate.js').deadlineFrom;
const UA='BinaSmartBot/1.0 (+https://bina.et/jobs; Ethiopian jobs aggregator)';
const unent=s=>String(s).replace(/&nbsp;/g,' ').replace(/&#8217;|&rsquo;/g,"'").replace(/&#8211;|&ndash;/g,'–').replace(/&quot;/g,'"').replace(/&#0?39;|&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const strip=h=>String(h||'').replace(/<(script|style|ins|iframe|noscript)\b[\s\S]*?<\/\1>/gi,' ').replace(/<\/(p|div|li|h[1-6]|tr)>/gi,'\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ');
const tidy=s=>unent(s).replace(/[ \t]+/g,' ').split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
function OLD(text, from=Date.now()){
  const m=/(?:deadline|closing\s+date|last\s+day|dead\s*line)\s*[:\-–]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s*20\d\d|\d{1,2}\s+[A-Za-z]{3,9},?\s*20\d\d|\d{4}-\d{2}-\d{2})/i.exec(text);
  if(!m) return null;
  const d=new Date(m[1].replace(/(\d)(st|nd|rd|th)/i,'$1'));
  if(isNaN(d.getTime())) return null;
  if(d.getTime()<from-86400000||d.getTime()>from+200*86400000) return null;
  return d;
}
(async()=>{
  const p=new PrismaClient();
  const rows=await p.job.findMany({where:{sourceName:'EthioJobsHub',deadline:null},orderBy:{publishedAt:'desc'},take:Number(process.argv[2]||25),select:{slug:true,sourceUrl:true,publishedAt:true}});
  const seen=new Set(); let gained=0,both=0,none=0,fail=0;
  for(const r of rows){
    if(!r.sourceUrl||seen.has(r.sourceUrl)) continue; seen.add(r.sourceUrl);
    let h=''; try{const x=await fetch(r.sourceUrl,{headers:{'user-agent':UA}}); h=x.ok?await x.text():'';}catch(e){}
    if(!h){fail++;continue;}
    const t=tidy(strip(h)); const from=new Date(r.publishedAt).getTime();
    const o=OLD(t,from), n=NEW(t,from);
    const os=o?o.toISOString().slice(0,10):'-', ns=n?n.toISOString().slice(0,10):'-';
    if(!o&&n){gained++;console.log('  GAINED',ns,r.slug.slice(0,52));}
    else if(o&&n){both++; if(os!==ns) console.log('  DIFFER old',os,'new',ns,r.slug.slice(0,44));}
    else none++;
  }
  console.log('\npages',seen.size,'| new date where there was none:',gained,'| both agreed:',both,'| still none:',none,'| fetch failed:',fail);
  await p.$disconnect();
})();
