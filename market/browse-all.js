// Browse-all index for the listing hubs (1 Oct 2026). /cars, /property, /hotels and /restaurants draw
// 24-60 cards and load the rest with JavaScript, so crawlers found ~90% of the car, home, hotel and
// restaurant pages only in the sitemap and left them at "Discovered - currently not indexed" (GSC,
// 1 Oct 2026: 0 impressions across 1,100 pages). This renders every child page as a plain link, grouped
// and collapsed, inside a container none of the page scripts touch (they only redraw #cars, #props,
// #dir and #fg). Server-side only; the hubs pass the same list they already loaded.
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// [[label, [{slug, text}]]...], biggest group first, then by name.
function groups(list, keyOf, textOf) {
  const m = new Map();
  for (const x of list || []) {
    if (!x || !x.slug) continue;
    const k = String(keyOf(x) || 'Other').trim() || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ slug: x.slug, text: textOf(x) || x.slug });
  }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function render(title, titleAm, base, gs) {
  const n = gs.reduce((s, g) => s + g[1].length, 0);
  if (!n) return '';
  return '<section id="browse-all" style="max-width:1100px;margin:28px auto 8px;padding:0 16px">'
    + '<h2 style="font-size:1.15rem;margin:0 0 4px">' + esc(title) + ' <span style="color:#64748b;font-weight:600">' + n + '</span> · <span class="am">' + esc(titleAm) + '</span></h2>'
    + '<p style="color:#64748b;font-size:13.5px;margin:0 0 8px">Every page in this section, in one list. Open a group to browse it.</p>'
    + gs.map(([label, items]) => '<details style="border-top:1px solid #e2e8f0;padding:9px 0"><summary style="font-weight:800;cursor:pointer">' + esc(label)
      + ' <span style="color:#64748b;font-weight:600">' + items.length + '</span></summary>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:13.5px;line-height:1.5">'
      + items.map(i => '<a href="' + base + '/' + esc(i.slug) + '">' + esc(i.text) + '</a>').join('') + '</div></details>').join('')
    + '</section>\n';
}

// The sitemap's rule for homes and cars (server.js /sitemap.xml): a listing whose source page was last
// seen more than a year ago may be sold, so it is left out there and here alike.
const fresh = x => !(x && x.updated && Date.parse(x.updated) < Date.now() - 365 * 864e5);

module.exports = { groups, render, esc, fresh };
