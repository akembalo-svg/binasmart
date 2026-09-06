# -*- coding: utf-8 -*-
# Internal link graph of bina.et from the sitemap. Run by ops/health/weekly-audit.js; last line is the summary.
#   python3 ops/link-graph.py
# Internal link graph of bina.et from the sitemap. Server-rendered HTML only: the footer is injected
# by bina-footer.js client-side, so footer links are NOT counted (crawlers that don't run JS see it
# the same way). Prints orphans, dead ends, depth from home, weak anchors, and a per-section summary.
import re, sys, json, html, urllib.request, concurrent.futures as cf
from urllib.parse import urljoin, urlsplit
from collections import defaultdict, deque

BASE = 'https://bina.et'
UA = {'User-Agent': 'BinaSmart-linkgraph/1.0'}

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            return r.status, r.read().decode('utf-8', 'ignore')
    except Exception as e:
        return 0, ''

def norm(u):
    p = urlsplit(u)
    path = p.path or '/'
    if path != '/' and path.endswith('/'): path = path[:-1]
    return path

st, sm = get(BASE + '/sitemap.xml')
urls = re.findall(r'<loc>([^<]+)</loc>', sm)
pages = sorted({norm(u) for u in urls if u.startswith(BASE)})
# keep the audit to editorial pages: skip per-building, per-show and per-film IDs
def section(p):
    if p == '/': return 'home'
    if p.startswith('/news/'): return 'news'
    if p.startswith('/tenders/'): return 'tender'
    if p.startswith(('/b/', '/hotel/', '/restaurant/', '/hospital/', '/business/')): return 'place'
    if p.startswith('/cinema/'): return 'cinema-show'
    if p.startswith('/watch/'): return 'film'
    if p.startswith('/flights/'): return 'flight-partner'
    return 'static'
pages = [p for p in pages if section(p) not in ('place', 'cinema-show', 'film', 'tender')]

A_RE = re.compile(r'<a\s[^>]*href="([^"#]+)(?:#[^"]*)?"[^>]*>(.*?)</a>', re.S)
out = {}
def crawl(p):
    st, body = get(BASE + p)
    body = re.sub(r'<script.*?</script>', '', body, flags=re.S)
    links = []
    for href, inner in A_RE.findall(body):
        if href.startswith(('http', '//')) and not href.startswith(BASE): continue
        if href.startswith(('mailto:', 'tel:', 'javascript:', 'wa.me')): continue
        tgt = norm(urljoin(BASE + p, href))
        if tgt.startswith('/static/') or tgt == p: continue
        anchor = html.unescape(re.sub(r'<[^>]+>', ' ', inner)); anchor = re.sub(r'\s+', ' ', anchor).strip()
        links.append((tgt, anchor))
    return p, st, links

with cf.ThreadPoolExecutor(4) as ex:
    for p, st, links in ex.map(crawl, pages):
        out[p] = (st, links)

inb = defaultdict(list)
for p, (st, links) in out.items():
    for tgt, anchor in links:
        inb[tgt].append((p, anchor))

# depth from home over the crawled graph
depth = {'/': 0}; q = deque(['/'])
while q:
    p = q.popleft()
    for tgt, _ in out.get(p, (0, []))[1]:
        if tgt in out and tgt not in depth:
            depth[tgt] = depth[p] + 1; q.append(tgt)

pageset = set(out)
res = {'pages': len(out), 'total_links': sum(len(l) for _, l in out.values())}
res['orphans'] = sorted(p for p in out if p != '/' and not [s for s, _ in inb[p] if s in pageset])
res['one_inlink'] = sorted((p, sorted({s for s, _ in inb[p]})) for p in out if p != '/' and len({s for s, _ in inb[p] if s in pageset}) == 1)
res['dead_ends'] = sorted(p for p, (st, l) in out.items() if len([t for t, _ in l if t in pageset]) == 0)
res['unreachable_from_home'] = sorted(p for p in out if p not in depth)
res['deep'] = sorted((p, d) for p, d in depth.items() if d >= 4)
res['broken_internal'] = sorted({t for p, (st, l) in out.items() for t, _ in l if t not in pageset and not t.startswith(('/b/', '/cinema/', '/watch/', '/tenders/', '/hotel/', '/restaurant/', '/hospital/', '/business/', '/flights/', '/news/'))})
weak = defaultdict(list)
for p, (st, l) in out.items():
    for t, a in l:
        if re.fullmatch(r'(→|»|>|click here|read more|here|more|ተጨማሪ|ይመልከቱ|→ ?)', a.lower()) or a == '':
            weak[p].append((t, a))
res['weak_anchor_pages'] = sorted((p, len(v)) for p, v in weak.items())
res['non200'] = sorted((p, st) for p, (st, l) in out.items() if st != 200)
bysec = defaultdict(lambda: [0, 0, 0])
for p, (st, l) in out.items():
    s = section(p); bysec[s][0] += 1; bysec[s][1] += len([t for t, _ in l if t in pageset]); bysec[s][2] += len({x for x, _ in inb[p] if x in pageset})
res['by_section'] = {k: {'pages': v[0], 'out': v[1], 'in': v[2]} for k, v in bysec.items()}
# inbound counts for the guides and law posts specifically
res['guide_inlinks'] = sorted((len({s for s, _ in inb[p] if s in pageset}), p) for p in out if section(p) == 'static' and p.count('/') == 1)
res['news_inlinks'] = sorted((len({s for s, _ in inb[p] if s in pageset}), p) for p in out if section(p) == 'news')
ed = lambda xs: [x for x in xs if not (x[0] if isinstance(x, list) else x).startswith('/shop/')]
res['summary'] = 'linkgraph: %d pages, %d internal links, %d orphaned editorial pages, %d unreachable from home, %d news posts with no inbound link' % (len(out), res['total_links'], len(ed(res['orphans'])), len(ed(res['unreachable_from_home'])), len([1 for n, p in res['news_inlinks'] if n == 0]))
json.dump(res, open('/tmp/linkgraph.json', 'w'), ensure_ascii=False, indent=1)
json.dump({p: {'status': st, 'links': l} for p, (st, l) in out.items()}, open('/tmp/linkgraph-raw.json', 'w'), ensure_ascii=False)
print(json.dumps({k: res[k] for k in ['pages', 'total_links', 'by_section', 'non200', 'orphans', 'dead_ends', 'unreachable_from_home', 'deep', 'broken_internal']}, ensure_ascii=False, indent=1))
print('ONE_INLINK', json.dumps(res['one_inlink'], ensure_ascii=False))
print('WEAK', json.dumps(res['weak_anchor_pages'], ensure_ascii=False))
print('GUIDE_IN', json.dumps(res['guide_inlinks'], ensure_ascii=False))
print('NEWS_IN', json.dumps(res['news_inlinks'], ensure_ascii=False))
print(res['summary'])
