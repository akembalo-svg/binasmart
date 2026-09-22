'use strict';
// ethiojobshub.com — a WordPress board where one post is one company's whole announcement.
//
// Two shapes of post, and they need different treatment:
//
//   1. TEXT posts. The announcement is written out: "Position 1: Senior IT Officer", the duties, the
//      qualification, "Deadline: sept 25, 2026", and a form link. These we split into one listing per
//      position - that is what a job seeker searches for, and a single entry called "Bunna Bank Job
//      Vacancy" hides five different jobs behind one line.
//   2. POSTER posts. The positions live inside a photographed notice and the page text is only the
//      company's introduction and how to apply. We publish the announcement as one entry with the
//      poster shown (copied to our server, never hotlinked). We do NOT transcribe the poster into
//      fields and present our reading as the employer's terms - a misread salary or closing date is a
//      person travelling across Addis for nothing.
//
// The board also publishes its own advice articles ("Top 10 Government Jobs…", "How to Apply on
// EthioJobsHub"). Those are refused: a jobs board padded with blog posts is a jobs board nobody trusts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'jobposters');
const IMG_MAX = 3 * 1024 * 1024;
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; Ethiopian jobs aggregator; contact https://t.me/Bina_smart)';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_POSITIONS = 25;

const unent = s => String(s).replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, '–')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const strip = h => String(h || '')
  .replace(/<(script|style|ins|iframe|noscript)\b[\s\S]*?<\/\1>/gi, ' ')   // ad slots included
  .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ');
const tidy = s => unent(s).replace(/[ \t]+/g, ' ').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "Zemen Insurance S.C Job", "Bunna Bank Job Vacancy 2026 9" — one company with the board's suffix.
function employerFrom(h1) {
  return unent(h1)
    .replace(/\s*[-–|]\s*ethiojobshub.*$/i, '')
    .replace(/\b(new\s+)?(job|jobs)?\s*vacancy(\s+announcement)?\b/gi, ' ')
    .replace(/\bnew\s+alert\b/gi, ' ').replace(/\bjobs?\b/gi, ' ')
    .replace(/\b(20\d\d)\b/g, ' ').replace(/[\s\-–_]+\d+\s*$/g, ' ')
    .replace(/\s{2,}/g, ' ').replace(/[\s\-–,:]+$/, '').trim();
}

// The instructions, in the employer's own words. This is what replaces a link to somebody else's site.
function howToApply(text) {
  const i = text.search(/(interested\s+(and\s+qualified\s+)?(applicants|candidates)|how\s+to\s+apply|applicants?\s+(who|should|can|are)\b|submit\s+your\s+(cv|application)|apply\s+(online\s+)?(through|via|using)|ፍላጎት\s*ያላቸው|ማመልከት)/i);
  if (i < 0) return null;
  let block = text.slice(i, i + 900).trim();
  block = block.split(/\n(?:share|related|tags?|previous|next|join our telegram|you may also like)\b/i)[0].trim();
  return block.slice(0, 700) || null;
}

// "Deadline: sept 25, 2026". Taken only when it parses to a real date within the next months - a closing
// date we got wrong is worse than none, because the board then hides a vacancy that is still open.
function deadlineFrom(text, from = Date.now()) {
  const m = /(?:deadline|closing\s+date|last\s+day|dead\s*line)\s*[:\-–]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s*20\d\d|\d{1,2}\s+[A-Za-z]{3,9},?\s*20\d\d|\d{4}-\d{2}-\d{2})/i.exec(text);
  if (!m) return null;
  const d = new Date(m[1].replace(/(\d)(st|nd|rd|th)/i, '$1'));
  if (isNaN(d.getTime())) return null;
  if (d.getTime() < from - 86400000 || d.getTime() > from + 200 * 86400000) return null;
  return d;
}

const CITIES = ['Addis Ababa', 'Adama', 'Bahir Dar', 'Hawassa', 'Mekelle', 'Dire Dawa', 'Jimma', 'Gondar',
  'Bishoftu', 'Shashemene', 'Harar', 'Debre Birhan', 'Debre Markos', 'Jigjiga', 'Assosa', 'Semera'];

async function fetchImage(src) {
  // WordPress writes "-265x300" into a thumbnail's name; the original sits beside it without that.
  for (const url of [src.replace(/-\d+x\d+(\.\w+)$/, '$1'), src]) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'image/*' } });
      if (!r.ok) continue;
      const ext = EXT[String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
      if (!ext) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000 || buf.length > IMG_MAX) continue;
      fs.mkdirSync(IMG_DIR, { recursive: true });
      const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20) + '.' + ext;
      fs.writeFileSync(path.join(IMG_DIR, name), buf);
      return '/static/jobposters/' + name;
    } catch (e) { /* try the next candidate */ } finally { clearTimeout(t); }
  }
  return null;
}

