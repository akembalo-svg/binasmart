# -*- coding: utf-8 -*-
"""The two Ethiopian federal court sites cannot be reached from this server, and Bright Data refuses them
outright: "classified as Government and blocked by Bright Data as it might breach Bright Data usage policy".
Routing through Ethiopia does not change that — it is a policy block, not a geography one.

The Internet Archive has both. This fetches the newest usable snapshot of each and writes it into the
knowledge folder with the snapshot DATE in the front matter and in the body, so Asmat can never present an
archived page as today's position on a court fee or a procedure.

Run:  python3 fetch_courts_archive.py
"""
import json, os, re, sys, time, urllib.parse, urllib.request

OUT = "/var/www/connectcare/binasmart/knowledge/web"
UA = {"user-agent": "Mozilla/5.0 (compatible; BinaSmart/1.0; +https://bina.et)"}
COURTS = [
    dict(id="ffic", host="www.ffic.gov.et", name="የፌዴራል የመጀመሪያ ደረጃ ፍርድ ቤት (Federal First Instance Court)"),
    dict(id="fsc", host="www.fsc.gov.et", name="የፌዴራል ጠቅላይ ፍርድ ቤት (Federal Supreme Court)"),
]
MAX_PAGES = 12


def get(url, timeout=90):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:
        print("   !", str(e)[:70]); return ""


def text_of(html):
    t = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"&nbsp;?", " ", t)
    t = re.sub(r"&amp;", "&", t)
    return re.sub(r"\s+", " ", t).strip()


def usable(t):
    """A snapshot is usable only if it is the site, not an interstitial, and carries real Amharic."""
    if not t or len(t) < 800: return False
    if "1.1.1.1" in t or "Cloudflare" in t[:400]: return False
    return len(re.findall(r"[ሀ-፿]", t)) >= 300


def snapshots(host, since=2023, limit=60):
    u = ("http://web.archive.org/cdx/search/cdx?url=" + urllib.parse.quote(host)
         + "*&output=json&filter=statuscode:200&collapse=urlkey&from=" + str(since) + "&limit=" + str(limit))
    try:
        rows = json.loads(get(u, 120) or "[]")
    except Exception:
        return []
    return [(r[1], r[2]) for r in rows[1:]] if rows else []


total = 0
for c in COURTS:
    print(f"== {c['id']} ({c['host']})")
    snaps = snapshots(c["host"])
    if not snaps:
        print("   no snapshots since 2023"); continue
    # newest first, homepage first
    snaps.sort(key=lambda s: (0 if s[1].rstrip("/").endswith(c["host"]) else 1, -int(s[0])))
    d = os.path.join(OUT, c["id"]); os.makedirs(d, exist_ok=True)
    kept = 0
    seen = set()
    for ts, orig in snaps:
        if kept >= MAX_PAGES: break
        key = orig.rstrip("/")
        if key in seen: continue
        seen.add(key)
        html = get(f"https://web.archive.org/web/{ts}id_/{orig}")
        t = text_of(html)
        if not usable(t):
            continue
        when = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
        title = (re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I) or [None, c["name"]])[1]
        title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title)).strip()[:120]
        name = re.sub(r"[^a-z0-9]+", "-", urllib.parse.urlparse(orig).path.lower()).strip("-") or "home"
        fn = os.path.join(d, f"{name[:60]}-{ts}.md")
        body = (
            "---\n"
            f'url: "{orig}"\n'
            f'title: "{title}"\n'
            f'source_name: "{c["name"]}"\n'
            'lang: "am"\n'
            f'fetched: "{when}"\n'
            f'archived: "https://web.archive.org/web/{ts}/{orig}"\n'
            "---\n\n"
            f"# {title}\n\n"
            f"**This is an archived copy of {orig}, saved on {when}.** The live site cannot be reached from "
            f"BinaSmart's servers. Anything time-sensitive here — a fee, an office, a procedure, a name — may "
            f"have changed since {when} and must be confirmed with the court before anyone relies on it.\n\n"
            + t + "\n")
        open(fn, "w", encoding="utf-8").write(body)
        kept += 1; total += 1
        print(f"   {when}  {len(t):>6} chars  {title[:58]}")
        time.sleep(1.5)
    print(f"   kept {kept}")
print(f"\ntotal pages written: {total}")
