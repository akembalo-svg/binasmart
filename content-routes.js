'use strict';
// Crawlable pages for Ethiopia's Essential Health Services Package.
//
// The point: "is delivery free at a health centre?" and "which hospital does caesarean sections?"
// are questions people type into a search box, and until now the only way to get BinaSmart's answer
// was to ask a chatbot — which no crawler can do. The corpus earned nothing while those questions
// went to sites that do not have the data.
//
// Each page is one programme area, listing every intervention, the facility levels that provide it,
// and whether the patient pays. Provenance is stated on every page: a page that tells someone what
// they are entitled to has to say where that came from.
const library = require('./content-library');

const escH = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SHORT = {
  'health posts': 'Health post', 'health centres': 'Health centre',
  'primary hospitals': 'Primary hospital', 'general hospitals': 'General hospital',
  'tertiary hospitals': 'Tertiary hospital',
};
const PAY_CLASS = {
  'Free': 'background:#e6f6ec;color:#186a3b',
  'Cost sharing': 'background:#fdf3e0;color:#8a5a00',
  'Cost recovery': 'background:#fdeaea;color:#8a1f1f',
};

const CSS = [
  '<style>',
  '.lib{max-width:1080px;margin:0 auto;padding:8px 16px 48px}',
  '.lib h1{font-size:30px;line-height:1.25;margin:18px 0 8px}',
  '.lib .lead{font-size:17px;color:#444;margin:0 0 18px;max-width:70ch}',
  '.lib .prov{font-size:13px;line-height:1.6;color:#555;background:#f6f7f9;border:1px solid #e3e6ea;border-radius:12px;padding:12px 14px;margin:16px 0 22px}',
  '.lib table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 24px}',
  '.lib th,.lib td{text-align:left;padding:9px 10px;border-bottom:1px solid #e8ebef;vertical-align:top}',
  '.lib th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666;white-space:nowrap}',
  '.lib td.lv{text-align:center;font-weight:700;color:#186a3b}',
  '.lib td.no{text-align:center;color:#c8ccd2}',
  '.lib .pay{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}',
  '.lib .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;margin:14px 0 28px}',
  '.lib .cards a{display:block;padding:14px 16px;border:1.5px solid #e3e6ea;border-radius:14px;text-decoration:none;color:inherit;background:#fff}',
  '.lib .cards a:hover{border-color:#0099FF}',
  '.lib .cards b{display:block;font-size:15px;margin-bottom:3px}',
  '.lib .cards span{font-size:13px;color:#667}',
  '.lib .ask{display:flex;gap:14px;align-items:center;margin:26px 0 8px;padding:15px 18px;border-radius:14px;background:#e7f3fb;border:1.5px solid #bfe0f5;color:#0f4c75;text-decoration:none}',
  '.lib .wrap{overflow-x:auto}',
  '@media(max-width:640px){.lib h1{font-size:24px}}',
  '</style>',
].join('');

function provenance(src) {
  return '<div class="prov"><b>Source:</b> ' + escH(src.document) + ' — ' + escH(src.authority) + '. '
    + 'These are the services the package says should be available at each level of the public health system, and how they are paid for. '
    + 'Availability at a particular facility can differ and fees change: confirm before you travel. '
    + 'BinaSmart is an information service, not a medical provider.</div>';
}

const ASK_AFIYA = '<a class="ask" href="/afiya"><span style="font-size:28px">🩺</span>'
  + '<span><b style="display:block">Ask Dr Afiya</b>'
  + '<span style="font-size:13px">Which department, what to bring, what it costs — in Amharic, English or Afaan Oromoo</span></span>'
  + '<span style="margin-left:auto;font-weight:900">→</span></a>';

