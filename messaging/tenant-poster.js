'use strict';
// The printable A4 poster that invites a building's tenants to link @bina_smart_bot (messaging design §2).
// Served behind the owner key (server.js), but it holds nothing private: only the building's name and the bot link.
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tenantPoster({ building, startUrl, qrSvg }) {
  const name = building.name || '', nameAm = building.nameAm || name;
  return '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>' + esc(name) + ' · Telegram notices</title>'
    + '<link rel="stylesheet" href="/static/fonts/fonts.css?v=2">'
    + '<style>@page{size:A4;margin:0}body{margin:0;font-family:Inter,"Noto Sans Ethiopic",sans-serif;background:#e5e7eb;color:#0f2027}'
    + '.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;box-sizing:border-box;padding:16mm 16mm;text-align:center}'
    + '.bld{font-size:22px;font-weight:800;margin-bottom:8mm}h1{font-size:30px;margin:0 0 3mm}h2{font-size:20px;margin:0 0 10mm;color:#068f79}'
    + '.qr{width:105mm;margin:0 auto 8mm}.qr svg{width:100%;height:auto;display:block}'
    + '.steps{text-align:left;max-width:150mm;margin:0 auto;font-size:17px;line-height:1.5;padding-left:7mm}.steps li{margin-bottom:4mm}.steps small{color:#475569;font-size:14px}'
    + '.link{font-size:14px;color:#0369a1;word-break:break-all;margin:6mm 0}.foot{font-size:13px;color:#64748b;margin-top:8mm;line-height:1.6}'
    + '.bar{text-align:center;padding:12px}.btn{display:inline-block;padding:10px 18px;background:#068f79;color:#fff;border:0;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer}'
    + '@media print{body{background:#fff}.bar{display:none}}</style></head><body>'
    + '<div class="bar"><button class="btn" onclick="window.print()">🖨️ Print · አትም</button></div>'
    + '<div class="page"><div class="bld">🏢 ' + esc(nameAm) + (nameAm !== name ? ' · ' + esc(name) : '') + '</div>'
    + '<h1>የኪራይ መልእክቶችዎን በቴሌግራም ያግኙ</h1><h2>Get your rent notices on Telegram</h2>'
    + '<div class="qr">' + qrSvg + '</div>'
    + '<ol class="steps">'
    + '<li>QR ኮዱን በስልክዎ ካሜራ ይቃኙ ወይም ከታች ያለውን ሊንክ ይክፈቱ።<br><small>Scan the QR code with your phone camera, or open the link below.</small></li>'
    + '<li>በቴሌግራም «Start»ን፣ ከዚያ «📱 ስልኬን አጋራ»ን ይጫኑ።<br><small>In Telegram tap Start, then "📱 Share my phone".</small></li>'
    + '<li>የሚያጋሩት ስልክ ቁጥር በኪራይ ውልዎ ላይ የተመዘገበው መሆን አለበት።<br><small>The number you share must be the one registered for your tenancy.</small></li>'
    + '</ol>'
    + '<div class="link">' + esc(startUrl) + '</div>'
    + '<div class="foot">የክፍያ መጠየቂያዎች፣ ደረሰኞችና የህንፃ ማሳሰቢያዎች ብቻ ይላካሉ። ለማቆም /stop ይጻፉ።<br>'
    + 'Only invoices, receipts and building notices are sent. Send /stop to stop.<br><b>BinaSmart · bina.et</b></div>'
    + '</div></body></html>';
}

module.exports = { tenantPoster };
