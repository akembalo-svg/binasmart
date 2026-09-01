const fs = require('fs');

// 1) server.js: add GET /login route
const sf = '/var/www/connectcare/binasmart/server.js';
let s = fs.readFileSync(sf, 'utf8');
if (!s.includes("sendFile('login.html')")) {
  const a = "fastify.get('/nav', async (req, reply) => reply.sendFile('nav.html'));";
  if (!s.includes(a)) { console.error('server anchor missing'); process.exit(1); }
  s = s.replace(a, a + "\nfastify.get('/login', async (req, reply) => reply.sendFile('login.html'));");
  fs.writeFileSync(sf, s);
  console.log('server.js: /login route added');
} else console.log('server.js: already has /login');

// 2) owner.html: 401 screen -> redirect to login page (session-first world)
const of = '/var/www/connectcare/binasmart/public/owner.html';
let o = fs.readFileSync(of, 'utf8');
if (o.includes('REDIR-TO-LOGIN')) { console.log('owner.html: already patched'); process.exit(0); }
const start = o.indexOf("if (r.status === 401) {");
const endMark = "    return;\n  }";
const end = o.indexOf(endMark, start);
if (start < 0 || end < 0) { console.error('owner anchors missing'); process.exit(1); }
const replacement = `if (r.status === 401) { // REDIR-TO-LOGIN
    localStorage.removeItem('bs_key'); KEY = '';
    const prefix = location.pathname.split('/owner/')[0];
    location.href = prefix + '/login';
    return;
  }`;
o = o.slice(0, start) + replacement + o.slice(end + endMark.length);
fs.copyFileSync(of, of + '.bak-preauth');
fs.writeFileSync(of, o);
console.log('owner.html: 401 now redirects to /login');
