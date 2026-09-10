# -*- coding: utf-8 -*-
"""Real Afaan Oromoo into the corpus.

oromia.gov.et needs its own fetcher: the site prints its own links malformed — href="https://www.oromia.gov.etom/bulchinsa",
with the .et and the /om run together — so the ordinary crawler follows nothing and takes only the homepage.
The working paths are /om/<slug>, discovered by repairing those links.

Fana's Afaan Oromoo section is on a host we already crawl, so it is fetched here under its own id to keep it
separate from the Amharic Fana pages for the boilerplate stripper.

Everything written here is AUTHENTIC Afaan Oromoo written by Oromo speakers. Nothing is machine-translated:
an agent quoting a bad translation of a government rule is the harm we are trying to avoid.
"""
import os, re, time, urllib.parse, urllib.request

OUT = "/var/www/connectcare/binasmart/knowledge/web"
UA = {"user-agent": "Mozilla/5.0 (compatible; BinaSmart/1.0; +https://bina.et)"}
OROMO_WORDS = re.compile(r"\b(fi|kan|akka|irratti|jedhan|hojii|waa'ee|keessa|dha|isaa|Oromiyaa|mootummaa|"
                         r"tajaajila|barbaachisa|qaba|ta'e|namoota|guddina|misooma)\b", re.I)

SITES = [
    dict(id="oromia", name="Waajjira Pirezidaantii Mootummaa Naannoo Oromiyaa (Oromia President Office)",
         base="https://oromia.gov.et", start="https://oromia.gov.et/",
         seeds=["/om/bulchinsa", "/om/oduu", "/om/diyaaspooraa", "/om/daarektaroota", "/om/waaee-waajjiraa",
                "/om/hundeeffama", "/om/caasaa", "/om/ergama", "/om/aangoo", "/om/qonnaa", "/om/hawaasuma",
                "/om/faayinaansii", "/om/industirii", "/om/misooma"]),
    dict(id="fana-om", name="Fana Broadcasting Corporate — Afaan Oromoo",
         base="https://www.fanamc.com", start="https://www.fanamc.com/afaanoromoo/", seeds=[]),
]
MAX = 25


def get(url, timeout=45):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return ""


def text_of(html):
    t = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"&nbsp;?", " ", t).replace("&amp;", "&")
    return re.sub(r"\s+", " ", t).strip()


def is_oromo(t):
    """Real Oromo prose, not a menu and not an error page."""
    if len(t) < 700 or "Page not found" in t or "403 Forbidden" in t:
        return False
    return len(OROMO_WORDS.findall(t)) >= 12


def links_of(html, base, want):
    """Repair the site's malformed hrefs (.etom/x -> .et/om/x) and keep the ones under the wanted prefix."""
    out = set()
    for m in re.finditer(r'href=["\']([^"\'#]+)', html):
        u = m.group(1)
        u = re.sub(r"\.et(om/)", r".et/\1", u)          # the bug on oromia.gov.et
        try:
            full = urllib.parse.urljoin(base + "/", u)
        except Exception:
            continue
        p = urllib.parse.urlparse(full)
        if not p.netloc.endswith(urllib.parse.urlparse(base).netloc.replace("www.", "")):
            continue
        if re.search(r"\.(jpg|jpeg|png|gif|svg|pdf|zip|mp4|mp3|css|js)($|\?)", p.path, re.I):
            continue
        if want and want not in p.path:
            continue
        out.add(p.scheme + "://" + p.netloc + p.path)
    return sorted(out)


total = 0
for s in SITES:
    print(f"== {s['id']}")
    d = os.path.join(OUT, s["id"]); os.makedirs(d, exist_ok=True)
    home = get(s["start"])
    want = "/om" if s["id"] == "oromia" else "afaanoromoo"
    queue = [s["base"] + p for p in s["seeds"]] + links_of(home, s["base"], want)
    seen, kept = set(), 0
    for u in queue:
        if kept >= MAX:
            break
        if u in seen:
            continue
        seen.add(u)
        html = get(u)
        t = text_of(html)
        if not is_oromo(t):
            continue
        title = (re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I) or [None, s["name"]])[1]
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title)).strip()[:120]
        name = re.sub(r"[^a-z0-9]+", "-", urllib.parse.urlparse(u).path.lower()).strip("-") or "home"
        open(os.path.join(d, f"{name[:60]}.md"), "w", encoding="utf-8").write(
            "---\n" + f'url: "{u}"\n' + f'title: "{title}"\n' + f'source_name: "{s["name"]}"\n'
            + 'lang: "om"\n' + f'fetched: "{time.strftime("%Y-%m-%d")}"\n' + "---\n\n"
            + f"# {title}\n\n" + t + "\n")
        kept += 1; total += 1
        print(f"   {len(t):>6} chars  {title[:62]}")
        # follow one level deeper on the first few pages
        if kept <= 6:
            for l in links_of(html, s["base"], want)[:12]:
                if l not in seen and l not in queue:
                    queue.append(l)
        time.sleep(1.2)
    print(f"   kept {kept}")
print(f"\ntotal Afaan Oromoo pages: {total}")
