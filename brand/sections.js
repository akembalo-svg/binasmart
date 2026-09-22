'use strict';
// One mark per section, drawn to the same rules so they read as a family rather than six logos.
//
// The rules, so a later mark matches without anyone having to guess:
//   · 24×24 box, stroke only, width 1.8, round caps and joins — the same construction as the footer icons
//   · one idea per mark, no text inside, legible at 18px on a phone
//   · every mark carries BinaSmart's claim in its second element: the tick, the stamp, the checked seat.
//     The category says what the page is; the small mark says the listings were checked. That is the
//     whole positioning of the platform, and it belongs in the logo rather than in a sentence nobody reads.
//   · each section owns a colour pair used for its hero gradient, so a returning reader knows where they
//     are before reading a word. Green stays with tenders and teal with ride because people already
//     learned those; the new sections take the free colours.
//
// Marks are inline SVG, not files: they must recolour with the page, print, and never 404.

const MARKS = {
  // A case, and the tick that says somebody checked the advert before it was published.
  jobs: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M3 12h18"/><path d="M9.6 15.4l1.6 1.6 3.2-3.2"/>',
  // A notice with a stamp in the corner — how a tender arrives in Ethiopia.
  tenders: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15.5h4"/><circle cx="16.5" cy="16.5" r="3"/><path d="M15.2 16.6l.9.9 1.9-1.9"/>',
  // A ticket with its torn edge, and the seat that was actually kept for you.
  cinema: '<path d="M3 8.5A2 2 0 0 1 5 6.5h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M12 7v1.5M12 11v2M12 15.5V17"/>',
  // A folded paper, the fold showing it was opened and read.
  news: '<path d="M4 5h11a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2z"/><path d="M17 9h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><path d="M7 8.5h5M7 12h5M7 15.5h3"/>',
  // A car and the point it is going to — the fixed destination, which is the product.
  ride: '<path d="M4 15.5h16"/><path d="M5.5 15.5l1.4-4.2A2 2 0 0 1 8.8 10h6.4a2 2 0 0 1 1.9 1.3l1.4 4.2"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/><path d="M12 3.5c1.7 0 3 1.3 3 3 0 2-3 4.5-3 4.5S9 8.5 9 6.5c0-1.7 1.3-3 3-3z"/>',
  // A bed and a key: a room that is actually held for the guest.
  hotels: '<path d="M3 18v-7M3 14h12a4 4 0 0 1 4 4v0"/><path d="M3 18h18"/><circle cx="7" cy="10.5" r="2"/><circle cx="18" cy="7" r="2.2"/><path d="M18 9.2V13M17 11.4h2"/>',
};

// Hero gradient per section. Tenders green and ride teal are kept because readers already know them.
const COLOURS = {
  jobs: ['#1e3a8a', '#2563eb'],
  tenders: ['#064e3b', '#059669'],
  cinema: ['#7c2d12', '#ea580c'],
  news: ['#1f2937', '#475569'],
  ride: ['#0f766e', '#14b8a6'],
  hotels: ['#581c87', '#9333ea'],
};

// The mark as a standalone SVG, sized for a hero badge or an inline icon.
function mark(section, { size = 26, colour = 'currentColor', stroke = 1.8 } = {}) {
  const d = MARKS[section];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${colour}" `
    + `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// The badge that sits in a section hero: the mark in a soft tile, on the section's own colour.
// The hero badge. It was a translucent tile with a white outline mark inside a dark hero, which read as
// a grey box on every page - the owner's words: "a single, uniform logo across all sections". A logo has
// to survive being glanced at: solid white tile, the mark drawn in the section's OWN colour, a little
// depth. Now jobs is a blue mark on white, tenders green, cinema orange - different at a glance, same
// family up close.
function badge(section, { size = 30 } = {}) {
  if (!MARKS[section]) return '';
  const box = size + 20;
  const ink = (COLOURS[section] || COLOURS.news)[0];
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${box}px;height:${box}px;`
    + `border-radius:${Math.round(box / 3.2)}px;background:#fff;flex:none;`
    + `box-shadow:0 6px 16px -6px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.9)">`
    + mark(section, { size, colour: ink, stroke: 2 }) + '</span>';
}

// The header tile, per section.
//
// The owner, twice: the logo at the top of the page is the same green on every page, and it should not
// be - "ride logo another and here job logo make other". So the wordmark stays BinaSmart (that is the
// company and it does not change), and the TILE beside it carries the section's own mark on the
// section's own colour. A reader landing on /jobs from a search sees a jobs logo, not the news one.
// Sections we have no mark for keep the house tile, which is what /static/site-v3.css draws.
const SUFFIX = {
  jobs: 'ሥራ', tenders: 'ጨረታ', news: 'ዜና', cinema: 'ሲኒማ', ride: 'ራይድ', hotels: 'ሆቴል',
};
function brandTile(section, { size = 30 } = {}) {
  if (!MARKS[section]) return '<i class="lg"></i>';
  const c = COLOURS[section] || COLOURS.news;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;`
    + `border-radius:9px;background:linear-gradient(135deg,${c[1]},${c[0]});box-shadow:0 8px 18px -8px ${c[1]}cc;`
    + `vertical-align:middle;margin-right:8px;flex:none">`
    + mark(section, { size: Math.round(size * 0.62), colour: '#fff', stroke: 2.1 }) + '</span>';
}
const suffix = section => SUFFIX[section] || 'ዜና';

const gradient = section => {
  const c = COLOURS[section] || COLOURS.news;
  return `linear-gradient(135deg,${c[0]},${c[1]})`;
};

module.exports = { MARKS, COLOURS, mark, badge, gradient, brandTile, suffix, SUFFIX };
