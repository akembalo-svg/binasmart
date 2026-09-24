'use strict';

// A website typed without a scheme would resolve against bina.et; make it absolute before it is linked.
const absUrl = w => /^https?:\/\//i.test(String(w).trim()) ? String(w).trim() : 'https://' + String(w).trim().replace(/^\/+/, '');
// bina.et/jobs — vacancies, and the employers behind them.
//
//   GET  /jobs                 open vacancies, soonest deadline first
//   GET  /jobs/<slug>          one vacancy, with the employer beside it
//   GET  /employer/<slug>      the company, and everything it has posted
//   POST /api/ops/jobs         owner key: publish one job, creating or matching its employer
//
// Two decisions carried from the tender page, both learned the hard way there:
//   - a closed vacancy never leads the page. It is reachable, not in the way. A board whose first ten
//     entries have expired teaches people to stop opening it.
//   - a deadline stored as a bare date is open until midnight in ADDIS, not midnight UTC — three hours
//     in which a job seeker would otherwise be told the vacancy had closed while the office is still open.
//     tenders/deadline.js already models that; jobs use the same functions rather than a second copy.
//
// And one that belongs to jobs alone: the employer's coordinates are shown as a place to travel to only
// when a person has checked them (locationChecked). A guessed point sends somebody across Addis for an
// interview that is somewhere else - they lose the fare and the day, and it is our fault, not the map's.
const { closesAt, isClosed, openSince } = require('../tenders/deadline');
// The section's own mark and colour (brand/sections.js) - jobs is not the news page in blue.
const { badge, gradient, mark, brandTile } = require('../brand/sections');
const { cvForm } = require('./cv-form');
const { CATEGORIES, BY_SLUG, categorise, label: catLabel } = require('./categories');
const { cleanCity, regionFor, salaryLd } = require('./place');

// Contact goes to Telegram (@Bina_smart), never to a personal phone number: the owner asked on
// 2026-09-21, and at a jobs board's volume a published mobile becomes a day of calls from applicants
// who should be applying to the employer, not to us.
const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship', 'temporary'];
const TYPE_AM = { 'full-time': 'ሙሉ ጊዜ', 'part-time': 'ትርፍ ጊዜ', contract: 'በውል', internship: 'ልምምድ', temporary: 'ጊዜያዊ' };

// Two languages, one page each way round. Amharic leads by default because most job seekers read it
// first; ?lang=en turns the interface over for an employer, a diaspora reader or a search engine. Only
// the INTERFACE switches - a vacancy is shown in the words the employer published, with the other title
// underneath when we have both, because translating an advert is how a salary or a deadline changes.
const L = {
  am: {
    h1: 'ክፍት የሥራ ቦታዎች · Jobs', lede: 'የተረጋገጡ ማስታወቂያዎች — ከቀጣሪው መገለጫና አድራሻ ጋር',
    open: 'ክፍት', closed: 'የተዘጉ ማስታወቂያዎች · Closed vacancies', backOpen: 'ክፍት ሥራዎች →',
    viewClosed: n => `🔒 ${n} የተዘጉ ማስታወቂያዎችን ይመልከቱ`, place: '📍', deadline: '🗓',
    apply: '📨 እንዴት ማመልከት ይቻላል · How to apply', vacancy: 'ቦታ', days: 'ቀን',
    allJobs: 'ሁሉንም የዚህ ድርጅት ሥራዎች ይመልከቱ →', more: e => `ከዚሁ ድርጅት · More from ${e}`,
    postFree: '📢 ክፍት የሥራ ቦታዎን በነጻ ያውጡ · Post a vacancy FREE',
    postSub: 'Employers: we publish your vacancy at no cost, with your company profile.',
    notify: '🔔 ሥራ ሲወጣ አሳውቀኝ · Notify me on Telegram', contact: 'Telegram us →',
    emptyH: 'የመጀመሪያዎቹ ክፍት የሥራ ቦታዎች በቅርቡ',
    emptyP: 'ክፍት የሥራ ማስታወቂያዎች — ከቀጣሪው ድርጅት መገለጫ፣ አድራሻና የማመልከቻ መንገድ ጋር። እያንዳንዱ ማስታወቂያ ከምንጩ ተረጋግጦ ይወጣል።',
    closedTag: '🔒 ይህ ማስታወቂያ ተዘግቷል · This vacancy has closed',
    unverified: 'የቢሮው ትክክለኛ ቦታ ገና አልተረጋገጠም — ከመሄድዎ በፊት በስልክ ያረጋግጡ።',
    ride: '🚕 ዋጋ ይመልከቱ · Ride here', noJobs: 'አሁን ክፍት ሥራ የለም', other: 'English', otherHref: '?lang=en',
    srcNote: 'ማመልከትዎ በፊት ከቀጣሪው ያረጋግጡ።', openVac: 'ክፍት ሥራዎች · Open vacancies',
  },
  en: {
    h1: 'Jobs in Ethiopia', lede: 'Verified vacancies — each linked to the company that posted it',
    open: 'open', closed: 'Closed vacancies', backOpen: 'Open vacancies →',
    viewClosed: n => `🔒 View ${n} closed vacancies`, place: '📍', deadline: '🗓',
    apply: '📨 How to apply', vacancy: 'post(s)', days: 'days left',
    allJobs: 'See every vacancy from this employer →', more: e => `More from ${e}`,
    postFree: '📢 Post a vacancy FREE',
    postSub: 'Employers: we publish your vacancy at no cost, with your company profile.',
    notify: '🔔 Notify me on Telegram', contact: 'Telegram us →',
    emptyH: 'The first vacancies are coming shortly',
    emptyP: 'Verified Ethiopian vacancies with the employer profile, address and how to apply — free, and checked against the source before publishing.',
    closedTag: '🔒 This vacancy has closed',
    unverified: 'The exact office location is not confirmed yet — call before travelling.',
    ride: '🚕 See the fare · Ride here', noJobs: 'No open vacancies right now', other: 'አማርኛ', otherHref: '?lang=am',
    srcNote: 'Confirm with the employer before applying.', openVac: 'Open vacancies',
  },
};
const pick = req => (String(req.query.lang || '').toLowerCase() === 'en' ? L.en : L.am);
const langOf = req => (String(req.query.lang || '').toLowerCase() === 'en' ? 'en' : 'am');
const qs = (req, extra) => {
  const l = langOf(req);
  const parts = [...(l === 'en' ? ['lang=en'] : []), ...(extra || [])];
  return parts.length ? '?' + parts.join('&') : '';
};
const langToggle = req => {
  const l = langOf(req);
  return `<a class="sans" href="${l === 'en' ? '?lang=am' : '?lang=en'}" style="float:right;font-size:13px;font-weight:700;border:1.5px solid var(--line);border-radius:999px;padding:5px 14px">${l === 'en' ? 'አማርኛ' : 'English'}</a>`;
};

const slugify = s => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9ሀ-፿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'job';

