// BinaSmart image uploader — standalone service on :4219
// Survives server.js redeploys. Serves an upload page + saves into public/.
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4219;
const KEY = process.env.OWNER_KEY || 'darulle2026';
const PUBLIC_DIR = '/var/www/connectcare/binasmart/public';

const PAGE = `<!DOCTYPE html><html lang="am"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ቢና — ፎቶ መጫኛ</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Noto Sans Ethiopic',sans-serif;background:#f8f7f3;color:#141414;padding:22px;max-width:560px;margin:0 auto}
h1{font-size:22px;margin-bottom:4px}
p.s{color:#6f6a60;font-size:14px;margin-bottom:22px}
label{display:block;font-weight:700;font-size:14px;margin:16px 0 6px}
input[type=text],input[type=password]{width:100%;padding:13px;border:1.5px solid #e0dacd;border-radius:12px;font-size:16px;background:#fff}
.drop{border:2px dashed #c9c2b2;border-radius:18px;padding:34px 18px;text-align:center;background:#fff;margin-top:8px}
.drop input{display:none}
.pick{display:inline-block;background:#0d7a4f;color:#fff;padding:13px 26px;border-radius:999px;font-weight:700;font-size:16px}
button{width:100%;margin-top:20px;padding:15px;border:0;border-radius:14px;background:#141414;color:#fff;font-size:17px;font-weight:700}
button:disabled{opacity:.5}
#out{margin-top:20px;padding:15px;border-radius:14px;font-size:14px;display:none;word-break:break-all}
.ok{background:#e6f4ee;border:1.5px solid #0d7a4f}
.err{background:#fdeaea;border:1.5px solid #c62a3a}
#prev{max-width:100%;border-radius:12px;margin-top:14px;display:none}
code{background:#141414;color:#7fd0ab;padding:9px 12px;border-radius:8px;display:block;margin-top:9px;font-size:13px}
</style></head><body>
<h1>ቢና — ፎቶ መጫኛ 📸</h1>
<p class="s">ፎቶ ምረጥ → ጫን → ሊንኩን ለ Claude ላክ።</p>
<label>የባለቤት ቁልፍ</label>
<input type="password" id="key" placeholder="key" autocomplete="off">
<label>ስም (አማራጭ)</label>
<input type="text" id="name" placeholder="ለምሳሌ፦ aramco-stadium">
<div class="drop">
  <label class="pick" for="file">ፎቶ ምረጥ</label>
  <input type="file" id="file" accept="image/*">
  <div id="fname" style="margin-top:12px;color:#6f6a60;font-size:14px">ምንም አልተመረጠም</div>
  <img id="prev">
</div>
<button id="go" disabled>ጫን ⬆️</button>
<div id="out"></div>
<script>
const f=document.getElementById('file'),go=document.getElementById('go'),out=document.getElementById('out');
f.onchange=()=>{if(f.files[0]){document.getElementById('fname').textContent=f.files[0].name;
const p=document.getElementById('prev');p.src=URL.createObjectURL(f.files[0]);p.style.display='block';go.disabled=false;}};
go.onclick=async()=>{
 go.disabled=true;go.textContent='እየተጫነ...';out.style.display='none';
 const r=new FileReader();
 r.onload=async()=>{
  try{
   const res=await fetch('/bina-upload/upload?key='+encodeURIComponent(document.getElementById('key').value),
    {method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({name:document.getElementById('name').value,base64:r.result})});
   const j=await res.json();
   out.style.display='block';
   if(j.ok){out.className='ok';out.innerHTML='✅ ተጫነ!<code>'+j.url+'</code><small style="color:#6f6a60">ይህን ሊንክ ለ Claude ላክ።</small>';}
   else{out.className='err';out.textContent='❌ '+(j.error||'አልተሳካም');}
  }catch(e){out.style.display='block';out.className='err';out.textContent='❌ '+e.message;}
  go.disabled=false;go.textContent='ጫን ⬆️';
 };
 r.readAsDataURL(f.files[0]);
};
</script></body></html>`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && u.pathname.endsWith('/upload')) {
    if (u.searchParams.get('key') !== KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'wrong key' }));
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 30e6) req.destroy(); });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const b = JSON.parse(body);
        const m = /^data:image\/(png|jpe?g|webp|gif);base64,/.exec(b.base64 || '');
        if (!m) { res.writeHead(400); return res.end(JSON.stringify({ error: 'not an image' })); }
        let ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        let name = String(b.name || 'upload-' + Date.now()).trim().replace(/[^a-zA-Z0-9._-]/g, '-') || 'upload';
        name = name.replace(/\.(png|jpe?g|webp|gif)$/i, '') + '.' + ext;
        const buf = Buffer.from(b.base64.split(',')[1], 'base64');
        if (buf.length < 500) { res.writeHead(400); return res.end(JSON.stringify({ error: 'file too small' })); }
        fs.writeFileSync(path.join(PUBLIC_DIR, name), buf);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, url: 'https://bina.et/static/' + name, bytes: buf.length }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }
  res.writeHead(404); res.end('nope');
}).listen(PORT, '127.0.0.1', () => console.log('bina-uploader on ' + PORT));
