#!/usr/bin/env node
'use strict';
// The Ethiopian Ministry of Revenue's public forms and FAQs, as knowledge documents and as the /tax-forms page.
//
// mor.gov.et is a single-page app over a JSON API (https://www.mor.gov.et/api/<endpoint>). The API is harvested on the
// server into /root/legal-sources/mor/api/*.json (ops/mor/harvest.js) and the documents it lists are downloaded into
// /root/legal-sources/mor/files/<endpoint>/<id>.pdf with a manifest (ops/mor/download.js). This script turns that into:
//
//   knowledge/mor/mor-faqs.md    the Ministry's FAQs, Amharic as published, grouped into tax and customs, with a short
//                                English gloss of each question written by BinaSmart (labelled as ours)
//   knowledge/mor/mor-forms.md   every form: Amharic title, English name and purpose (read from the form's own first
//                                page, curated in ops/mor/forms-info.json), category, pages, our download link, original
//   public/tax-forms.html        the same forms as a bilingual download page (https://bina.et/tax-forms)
//   public/docs/mor/forms/*.pdf  byte-identical copies of the Ministry's PDFs under ASCII names
//
// The API's User / UserId fields name Ministry staff. They are removed before anything is read and never printed.
// knowledge/mor belongs to this script: a .md file there that this run did not produce is removed.
//
//   node ops/mor/mor-to-md.js [--src /root/legal-sources/mor] [--fetched 2026-09-14]

const fs = require('fs');
const path = require('path');

const FORMS_PATH = '/static/docs/mor/forms/';
const SITE = 'https://bina.et';
const MOR = 'https://www.mor.gov.et/';

const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const html = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function stripStaff(v) {
  if (Array.isArray(v)) return v.map(stripStaff);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { if (k === 'User' || k === 'UserId') continue; o[k] = stripStaff(x); } return o; }
  return v;
}

// The file names in the API are UTF-8 read as Latin-1 (mojibake). The server serves them under exactly those
// characters, so the link is the string percent-encoded as it stands; an already-encoded link is left alone.
function originalHref(u) {
  const s = String(u || '');
  return /%[0-9A-Fa-f]{2}/.test(s) ? s : encodeURI(s);
}

// ---------- FAQs ----------
const FAQ_GROUPS = [
  ['domestic law', 'ግብር — የአገር ውስጥ ታክስ', 'Domestic taxes'],
  ['custom law', 'ጉምሩክ — Customs', 'Customs'],
];
// English glosses of the questions, by FAQ id. Ours, not the Ministry's; the answers are never translated here.
const FAQ_GLOSS = {
  11: 'What must a taxpayer provide to get a TIN in order to start a business?',
  13: 'Who pays tax on a gain from transferring capital assets?',
  22: 'What is the penalty for not having a sales register (cash register) machine inspected on time?',
  23: 'Does the amount on which the 3% withholding tax is calculated include VAT?',
  24: 'Is VAT charged when metals, automotive and industrial oils and lubricants are sold locally?',
  25: 'Does the 3% advance tax (withholding) apply to a business during its tax holiday?',
  26: 'Is VAT charged when electric vehicles are sold locally?',
  27: 'When does depreciation of a building start?',
  28: 'Is VAT charged on retention money?',
  29: 'What receipt do we use when buying from people who are not required to print receipts?',
  30: 'How is income tax calculated when an employee has more than one employer?',
  31: 'What tax is due when a person sells taxable immovable property?',
  32: 'Up to what amount are per diem and transport allowances exempt from income tax?',
  33: 'Sales register (cash register) machine users: what to do on a breakdown, a power cut or a change of address?',
  34: 'Is a higher-education cost-sharing clearance given in parts?',
  35: 'Higher-education cost sharing: when must graduates start paying, and how does service count?',
  36: 'Why must exporters register for VAT when exports are zero-rated?',
  37: 'How much of a penalty is waived when a taxpayer who owes only a penalty asks for a waiver?',
  38: 'At what rate is tax withheld from a payment for services to a resident who has no TIN?',
  39: 'Is the food and drink a hotel or restaurant gives its employees fully deductible?',
  41: 'What must the business asset register contain when a company keeps tax accounts?',
  20: 'What evidence must a taxpayer keep when borrowing for the business from someone other than a financial institution?',
  44: 'What documents must importers and exporters present to customs?',
  46: 'Is duty refunded when part of the goods on which duty and tax were paid is missing?',
  48: 'Can a person returning home for good bring personal effects?',
  49: 'Can a vehicle imported duty-free be sold to a person without a duty-free right?',
  50: 'Can goods be imported once without an import trade licence?',
  51: 'How are the duty and taxes on imported goods determined?',
  53: 'How can I find the duty and tax rate of goods?',
  54: 'How do we get the single window service?',
  55: 'Can banks auction duty-free goods they hold as collateral?',
  56: 'Are machinery and goods imported for construction charged duty and tax?',
  12: 'We made a calculation error in a tax declaration — how can it be corrected?',
};