// "Awash Bank", "AWASH BANK S.C.", "awash  bank sc" must all reach the same employer, or the company
// profile that is the point of this page never accumulates.
const normName = s => String(s || '').toLowerCase()
  .replace(/[‘’'".,()]/g, '')
  .replace(/\b(s\.?c\.?|plc|p\.l\.c\.?|inc|ltd|limited|company|co|share company|አክሲዮን ማህበር|ኃ\.የ\.የግ\.ማ)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();


// A company avatar from its own initials: a jobs board with a grey box where every logo should be looks
// unfinished, and we do not have logos yet. Initials on the employer's own colour read as deliberate,
// and the colour is derived from the name so the same company always looks the same.
function initials(name) {
  return String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/)
    .filter(w => !/^(the|and|plc|sc|ltd|inc|co)$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}
// The jobs section's own styles, sent once per page in the head rather than repeated inline on every
// card. Everything here is written phone-first: the desktop rules sit inside the min-width query.
const JOBS_CSS = `<style>
.tgband{display:flex;align-items:center;gap:13px;margin:16px 0;padding:14px 16px;border-radius:16px;
  background:linear-gradient(135deg,#e8f3fd,#f4f9ff);border:1.5px solid #bcdcf7;color:var(--ink)}
.tgband .tgi{font-size:22px;flex:none}
.tgband .tgt{min-width:0}
.tgband b{display:block;font-size:14.5px;line-height:1.35}
.tgband small{color:var(--mut);font-size:12.5px}
.tgband .tggo{margin-left:auto;background:#229ED9;color:#fff;border-radius:999px;padding:9px 16px;
  font-weight:800;font-size:13px;white-space:nowrap;flex:none}
@media (max-width:420px){.tgband .tggo{padding:8px 12px}}
.jc{display:block}
.jc-top{display:flex;align-items:center;gap:11px;min-width:0}
.jc-emp{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--gold);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.jc-title{margin:9px 0 0;font-size:19px;line-height:1.28}
.jc-alt{font-size:12.5px;color:var(--mut);margin-top:2px}
.jc-sum{color:var(--mut);font-size:13.5px;line-height:1.55;margin-top:6px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.jc-tags{margin-top:9px;display:flex;flex-wrap:wrap;gap:6px}
.jc-acts{display:flex;gap:8px;margin-top:13px}
.jc-go,.jc-more{flex:1;text-align:center;border-radius:999px;padding:11px 18px;font-size:13.5px;white-space:nowrap}
.jc-go{background:var(--jobs-g);color:#fff;font-weight:800}
.jc-more{border:1.5px solid var(--line);color:var(--mut);font-weight:700}
@media (min-width:640px){
  .jc-title{font-size:21px}
  .jc-acts{justify-content:flex-end;margin-top:14px}
  .jc-go,.jc-more{flex:0 0 auto;min-width:132px}
}
.phero.lite{background:#fff;color:var(--ink);padding:16px 18px;margin:16px 0 2px;clear:both;overflow:visible;
  border:1.5px solid var(--line);box-shadow:0 10px 26px -22px rgba(15,23,42,.5)}
.phero.lite h1{font-size:clamp(20px,4.6vw,27px)}
.phero.lite .am{color:var(--mut);font-weight:700;font-size:13px;margin-top:3px}
.phero.lite .sub{color:var(--mut);opacity:1;font-size:12px;margin-top:6px}
.phero.lite::after{display:none}
/* The poster notices carry an image inside the body; keep it inside the column on a phone. */
.body-t img{max-width:100%;height:auto;border-radius:12px}
</style>`;

// schema.org JobPosting — the format Google Jobs reads, and the reason a vacancy page can appear in the
// jobs box rather than on page four. We emit only fields we actually hold: no invented salary, no
// invented closing date, and no `directApply` claim, which would say the application completes on this
// page when for most adverts it does not. The description is the advert's own text.
function jobLd(j, e, escH) {
  const locality = cleanCity(j.city) || cleanCity(e.city);
  const region = regionFor(locality);
  const salary = salaryLd(j.salary);
  const ld = {
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: j.title,
    description: (j.bodyHtml || j.summary || '').slice(0, 5000),
    datePosted: new Date(j.publishedAt).toISOString().slice(0, 10),
    hiringOrganization: { '@type': 'Organization', name: e.name,
      ...(e.website ? { sameAs: absUrl(e.website) } : {}), ...(e.logoUrl ? { logo: 'https://bina.et' + e.logoUrl } : {}) },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress',
      // Boards put the working arrangement in the city column ("Project Based", "Head Office"), which
      // is not a place. Fall back to the employer's own city rather than publish a non-place as one.
      ...(locality ? { addressLocality: locality } : {}),
      ...(region ? { addressRegion: region } : {}),
      addressCountry: 'ET', ...(e.address ? { streetAddress: e.address } : {}) } },
    ...(salary ? { baseSalary: salary } : {}),
    ...(j.deadline ? { validThrough: new Date(j.deadline).toISOString().slice(0, 10) } : {}),
    ...(j.jobType ? { employmentType: ({ 'full-time': 'FULL_TIME', 'part-time': 'PART_TIME', contract: 'CONTRACTOR',
      internship: 'INTERN', temporary: 'TEMPORARY' })[j.jobType] } : {}),
    ...(j.vacancies ? { totalJobOpenings: j.vacancies } : {}),
  };
  // JSON inside a script tag: the only character that can break out is "<".
  return '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
}

// schema.org Organization for a company page. Only what we hold: the name, their own website, the logo
// we host, the address and city they advertised. No founding date, no employee count, no rating.
function orgLd(e) {
  const locality = cleanCity(e.city);
  const region = regionFor(locality);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: e.name, url: 'https://bina.et/employer/' + e.slug,
    ...(e.nameAm && e.nameAm !== e.name ? { alternateName: e.nameAm } : {}),
    ...(e.website ? { sameAs: absUrl(e.website) } : {}),
    ...(e.logoUrl ? { logo: 'https://bina.et' + e.logoUrl } : {}),
    address: { '@type': 'PostalAddress', addressCountry: 'ET',
      ...(locality ? { addressLocality: locality } : {}), ...(region ? { addressRegion: region } : {}),
      ...(e.address ? { streetAddress: e.address } : {}) },
  };
  return '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
}