// "Position 1: Senior IT Officer (Re-advertised)" → the separate vacancies inside one announcement.
function splitPositions(text) {
  const re = /^\s*(?:position|vacancy|job\s*title)\s*(?:no\.?\s*)?\d*\s*[:\-–]\s*(.+)$/gim;
  const marks = [];
  let m;
  while ((m = re.exec(text)) && marks.length < MAX_POSITIONS) {
    const title = m[1].replace(/[\s\-–:]+$/, '').replace(/\s{2,}/g, ' ').trim();
    if (title.length >= 3 && title.length <= 110) marks.push({ title, at: m.index, end: re.lastIndex });
  }
  if (marks.length < 2) return [];                       // a single marker is a heading, not a list
  return marks.map((mk, i) => ({
    title: mk.title,
    body: text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim(),
  }));
}

const asHtml = lines => lines.map(l => `<p>${esc(l)}</p>`).join('');

module.exports = async function parseEthiojobsHub(html, url, sourceName) {
  const h1raw = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1];
  if (!h1raw) return null;
  const h1 = unent(strip(h1raw)).replace(/\s+/g, ' ').trim();

  // The board's own advice articles announce themselves in the opening of the headline.
  if (/^(how to|top \d+|best |guide|what is|why |where |when |\d+ (ways|tips|things))/i.test(h1)) return null;
  if (/ethiojobshub|step[- ]by[- ]step|guide$/i.test(h1)) return null;

  const employer = employerFrom(h1);
  if (!employer || employer.length < 3) return null;

  const raw = (/class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)(?:<\/article>|<footer)/i.exec(html) || [])[1] || '';
  let text = tidy(strip(raw));
  // Drop the theme's own header block: the category, the title again, and the date printed twice.
  text = text.split('\n').filter(l => !/^\w{3,10}\s+\d{1,2},\s+20\d\d$/.test(l) && l !== h1).join('\n');
  if (text.length < 150) return null;

  const apply = howToApply(text);
  const filed = /\bcategory-[a-z0-9-]+/i.test(html);
  const titled = /vacanc|job|recruit|hiring|ክፍት|ሥራ/i.test(h1);
  if (!filed && !apply) return null;
  if (!titled && !apply) return null;

  const published = (/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1];
  const publishedAt = published ? new Date(published) : new Date();
  const city = CITIES.find(c => new RegExp('\\b' + c.replace(/ /g, '\\s+') + '\\b', 'i').test(text)) || 'Addis Ababa';
  const deadline = deadlineFrom(text, publishedAt.getTime());

  const positions = splitPositions(text);
  const base = { employer, website: null, city, jobType: null, howToApply: apply, deadline,
    publishedAt, sourceUrl: url, sourceName };

  // When the text carries the positions, each one is its own listing - and the poster is not needed.
  if (positions.length) {
    return positions.map(p => ({
      ...base,
      title: p.title, titleAm: null,
      summary: (p.body.replace(/\n/g, ' ').slice(0, 280) || (p.title + ' — ' + employer)),
      bodyHtml: asHtml(p.body.split('\n').slice(0, 40)),
      imageUrl: null,
    }));
  }

  // Otherwise the notice itself is the advert, so we show it.
  const imgSrc = (/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i.exec(raw) || [])[1]
    || (/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(html) || [])[1];
  const imageUrl = imgSrc ? await fetchImage(new URL(imgSrc, url).toString()) : null;
  if (!apply && !imageUrl) return null;                  // nothing here a job seeker can use

  const intro = text.split('\n').filter(l => l.length > 60).slice(0, 2).join(' ');
  return {
    ...base,
    // The date is part of the title on purpose. A company posts several notices a month, and with a
    // bare "Vacancy announcement" they are indistinguishable - to a reader scanning the board, and to
    // the duplicate check, which would fold this month's notice into last month's.
    title: 'Vacancy announcement — ' + publishedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    titleAm: 'የክፍት ሥራ ማስታወቂያ',
    summary: (intro || (employer + ' has published a vacancy announcement.')).slice(0, 280),
    bodyHtml: (imageUrl ? `<p><img src="${imageUrl}" alt="" style="max-width:100%;border-radius:12px"></p>` : '')
      + asHtml(text.split('\n').slice(0, 30)),
    imageUrl,
  };
};

module.exports.employerFrom = employerFrom;
module.exports.howToApply = howToApply;
module.exports.deadlineFrom = deadlineFrom;
module.exports.splitPositions = splitPositions;