module.exports = function contentRoutes(fastify, { shell, root }) {

  fastify.get('/health-services', async (req, reply) => {
    const { pages, source, total } = library.load(root);
    const cards = pages.map(p =>
      '<a href="/health-services/' + p.slug + '"><b>' + escH(p.name) + '</b><span>' + p.count + ' services</span></a>').join('');
    const body = '<main class="lib">'
      + '<h1>Health services in Ethiopia: who provides what, and who pays</h1>'
      + '<p class="lead">Every service in Ethiopia&rsquo;s Essential Health Services Package — ' + total + ' of them — '
      + 'with the level of facility that provides it and whether it is free, cost-shared or cost-recovered. '
      + 'በኢትዮጵያ የጤና አገልግሎቶች የት እንደሚሰጡና ክፍያቸው።</p>'
      + provenance(source) + '<div class="cards">' + cards + '</div>' + ASK_AFIYA + '</main>';
    reply.type('text/html').send(shell({
      title: 'Health services in Ethiopia — who provides what, and who pays | BinaSmart',
      desc: 'All ' + total + ' services in Ethiopia’s Essential Health Services Package: which facility level provides each one, and whether it is free.',
      canonical: 'https://bina.et/health-services',
      extraHead: CSS, body, active: '',
    }));
  });

  fastify.get('/health-services/:slug', async (req, reply) => {
    const { pages, source, levels } = library.load(root);
    const p = pages.find(x => x.slug === req.params.slug);
    if (!p) {
      return reply.code(404).type('text/html').send(shell({
        title: 'Not found — BinaSmart', desc: '', canonical: 'https://bina.et/health-services',
        extraHead: CSS, active: '',
        body: '<main class="lib"><h1>Not found</h1><p><a href="/health-services">← All health services</a></p></main>',
      }));
    }

    const free = p.items.filter(i => i.payment === 'Free').length;
    const rows = p.items.map(i => {
      const sub = i.sub ? '<br><span style="color:#778;font-size:12.5px">' + escH(i.sub) + '</span>' : '';
      const ticks = levels.map(l => i.levels.includes(l) ? '<td class="lv">✓</td>' : '<td class="no">·</td>').join('');
      const pay = i.payment
        ? '<span class="pay" style="' + (PAY_CLASS[i.payment] || '') + '">' + escH(i.payment) + '</span>'
        : '<span style="color:#aab">—</span>';
      return '<tr><td>' + escH(i.name) + sub + '</td>' + ticks + '<td>' + pay + '</td></tr>';
    }).join('');

    const others = pages.filter(x => x.slug !== p.slug).slice(0, 8).map(x =>
      '<a href="/health-services/' + x.slug + '"><b>' + escH(x.name) + '</b><span>' + x.count + ' services</span></a>').join('');

    const schema = '<script type="application/ld+json">' + JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: p.name + ' services in Ethiopia — where they are provided and who pays',
      inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'BinaSmart', url: 'https://bina.et' },
      isBasedOn: {
        '@type': 'Legislation', name: source.document, legislationJurisdiction: 'Ethiopia',
        publisher: { '@type': 'GovernmentOrganization', name: source.authority, url: source.sourceUrl },
      },
      mainEntityOfPage: 'https://bina.et/health-services/' + p.slug,
    }) + '</script>';

    const head = levels.map(l => '<th style="text-align:center">' + escH(SHORT[l] || l) + '</th>').join('');
    const body = '<main class="lib">'
      + '<p style="font-size:13px;margin:14px 0 4px"><a href="/health-services" style="color:#0099FF;text-decoration:none">← All health services</a></p>'
      + '<h1>' + escH(p.name) + ': where each service is provided in Ethiopia, and who pays</h1>'
      + '<p class="lead">' + p.count + ' services in the ' + escH(p.name) + ' programme of Ethiopia&rsquo;s Essential Health Services Package'
      + (free ? ', of which <b>' + free + ' are free of charge</b>' : '')
      + '. A tick means that level of facility is expected to provide the service.</p>'
      + provenance(source)
      + '<div class="wrap"><table><thead><tr><th>Service</th>' + head + '<th>Payment</th></tr></thead><tbody>'
      + rows + '</tbody></table></div>'
      + ASK_AFIYA
      + '<h2 style="font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#667;margin:28px 0 10px">Other programmes</h2>'
      + '<div class="cards">' + others + '</div></main>';

    reply.type('text/html').send(shell({
      title: p.name + ' services in Ethiopia — who provides what, and who pays | BinaSmart',
      desc: 'All ' + p.count + ' ' + p.name + ' services in Ethiopia’s Essential Health Services Package: which facility level provides each, and whether it is free.',
      canonical: 'https://bina.et/health-services/' + p.slug,
      extraHead: CSS + schema, body, active: '',
    }));
  });

  // urls for the sitemap
  fastify.decorate('healthServiceUrls', function () {
    const { pages } = library.load(root);
    return ['https://bina.et/health-services'].concat(pages.map(p => 'https://bina.et/health-services/' + p.slug));
  });
};
