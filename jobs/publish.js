'use strict';
// Employer matching and slugs — one implementation, used by both the page's posting endpoint and every
// harvester. If a second copy of this logic ever appears, "Awash Bank" and "AWASH BANK S.C." start
// becoming two companies depending on which door the advert came through, and the employer register
// that is the point of the jobs section quietly rots.

const slugify = s => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9ሀ-፿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'job';

// Strips the legal suffixes and punctuation that differ between adverts for the same company.
const normName = s => String(s || '').toLowerCase()
  .replace(/[‘’'".,()]/g, '')
  .replace(/\b(s\.?c\.?|plc|p\.l\.c\.?|inc|ltd|limited|company|co|share company|አክሲዮን ማህበር|ኃ\.የ\.የግ\.ማ)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Fields a later advert may fill in, never overwrite. An advert that omits the website must not erase
// the one a previous advert gave us, and a harvested row must never clobber what a person typed.
const FILLABLE = ['sector', 'city', 'about', 'website', 'phone', 'email', 'logoUrl', 'address', 'locationNote'];


// The same city arrives spelled several ways in one afternoon's harvest: "Addis Ababa" 546 times,
// "Addis Ababa, Ethiopia" 121, "Addis abeba" 16. Left alone they become three entries in the city
// filter, each holding part of the answer - which reads as a broken board rather than a full one.
// Only spelling is normalised here. A city we do not recognise is kept exactly as the advert wrote it,
// because guessing a location is how somebody travels to the wrong town.
const CITY_FIX = [
  [/^addis\s*a?b[ae]b?a?\b.*$/i, 'Addis Ababa'],
  [/^a\.?\s*a\.?$/i, 'Addis Ababa'],
  [/^አዲስ\s*አበባ.*$/, 'Addis Ababa'],
  [/^dire\s*dawa.*$/i, 'Dire Dawa'],
  [/^bahir\s*dar.*$/i, 'Bahir Dar'],
  [/^hawass?a.*$/i, 'Hawassa'],
  [/^mekell?e.*$/i, 'Mekelle'],
  [/^adama.*$/i, 'Adama'],
  [/^jimma.*$/i, 'Jimma'],
  [/^gond[ae]r.*$/i, 'Gondar'],
  [/^debre\s*birhan.*$/i, 'Debre Birhan'],
  [/^debre\s*mark?os.*$/i, 'Debre Markos'],
  [/^shashem[ae]n[ae].*$/i, 'Shashemene'],
  [/^b[ei]shoftu.*$/i, 'Bishoftu'],
  [/^h?arar\b.*$/i, 'Harar'],
];
// Some adverts put a whole sentence in the location field - "Under West Regional Office for Addis Ababa
// Surrounding Branches". Printed as a filter pill that is three lines of noise, and it splinters the
// city list. If a city we know is named inside it we take that; otherwise the advert's own words stay,
// trimmed, because inventing a location is how somebody travels to the wrong town.
const KNOWN = ['Addis Ababa', 'Dire Dawa', 'Bahir Dar', 'Hawassa', 'Mekelle', 'Adama', 'Jimma', 'Gondar',
  'Bishoftu', 'Shashemene', 'Harar', 'Debre Birhan', 'Debre Markos', 'Jigjiga', 'Assosa', 'Semera',
  'Arba Minch', 'Dessie', 'Nekemte', 'Wolaita Sodo', 'Hosaena', 'Sebeta', 'Burayu'];
function cleanCity(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'Addis Ababa';
  for (const [re, name] of CITY_FIX) if (re.test(s)) return name;
  if (s.length > 28) {
    const hit = KNOWN.find(c => new RegExp('\\b' + c.replace(/ /g, '\\s+') + '\\b', 'i').test(s));
    if (hit) return hit;
  }
  return s.replace(/,\s*Ethiopia$/i, '').trim().slice(0, 60) || s;
}

module.exports = function publishing({ prisma }) {
  async function findOrCreateEmployer(name, extra = {}) {
    const key = normName(name);
    if (!key) throw new Error('employer name required');
    const all = await prisma.employer.findMany({ select: { id: true, name: true, slug: true } });
    const hit = all.find(e => normName(e.name) === key);
    if (hit) {
      const patch = {};
      const cur = await prisma.employer.findUnique({ where: { id: hit.id } });
      for (const k of FILLABLE) if (extra[k] && !cur[k]) patch[k] = extra[k];
      if (Object.keys(patch).length) await prisma.employer.update({ where: { id: hit.id }, data: patch });
      return hit;
    }
    const base = slugify(name);
    let slug = base, n = 1;
    while (await prisma.employer.findUnique({ where: { slug } })) slug = base + '-' + (++n);
    const data = { slug, name: String(name).trim() };
    for (const k of FILLABLE) if (extra[k]) data[k] = extra[k];
    return prisma.employer.create({ data });
  }

  async function uniqueJobSlug(seed) {
    const base = slugify(seed);
    let slug = base, n = 1;
    while (await prisma.job.findUnique({ where: { slug } })) slug = base + '-' + (++n);
    return slug;
  }

  return { findOrCreateEmployer, uniqueJobSlug };
};

module.exports.cleanCity = cleanCity;
module.exports.slugify = slugify;
module.exports.normName = normName;