function faqsToMd(faqs, { fetched = '' } = {}) {
  const live = stripStaff(faqs || []).filter(q => q && !q.deleted && norm(q.question));
  const parts = [];
  let count = 0;
  for (const [cat, am, en] of FAQ_GROUPS) {
    const qs = live.filter(q => q.category === cat);
    if (!qs.length) continue;
    parts.push('## ' + am + ' (' + en + ')');
    for (const q of qs) {
      const answers = (q.Answers || []).filter(a => a && !a.deleted && norm(a.answer)).sort((a, b) => a.id - b.id).map(a => norm(a.answer));
      if (!answers.length) continue;
      count++;
      parts.push('### ' + norm(q.question) + '\n\n' + (FAQ_GLOSS[q.id] ? 'Question in English (BinaSmart\'s gloss): ' + FAQ_GLOSS[q.id] + '\n\n' : '')
        + 'የገቢዎች ሚኒስቴር መልስ፦ ' + answers.join('\n'));
    }
  }
  const other = live.filter(q => !FAQ_GROUPS.some(g => g[0] === q.category));
  if (other.length) throw new Error('FAQ category not handled: ' + [...new Set(other.map(q => q.category))].join(', '));
  const fm = ['---', 'title: "Ministry of Revenue FAQs — የገቢዎች ሚኒስቴር ተደጋጋሚ ጥያቄዎችና መልሶች (ግብርና ጉምሩክ)"',
    'source_name: "Ministry of Revenue (mor.gov.et), public FAQ list"', 'url: "' + MOR + '"', 'source_api: "' + MOR + 'api/faqs"',
    'lang: "am"', 'fetched: "' + esc(fetched) + '"', 'questions: ' + count, 'generated_by: "ops/mor/mor-to-md.js"', '---'];
  const intro = ['# የገቢዎች ሚኒስቴር ተደጋጋሚ ጥያቄዎችና መልሶች — Ministry of Revenue FAQs', '',
    'These are the questions and answers the Ethiopian Ministry of Revenue publishes on mor.gov.et' + (fetched ? ', as fetched on ' + fetched : '')
      + ', in Amharic as published. The Ministry does not date its answers, and some figures in them (allowances, withholding rates) may since have been changed by later law such as the Income Tax (Amendment) Proclamation No. 1395/2025; check the current law or the tax office before relying on a figure. The English line under each question is BinaSmart\'s gloss of the question, not the Ministry\'s text.',
    '', 'በአማርኛ፦ ከዚህ በታች ያሉት ጥያቄዎችና መልሶች የገቢዎች ሚኒስቴር በድረ-ገጹ (mor.gov.et) ያወጣቸው ናቸው፤ እንደወጡት ተቀምጠዋል። መልሶቹ ቀን የላቸውም፤ አንዳንድ አሃዞች በኋላ በወጡ ሕጎች (ለምሳሌ የገቢ ግብር ማሻሻያ አዋጅ ቁጥር 1395/2017) ተቀይረው ሊሆን ስለሚችል ከመጠቀምዎ በፊት ከግብር ጽ/ቤት ያረጋግጡ።'];
  return fm.join('\n') + '\n\n' + intro.join('\n') + '\n\n' + parts.join('\n\n') + '\n';
}

// ---------- forms ----------
const CATEGORY_EN_FIX = { 'Value Addede Tax Forms': 'Value Added Tax Forms' };
const catEn = c => CATEGORY_EN_FIX[norm(c && c.engName)] || norm(c && c.engName);

function formSlug(form, info) {
  const i = info && info[form.id];
  if (!i || !i.slug) return 'mor-form-' + form.id;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(i.slug)) throw new Error('form ' + form.id + ': slug must be lower-case ASCII words joined by hyphens: ' + i.slug);
  return i.slug;
}