// What a company's own adverts say about it, counted: the fields it hires in, where, on what terms,
// since when. Every line is a tally of rows we hold - the page gets longer only by telling the truth.
function hiringHistory(all) {
  const tally = key => {
    const m = new Map();
    for (const j of all) { const v = key(j); if (v) m.set(v, (m.get(v) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const first = all.reduce((d, j) => (j.publishedAt && (!d || j.publishedAt < d) ? j.publishedAt : d), null);
  return {
    total: all.length,
    since: first,
    cats: tally(j => j.category),
    cities: tally(j => cleanCity(j.city)),
    types: tally(j => j.jobType),
  };
}

// The employer's OWN way in, pulled out of their instructions: a Google form, their recruitment page,
// an email address. That is a link we are glad to publish - it takes the applicant to the company, not
// to another jobs board. The boards we read from are blocked by name, which is the whole distinction:
// we never hand our reader to a competitor, and we never hide the company's own door.
const AGGREGATORS = /(^|\.)(ethiojobs\.net|ethiojobshub\.com|ethiojobs\.com|harmeejobs\.com|ethiojobvacancy|zehabesha|jobsethiopia)/i;
function ownApplyRoute(job, emp) {
  // Boards mangle the scheme when they paste: "https: //forms.gle/…". Repair it before matching, or a
  // perfectly good application form stays invisible because of somebody else's typo.
  const text = String(job.howToApply || '').replace(/https?:\s*\/\s*\//gi, m => m.replace(/\s+/g, ''));
  const urls = (text.match(/https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/gi) || [])
    // The boards write the link with a space after "https:" often enough to matter.
    .map(u => u.replace(/^www\./i, 'https://www.').replace(/[.,;:)]+$/, ''));
  for (const u of urls) {
    let host = '';
    try { host = new URL(u).hostname; } catch (e) { continue; }
    if (AGGREGATORS.test(host)) continue;
    return { href: u, kind: 'link' };
  }
  const mail = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/) || [])[0];
  if (mail) return { href: 'mailto:' + mail, kind: 'mail', label: mail };
  if (emp && emp.website && /^https?:\/\//i.test(emp.website)) return { href: emp.website, kind: 'site' };
  return null;
}

// The company's own logo when jobs/fetch-logos.js found one on their website, and the monogram when it
// did not. The tile is the same size and shape either way, so a list of 200 vacancies lines up whether a
// company has a logo or not. The logo sits in a white tile with padding: most company marks are drawn
// for white, and a favicon dropped straight onto a tinted square looks like a mistake.
function avatarFor(emp, size = 46) {
  const e = typeof emp === 'string' ? { name: emp } : (emp || {});
  const name = e.name || '';
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  const box = `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;`
    + `border-radius:${Math.round(size / 3.4)}px;flex:none;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.10)`;
  if (e.logoUrl) {
    return `<span style="${box};background:#fff;border:1.5px solid #e6e9f0;padding:${Math.round(size / 10)}px">`
      + `<img src="${escHSafe(e.logoUrl)}" alt="${escHSafe(name)}" width="${size}" height="${size}" loading="lazy" `
      + `style="width:100%;height:100%;object-fit:contain"></span>`;
  }
  return `<span aria-hidden="true" style="${box};font-weight:800;font-size:${Math.round(size / 2.7)}px;letter-spacing:-.5px;`
    + `color:hsl(${h} 58% 30%);background:linear-gradient(140deg,hsl(${h} 62% 96%),hsl(${h} 58% 88%));`
    + `border:1.5px solid hsl(${h} 42% 83%)">${escHSafe(initials(name))}</span>`;
}
// "ዛሬ" / "2 days ago" — a job seeker reads freshness before anything else on the card.
function postedAgo(d, lang) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days <= 0) return lang === 'en' ? 'today' : 'ዛሬ';
  if (days === 1) return lang === 'en' ? 'yesterday' : 'ትናንት';
  return lang === 'en' ? `${days} days ago` : `ከ${days} ቀን በፊት`;
}
let escHSafe = s => String(s == null ? '' : s);

module.exports = async function jobRoutes(fastify, { prisma, shell, escH, amDate, OWNER_KEY }) {
  escHSafe = escH;
  const daysLeft = d => Math.ceil((closesAt(d).getTime() - Date.now()) / 86400000);

  const { findOrCreateEmployer, uniqueJobSlug } = require('./publish')({ prisma });

  // In English the pill says "Full-time", in Amharic "ሙሉ ጊዜ" — this is interface, not content, so it
  // follows the reader. The advert's own words never get translated; only the labels around them do.
  const typePill = (ty, lang) => ty ? `<span class="t-tag">💼 ${escH(lang === 'en' ? ty.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : (TYPE_AM[ty] || ty))}</span>` : '';
  const catPill = (j, lang) => j.category && BY_SLUG.get(j.category)
    ? `<a class="t-tag" href="/jobs/category/${j.category}${lang === 'en' ? '?lang=en' : ''}" style="color:inherit">🏷 ${escH(catLabel(j.category, lang))}</a>`
    : '';
  const dlPill = (d, lang) => d
    ? `<span class="t-tag">🗓 ${amDate(d)}${daysLeft(d) >= 0 ? ` · ${daysLeft(d)} ${lang === 'en' ? 'days left' : 'ቀን'}` : ''}</span>`
    : `<span class="t-tag">🗓 ${lang === 'en' ? 'Deadline: see the advert' : 'ማብቂያ፡ ማስታወቂያውን ይመልከቱ'}</span>`;

  // Both titles are shown when we hold both; which one leads follows the reader's language. Neither is
  // translated here - a title is the employer's wording and changing it changes the advert.
  // The card, rebuilt for a phone first (owner, 2026-09-21: "the job on the right side of the mobile
  // interface is white, and one card down appears elongated").
  //
  // What was wrong: the card was one flex row - avatar | text | buttons - so on a 390px screen the text
  // was squeezed into a ~180px column. Every title wrapped four times, the summary ran to ten lines, the
  // tags stacked one per line, and the two buttons sat marooned in a white gap on the right, making the
  // card three times as tall as it needed to be. On a jobs board that is the whole product: a list you
  // can scan. Now the card is a single column at any width, the summary is clamped to two lines, and the
  // buttons sit on one row at the bottom - full width on a phone, right-aligned on a desktop.
// The channel band. The owner asked for it on the page and between the cards (2026-09-22): the board
  // is updated every morning, and a reader who follows the channel hears about a vacancy the day it
  // opens instead of the week it closes. @binasmart is the CHANNEL (BINA_TG_CHANNEL); @Bina_smart is
  // the chat people write to - different accounts, so the link is written out rather than guessed at.
  // On a category page the band subscribes to THAT field; on the board it opens the chooser. A deep
  // link needs no login and no form - one tap and they are subscribed.
  const alertLink = cat => 'https://t.me/bina_smart_bot?start=jobs_' + (cat && BY_SLUG.get(cat) ? cat : 'all');
  const tgAlert = (lang, cat) => `<a href="${alertLink(cat)}" target="_blank" rel="noopener" class="sans tgband">
      <span class="tgi">🔔</span>
      <span class="tgt"><b>${lang === 'en'
        ? (cat && BY_SLUG.get(cat) ? 'Get every new ' + escH(catLabel(cat, 'en')) + ' vacancy' : 'Get every new vacancy')
        : (cat && BY_SLUG.get(cat) ? 'አዲስ ' + escH(catLabel(cat, 'am')) + ' ሥራ ሲወጣ ይወቁ' : 'አዲስ ሥራ ሲወጣ ይወቁ')}</b>
      <small>${lang === 'en' ? 'One tap. We message you every morning. Free, stop any time.' : 'በአንድ ጠቅታ። በየጠዋቱ እንነግርዎታለን። ነጻ፣ በፈለጉ ጊዜ ያቁሙ።'}</small></span>
      <span class="tggo">${lang === 'en' ? 'Notify me' : 'አሳውቀኝ'} →</span>
    </a>`;

  const tgBand = lang => `<a href="https://t.me/binasmart" target="_blank" rel="noopener" class="sans tgband">
      <span class="tgi">✈️</span>
      <span class="tgt"><b>${lang === 'en' ? 'Every new vacancy on Telegram' : 'አዲስ ሥራ በቴሌግራም ይከታተሉ'}</b>
      <small>${lang === 'en' ? '200+ new jobs a day · free · updated every morning' : 'በየቀኑ 200+ አዲስ ሥራ · ነጻ · በየጠዋቱ ይታደሣል'}</small></span>
      <span class="tggo">${lang === 'en' ? 'Join' : 'ይቀላቀሉ'} →</span>
    </a>`;

  function jobCard(j, req) {
    const lang = langOf(req);
    const lead = lang === 'en' ? (j.title || j.titleAm) : (j.titleAm || j.title);
    const under = lang === 'en' ? (j.titleAm && j.titleAm !== lead ? j.titleAm : '') : (j.title && j.title !== lead ? j.title : '');
    return `<div class="t-card jc">
      <div class="jc-top">
        ${avatarFor(j.employer, 44)}
        <a class="jc-emp sans" href="/employer/${j.employer.slug}${qs(req)}">${escH(j.employer.name)}${j.employer.verified ? ' <span style="color:#059669">✓</span>' : ''}</a>
      </div>
      <h3 class="jc-title"><a href="/jobs/${j.slug}${qs(req)}">${escH(lead)}</a></h3>
      ${under ? `<div class="jc-alt sans">${escH(under)}</div>` : ''}
      <div class="jc-sum sans">${escH(j.summary)}</div>
      <div class="t-tags sans jc-tags"><span class="t-tag">📍 ${escH(j.city)}</span>${catPill(j, lang)}${typePill(j.jobType, lang)}${j.vacancies ? `<span class="t-tag">👥 ${j.vacancies}</span>` : ''}${j.salary ? `<span class="t-tag">💰 ${escH(j.salary)}</span>` : ''}${dlPill(j.deadline, lang)}<span class="t-tag" style="opacity:.75">🕐 ${postedAgo(j.publishedAt, lang)}</span></div>
      <div class="jc-acts sans">
        <a class="jc-go" href="/jobs/${j.slug}${qs(req)}#apply">${lang === 'en' ? 'Apply' : 'ያመልክቱ'}</a>
        <a class="jc-more" href="/jobs/${j.slug}${qs(req)}">${lang === 'en' ? 'See more' : 'ተጨማሪ ይመልከቱ'}</a>
      </div>
    </div>`;
  }

// The share picture for a page. A vacancy in banking shares the banking card, the board shares the jobs
// card; ops/og/section-cards.js draws them. Falling back to the section card is deliberate: a category
// we have not drawn yet must not silently borrow the news one.
const OG = 'https://bina.et/static/';
// ?v=<file mtime>: platforms cache an og:image by url for weeks, so a redrawn card must arrive at a new
// url or nobody ever sees it. Falls back to the plain url if the file is missing.
const ogJobs = cat => {
  const name = (cat && BY_SLUG.get(cat)) ? 'og-jobs-category-' + cat + '.png' : 'og-section-jobs.png';
  try {
    const f = require('path').join(__dirname, '..', 'public', name);
    return OG + name + '?v=' + Math.floor(require('fs').statSync(f).mtimeMs / 1000);
  } catch (e) { return OG + name; }
};

  // One list, two doors: /jobs with filters, and /jobs/category/<slug> - a page per field of work,
  // which is what people actually search for ("accounting jobs in ethiopia", "የባንክ ክፍት የሥራ ቦታ") and
  // therefore what a search engine can rank. Same data, same card, its own heading and description.
  const JOBS_HEAD = JOBS_CSS + `<style>:root{--jobs-g:${gradient('jobs')}}</style>`;

  async function jobsPage(req, reply, forcedCat) {
    const t = pick(req), lang = langOf(req);
    const cat = String(forcedCat || req.query.cat || '').trim().toLowerCase();
    const catDef = BY_SLUG.get(cat) || null;
    if (forcedCat && !catDef) return reply.code(404).type('text/html').send('<h2>No such category</h2>');
    const now = new Date();
    const showClosed = req.query.show === 'closed';
    const where = { published: true };
    // Search and filters. A board without them is a list; ethiojobs has them and a job seeker expects
    // them. The query stays simple on purpose - title, employer, city, type - because a filter that
    // returns nothing teaches people the site is empty when it is only fussy.
    const q = String(req.query.q || '').trim().slice(0, 60);
    const city = String(req.query.city || '').trim().slice(0, 40);
    const type = String(req.query.type || '').trim().slice(0, 20);
    const search = q ? {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { titleAm: { contains: q } },
        { summary: { contains: q, mode: 'insensitive' } },
        { employer: { name: { contains: q, mode: 'insensitive' } } },
      ],
    } : {};
    const filters = { ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}), ...(type ? { jobType: type } : {}),
      ...(catDef ? { category: catDef.slug } : {}) };
    const jobs = showClosed
      ? (await prisma.job.findMany({ where: { ...where, ...search, ...filters, deadline: { lt: openSince(now) } }, include: { employer: true }, orderBy: { deadline: 'desc' }, take: 200 })).filter(j => isClosed(j.deadline, now))
      : (await prisma.job.findMany({ where: { ...where, ...search, ...filters, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }], ...(q ? { AND: [search] } : {}) }, include: { employer: true }, orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }], take: 200 })).filter(j => !isClosed(j.deadline, now));
    const cities = (await prisma.job.groupBy({ by: ['city'], _count: { city: true }, orderBy: { _count: { city: 'desc' } }, take: 8 })).filter(c => c.city);
    const closedCount = (await prisma.job.findMany({ where: { ...where, deadline: { lt: openSince(now) } }, select: { deadline: true } })).filter(j => isClosed(j.deadline, now)).length;
    const employers = await prisma.employer.count();
    // Counts for the chips, over OPEN vacancies only - a category offering 40 jobs that all closed last
    // month is a promise the page cannot keep.
    const openWhere = { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] };
    const catCounts = new Map((await prisma.job.groupBy({ by: ['category'], where: openWhere, _count: { category: true } }))
      .filter(c => c.category).map(c => [c.category, c._count.category]));
    const chips = CATEGORIES.filter(c => catCounts.get(c.slug))
      .map(c => `<a href="/jobs/category/${c.slug}${lang === 'en' ? '?lang=en' : ''}" style="border:1.5px solid ${cat === c.slug ? '#8fb0f2' : 'var(--line)'};background:${cat === c.slug ? '#eef4ff' : '#fff'};color:${cat === c.slug ? '#1e3a8a' : 'var(--mut)'};border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;white-space:nowrap">${escH(lang === 'en' ? c.en : c.am)} <span style="opacity:.6">${catCounts.get(c.slug)}</span></a>`).join('');

    const empty = `<div class="empty"><div class="big">💼</div><h3>${t.emptyH}</h3>
      <p class="sans" style="max-width:540px;margin:0 auto">${t.emptyP}</p>
      <p class="sans" style="margin-top:22px"><a href="https://t.me/Bina_smart" target="_blank" rel="noopener" style="background:var(--ink);color:#fff;border-radius:999px;padding:13px 28px;font-weight:800;font-size:14px">${t.notify}</a></p></div>`;

    const body = `<main>
      ${langToggle(req)}
      <div class="phero lite"><div style="display:flex;align-items:center;gap:12px">${brandTile('jobs', { size: 40 })}<h1 style="margin:0">${catDef ? escH(lang === 'en' ? catDef.en + ' jobs in Ethiopia' : catDef.am + ' ክፍት የሥራ ቦታዎች') : t.h1}</h1></div><div class="am sans">${t.lede}</div><div class="sub sans">${employers ? employers + (lang === 'en' ? ' employers listed.' : ' ድርጅቶች ተመዝግበዋል።') : ''}</div></div>
      ${showClosed ? `<div class="sans" style="display:flex;gap:12px;align-items:center;margin:0 0 18px;padding:13px 17px;border-radius:14px;background:#fdeaea;border:1.5px solid #f3bdbd;color:#8a1f1f"><span style="font-size:22px">🔒</span><span><b style="display:block;font-size:15px">${t.closed}</b><span style="font-size:13px"><a href="/jobs${qs(req)}" style="color:#8a1f1f;font-weight:700">${t.backOpen}</a></span></span></div>` : ''}
      ${chips ? `<div class="sans" style="display:flex;gap:7px;overflow-x:auto;padding:2px 0 12px;-webkit-overflow-scrolling:touch">
        <a href="/jobs${lang === 'en' ? '?lang=en' : ''}" style="border:1.5px solid ${cat ? 'var(--line)' : '#8fb0f2'};background:${cat ? '#fff' : '#eef4ff'};color:${cat ? 'var(--mut)' : '#1e3a8a'};border-radius:999px;padding:7px 14px;font-size:13px;font-weight:700;white-space:nowrap">${lang === 'en' ? 'All' : 'ሁሉም'}</a>${chips}</div>` : ''}
      <form class="sans" method="get" action="${catDef ? '/jobs/category/' + catDef.slug : '/jobs'}" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px">
        ${lang === 'en' ? '<input type="hidden" name="lang" value="en">' : ''}
        ${showClosed ? '<input type="hidden" name="show" value="closed">' : ''}
        <input name="q" value="${escH(q)}" placeholder="${lang === 'en' ? 'Search title or company…' : 'የሥራ መደብ ወይም ድርጅት ይፈልጉ…'}" style="flex:1;min-width:190px;border:1.5px solid var(--line);border-radius:999px;padding:10px 16px;font-size:14px;font-family:inherit">
        <select name="city" style="border:1.5px solid var(--line);border-radius:999px;padding:10px 14px;font-size:14px;font-family:inherit"><option value="">${lang === 'en' ? 'All cities' : 'ሁሉም ከተሞች'}</option>${cities.map(c => `<option value="${escH(c.city)}"${city.toLowerCase() === String(c.city).toLowerCase() ? ' selected' : ''}>${escH(c.city)} (${c._count.city})</option>`).join('')}</select>
        <select name="type" style="border:1.5px solid var(--line);border-radius:999px;padding:10px 14px;font-size:14px;font-family:inherit"><option value="">${lang === 'en' ? 'Any type' : 'ሁሉም ዓይነት'}</option>${JOB_TYPES.map(ty => `<option value="${ty}"${type === ty ? ' selected' : ''}>${lang === 'en' ? ty.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : TYPE_AM[ty]}</option>`).join('')}</select>
        <button type="submit" style="background:${gradient('jobs')};color:#fff;border:none;border-radius:999px;padding:10px 22px;font-weight:800;font-size:14px;cursor:pointer">${lang === 'en' ? 'Search' : 'ፈልግ'}</button>
        ${(q || city || type) ? `<a href="/jobs${lang === 'en' ? '?lang=en' : ''}" style="align-self:center;font-size:13.5px;color:var(--mut)">${lang === 'en' ? 'clear' : 'አጽዳ'}</a>` : ''}
      </form>
      ${(q || city || type) ? `<p class="sans" style="margin:0 0 12px;color:var(--mut);font-size:13.5px">${jobs.length} ${lang === 'en' ? 'result(s)' : 'ውጤት'}</p>` : ''}
      ${jobs.length
        ? jobs.map((j, i) => jobCard(j, req) + (i === 4 && jobs.length > 6 ? tgAlert(lang, catDef && catDef.slug) : '')).join('')
          + (jobs.length > 4 ? tgBand(lang) : '')
        : empty}
      ${!showClosed && closedCount ? `<p class="sans" style="text-align:center;margin:26px 0 4px;font-size:13.5px"><a href="/jobs${qs(req, ['show=closed'])}" style="color:var(--mut)">${t.viewClosed(closedCount)}</a></p>` : ''}
      <p class="sans" style="margin:22px 0 10px;font-size:14px;line-height:1.9;text-align:center"><!-- guide-links:job-list -->📚 <a href="${lang === 'en' ? '/cv-ethiopia-en' : '/cv-ethiopia'}" style="font-weight:700">${lang === 'en' ? 'CV guide' : 'የሲቪ አጻጻፍ'}</a> · <a href="/interview-questions-ethiopia" style="font-weight:700">${lang === 'en' ? 'Interview questions' : 'የቃለ መጠይቅ ጥያቄዎች'}</a> · <a href="/ethiopia-jobs-report-september-2026" style="font-weight:700">${lang === 'en' ? 'Jobs report' : '📊 የሥራ ገበያ ሪፖርት'}</a>${catDef && catDef.slug === 'banking' ? ` · <a href="/bank-jobs-ethiopia" style="font-weight:700">${lang === 'en' ? '🏦 What banks ask for' : '🏦 ባንኮች ምን ይጠይቃሉ'}</a>` : ''}</p>
      <div class="cta-band sans" style="background:${gradient('jobs')}"><div><h3>${t.postFree}</h3><p>${t.postSub}</p></div><a style="background:#fff;color:#1e3a8a" href="/jobs/post${lang === 'en' ? '?lang=en' : ''}">${lang === 'en' ? 'Post it here →' : 'እዚህ ያውጡ →'}</a></div>
    </main>`;
    // The category page carries its own title, description and canonical. Without them Google sees
    // seventeen copies of /jobs and ranks none of them.
    const nOpen = jobs.length;
    reply.type('text/html').send(shell({
      title: catDef
        ? (lang === 'en' ? catDef.en + ' jobs in Ethiopia — ' + nOpen + ' open vacancies' : catDef.am + ' ክፍት የሥራ ቦታዎች በኢትዮጵያ · ' + catDef.en + ' jobs')
        : (lang === 'en' ? 'Jobs in Ethiopia — verified vacancies with employer profiles' : 'ክፍት የሥራ ቦታዎች በኢትዮጵያ · Jobs in Ethiopia'),
      desc: catDef
        ? (lang === 'en'
          ? nOpen + ' open ' + catDef.en.toLowerCase() + ' vacancies in Ethiopia, each with the employer, the address, the deadline and how to apply.'
          : 'በኢትዮጵያ ' + catDef.am + ' ዘርፍ ' + nOpen + ' ክፍት የሥራ ቦታዎች — ከቀጣሪው መገለጫ፣ አድራሻ፣ ማብቂያ ቀንና የማመልከቻ መንገድ ጋር።')
        : (lang === 'en'
          ? 'Verified Ethiopian job vacancies, each linked to the company that posted it — address, how to apply and the deadline.'
          : 'የተረጋገጡ ክፍት የሥራ ማስታወቂያዎች — ከቀጣሪው ድርጅት መገለጫ፣ አድራሻና የማመልከቻ መንገድ ጋር።'),
      canonical: 'https://bina.et/jobs' + (catDef ? '/category/' + catDef.slug : ''), extraHead: JOBS_HEAD, body, active: 'jobs',
      ogImage: ogJobs(catDef && catDef.slug),
    }));
  }

  // A small JSON search, for Bini's search_jobs tool and nothing else: at most ten rows, no bodies, no
  // contact details. Deliberately not a bulk feed - the board is in the HTML pages, which is what we
  // want people (and search engines) to read.
  fastify.get('/api/jobs/search', async (req, reply) => {
    const now = new Date();
    const q = String(req.query.q || '').trim().slice(0, 60);
    const field = String(req.query.field || '').trim().toLowerCase().slice(0, 20);
    const city = String(req.query.city || '').trim().slice(0, 40);
    const take = Math.min(Math.max(Number(req.query.limit) || 6, 1), 10);
    const where = { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] };
    if (field && BY_SLUG.get(field)) where.category = field;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (q) {
      where.AND = [{ OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { titleAm: { contains: q } },
        { summary: { contains: q, mode: 'insensitive' } },
        { employer: { name: { contains: q, mode: 'insensitive' } } },
      ] }];
    }
    // Fetch well beyond `take` before filtering. The SQL window keeps anything whose deadline has not
    // passed in UTC, but isClosed() applies the Addis midnight rule - so the earliest rows, which are
    // exactly the ones this ordering returns first, are often the ones that just closed. Taking twice
    // `take` returned an empty list for every field on the first try.
    const rows = (await prisma.job.findMany({ where, include: { employer: { select: { name: true } } },
      orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }], take: Math.max(take * 10, 60) }))
      .filter(j => !isClosed(j.deadline, now)).slice(0, take);
    reply.header('cache-control', 'public, max-age=300');
    return { jobs: rows.map(j => ({
      title: j.title, titleAm: j.titleAm || undefined, employer: j.employer.name, city: j.city,
      field: j.category || undefined, jobType: j.jobType || undefined, salary: j.salary || undefined,
      deadline: j.deadline ? new Date(j.deadline).toISOString().slice(0, 10) : undefined,
      daysLeft: j.deadline ? Math.max(0, daysLeft(j.deadline)) : undefined,
      url: 'https://bina.et/jobs/' + j.slug,
    })) };
  });

  fastify.get('/jobs/category/:cat', async (req, reply) => jobsPage(req, reply, String(req.params.cat || '')));
  fastify.get('/jobs', async (req, reply) => jobsPage(req, reply, null));

  fastify.get('/jobs/:slug', async (req, reply) => {
    const t = pick(req), lang = langOf(req);
    const j = await prisma.job.findUnique({ where: { slug: String(req.params.slug) }, include: { employer: true } });
    // An address this vacancy used to live at: Google has it indexed, somebody has it in a Telegram
    // message. A permanent redirect keeps both working and passes the ranking to the new address.
    if (!j || !j.published) {
      const alias = await prisma.jobAlias.findUnique({ where: { slug: String(req.params.slug) } }).catch(() => null);
      if (alias && alias.path) return reply.redirect(alias.path, 301);
      if (alias && alias.jobId) {
        const to = await prisma.job.findUnique({ where: { id: alias.jobId }, select: { slug: true, published: true } });
        if (to && to.published) return reply.redirect('/jobs/' + to.slug, 301);
      }
    }
    if (!j || !j.published) return reply.code(404).type('text/html').send(shell({ title: 'አልተገኘም', desc: '', canonical: 'https://bina.et/jobs', body: '<main><div class="empty"><div class="big">🔍</div><h3>ይህ ማስታወቂያ የለም</h3><p class="sans"><a href="/jobs">ወደ ክፍት ሥራዎች →</a></p></div></main>', active: 'jobs' }));
    const closed = isClosed(j.deadline);
    const e = j.employer;
    const mapped = e.lat != null && e.lng != null && e.locationChecked;   // only a checked point is a place
    const others = await prisma.job.findMany({ where: { employerId: e.id, published: true, NOT: { id: j.id } }, orderBy: { publishedAt: 'desc' }, take: 5 });

    const body = `<main><article class="art">
      ${langToggle(req)}
      ${closed ? `<div class="sans" style="margin:0 0 14px;padding:12px 16px;border-radius:12px;background:#fdeaea;border:1.5px solid #f3bdbd;color:#8a1f1f"><b>${t.closedTag}</b></div>` : ''}
      <span class="cat sans" style="color:var(--gold)"><a href="/employer/${e.slug}">${escH(e.name)}</a></span>
      <h1>${escH(lang === 'en' ? (j.title || j.titleAm) : (j.titleAm || j.title))}</h1>
      ${(() => { const other = lang === 'en' ? j.titleAm : j.title; const lead2 = lang === 'en' ? (j.title || j.titleAm) : (j.titleAm || j.title); return other && other !== lead2 ? `<p class="lead">${escH(other)}</p>` : ''; })()}
      <p class="lead">${escH(j.summary)}</p>
      <div class="t-tags sans" style="margin:10px 0 18px">
        <span class="t-tag">📍 ${escH(j.city)}</span>${catPill(j, lang)}${typePill(j.jobType, lang)}
        ${j.vacancies ? `<span class="t-tag">👥 ${j.vacancies} ${t.vacancy}</span>` : ''}
        ${j.experience ? `<span class="t-tag">🎯 ${escH(j.experience)}</span>` : ''}
        ${j.education ? `<span class="t-tag">🎓 ${escH(j.education)}</span>` : ''}
        ${j.salary ? `<span class="t-tag">💰 ${escH(j.salary)}</span>` : ''}
        ${dlPill(j.deadline, lang)}
      </div>
      ${j.bodyHtml ? `<div class="body-t">${j.bodyHtml}</div>` : ''}
      ${/* How to apply. Nothing here leaves bina.et.
             The owner's call (2026-09-21): an Apply button that opened ethiojobs sent our reader to
             someone else's site to finish the thing they came here to do. So the routes we publish are
             the employer's own instructions when the advert carries them, and our CV form otherwise -
             we hold the CV and pass it on. The source url is still stored on the row; it is how a claim
             is checked and how the harvester knows it already holds this vacancy. It is not a link. */''}
      ${j.howToApply ? `<div id="apply" class="sans" style="margin:18px 0;padding:16px 18px;border-radius:14px;background:#eef4ff;border:1.5px solid #c7d8fb">
        <b style="display:block;margin-bottom:6px">${t.apply}</b>${escH(j.howToApply)}
        ${(() => {
          const r = ownApplyRoute(j, e);
          if (!r) return '';
          const label = r.kind === 'mail'
            ? (lang === 'en' ? 'Apply by email' : 'በኢሜይል ያመልክቱ') + ' · ' + escH(r.label)
            : (lang === 'en' ? 'Apply on ' : 'ያመልክቱ · ') + escH(e.name);
          const note = r.kind === 'mail' ? '' : `<div style="margin-top:6px;font-size:12.5px;color:var(--mut)">${lang === 'en' ? 'Opens the employer\'s own application form.' : 'የቀጣሪው ራሱ የማመልከቻ ገጽ ይከፍታል።'}</div>`;
          return `<div style="margin-top:12px"><a href="${escH(r.href)}" target="_blank" rel="noopener" style="display:inline-block;background:${gradient('jobs')};color:#fff;border-radius:999px;padding:11px 24px;font-weight:800;font-size:14.5px">${label} →</a>${note}</div>`;
        })()}</div>` : ''}
      <div id="${j.howToApply ? 'apply-cv' : 'apply'}">${cvForm({ job: j, lang, escH, main: !j.howToApply })}</div>
      <div class="sans" style="margin:18px 0;padding:14px 18px;border-radius:14px;background:#fff;border:1.5px solid var(--line)"><!-- guide-links:job-detail --><b>${lang === 'en' ? '📚 Before you apply' : '📚 ከማመልከትዎ በፊት'}</b><div style="margin-top:6px;font-size:14px;line-height:1.9"><a href="${lang === 'en' ? '/cv-ethiopia-en' : '/cv-ethiopia'}" style="font-weight:700">${lang === 'en' ? '📄 How to write a CV for Ethiopian jobs' : '📄 የሲቪ አጻጻፍ መመሪያ'}</a> · <a href="/interview-questions-ethiopia" style="font-weight:700">${lang === 'en' ? '🤝 Interview questions' : '🤝 የቃለ መጠይቅ ጥያቄዎች'}</a>${j.category === 'banking' ? ` · <a href="/bank-jobs-ethiopia" style="font-weight:700">${lang === 'en' ? '🏦 What Ethiopian banks ask for' : '🏦 ባንኮች ምን ይጠይቃሉ'}</a>` : ''}</div></div>

      <div class="sans" style="margin:18px 0;padding:18px;border-radius:16px;background:#fff;border:1.5px solid var(--line)">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:6px">${avatarFor(e, 44)}
          <b style="font-size:16px">${escH(e.name)}${e.verified ? ' <span style="color:#059669">✓</span>' : ''}</b></div>
        ${e.sector ? `<div style="color:var(--mut);font-size:13.5px">${escH(e.sector)}</div>` : ''}
        ${e.address ? `<div style="margin-top:8px">📍 ${escH(e.address)}</div>` : ''}
        ${e.locationNote ? `<div style="color:var(--mut);font-size:13px">${escH(e.locationNote)}</div>` : ''}
        ${mapped
          ? `<div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
               <a href="/ride?to=${e.lat},${e.lng}&label=${encodeURIComponent(e.name)}" style="background:#064e3b;color:#fff;border-radius:999px;padding:9px 18px;font-weight:700;font-size:13.5px">${t.ride}</a>
               <a href="https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=17/${e.lat}/${e.lng}" target="_blank" rel="noopener" style="border:1.5px solid var(--line);border-radius:999px;padding:9px 18px;font-weight:700;font-size:13.5px">🗺 ካርታ</a>
             </div>`
          : `<div style="margin-top:8px;color:var(--mut);font-size:13px">${t.unverified}</div>`}
        ${e.phone ? `<div style="margin-top:8px">📞 <a href="tel:${escH(e.phone)}">${escH(e.phone)}</a></div>` : ''}
        ${e.website ? `<div>🔗 <a href="${escH(absUrl(e.website))}" target="_blank" rel="noopener">${escH(e.website)}</a></div>` : ''}
        <div style="margin-top:10px"><a href="/employer/${e.slug}${qs(req)}" style="font-weight:700">${t.allJobs}</a></div>
      </div>

      ${/* The source is NAMED, not linked (owner's call, 2026-09-21). The url is still stored on the row:
             it is how a claim gets checked and how the harvester knows it already holds this vacancy -
             it simply is not published as an outbound link. */''}
      ${j.sourceName ? `<p class="sans" style="font-size:13px;color:var(--mut)">ምንጭ · Source: ${escH(j.sourceName)} · ${t.srcNote}</p>` : ''}
      ${others.length ? `<h2 class="sans" style="font-size:13px;letter-spacing:2px;color:var(--mut);padding:22px 0 8px;text-transform:uppercase">${t.more(escH(e.name))}</h2>${others.map(o => `<div class="t-card"><div><h3><a href="/jobs/${o.slug}">${escH(o.titleAm || o.title)}</a></h3><div class="t-tags sans"><span class="t-tag">📍 ${escH(o.city)}</span>${dlPill(o.deadline, lang)}</div></div></div>`).join('')}` : ''}
    </article></main>`;
    reply.type('text/html').send(shell({ title: (j.titleAm || j.title) + ' · ' + e.name, desc: j.summary.slice(0, 160),
      canonical: 'https://bina.et/jobs/' + j.slug, extraHead: JOBS_HEAD + jobLd(j, e, escH), body, active: 'jobs',
      ogImage: ogJobs(j.category) }));
  });

  fastify.get('/employer/:slug', async (req, reply) => {
    const t = pick(req), lang = langOf(req);
    const e = await prisma.employer.findUnique({ where: { slug: String(req.params.slug) } });
    if (!e) return reply.code(404).type('text/html').send(shell({ title: 'አልተገኘም', desc: '', canonical: 'https://bina.et/jobs', body: '<main><div class="empty"><div class="big">🔍</div><h3>ይህ ድርጅት የለም</h3><p class="sans"><a href="/jobs">ወደ ክፍት ሥራዎች →</a></p></div></main>', active: 'jobs' }));
    const now = new Date();
    const all = await prisma.job.findMany({ where: { employerId: e.id, published: true }, orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }], take: 120 });
    const open = all.filter(j => !isClosed(j.deadline, now));
    const shut = all.filter(j => isClosed(j.deadline, now));
    const mapped = e.lat != null && e.lng != null && e.locationChecked;
    const h = hiringHistory(all);
    const en = lang === 'en';
    const monthYear = d => new Date(d).toLocaleDateString(en ? 'en-GB' : 'en-GB', { month: 'long', year: 'numeric' });
    const sectorDef = e.sector ? CATEGORIES.find(c => catLabel(c.slug, 'en') === e.sector) : null;
    // Other companies in the same line of business that are hiring today - the way sideways for a reader
    // whose company has nothing open, and the link Google follows from one company to the next.
    let peers = [];
    if (sectorDef) {
      const live = await hiringNow();
      const ids = [...live.keys()].filter(id => id !== e.id);
      if (ids.length) {
        peers = await prisma.employer.findMany({ where: { id: { in: ids }, sector: e.sector },
          select: { id: true, slug: true, name: true, city: true, sector: true, logoUrl: true } });
        peers = peers.sort((a, b) => (live.get(b.id) || 0) - (live.get(a.id) || 0) || a.name.localeCompare(b.name)).slice(0, 6)
          .map(p => ({ p, n: live.get(p.id) || 0 }));
      }
    }
    const typeName = ty => (en ? ty.replace('-', ' ') : (TYPE_AM[ty] || ty));
    const history = h.total ? `<div class="sans" style="padding:16px 18px;border-radius:14px;background:#fff;border:1.5px solid var(--line);margin:0 0 18px">
        <b style="display:block;margin-bottom:6px">${en ? '📊 Hiring history on BinaSmart' : '📊 በቢናስማርት ላይ ያለው የቅጥር ታሪክ'}</b>
        <div style="line-height:1.8">
          ${en
            ? `${h.total} ${h.total === 1 ? 'advert' : 'adverts'} recorded${h.since ? ' since ' + monthYear(h.since) : ''} — ${open.length} open now, ${shut.length} closed.`
            : `${h.since ? 'ከ' + monthYear(h.since) + ' ጀምሮ ' : ''}${h.total} ማስታወቂያዎች ተመዝግበዋል — ${open.length} አሁን ክፍት፣ ${shut.length} የተዘጉ።`}
          ${h.cats.length ? `<div>${en ? 'Hires in' : 'የሚቀጥርባቸው ዘርፎች'}: ${h.cats.slice(0, 4).map(([c, n]) => `<a href="/jobs/category/${escH(c)}${qs(req)}">${escH(catLabel(c, lang))}</a> (${n})`).join(' · ')}</div>` : ''}
          ${h.cities.length ? `<div>${en ? 'Places' : 'ቦታዎች'}: ${h.cities.slice(0, 4).map(([c, n]) => `${escH(c)} (${n})`).join(' · ')}</div>` : ''}
          ${h.types.length ? `<div>${en ? 'Terms' : 'የቅጥር ዓይነት'}: ${h.types.map(([ty, n]) => `${escH(typeName(ty))} (${n})`).join(' · ')}</div>` : ''}
        </div>
        <div style="margin-top:6px;color:var(--mut);font-size:12.5px">${en ? 'Counted from this company\'s own adverts. Nothing here is estimated.' : 'ከድርጅቱ ራሱ ማስታወቂያዎች የተቆጠረ ነው፤ ግምት የለበትም።'}</div>
      </div>` : '';
    const body = `<main><article class="art">
      ${langToggle(req)}
      <div style="display:flex;gap:14px;align-items:center">${avatarFor(e, 62)}
        <h1 style="margin:0">${escH(e.name)}${e.verified ? ' <span style="color:#059669;font-size:.7em">✓ የተረጋገጠ</span>' : ''}</h1></div>
      ${e.nameAm && e.nameAm !== e.name ? `<p class="lead">${escH(e.nameAm)}</p>` : ''}
      ${e.about ? `<p class="lead">${escH(e.about)}</p>` : ''}
      <div class="t-tags sans" style="margin:8px 0 16px">
        ${e.sector ? (sectorDef ? `<a class="t-tag" href="/employers/${sectorDef.slug}${qs(req)}">🏭 ${escH(en ? sectorDef.en : sectorDef.am)}</a>` : `<span class="t-tag">🏭 ${escH(e.sector)}</span>`) : ''}
        <span class="t-tag">📍 ${escH(e.city)}</span>
        <span class="t-tag">💼 ${open.length} ${t.open}</span>
      </div>
      <div class="sans" style="padding:16px 18px;border-radius:14px;background:#fff;border:1.5px solid var(--line);margin-bottom:18px">
        ${e.address ? `<div>📍 ${escH(e.address)}</div>` : (lang === 'en' ? '<div style="color:var(--mut)">Address not recorded yet</div>' : '<div style="color:var(--mut)">አድራሻው ገና አልተመዘገበም</div>')}
        ${e.locationNote ? `<div style="color:var(--mut);font-size:13px">${escH(e.locationNote)}</div>` : ''}
        ${mapped ? `<div style="margin-top:10px"><a href="/ride?to=${e.lat},${e.lng}&label=${encodeURIComponent(e.name)}" style="background:#064e3b;color:#fff;border-radius:999px;padding:9px 18px;font-weight:700;font-size:13.5px">${t.ride}</a></div>`
          : `<div style="margin-top:6px;color:var(--mut);font-size:13px">${t.unverified}</div>`}
        ${e.phone ? `<div style="margin-top:8px">📞 <a href="tel:${escH(e.phone)}">${escH(e.phone)}</a></div>` : ''}
        ${e.email ? `<div>✉️ ${escH(e.email)}</div>` : ''}
        ${e.website ? `<div>🔗 <a href="${escH(absUrl(e.website))}" target="_blank" rel="noopener">${escH(e.website)}</a></div>` : ''}
      </div>
      ${open.length ? `<h2 class="sans" style="font-size:13px;letter-spacing:2px;color:var(--mut);text-transform:uppercase;padding-bottom:8px">${t.openVac}</h2>${open.map(j => `<div class="t-card"><div><h3><a href="/jobs/${j.slug}">${escH(j.titleAm || j.title)}</a></h3><div class="t-tags sans"><span class="t-tag">📍 ${escH(j.city)}</span>${typePill(j.jobType, lang)}${dlPill(j.deadline, lang)}</div></div></div>`).join('')}` : `<div class="empty"><div class="big">💼</div><h3>${escH(t.noJobs)}</h3></div>`}
      ${history}
      ${shut.length ? `<h2 class="sans" style="font-size:13px;letter-spacing:2px;color:var(--mut);text-transform:uppercase;padding:14px 0 8px">🔒 ${en ? 'Past adverts' : 'ያለፉ ማስታወቂያዎች'} · ${shut.length}</h2>
        <ul class="sans" style="margin:0 0 18px;padding-left:18px;line-height:1.9">${shut.slice(0, 12).map(j => `<li><a href="/jobs/${j.slug}${qs(req)}">${escH(j.titleAm || j.title)}</a>${j.deadline ? ` <span style="color:var(--mut);font-size:13px">· ${en ? 'closed' : 'ተዘግቷል'} ${new Date(j.deadline).toISOString().slice(0, 10)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${peers.length ? `<h2 class="sans" style="font-size:13px;letter-spacing:2px;color:var(--mut);text-transform:uppercase;padding:14px 0 8px">${en ? 'Also hiring in ' + escH(sectorDef.en) : 'በ' + escH(sectorDef.am) + ' ዘርፍ ሌሎች የሚቀጥሩ'}</h2>
        <div style="display:flex;flex-direction:column;gap:10px">${peers.map(x => employerCard(x.p, x.n, lang)).join('')}</div>
        <p class="sans" style="margin:10px 0 0"><a href="/employers/${sectorDef.slug}${qs(req)}" style="font-weight:700">${en ? 'All ' + escH(sectorDef.en.toLowerCase()) + ' companies hiring →' : 'በዚህ ዘርፍ ሁሉም የሚቀጥሩ ድርጅቶች →'}</a></p>` : ''}
    </article></main>`;
    const thin = !open.length && h.total <= 1;
    const desc = e.about || (en
      ? `${e.name}${e.city ? ', ' + e.city : ''} — ${open.length} open ${open.length === 1 ? 'vacancy' : 'vacancies'} now; ${h.total} ${h.total === 1 ? 'advert' : 'adverts'} on BinaSmart${h.cats.length ? ', mostly ' + catLabel(h.cats[0][0], 'en') : ''}.`
      : `${e.name} — አሁን ${open.length} ክፍት የሥራ ቦታ፤ በቢናስማርት ${h.total} ማስታወቂያዎች${h.cats.length ? '፣ በብዛት በ' + catLabel(h.cats[0][0], 'am') + ' ዘርፍ' : ''}።`);
    reply.type('text/html').send(shell({ title: e.name + ' · ክፍት የሥራ ቦታዎች', desc: desc.slice(0, 160), canonical: 'https://bina.et/employer/' + e.slug,
      extraHead: JOBS_HEAD + orgLd(e) + (thin ? '<meta name="robots" content="noindex,follow">' : ''), body, active: 'jobs',
      ogImage: ogJobs(null) }));
  });

  // ---- The company directory ----
  // Until today every company page was an island: reachable from a vacancy and from nowhere else, so
  // Google had no way in and no reason to believe the pages belonged together. /employers is that way
  // in, and a page per sector answers a search nobody here answers well - "construction companies in
  // Addis Ababa" is a real query with no good Ethiopian result.
  //
  // Only companies with a vacancy that is still open are listed. Same rule as the sitemap: a directory
  // padded with companies that are not hiring asks Google to rank a promise we are not keeping.
  async function hiringNow() {
    const now = new Date();
    const jobs = await prisma.job.findMany({
      where: { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      select: { employerId: true, deadline: true },
    });
    const live = new Map();
    for (const j of jobs) if (!isClosed(j.deadline, now)) live.set(j.employerId, (live.get(j.employerId) || 0) + 1);
    return live;
  }

  function employerCard(e, n, lang) {
    return `<a class="jc" href="/employer/${encodeURIComponent(e.slug)}" style="display:flex;gap:12px;align-items:center;padding:12px 14px">
      ${avatarFor(e, 44)}
      <span style="flex:1;min-width:0">
        <b style="display:block">${escH(e.name)}</b>
        <small class="sans" style="color:var(--mut)">${escH(e.sector || '')}${e.sector ? ' · ' : ''}📍 ${escH(e.city)}</small>
      </span>
      <span class="t-tag">${n} ${lang === 'en' ? (n === 1 ? 'vacancy' : 'vacancies') : 'ክፍት'}</span>
    </a>`;
  }

  async function employersPage(req, reply, sectorSlug) {
    const lang = langOf(req);
    const def = sectorSlug ? BY_SLUG.get(sectorSlug) : null;
    if (sectorSlug && !def) return reply.code(404).type('text/html').send(shell({
      title: 'አልተገኘም', desc: '', canonical: 'https://bina.et/employers', body: '<main><article class="art"><h1>አልተገኘም</h1></article></main>', active: 'jobs' }));

    const live = await hiringNow();
    const ids = [...live.keys()];
    const emps = ids.length ? await prisma.employer.findMany({
      where: { id: { in: ids }, ...(def ? { sector: catLabel(def.slug, 'en') } : {}) },
      select: { id: true, slug: true, name: true, city: true, sector: true, logoUrl: true },
    }) : [];
    emps.sort((a, b) => (live.get(b.id) || 0) - (live.get(a.id) || 0) || a.name.localeCompare(b.name));

    // Every sector that actually has somebody hiring, for the chips at the top.
    const bySector = new Map();
    if (!def) {
      const all = ids.length ? await prisma.employer.findMany({ where: { id: { in: ids } }, select: { sector: true } }) : [];
      for (const e of all) if (e.sector) bySector.set(e.sector, (bySector.get(e.sector) || 0) + 1);
    }

    const chips = def ? '' : CATEGORIES.map(c => {
      const n = bySector.get(catLabel(c.slug, 'en')) || 0;
      return n ? `<a class="t-tag" href="/employers/${c.slug}">${escH(lang === 'en' ? c.en : c.am)} <b>${n}</b></a>` : '';
    }).join('');

    const heading = def
      ? (lang === 'en' ? def.en + ' companies hiring in Ethiopia' : 'በ' + def.am + ' ዘርፍ ሠራተኛ እየቀጠሩ ያሉ ድርጅቶች')
      : (lang === 'en' ? 'Companies hiring in Ethiopia' : 'በኢትዮጵያ ሠራተኛ እየቀጠሩ ያሉ ድርጅቶች');

    const body = `<main><article class="art">
      ${langToggle(req)}
      <h1>${escH(heading)}</h1>
      <p class="lead">${emps.length} ${lang === 'en'
        ? 'companies with at least one vacancy open right now. Every one is a company that actually advertised — nothing here is invented.'
        : 'ድርጅቶች አሁን ክፍት የሥራ ቦታ አላቸው። ሁሉም በእውነት ማስታወቂያ ያወጡ ናቸው።'}</p>
      ${chips ? `<div class="t-tags sans" style="margin:10px 0 18px">${chips}</div>` : ''}
      ${def ? `<p class="sans" style="margin:0 0 14px"><a href="/employers">← ${lang === 'en' ? 'all sectors' : 'ሁሉም ዘርፎች'}</a></p>` : ''}
      <div style="display:flex;flex-direction:column;gap:10px">${emps.map(e => employerCard(e, live.get(e.id) || 0, lang)).join('')}</div>
      ${emps.length ? '' : `<p class="sans">${lang === 'en' ? 'Nobody in this sector is hiring today.' : 'በዚህ ዘርፍ ዛሬ የሚቀጥር የለም።'}</p>`}
    </article></main>`;

    reply.type('text/html').send(shell({
      title: def
        ? (lang === 'en' ? def.en + ' companies hiring in Ethiopia — ' + emps.length + ' with open vacancies'
                         : 'በ' + def.am + ' ዘርፍ የሚቀጥሩ ድርጅቶች — ' + emps.length)
        : (lang === 'en' ? 'Companies hiring in Ethiopia — ' + emps.length + ' with open vacancies'
                         : 'በኢትዮጵያ የሚቀጥሩ ድርጅቶች — ' + emps.length),
      desc: def
        ? (lang === 'en' ? emps.length + ' ' + def.en.toLowerCase() + ' companies in Ethiopia with vacancies open now — each with its address, its logo and what it is hiring for.'
                         : 'በ' + def.am + ' ዘርፍ ' + emps.length + ' ድርጅቶች አሁን ክፍት የሥራ ቦታ አላቸው።')
        : (lang === 'en' ? 'Every Ethiopian company advertising a vacancy on BinaSmart right now, by sector, with addresses and logos.'
                         : 'በቢናስማርት ላይ አሁን ማስታወቂያ ያወጡ የኢትዮጵያ ድርጅቶች — በዘርፍ፣ ከአድራሻና ከምልክት ጋር።'),
      canonical: 'https://bina.et/employers' + (def ? '/' + def.slug : ''),
      extraHead: JOBS_HEAD, body, active: 'jobs', ogImage: ogJobs(def && def.slug),
    }));
  }

  fastify.get('/employers', async (req, reply) => employersPage(req, reply, null));
  fastify.get('/employers/:sector', async (req, reply) => employersPage(req, reply, String(req.params.sector || '')));


  // Publishing. Owner key only for now: at 2,000 a day this becomes a harvester writing through the same
  // function, and the employer matching above is what keeps that from creating 2,000 companies a day.
  fastify.post('/api/ops/jobs', async (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    const b = req.body || {};
    if (!b.title || !b.employer || !b.summary) return reply.code(400).send({ ok: false, error: 'title, employer and summary are required' });
    if (b.jobType && !JOB_TYPES.includes(String(b.jobType))) return reply.code(400).send({ ok: false, error: 'jobType must be one of ' + JOB_TYPES.join(', ') });
    try {
      const emp = await findOrCreateEmployer(b.employer, {
        sector: b.sector, city: b.employerCity || b.city, website: b.website, phone: b.phone,
        email: b.email, address: b.address, locationNote: b.locationNote,
      });
      const slug = await uniqueJobSlug(b.title + '-' + b.employer);
      const job = await prisma.job.create({ data: {
        slug, title: String(b.title).trim(), titleAm: b.titleAm || null, employerId: emp.id,
        city: b.city || 'Addis Ababa', jobType: b.jobType || null, experience: b.experience || null,
        education: b.education || null, salary: b.salary || null,
        vacancies: b.vacancies ? Number(b.vacancies) : null,
        summary: String(b.summary).trim(), bodyHtml: b.bodyHtml || null, howToApply: b.howToApply || null,
        deadline: b.deadline ? new Date(b.deadline) : null,
        sourceUrl: b.sourceUrl || null, sourceName: b.sourceName || null,
      } });
      return { ok: true, job: { slug: job.slug, url: 'https://bina.et/jobs/' + job.slug }, employer: { slug: emp.slug, url: 'https://bina.et/employer/' + emp.slug, created: !emp.createdAt || undefined } };
    } catch (e) {
      req.log && req.log.warn && req.log.warn('job publish failed: ' + e.message);
      return reply.code(500).send({ ok: false, error: 'publish_failed' });
    }
  });
};

module.exports.normName = normName;
module.exports.slugify = slugify;
