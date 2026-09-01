// BinaSmart app-shell service worker
const CACHE='bina-v1';
const SHELL=['/','/icon-192.png','/icon-512.png','/icon-32.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL).catch(()=>{})));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const ks=await caches.keys();await Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET') return;
  const url=new URL(req.url); if(url.origin!==location.origin) return;
  if(req.mode==='navigate'){ e.respondWith(fetch(req).catch(()=>caches.match('/'))); return; }
  if(/\.(png|jpe?g|svg|ico|webp|css|woff2?)$/.test(url.pathname)){
    e.respondWith(caches.match(req).then(r=>r||fetch(req).then(rr=>{const cp=rr.clone();caches.open(CACHE).then(c=>c.put(req,cp));return rr;}).catch(()=>r)));
  }
});