function liveForms(forms, info) {
  const list = stripStaff(forms || []).filter(f => f && !f.deleted && f.pdfFile);
  const seen = new Map();
  for (const f of list) { const s = formSlug(f, info); if (seen.has(s)) throw new Error('forms ' + seen.get(s) + ' and ' + f.id + ' share the slug ' + s); seen.set(s, f.id); }
  // categories in the order of their first form after sorting by category id, then forms by id
  return list.sort((a, b) => ((a.FormCategory || {}).id || 0) - ((b.FormCategory || {}).id || 0) || a.id - b.id);
}
function groups(list) {
  const m = new Map();
  for (const f of list) { const c = f.FormCategory || {}; const k = c.id != null ? c.id : 'none'; if (!m.has(k)) m.set(k, { am: norm(c.name), en: catEn(c), forms: [] }); m.get(k).forms.push(f); }
  return [...m.values()];
}
const kb = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const pagesText = n => n ? n + (n === 1 ? ' page' : ' pages') : '';

function formsToMd(forms, { info = {}, files = {}, fetched = '' } = {}) {
  const list = liveForms(forms, info);
  const blocks = [];
  for (const g of groups(list)) {
    blocks.push('## ' + (g.am ? g.am + ' — ' : '') + g.en);
    for (const f of g.forms) {
      const i = info[f.id] || {}, fl = files[f.id] || {};
      const lines = ['### ' + norm(f.title), ''];
      if (i.en) lines.push('English name: ' + i.en);
      lines.push('Category: ' + (g.am ? g.am + ' (' + g.en + ')' : g.en));
      if (i.purpose_en) lines.push('What it is for: ' + i.purpose_en);
      if (i.purpose_am) lines.push('ለምን ይጠቅማል፦ ' + i.purpose_am);
      if (i.language) lines.push('Language of the form: ' + i.language);
      if (fl.sha256) lines.push('Download (BinaSmart copy' + (fl.pages ? ', ' + pagesText(fl.pages) : '') + (fl.bytes ? ', ' + kb(fl.bytes) : '') + '): ' + SITE + FORMS_PATH + formSlug(f, info) + '.pdf');
      else lines.push('Download: not available from BinaSmart — the Ministry’s own link did not return the file' + (fetched ? ' on ' + fetched : '') + '; ask the tax office or try mor.gov.et.');
      lines.push('Original on mor.gov.et: ' + originalHref(f.pdfFile));
      blocks.push(lines.join('\n'));
    }
  }
  const fm = ['---', 'title: "Ministry of Revenue forms — የገቢዎች ሚኒስቴር ቅጾች (TIN, VAT, withholding, excise, income tax declarations)"',
    'source_name: "Ministry of Revenue (mor.gov.et), forms list; copies hosted by BinaSmart"', 'url: "' + SITE + '/tax-forms"',
    'source_api: "' + MOR + 'api/forms"', 'lang: "en"', 'fetched: "' + esc(fetched) + '"', 'forms: ' + list.length, 'generated_by: "ops/mor/mor-to-md.js"', '---'];
  const intro = ['# Ethiopian Ministry of Revenue forms — የገቢዎች ሚኒስቴር ቅጾች', '',
    'The ' + list.length + ' forms the Ministry of Revenue publishes on mor.gov.et' + (fetched ? ' (downloaded ' + fetched + ')' : '')
      + ', each with its Amharic title as the Ministry lists it, an English name and purpose read from the form itself, and a download link. BinaSmart hosts byte-identical copies at https://bina.et/tax-forms; forms change, and the copy on mor.gov.et or at the tax office is the authoritative one. Most of these forms are submitted at the taxpayer\'s tax office or through the Ministry\'s e-tax system (etax.mor.gov.et).',
    '', 'በአማርኛ፦ የገቢዎች ሚኒስቴር በድረ-ገጹ ያወጣቸው ' + list.length + ' ቅጾች — የግብር ከፋይ ምዝገባ፣ TIN መመለሻ፣ የተጨማሪ እሴት ታክስ፣ ተቀናሽ ግብር (withholding)፣ ኤክሳይዝ እና የንግድ ትርፍ ግብር ማሳወቂያ ቅጾች። ቅጾቹን ከ https://bina.et/tax-forms ማውረድ ይቻላል። ቅጾች ሊቀየሩ ስለሚችሉ ትክክለኛው ቅጂ በገቢዎች ሚኒስቴር ወይም በግብር ጽ/ቤት ያለው ነው።'];
  return fm.join('\n') + '\n\n' + intro.join('\n') + '\n\n' + blocks.join('\n\n') + '\n';
}

