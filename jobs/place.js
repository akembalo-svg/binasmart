'use strict';
// Where the job is, and what it pays — in the shape Google reads.
//
// Search Console reported five missing JobPosting fields on 23 September 2026, all non-critical:
// postalCode, streetAddress, addressRegion, baseSalary, employmentType. Two of those we are not going
// to fix by making something up. A street address we have not researched, invented to satisfy a
// validator, sends a job seeker to the wrong gate: a day and a fare, which in Addis is real money.
// So this fills only what we can derive from something the advert or the employer actually told us.

// A city's region. Only entries we are sure of — a city missing from here simply gets no addressRegion,
// which is a gap, not an error. Addis Ababa and Dire Dawa are chartered cities: the city IS the region.
const REGION = {
  'addis ababa': 'Addis Ababa',
  'dire dawa': 'Dire Dawa',
  // Oromia
  adama: 'Oromia', nazret: 'Oromia', bishoftu: 'Oromia', 'debre zeit': 'Oromia', jimma: 'Oromia',
  shashamane: 'Oromia', nekemte: 'Oromia', ambo: 'Oromia', asella: 'Oromia', 'sebeta': 'Oromia',
  'holeta': 'Oromia', 'bishoftu (debre zeit)': 'Oromia', 'dukem': 'Oromia', 'mojo': 'Oromia',
  // Amhara
  'bahir dar': 'Amhara', gondar: 'Amhara', dessie: 'Amhara', 'debre birhan': 'Amhara',
  'debre markos': 'Amhara', woldia: 'Amhara', 'kombolcha': 'Amhara', 'debre tabor': 'Amhara',
  // Tigray
  mekelle: 'Tigray', mekele: 'Tigray', adigrat: 'Tigray', shire: 'Tigray', axum: 'Tigray', aksum: 'Tigray',
  // the rest
  hawassa: 'Sidama', awassa: 'Sidama',
  assosa: 'Benishangul-Gumuz',
  jigjiga: 'Somali', 'jijiga': 'Somali',
  semera: 'Afar', 'samara': 'Afar',
  gambela: 'Gambela', gambella: 'Gambela',
};

// Values that arrive in the city column but are not places. Boards put the working arrangement there.
const NON_PLACE = /^(project based|project|on-?site.*|head office|field based|remote|hybrid|various|multiple|nationwide|ethiopia|tbd|n\/?a|s:|-+)$/i;

// "Addis Ababa, Ethiopia" and "Head Office, Addis Ababa" both name a city; take it.
function cleanCity(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  for (const part of parts) {
    if (NON_PLACE.test(part)) continue;
    if (/^ethiopia$/i.test(part)) continue;
    return part;
  }
  return null;
}

// The region for a city, or null. Never a guess.
const regionFor = city => (city ? REGION[String(city).toLowerCase().trim()] || null : null);

// Salaries arrive as the advert printed them: "16,483 ETB", "11,000 - 14,000 ETB", "160 USD",
// "Negotiable", "As per company scale". Only a real figure with a real currency becomes baseSalary;
// everything else stays text on the page and out of the structured data.
//
// unitText is MONTH. Ethiopian adverts quote a monthly gross, and a figure like 16,483 ETB is a month's
// pay by any reading — but it IS an assumption about a convention, so it is written here rather than
// buried: if a board ever starts quoting annual figures this is the line that has to change.
const CURRENCY = { etb: 'ETB', birr: 'ETB', br: 'ETB', usd: 'USD', $: 'USD', eur: 'EUR' };
function parseSalary(raw) {
  const s = String(raw || '').trim();
  if (!s || /negotiab|as per|company scale|attractive|competitive|depend/i.test(s)) return null;
  const m = s.match(/(\d[\d,.\s]*\d|\d)\s*(?:-|–|to)\s*(\d[\d,.\s]*\d|\d)\s*(etb|birr|br|usd|eur|\$)/i)
         || s.match(/(etb|birr|br|usd|eur|\$)\s*(\d[\d,.\s]*\d|\d)/i)
         || s.match(/(\d[\d,.\s]*\d|\d)\s*(etb|birr|br|usd|eur|\$)/i);
  if (!m) return null;
  const num = t => { const n = Number(String(t).replace(/[,\s]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

  let currency, min = null, max = null;
  if (m.length === 4) { currency = CURRENCY[m[3].toLowerCase()]; min = num(m[1]); max = num(m[2]); }
  else if (CURRENCY[String(m[1]).toLowerCase()]) { currency = CURRENCY[m[1].toLowerCase()]; min = num(m[2]); }
  else { currency = CURRENCY[String(m[2]).toLowerCase()]; min = num(m[1]); }
  if (!currency || !min) return null;
  if (max != null && max < min) return null;
  // A salary of 50 birr a month is a mis-parse, not a job. So is 10 million.
  if (currency === 'ETB' && (min < 500 || min > 2000000)) return null;
  return { currency, min, max: max != null && max !== min ? max : null };
}

function salaryLd(raw) {
  const p = parseSalary(raw);
  if (!p) return null;
  return {
    '@type': 'MonetaryAmount', currency: p.currency,
    value: {
      '@type': 'QuantitativeValue', unitText: 'MONTH',
      ...(p.max ? { minValue: p.min, maxValue: p.max } : { value: p.min }),
    },
  };
}

module.exports = { cleanCity, regionFor, parseSalary, salaryLd, REGION };
