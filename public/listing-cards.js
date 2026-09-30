/* The listing cards of bina.et/property and bina.et/cars, shared by the browser (window.BinaCards) and the server,
   which writes the first cards into the page so search engines see them (server.js, /property and /cars). */
(function (root) {
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function cssUrl(u){return /^https?:\/\//i.test(u||'')?String(u).replace(/[()'"\\\s]/g,function(c){return '%'+('0'+c.charCodeAt(0).toString(16)).slice(-2).toUpperCase()}):''}
// Bayut-style card: photo with the company's round logo, price first, bed/bath/size icons, then the
// company's OWN Call / WhatsApp / Telegram (taken from its listing page by ops/places/property-import.js).
// A button is hidden when the company doesn't publish that contact; with none at all, "Website" shows instead.
function ic(n){var d={bed:'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9',bath:'M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.68 3 4 3.68 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M2 12h20M7 19v2M17 19v2',
 area:'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
 year:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',gauge:'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',fuel:'M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M15 10h2a2 2 0 0 1 2 2v5a2 2 0 0 0 4 0V9l-3-3M7 7h4',gear:'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
 call:'M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
 wa:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z',
 tg:'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',pin:'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'}[n];
 return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+d+'"/></svg>'}
function httpLink(u){return typeof u==='string'&&/^https?:\/\//i.test(u)}
function telOf(p){var t=String(p.phone||'').replace(/[^\d+]/g,'');return t.length>=9?t:''}
// WhatsApp: the one the company publishes, else its phone when that is an Ethiopian mobile (09/07).
function waOf(p){var w=String(p.whatsapp||'').replace(/\D/g,'');if(!w){var t=String(p.phone||'').replace(/\D/g,'');if(/^251[79]\d{8}$/.test(t))w=t}return w}
// The date the company last updated it; older than a year = "ask if it is still available" (it may be sold).
var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function ageTag(x){if(!x.updated)return '';var d=new Date(x.updated+'T00:00:00Z');if(isNaN(d))return '';var old=(Date.now()-d)>365*864e5;
  return '<div class="age'+(old?' old':'')+'">'+(old?'⚠️ Older listing · ask if still available · ':'🕒 ')+'Updated '+MON[d.getUTCMonth()]+' '+d.getUTCFullYear()+'</div>'}
function propertyCard(p){
  var img=cssUrl(p.imageUrl),ph=img?('style="background-image:url('+esc(img)+')"'):'';
  var box=img?'':(p.agency?'<span class="an">'+esc(p.agency)+'</span>':'🏠');
  var logo=p.logo&&/^\/static\//.test(p.logo)?'<img class="clogo" src="'+esc(p.logo)+'" alt="'+esc(p.agency||'')+' logo" loading="lazy" onerror="this.remove()">':'';
  var facts=[p.beds?'<span>'+ic('bed')+esc(p.beds)+'</span>':'',p.baths?'<span>'+ic('bath')+esc(p.baths)+'</span>':'',p.area?'<span>'+ic('area')+esc(p.area)+'</span>':''].join('');
  var link=httpLink(p.sourceUrl)?p.sourceUrl:'https://bina.et/property#p-'+p.slug;
  var msg='Hello'+(p.agency?' '+p.agency:'')+', I saw this property on BinaSmart (bina.et) and I am interested:\n'+p.title+(p.price?'\n'+p.price:'')+'\n'+link;
  var tel=telOf(p),wa=waOf(p),tg=/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(p.telegram||'')?p.telegram:'';
  var btns=(tel?'<a class="c call" href="tel:'+esc(tel)+'">'+ic('call')+'Call</a>':'')+
   (wa?'<a class="c wa" href="https://wa.me/'+wa+'?text='+encodeURIComponent(msg)+'" target="_blank" rel="noopener">'+ic('wa')+'WhatsApp</a>':'')+
   (tg?'<a class="c tg" href="https://t.me/'+tg+'?text='+encodeURIComponent(msg)+'" target="_blank" rel="noopener">'+ic('tg')+'Telegram</a>':'');
  if(!btns&&httpLink(p.sourceUrl))btns='<a class="c call" href="'+esc(p.sourceUrl)+'" target="_blank" rel="noopener nofollow">Contact on their website ↗</a>';
  var dl='/property/'+encodeURIComponent(p.slug);
  return '<div class="pc" id="p-'+esc(p.slug)+'"><a class="ph'+(img?'':' noimg')+'" href="'+dl+'" '+ph+' aria-label="'+esc(p.title)+'">'+box+
   '<span class="lt">'+(p.listingType==='rent'?'For rent':'For sale')+'</span>'+(p.verified?'<span class="vf" title="Checked by BinaSmart">✓ Verified</span>':'')+
   (img&&p.agency?'<span class="cr">Photo: '+esc(p.agency)+'</span>':'')+logo+'</a>'+
   '<div class="bd">'+(p.price?'<div class="price">'+esc(p.price)+'</div>':'<div class="price ask">Price on request</div>')+
   (p.propertyType?'<div class="ty">'+esc(p.propertyType)+'</div>':'')+'<h3><a href="'+dl+'">'+esc(p.title)+'</a></h3>'+
   (facts?'<div class="facts">'+facts+'</div>':'')+
   ((p.location||p.city)?'<div class="dl">'+ic('pin')+esc(p.location||p.city)+'</div>':'')+
   ageTag(p)+'<a class="pmore" href="'+dl+'">See all details & photos →</a>'+
   (p.companySlug?'<div class="by">Listed by <a href="/companies/'+encodeURIComponent(p.companySlug)+'">'+esc(p.agency||'the company')+'</a>'+
     (httpLink(p.sourceUrl)?' · <a href="'+esc(p.sourceUrl)+'" target="_blank" rel="noopener nofollow">their website ↗</a>':'')+'</div>':(p.agency?'<div class="by">'+esc(p.agency)+'</div>':''))+
   (btns?'<div class="pcta">'+btns+'</div>':'')+'</div></div>';
}
function carCard(c){
  var cn=/china/i.test(c.city||'');
  var img=cssUrl(c.imageUrl),ph=img?('style="background-image:url('+esc(img)+')"'):'',dl='/cars/'+encodeURIComponent(c.slug);
  var box=img?'':(c.dealer?'<span class="an">'+esc(c.dealer)+'</span>':'🚗');
  var logo=c.logo&&/^\/static\//.test(c.logo)?'<img class="clogo" src="'+esc(c.logo)+'" alt="'+esc(c.dealer||'')+' logo" loading="lazy" onerror="this.remove()">':'';
  var facts=[c.year?'<span>'+ic('year')+esc(c.year)+'</span>':'',c.mileage?'<span>'+ic('gauge')+esc(c.mileage)+'</span>':'',c.fuel?'<span>'+ic('fuel')+esc(c.fuel)+'</span>':'',c.transmission?'<span>'+ic('gear')+esc(c.transmission)+'</span>':''].join('');
  var link=httpLink(c.sourceUrl)?c.sourceUrl:'https://bina.et'+dl;
  var msg='Hello'+(c.dealer?' '+c.dealer:'')+', I saw this car on BinaSmart (bina.et) and I am interested:\n'+c.title+(cn?' (in China)':'')+(c.price?'\n'+c.price+(cn?' in China, before shipping, duty and tax':''):'')+'\n'+link;
  var tel=telOf(c),wa=waOf(c),tg=/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(c.telegram||'')?c.telegram:'';
  var btns=(tel?'<a class="c call" href="tel:'+esc(tel)+'">'+ic('call')+'Call</a>':'')+(wa?'<a class="c wa" href="https://wa.me/'+wa+'?text='+encodeURIComponent(msg)+'" target="_blank" rel="noopener">'+ic('wa')+'WhatsApp</a>':'')+
   (tg?'<a class="c tg" href="https://t.me/'+tg+'?text='+encodeURIComponent(msg)+'" target="_blank" rel="noopener">'+ic('tg')+'Telegram</a>':'');
  if(!btns&&httpLink(c.sourceUrl))btns='<a class="c call" href="'+esc(c.sourceUrl)+'" target="_blank" rel="noopener nofollow">Contact on their website ↗</a>';
  if(!btns)btns='<a class="c call" href="#request" data-t="'+esc(c.title)+'" onclick="enquire(\'\',this.getAttribute(\'data-t\'))">Enquire</a>';   // the title stays out of the onclick
  return '<div class="cc" id="c-'+esc(c.slug)+'"><a class="ph'+(img?'':' noimg')+'" href="'+dl+'" '+ph+' aria-label="'+esc(c.title)+'">'+box+(c.condition||cn?'<span class="lt">'+esc([c.condition,cn?'🇨🇳 In China':''].filter(Boolean).join(' · '))+'</span>':'')+
   (img&&c.dealer?'<span class="cr">Photo: '+esc(c.dealer)+'</span>':'')+logo+'</a>'+
   '<div class="bd">'+(c.price?'<div class="price">'+esc(c.price)+'</div>':'<div class="price ask">Price on request</div>')+(cn?'<div class="cnote" style="font-size:12.5px;font-weight:700;color:#b45309;margin:2px 0 6px">In China · before shipping, customs duty and tax · ታክስና ቀረጥ አልተጨመረም</div>':'')+
   '<div class="ty">'+esc([c.bodyType,c.make].filter(Boolean).join(' · '))+'</div><h3><a href="'+dl+'">'+esc(c.title)+'</a></h3>'+
   (facts?'<div class="facts">'+facts+'</div>':'')+ageTag(c)+'<a class="pmore" href="'+dl+'">See all details & photos →</a>'+
   (c.companySlug?'<div class="by">Sold by <a href="/companies/'+encodeURIComponent(c.companySlug)+'">'+esc(c.dealer||'the dealer')+'</a>'+(httpLink(c.sourceUrl)?' · <a href="'+esc(c.sourceUrl)+'" target="_blank" rel="noopener nofollow">their website ↗</a>':'')+'</div>':(c.dealer?'<div class="by">'+esc(c.dealer)+'</div>':''))+
   '<div class="pcta">'+btns+'</div></div></div>';
}

var api = { propertyCard: propertyCard, carCard: carCard, esc: esc };
if (typeof module === 'object' && module.exports) module.exports = api; else root.BinaCards = api;
})(this);