// ---------- the page ----------
function formsPage(forms, { info = {}, files = {}, fetched = '', cssV = 5, footerV = 9 } = {}) {
  const list = liveForms(forms, info);
  const gs = groups(list);
  const cards = gs.map((g, gi) => {
    const items = g.forms.map(f => {
      const i = info[f.id] || {}, fl = files[f.id] || {};
      const meta = [pagesText(fl.pages), fl.bytes ? kb(fl.bytes) : '', 'PDF'].filter(Boolean).join(' · ');
      return '<div class="form">'
        + '<h3 class="am">' + html(norm(f.title)) + '</h3>'
        + (i.en ? '<div class="en">' + html(i.en) + '</div>' : '')
        + (i.purpose_am ? '<p class="am">' + html(i.purpose_am) + '</p>' : '')
        + (i.purpose_en ? '<p class="pen">' + html(i.purpose_en) + '</p>' : '')
        + '<div class="acts">' + (fl.sha256 ? '<a class="dl am" href="' + FORMS_PATH + formSlug(f, info) + '.pdf" download>⬇ አውርድ · Download</a>'
        + '<span class="meta">' + html(meta) + '</span>' : '<span class="meta am">ቅጂ የለንም — የሚኒስቴሩ ሊንክ ፋይሉን አልሰጠም · No copy: the Ministry’s link did not return the file</span>')
        + '<a class="orig" href="' + html(originalHref(f.pdfFile)) + '" target="_blank" rel="noopener">Original on mor.gov.et ↗</a></div>'
        + '</div>';
    }).join('\n');
    return '<section id="c' + (gi + 1) + '"><h2><span class="am">' + html(g.am) + '</span><span class="h2en">' + html(g.en) + '</span></h2>\n' + items + '\n</section>';
  }).join('\n\n');
  const nav = gs.map((g, gi) => '<a href="#c' + (gi + 1) + '" class="am">' + html(g.am || g.en) + '</a>').join('');
  const desc = 'የገቢዎች ሚኒስቴር ቅጾችን ያውርዱ — TIN ምዝገባና መመለሻ፣ ቫት፣ ዊዝሆልዲንግ፣ ኤክሳይዝ እና የንግድ ትርፍ ግብር ማሳወቂያ። Download Ethiopian Ministry of Revenue tax forms (PDF).';
  const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Ethiopian tax forms — የገቢዎች ሚኒስቴር ቅጾች', url: SITE + '/tax-forms', inLanguage: ['am', 'en'],
    isBasedOn: MOR, publisher: { '@type': 'Organization', name: 'BinaSmart', url: SITE },
    hasPart: list.filter(f => (files[f.id] || {}).sha256).map(f => ({ '@type': 'DigitalDocument', name: norm(f.title) + ((info[f.id] || {}).en ? ' — ' + info[f.id].en : ''), encodingFormat: 'application/pdf', url: SITE + FORMS_PATH + formSlug(f, info) + '.pdf' })) };
  return `<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>የግብር ቅጾች — Ethiopian Tax Forms (Ministry of Revenue) | BinaSmart</title>
<meta name="description" content="${html(desc)}">
<meta property="og:title" content="Ethiopian Tax Forms — Ministry of Revenue forms to download | BinaSmart">
<meta property="og:description" content="TIN registration and de-registration, VAT, withholding, excise and business income tax declaration forms, in Amharic and English.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/tax-forms">
<link rel="canonical" href="${SITE}/tax-forms">
<link rel="icon" href="/icon-32.png">
<link rel="stylesheet" href="/static/fonts/fonts.css?v=2">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#F8FAFC;--card:#fff;--line:#dbece7;--ink:#081120;--txt:#1e293b;--mut:#4a6a64;--em:#00C896;--em2:#00796b;--grad:linear-gradient(135deg,#0F172A,#0B3B31 70%,#00C896 160%)}
html{scroll-behavior:smooth}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',system-ui,sans-serif;background:var(--bg);color:var(--txt);line-height:1.65;-webkit-font-smoothing:antialiased}
.am{font-family:'Noto Sans Ethiopic','Plus Jakarta Sans',sans-serif}
a{color:var(--em2);text-decoration:none}
.wrap{max-width:820px;margin:0 auto;padding:0 18px}
.top{max-width:820px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:16px 18px}
.logo{font-weight:800;font-size:19px;color:var(--ink)}.logo b{color:var(--em)}
.top a.back{margin-left:auto;font-size:13px;font-weight:700;color:var(--mut)}
.hero{margin:8px 18px 0;max-width:820px}@media(min-width:860px){.hero{margin:8px auto 0}}
.phero{background:var(--grad);border-radius:24px;padding:28px 22px;color:#fff;position:relative;overflow:hidden}
.phero .kick{font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;opacity:.85}
.phero h1{font-size:clamp(25px,6vw,38px);font-weight:800;line-height:1.15;margin:6px 0}
.phero h1 .en{display:block;font-size:.58em;opacity:.95;font-weight:700;margin-top:4px}
.phero .sub{font-size:13.5px;opacity:.92;margin-top:10px;max-width:620px}
.note{background:var(--card);border:1.5px solid var(--line);border-radius:18px;padding:16px 18px;margin-top:18px;font-size:14px}
.note p+p{margin-top:8px}.note .pen{color:var(--mut);font-size:13px}
.jump{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.jump a{border:1.5px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:700;color:var(--ink)}
section{margin-top:30px}
h2{font-size:clamp(19px,4.4vw,24px);font-weight:800;color:var(--ink);line-height:1.3}h2 .h2en{display:block;font-size:13px;color:var(--mut);font-weight:700;letter-spacing:.3px;margin-top:2px}
.form{background:var(--card);border:1.5px solid var(--line);border-radius:18px;padding:16px 16px 14px;margin-top:12px}
.form h3{font-size:16px;font-weight:800;color:var(--ink);line-height:1.45}
.form .en{font-size:13.5px;font-weight:700;color:var(--em2);margin-top:2px}
.form p{font-size:14px;margin-top:8px}.form p.pen{font-size:13px;color:var(--mut);margin-top:2px}
.acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:12px}
.acts .dl{display:inline-block;background:linear-gradient(135deg,#00C896,#009688);color:#fff;font-weight:800;border-radius:999px;padding:9px 18px;font-size:14px}
.acts .meta{font-size:12px;color:var(--mut);font-weight:700}
.acts .orig{font-size:12.5px;font-weight:700;margin-left:auto}
@media(max-width:480px){.acts .orig{margin-left:0;width:100%}}
.more{display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px}@media(min-width:600px){.more{grid-template-columns:1fr 1fr}}
.more a{background:#fff;border:1.5px solid var(--line);border-radius:14px;padding:12px 14px;font-weight:700;color:var(--ink);font-size:14px}
.disclaim{max-width:820px;margin:26px auto 0;padding:12px 18px;font-size:12px;color:var(--mut);line-height:1.6;background:#fff;border:1px dashed var(--line);border-radius:12px}
footer{text-align:center;padding:30px 18px 44px;color:var(--mut);font-size:12.5px}
</style>
<link rel="stylesheet" href="/static/site-v3.css?v=${cssV}">
<meta name="theme-color" content="#009688">
</head>
<body>
<div class="top"><a class="logo am" href="/"><i class="lg"></i>Bina<b>Smart</b></a><a class="back am" href="/guides">← መመሪያዎች</a></div>

<div class="hero"><div class="phero am">
  <div class="kick">ቅጾች · Tax forms · Ministry of Revenue</div>
  <h1>የገቢዎች ሚኒስቴር ቅጾች<span class="en">Ethiopian tax forms to download</span></h1>
  <div class="sub">የግብር ከፋይ ምዝገባ፣ TIN መመለሻ፣ ተጨማሪ እሴት ታክስ (ቫት)፣ ተቀናሽ ግብር፣ ኤክሳይዝ እና የንግድ ትርፍ ግብር ማሳወቂያ ቅጾች — ${list.length} ቅጾች በአንድ ቦታ። Taxpayer registration, TIN de-registration, VAT, withholding, excise and business income tax declaration forms.</div>
</div></div>

<div class="wrap">
  <div class="note">
    <p class="am"><b>ምንጭ፦</b> የገቢዎች ሚኒስቴር (mor.gov.et)፣ የወረደው ${html(fetched)}። ቅጾች ሊቀየሩ ይችላሉ፤ ትክክለኛው ቅጂ በገቢዎች ሚኒስቴር ድረ-ገጽ ወይም በግብር ጽ/ቤትዎ ያለው ነው። ከማስገባትዎ በፊት ያረጋግጡ።</p>
    <p class="pen"><b>Source: Ministry of Revenue (mor.gov.et), downloaded ${html(fetched)}.</b> These are unchanged copies of the Ministry's PDFs. Forms change: the Ministry's own copy (linked beside each form) and your tax office are authoritative.</p>
  </div>
  <div class="jump">${nav}</div>

${cards}

  <section>
    <h2><span class="am">ተጨማሪ</span><span class="h2en">Related guides</span></h2>
    <div class="more am">
      <a href="/tin-registration-ethiopia">🔢 TIN እንዴት ማውጣት · TIN guide</a>
      <a href="/vat-registration-ethiopia">🧾 ቫት እና TOT ምዝገባ · VAT guide</a>
      <a href="/ethiopia-income-tax-calculator">🧮 የደሞዝ ግብር ማስያ · Salary tax calculator</a>
      <a href="/asmat">⚖️ አስማትን ይጠይቁ · Ask Asmat about tax law</a>
    </div>
  </section>
</div>

<div class="disclaim am">📌 <b>ማሳሰቢያ:</b> ይህ ገጽ በ<b>BinaSmart</b> የተዘጋጀ ነው፤ ኦፊሴላዊ የመንግስት ገጽ አይደለም። ቅጾቹ የገቢዎች ሚኒስቴር ናቸው፤ ወቅታዊውን ቅጂ ከ <a href="${MOR}" target="_blank" rel="noopener">mor.gov.et</a> ወይም ከግብር ጽ/ቤትዎ ያረጋግጡ። This page is not a government page; the forms belong to the Ministry of Revenue.</div>

<footer class="am">
  <p>© BinaSmart · <a href="/">bina.et</a> — የኢትዮጵያ ዲጂታል መድረክ</p>
  <p style="margin-top:6px"><a href="/">🏠 መነሻ</a> · <a href="/guides">📚 መመሪያዎች</a> · <a href="/news">📰 ዜና</a></p>
</footer>
<script src="/static/bina-footer.js?v=${footerV}" defer></script>
</body>
</html>
`;
}

