'use strict';
// Which airlines we show on /flights, and where each button points.
//
// Two things decide the layout, and both come from how Ethiopians actually pay:
//
//   * Ethiopian Airlines accepts telebirr and CBE Birr on its own site, so a customer in Addis can
//     finish the purchase there. Every other airline needs an international card, which most local
//     customers do not have — sending them to that checkout wastes the click and the trust. Those
//     buttons are for diaspora and card-holders; local customers get the agency instead.
//
//   * An affiliate id is only present once that programme approves us. Until then the button still
//     works — it just points at the airline's own site and earns nothing. Nothing on the page may
//     claim a partnership we do not have.
//
// Adding an affiliate link later is one environment variable, e.g. AFF_ET=https://...  No code change.

// site: the plain, always-correct destination. affiliate ids never live in this file.
const AIRLINES = [
  { id: 'ET', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ',
    site: 'https://www.ethiopianairlines.com/', paysBirr: true,
    payNote: 'telebirr · CBE Birr · card', payNoteAm: 'በtelebirr፣ በCBE ብር ወይም በካርድ' },
  { id: 'EK', name: 'Emirates', nameAm: 'ኤሚሬትስ',
    site: 'https://www.emirates.com/', paysBirr: false,
    payNote: 'international card only', payNoteAm: 'በዓለም አቀፍ ካርድ ብቻ' },
  { id: 'QR', name: 'Qatar Airways', nameAm: 'ኳታር ኤርዌይስ',
    site: 'https://www.qatarairways.com/', paysBirr: false,
    payNote: 'international card only', payNoteAm: 'በዓለም አቀፍ ካርድ ብቻ' },
  { id: 'EY', name: 'Etihad Airways', nameAm: 'ኢቲሃድ',
    site: 'https://www.etihad.com/', paysBirr: false,
    payNote: 'international card only', payNoteAm: 'በዓለም አቀፍ ካርድ ብቻ' },
  { id: 'TK', name: 'Turkish Airlines', nameAm: 'ቱርኪሽ ኤርላይንስ',
    site: 'https://www.turkishairlines.com/', paysBirr: false,
    payNote: 'international card only', payNoteAm: 'በዓለም አቀፍ ካርድ ብቻ' },
  { id: 'FZ', name: 'flydubai', nameAm: 'ፍላይ ዱባይ',
    site: 'https://www.flydubai.com/', paysBirr: false,
    payNote: 'international card only', payNoteAm: 'በዓለም አቀፍ ካርድ ብቻ' },
];

const envKey = id => 'AFF_' + String(id || '').toUpperCase();

// Only an https URL may replace the plain site link. A typo in .env must not send a customer to a
// broken or unencrypted page, so anything that is not a real https URL is ignored.
function validAffiliate(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return null;
  let u;
  try { u = new URL(v); } catch (e) { return null; }
  return u.protocol === 'https:' ? v : null;
}

// Where one airline's button goes, and whether it is a paid link.
function linkFor(airline, env) {
  const aff = validAffiliate((env || {})[envKey(airline.id)]);
  return {
    url: aff || airline.site,
    // Google requires paid links to be marked. An unpaid link to the airline's own site must NOT
    // carry rel=sponsored, or we would be devaluing an ordinary outbound link for no reason.
    rel: aff ? 'sponsored nofollow noopener' : 'noopener',
    sponsored: !!aff,
  };
}

// The full list, each with its resolved link. `list` is injectable so tests do not depend on which
// airlines we happen to ship today.
function resolve(env, list) {
  return (list || AIRLINES).map(a => Object.assign({}, a, { link: linkFor(a, env) }));
}

// Airlines a customer in Addis can actually pay, and the rest.
const payableInBirr = rows => rows.filter(a => a.paysBirr);
const cardOnly = rows => rows.filter(a => !a.paysBirr);

// How many affiliate programmes are actually live — for the ops page, so we never guess.
const liveAffiliates = rows => rows.filter(a => a.link && a.link.sponsored).map(a => a.id);

module.exports = { AIRLINES, envKey, validAffiliate, linkFor, resolve, payableInBirr, cardOnly, liveAffiliates };
