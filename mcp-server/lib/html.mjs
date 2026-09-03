const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#8217': '’', '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—' };
export function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENT[e] !== undefined) return ENT[e];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (/^#/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return m;
  });
}

// Guide pages are hand-written HTML: <nav>, <section>/<h2>/<p>/<ul>, <footer>, a few <script>s.
export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<(script|style|nav|footer|header|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  s = s.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export function titleOf(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decode(m[1]).replace(/\s*\|\s*BinaSmart\s*$/i, '').trim() : '';
}

export function descriptionOf(html) {
  const m = /<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i.exec(html);
  return m ? decode(m[1]).trim() : '';
}