function writeMorDocs(docs, out) {
  fs.mkdirSync(out, { recursive: true });
  const keep = new Set(Object.keys(docs).map(s => s + '.md'));
  const removed = [];
  for (const f of fs.readdirSync(out)) if (f.endsWith('.md') && !keep.has(f)) { fs.rmSync(path.join(out, f)); removed.push(f); }
  for (const [slug, md] of Object.entries(docs)) fs.writeFileSync(path.join(out, slug + '.md'), md);
  return removed;
}

module.exports = { stripStaff, originalHref, faqsToMd, formSlug, formsToMd, formsPage, writeMorDocs, FORMS_PATH, FAQ_GLOSS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (n, d) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
  const src = opt('--src', '/root/legal-sources/mor');
  const repo = path.join(__dirname, '..', '..');
  const read = f => stripStaff(JSON.parse(fs.readFileSync(path.join(src, 'api', f), 'utf8')));
  const faqs = read('faqs.json'), forms = read('forms.json');
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'forms-info.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  const files = {};
  for (const r of Object.values(manifest.files)) if (r.ok && r.endpoint === 'forms') files[r.id] = r;
  const fetched = opt('--fetched', (manifest.files && Object.values(manifest.files).map(r => r.fetched).filter(Boolean).sort().pop() || '').slice(0, 10));
  const removed = writeMorDocs({ 'mor-faqs': faqsToMd(faqs, { fetched }), 'mor-forms': formsToMd(forms, { info, files, fetched }) }, path.join(repo, 'knowledge', 'mor'));
  const siteCss = fs.readFileSync(path.join(repo, 'public', 'amharic-ai.html'), 'utf8');
  const cssV = (/site-v3\.css\?v=(\d+)/.exec(siteCss) || [])[1] || 5, footerV = (/bina-footer\.js\?v=(\d+)/.exec(siteCss) || [])[1] || 9;
  fs.writeFileSync(path.join(repo, 'public', 'tax-forms.html'), formsPage(forms, { info, files, fetched, cssV, footerV }));
  const dest = path.join(repo, 'public', 'docs', 'mor', 'forms');
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0, missing = [];
  for (const f of forms.filter(x => !x.deleted)) {
    const r = files[f.id];
    if (!r) { missing.push(f.id); continue; }
    fs.copyFileSync(path.join(src, r.path), path.join(dest, formSlug(f, info) + '.pdf')); copied++;
  }
  console.log('[mor] faqs + forms -> knowledge/mor' + (removed.length ? ' (removed ' + removed.join(', ') + ')' : '') + '; public/tax-forms.html; '
    + copied + ' form PDFs -> public/docs/mor/forms' + (missing.length ? '; NOT downloaded: ' + missing.join(', ') : ''));
}
